use morpheus_core::{
    FrameBatch, MultiChannelRing, MRPH_FLAG_SIMULATED, fnv1a_stream_id,
};
use sha2::{Digest, Sha256};
use std::{
    env,
    fs::{self, File},
    io::{BufWriter, Write},
    net::UdpSocket,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone)]
struct Config {
    stream_name: String,
    sample_rate_hz: f32,
    channels: usize,
    batch_frames: usize,
    ring_seconds: usize,
    udp_target: Option<String>,
    record_dir: Option<PathBuf>,
}

impl Config {
    fn from_env() -> Self {
        let sample_rate_hz = env_num("MORPHEUS_SAMPLE_RATE", 1024.0_f32).max(1.0);
        let channels = env_num("MORPHEUS_CHANNELS", 8_usize).clamp(1, 4096);
        let configured_batch = env_num("MORPHEUS_BATCH_FRAMES", 16_usize).clamp(1, 1024);
        let max_datagram_frames =
            ((48 * 1024usize).saturating_sub(24) / (8 + channels * 4)).max(1);
        let batch_frames = configured_batch.min(max_datagram_frames);
        let ring_seconds = env_num("MORPHEUS_RING_SECONDS", 8_usize).clamp(1, 120);
        let udp_target = env::var("MORPHEUS_UDP_TARGET").ok().filter(|value| !value.is_empty());
        let record_dir = env::var("MORPHEUS_RECORD_DIR")
            .ok()
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);

        Self {
            stream_name: env::var("MORPHEUS_STREAM_NAME")
                .unwrap_or_else(|_| "Morpheus Native Reference".to_string()),
            sample_rate_hz,
            channels,
            batch_frames,
            ring_seconds,
            udp_target,
            record_dir,
        }
    }
}

struct SessionRecorder {
    path: PathBuf,
    writer: BufWriter<File>,
    packets: u64,
    frames: u64,
    started_unix_ns: u128,
}

impl SessionRecorder {
    fn create(dir: &Path, stream_name: &str) -> std::io::Result<Self> {
        fs::create_dir_all(dir)?;
        let started_unix_ns = unix_ns();
        let safe = sanitize(stream_name);
        let path = dir.join(format!("{safe}-{started_unix_ns}.mrph"));
        let mut writer = BufWriter::with_capacity(1024 * 1024, File::create(&path)?);
        writer.write_all(b"MRPHSESSION\x01")?;
        writer.write_all(&(started_unix_ns as u64).to_le_bytes())?;

        Ok(Self {
            path,
            writer,
            packets: 0,
            frames: 0,
            started_unix_ns,
        })
    }

    fn append(&mut self, packet: &[u8], frame_count: usize) -> std::io::Result<()> {
        self.writer.write_all(&(packet.len() as u32).to_le_bytes())?;
        self.writer.write_all(packet)?;
        self.packets = self.packets.saturating_add(1);
        self.frames = self.frames.saturating_add(frame_count as u64);
        Ok(())
    }

