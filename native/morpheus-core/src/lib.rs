//! Native bounded signal primitives for Morpheus.
//!
//! The crate deliberately avoids dynamic allocation on the steady-state ring
//! hot path and defines the binary MRPH v1 packet protocol shared by the local
//! gateway and browser ingestion worker.

use std::fmt;

pub const MRPH_MAGIC: [u8; 4] = *b"MRPH";
pub const MRPH_VERSION: u16 = 1;
pub const MRPH_FLAG_SIMULATED: u16 = 1;
pub const MRPH_HEADER_BYTES: usize = 24;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RingError {
    ZeroChannels,
    ZeroCapacity,
    FrameWidth { expected: usize, received: usize },
    ChannelOutOfRange { channel: usize, channels: usize },
}

#[derive(Debug, Clone)]
pub struct MultiChannelRing {
    channels: usize,
    capacity: usize,
    data: Vec<f32>,
    timestamps: Vec<f64>,
    write_index: usize,
    len: usize,
    frames_written: u64,
}

impl MultiChannelRing {
    pub fn new(channels: usize, capacity: usize) -> Result<Self, RingError> {
        if channels == 0 {
            return Err(RingError::ZeroChannels);
        }
        if capacity == 0 {
            return Err(RingError::ZeroCapacity);
        }

        Ok(Self {
            channels,
            capacity,
            data: vec![0.0; channels * capacity],
            timestamps: vec![0.0; capacity],
            write_index: 0,
            len: 0,
            frames_written: 0,
        })
    }

    #[inline]
    pub fn channels(&self) -> usize {
        self.channels
    }

    #[inline]
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    #[inline]
    pub fn frames_written(&self) -> u64 {
        self.frames_written
    }

    #[inline]
    pub fn push_frame(&mut self, timestamp: f64, frame: &[f32]) -> Result<(), RingError> {
        if frame.len() != self.channels {
            return Err(RingError::FrameWidth {
                expected: self.channels,
                received: frame.len(),
            });
        }

        let base = self.write_index * self.channels;
        self.data[base..base + self.channels].copy_from_slice(frame);
        self.timestamps[self.write_index] = timestamp;

        self.write_index += 1;
        if self.write_index == self.capacity {
            self.write_index = 0;
        }

        self.len = (self.len + 1).min(self.capacity);
        self.frames_written = self.frames_written.saturating_add(1);
        Ok(())
    }

    pub fn copy_channel(
        &self,
        channel: usize,
        count: usize,
        output: &mut [f32],
    ) -> Result<usize, RingError> {
        if channel >= self.channels {
            return Err(RingError::ChannelOutOfRange {
                channel,
                channels: self.channels,
            });
        }

        let n = count.min(self.len).min(output.len());
        if n == 0 {
            return Ok(0);
        }

        let start = (self.write_index + self.capacity - n) % self.capacity;

        for (offset, slot) in output.iter_mut().take(n).enumerate() {
            let frame_index = (start + offset) % self.capacity;
            *slot = self.data[frame_index * self.channels + channel];
        }

        Ok(n)
    }