    fn finish(mut self, config: &Config) -> std::io::Result<()> {
        self.writer.flush()?;
        drop(self.writer);

        let bytes = fs::read(&self.path)?;
        let digest = Sha256::digest(&bytes);
        let sha256 = hex_lower(&digest);
        let manifest = self.path.with_extension("mrph.manifest.json");

        let json = format!(
            concat!(
                "{{\n",
                "  \"schema\": \"morpheus-native-session-v1\",\n",
                "  \"stream\": \"{}\",\n",
                "  \"sample_rate_hz\": {},\n",
                "  \"channels\": {},\n",
                "  \"packets\": {},\n",
                "  \"frames\": {},\n",
                "  \"started_unix_ns\": {},\n",
                "  \"stopped_unix_ns\": {},\n",
                "  \"bytes\": {},\n",
                "  \"sha256\": \"{}\"\n",
                "}}\n"
            ),
            json_escape(&config.stream_name),
            config.sample_rate_hz,
            config.channels,
            self.packets,
            self.frames,
            self.started_unix_ns,
            unix_ns(),
            bytes.len(),
            sha256,
        );

        fs::write(manifest, json)
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::from_env();

    let running = Arc::new(AtomicBool::new(true));
    {
        let running = Arc::clone(&running);
        ctrlc::set_handler(move || running.store(false, Ordering::SeqCst))?;
    }

    let capacity = (config.sample_rate_hz.ceil() as usize)
        .saturating_mul(config.ring_seconds)
        .max(config.batch_frames * 2);
    let mut ring = MultiChannelRing::new(config.channels, capacity)?;

    let socket = match &config.udp_target {
        Some(target) => {
            let socket = UdpSocket::bind("0.0.0.0:0")?;
            socket.connect(target)?;
            Some(socket)
        }
        None => None,
    };

    let mut recorder = match &config.record_dir {
        Some(dir) => Some(SessionRecorder::create(dir, &config.stream_name)?),
        None => None,
    };

    eprintln!(
        "Morpheus native gateway v0.7 | stream={} | {} Hz | {} ch | batch={} | target={}",
        config.stream_name,
        config.sample_rate_hz,
        config.channels,
        config.batch_frames,
        config.udp_target.as_deref().unwrap_or("disabled"),
    );

    let stream_id = fnv1a_stream_id(&config.stream_name);
    let interval = Duration::from_secs_f64(config.batch_frames as f64 / config.sample_rate_hz as f64);
    let started = Instant::now();
    let wall_origin = system_seconds();
    let mut next_deadline = Instant::now();
    let mut sequence = 0u32;
    let mut generated_frames = 0u64;
    let mut phase = vec![0.0_f64; config.channels];

    while running.load(Ordering::SeqCst) {
        let mut timestamps = Vec::with_capacity(config.batch_frames);
        let mut samples = Vec::with_capacity(config.batch_frames * config.channels);

        for frame in 0..config.batch_frames {
            let logical_frame = generated_frames + frame as u64;
            let timestamp = wall_origin + logical_frame as f64 / config.sample_rate_hz as f64;
            timestamps.push(timestamp);

            for channel in 0..config.channels {
                let fundamental = 6.0 + channel as f64 * 0.17;
                phase[channel] += 2.0 * std::f64::consts::PI * fundamental
                    / config.sample_rate_hz as f64;
                let secondary = phase[channel] * (1.9 + (channel % 5) as f64 * 0.03);
                let value =
                    phase[channel].sin() * 0.12 + secondary.sin() * 0.035;
                samples.push(value as f32);
            }
        }

        for frame in 0..config.batch_frames {
            let start = frame * config.channels;
            ring.push_frame(
                timestamps[frame],
                &samples[start..start + config.channels],
            )?;
        }

        let batch = FrameBatch {
            flags: MRPH_FLAG_SIMULATED,
            sequence,
            stream_id,
            sample_rate_hz: config.sample_rate_hz,
            channel_count: config.channels as u16,
            timestamps,
            samples,
        };
        let packet = batch.encode()?;

        if let Some(socket) = &socket {
            let _ = socket.send(&packet)?;
        }
        if let Some(recorder) = recorder.as_mut() {
            recorder.append(&packet, config.batch_frames)?;
        }

        sequence = sequence.wrapping_add(1);
        generated_frames = generated_frames.saturating_add(config.batch_frames as u64);

        next_deadline += interval;
        let now = Instant::now();
        if next_deadline > now {
            thread::sleep(next_deadline - now);
        } else if now.duration_since(next_deadline) > Duration::from_secs(1) {
            next_deadline = now;
        }

        let log_interval_frames =
            (config.sample_rate_hz.max(1.0) as u64).saturating_mul(10).max(1);
        if started.elapsed().as_secs() > 0
            && generated_frames % log_interval_frames < config.batch_frames as u64
        {
            eprintln!(
                "frames={} packets={} ring={} / {}",
                generated_frames,
                sequence,
                ring.len(),
                ring.capacity()
            );
        }
    }

    if let Some(recorder) = recorder {
        recorder.finish(&config)?;
    }

    eprintln!(
        "Morpheus native gateway stopped cleanly after {} frames.",
        generated_frames
    );
    Ok(())
}

fn env_num<T>(name: &str, default: T) -> T
where
    T: std::str::FromStr,
{
    env::var(name)
        .ok()
        .and_then(|value| value.parse::<T>().ok())
        .unwrap_or(default)
}

fn unix_ns() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn system_seconds() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

fn sanitize(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else if ch.is_whitespace() {
            out.push('-');
        }
    }
    if out.is_empty() {
        "session".to_string()
    } else {
        out
    }
}

fn json_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}