    pub fn copy_interleaved(
        &self,
        count: usize,
        output: &mut [f32],
        timestamp_output: &mut [f64],
    ) -> usize {
        let max_frames = output.len() / self.channels;
        let n = count
            .min(self.len)
            .min(max_frames)
            .min(timestamp_output.len());
        if n == 0 {
            return 0;
        }

        let start = (self.write_index + self.capacity - n) % self.capacity;

        for frame_offset in 0..n {
            let frame_index = (start + frame_offset) % self.capacity;
            let source =
                &self.data[frame_index * self.channels..(frame_index + 1) * self.channels];
            let target_start = frame_offset * self.channels;
            output[target_start..target_start + self.channels].copy_from_slice(source);
            timestamp_output[frame_offset] = self.timestamps[frame_index];
        }

        n
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct FrameBatch {
    pub flags: u16,
    pub sequence: u32,
    pub stream_id: u32,
    pub sample_rate_hz: f32,
    pub channel_count: u16,
    pub timestamps: Vec<f64>,
    pub samples: Vec<f32>,
}

impl FrameBatch {
    pub fn frame_count(&self) -> usize {
        self.timestamps.len()
    }

    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.channel_count == 0 {
            return Err(ProtocolError::InvalidChannelCount);
        }
        if self.timestamps.is_empty() {
            return Err(ProtocolError::InvalidFrameCount);
        }
        let expected = self.timestamps.len() * self.channel_count as usize;
        if self.samples.len() != expected {
            return Err(ProtocolError::PayloadLength {
                expected,
                received: self.samples.len(),
            });
        }
        Ok(())
    }

    pub fn encoded_len(&self) -> usize {
        MRPH_HEADER_BYTES
            + self.frame_count() * (8 + self.channel_count as usize * std::mem::size_of::<f32>())
    }

    pub fn encode(&self) -> Result<Vec<u8>, ProtocolError> {
        self.validate()?;
        if self.frame_count() > u16::MAX as usize {
            return Err(ProtocolError::InvalidFrameCount);
        }

        let mut out = Vec::with_capacity(self.encoded_len());
        out.extend_from_slice(&MRPH_MAGIC);
        out.extend_from_slice(&MRPH_VERSION.to_le_bytes());
        out.extend_from_slice(&self.flags.to_le_bytes());
        out.extend_from_slice(&self.sequence.to_le_bytes());
        out.extend_from_slice(&self.stream_id.to_le_bytes());
        out.extend_from_slice(&self.sample_rate_hz.to_le_bytes());
        out.extend_from_slice(&self.channel_count.to_le_bytes());
        out.extend_from_slice(&(self.frame_count() as u16).to_le_bytes());

        let channels = self.channel_count as usize;
        for frame in 0..self.frame_count() {
            out.extend_from_slice(&self.timestamps[frame].to_le_bytes());
            let start = frame * channels;
            for value in &self.samples[start..start + channels] {
                out.extend_from_slice(&value.to_le_bytes());
            }
        }

        Ok(out)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, ProtocolError> {
        if bytes.len() < MRPH_HEADER_BYTES {
            return Err(ProtocolError::Truncated);
        }
        if bytes[0..4] != MRPH_MAGIC {
            return Err(ProtocolError::Magic);
        }

        let version = read_u16(bytes, 4)?;
        if version != MRPH_VERSION {
            return Err(ProtocolError::Version(version));
        }

        let flags = read_u16(bytes, 6)?;
        let sequence = read_u32(bytes, 8)?;
        let stream_id = read_u32(bytes, 12)?;
        let sample_rate_hz = read_f32(bytes, 16)?;
        let channel_count = read_u16(bytes, 20)?;
        let frame_count = read_u16(bytes, 22)? as usize;

        if channel_count == 0 {
            return Err(ProtocolError::InvalidChannelCount);
        }
        if frame_count == 0 {
            return Err(ProtocolError::InvalidFrameCount);
        }

        let channels = channel_count as usize;
        let stride = 8 + channels * 4;
        let expected_len = MRPH_HEADER_BYTES + frame_count * stride;
        if bytes.len() < expected_len {
            return Err(ProtocolError::Truncated);
        }

        let mut timestamps = Vec::with_capacity(frame_count);
        let mut samples = Vec::with_capacity(frame_count * channels);
        let mut offset = MRPH_HEADER_BYTES;

        for _ in 0..frame_count {
            timestamps.push(read_f64(bytes, offset)?);
            offset += 8;
            for _ in 0..channels {
                samples.push(read_f32(bytes, offset)?);
                offset += 4;
            }
        }

        Ok(Self {
            flags,
            sequence,
            stream_id,
            sample_rate_hz,
            channel_count,
            timestamps,
            samples,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    Truncated,
    Magic,
    Version(u16),
    InvalidChannelCount,
    InvalidFrameCount,
    PayloadLength { expected: usize, received: usize },
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Truncated => write!(f, "truncated MRPH packet"),
            Self::Magic => write!(f, "invalid MRPH magic"),
            Self::Version(value) => write!(f, "unsupported MRPH version {value}"),
            Self::InvalidChannelCount => write!(f, "invalid channel count"),
            Self::InvalidFrameCount => write!(f, "invalid frame count"),
            Self::PayloadLength { expected, received } => {
                write!(f, "invalid payload length: expected {expected}, received {received}")
            }
        }
    }
}

impl std::error::Error for ProtocolError {}

pub fn fnv1a_stream_id(value: &str) -> u32 {
    let mut hash = 2_166_136_261u32;
    for byte in value.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(16_777_619);
    }
    hash
}

pub fn rms(values: &[f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    let energy = values
        .iter()
        .map(|value| (*value as f64) * (*value as f64))
        .sum::<f64>();
    (energy / values.len() as f64).sqrt() as f32
}

pub fn min_max_envelope(values: &[f32], buckets: usize) -> Vec<(f32, f32)> {
    if values.is_empty() || buckets == 0 {
        return Vec::new();
    }

    let bucket_count = buckets.min(values.len());
    let mut out = Vec::with_capacity(bucket_count);

    for bucket in 0..bucket_count {
        let start = bucket * values.len() / bucket_count;
        let mut end = (bucket + 1) * values.len() / bucket_count;
        if end <= start {
            end = start + 1;
        }

        let mut min = f32::INFINITY;
        let mut max = f32::NEG_INFINITY;
        for value in &values[start..end] {
            min = min.min(*value);
            max = max.max(*value);
        }
        out.push((min, max));
    }

    out
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, ProtocolError> {
    let data: [u8; 2] = bytes
        .get(offset..offset + 2)
        .ok_or(ProtocolError::Truncated)?
        .try_into()
        .map_err(|_| ProtocolError::Truncated)?;
    Ok(u16::from_le_bytes(data))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, ProtocolError> {
    let data: [u8; 4] = bytes
        .get(offset..offset + 4)
        .ok_or(ProtocolError::Truncated)?
        .try_into()
        .map_err(|_| ProtocolError::Truncated)?;
    Ok(u32::from_le_bytes(data))
}

fn read_f32(bytes: &[u8], offset: usize) -> Result<f32, ProtocolError> {
    let data: [u8; 4] = bytes
        .get(offset..offset + 4)
        .ok_or(ProtocolError::Truncated)?
        .try_into()
        .map_err(|_| ProtocolError::Truncated)?;
    Ok(f32::from_le_bytes(data))
}

fn read_f64(bytes: &[u8], offset: usize) -> Result<f64, ProtocolError> {
    let data: [u8; 8] = bytes
        .get(offset..offset + 8)
        .ok_or(ProtocolError::Truncated)?
        .try_into()
        .map_err(|_| ProtocolError::Truncated)?;
    Ok(f64::from_le_bytes(data))
}

#[derive(Debug, Clone, Copy, Default)]
struct Complex {
    re: f64,
    im: f64,
}

impl Complex {
    #[inline]
    fn add(self, other: Self) -> Self {
        Self {
            re: self.re + other.re,
            im: self.im + other.im,
        }
    }

    #[inline]
    fn sub(self, other: Self) -> Self {
        Self {
            re: self.re - other.re,
            im: self.im - other.im,
        }
    }

    #[inline]
    fn mul(self, other: Self) -> Self {
        Self {
            re: self.re * other.re - self.im * other.im,
            im: self.re * other.im + self.im * other.re,
        }
    }

    #[inline]
    fn norm_sqr(self) -> f64 {
        self.re * self.re + self.im * self.im
    }
}

/// Radix-2 FFT power spectrum. The input is windowed with Hann coefficients,
/// zero padded to the next power of two, and the positive-frequency power bins
/// are returned. This is a native engineering primitive, not a clinical
/// interpretation.
pub fn fft_power_spectrum(values: &[f32]) -> Vec<f64> {
    if values.is_empty() {
        return Vec::new();
    }

    let n = values.len().next_power_of_two().max(2);
    let mut data = vec![Complex::default(); n];
    let denominator = (values.len().saturating_sub(1)).max(1) as f64;

    for (index, value) in values.iter().enumerate() {
        let window =
            0.5 - 0.5 * (2.0 * std::f64::consts::PI * index as f64 / denominator).cos();
        data[index].re = *value as f64 * window;
    }

    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            data.swap(i, j);
        }
    }

    let mut len = 2usize;
    while len <= n {
        let angle = -2.0 * std::f64::consts::PI / len as f64;
        let wlen = Complex {
            re: angle.cos(),
            im: angle.sin(),
        };

        for start in (0..n).step_by(len) {
            let mut w = Complex { re: 1.0, im: 0.0 };
            for offset in 0..len / 2 {
                let u = data[start + offset];
                let v = data[start + offset + len / 2].mul(w);
                data[start + offset] = u.add(v);
                data[start + offset + len / 2] = u.sub(v);
                w = w.mul(wlen);
            }
        }

        len <<= 1;
    }

    data[..=n / 2]
        .iter()
        .map(|value| value.norm_sqr() / (n as f64 * n as f64))
        .collect()
}

pub fn band_power(
    values: &[f32],
    sample_rate_hz: f64,
    low_hz: f64,
    high_hz: f64,
) -> f64 {
    if values.is_empty()
        || sample_rate_hz <= 0.0
        || low_hz < 0.0
        || high_hz <= low_hz
    {
        return 0.0;
    }

    let spectrum = fft_power_spectrum(values);
    if spectrum.is_empty() {
        return 0.0;
    }

    let fft_size = (spectrum.len().saturating_sub(1) * 2).max(2);
    spectrum
        .iter()
        .enumerate()
        .filter_map(|(index, power)| {
            let frequency = index as f64 * sample_rate_hz / fft_size as f64;
            if frequency >= low_hz && frequency < high_hz {
                Some(*power)
            } else {
                None
            }
        })
        .sum()
}

#[derive(Debug, Clone)]
pub struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl Biquad {
    pub fn notch(sample_rate_hz: f64, frequency_hz: f64, q: f64) -> Option<Self> {
        if sample_rate_hz <= 0.0
            || frequency_hz <= 0.0
            || frequency_hz >= sample_rate_hz / 2.0
            || q <= 0.0
        {
            return None;
        }

        let omega = 2.0 * std::f64::consts::PI * frequency_hz / sample_rate_hz;
        let alpha = omega.sin() / (2.0 * q);
        let a0 = 1.0 + alpha;

        Some(Self {
            b0: 1.0 / a0,
            b1: -2.0 * omega.cos() / a0,
            b2: 1.0 / a0,
            a1: -2.0 * omega.cos() / a0,
            a2: (1.0 - alpha) / a0,
            z1: 0.0,
            z2: 0.0,
        })
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let x = input as f64;
        let output = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * output + self.z2;
        self.z2 = self.b2 * x - self.a2 * output;
        output as f32
    }

    pub fn process_in_place(&mut self, values: &mut [f32]) {
        for value in values {
            *value = self.process(*value);
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_preserves_recent_frames_and_timestamps() {
        let mut ring = MultiChannelRing::new(2, 3).unwrap();
        ring.push_frame(1.0, &[1.0, 10.0]).unwrap();
        ring.push_frame(2.0, &[2.0, 20.0]).unwrap();
        ring.push_frame(3.0, &[3.0, 30.0]).unwrap();
        ring.push_frame(4.0, &[4.0, 40.0]).unwrap();

        let mut out = [0.0; 6];
        let mut timestamps = [0.0; 3];
        let frames = ring.copy_interleaved(3, &mut out, &mut timestamps);

        assert_eq!(frames, 3);
        assert_eq!(out, [2.0, 20.0, 3.0, 30.0, 4.0, 40.0]);
        assert_eq!(timestamps, [2.0, 3.0, 4.0]);
        assert_eq!(ring.frames_written(), 4);
    }

    #[test]
    fn rejects_wrong_frame_width() {
        let mut ring = MultiChannelRing::new(4, 8).unwrap();
        assert_eq!(
            ring.push_frame(0.0, &[1.0, 2.0]),
            Err(RingError::FrameWidth {
                expected: 4,
                received: 2,
            })
        );
    }

    #[test]
    fn protocol_round_trip() {
        let batch = FrameBatch {
            flags: MRPH_FLAG_SIMULATED,
            sequence: 42,
            stream_id: fnv1a_stream_id("EEG"),
            sample_rate_hz: 1024.0,
            channel_count: 2,
            timestamps: vec![10.0, 10.0009765625],
            samples: vec![1.0, 2.0, 3.0, 4.0],
        };

        let encoded = batch.encode().unwrap();
        let decoded = FrameBatch::decode(&encoded).unwrap();
        assert_eq!(decoded, batch);
    }

    #[test]
    fn envelope_preserves_extrema() {
        let values = [0.0, 0.1, 7.0, 0.2, -5.0, 0.1, 0.0, 0.0];
        let envelope = min_max_envelope(&values, 4);
        assert!(envelope.iter().any(|(_, max)| *max == 7.0));
        assert!(envelope.iter().any(|(min, _)| *min == -5.0));
    }

    #[test]
    fn rms_is_stable() {
        let value = rms(&[1.0, -1.0, 1.0, -1.0]);
        assert!((value - 1.0).abs() < 1e-6);
    }

    #[test]
    fn fft_localizes_ten_hertz_energy() {
        let sample_rate = 256.0;
        let samples: Vec<f32> = (0..256)
            .map(|index| {
                (2.0 * std::f64::consts::PI * 10.0 * index as f64 / sample_rate)
                    .sin() as f32
            })
            .collect();

        let alpha = band_power(&samples, sample_rate, 8.0, 13.0);
        let delta = band_power(&samples, sample_rate, 0.5, 4.0);
        assert!(alpha > delta * 100.0);
    }

    #[test]
    fn notch_filter_remains_finite() {
        let mut filter = Biquad::notch(1000.0, 60.0, 30.0).unwrap();
        let mut samples = vec![1.0_f32; 4096];
        filter.process_in_place(&mut samples);
        assert!(samples.iter().all(|value| value.is_finite()));
    }
}
