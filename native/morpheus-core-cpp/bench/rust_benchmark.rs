#[path = "../../morpheus-core/src/lib.rs"]
mod core;
use std::{time::Instant,hint::black_box};
fn measure<F:FnMut()>(name:&str,iterations:usize,scalars:usize,timing_group:usize,mut f:F) {
  let mut samples=Vec::with_capacity(iterations);
  for _ in 0..100 {f();}
  let start=Instant::now();
  for i in (0..iterations).step_by(timing_group) {
    let count=timing_group.min(iterations-i);let t=Instant::now();for _ in 0..count {f();}
    samples.push(t.elapsed().as_secs_f64()*1e6/count as f64);
  }
  let elapsed=start.elapsed().as_secs_f64();samples.sort_by(|a,b|a.total_cmp(b));
  let percentile=|q:f64|samples[(q*(samples.len()-1) as f64) as usize];
  let rate=iterations as f64/elapsed;
  println!("{name},{iterations},{rate},{},{},{},{}",rate*scalars as f64,percentile(0.5),percentile(0.95),percentile(0.99));
}
fn main() {
  let channels=256;let frames=16;
  let mut ring=core::MultiChannelRing::new(channels,2048).unwrap();
  let frame=vec![0.1;channels];
  let batch=core::FrameBatch{flags:1,sequence:0,stream_id:42,sample_rate_hz:2000.0,channel_count:channels as u16,timestamps:vec![10.0;frames],samples:vec![0.1;channels*frames]};
  let packet=batch.encode().unwrap();let signal=vec![0.1;1024];
  println!("operation,iterations,operations_per_sec,scalar_samples_per_sec,p50_us,p95_us,p99_us");
  measure("ring_push_256ch",100000,channels,32,||{black_box(&mut ring).push_frame(10.0,black_box(&frame)).unwrap();});
  measure("encode_256ch_16frames_allocating",10000,channels*frames,1,||{black_box(batch.encode().unwrap());});
  measure("decode_256ch_16frames_allocating",10000,channels*frames,1,||{black_box(core::FrameBatch::decode(black_box(&packet)).unwrap());});
  measure("fft_1024_allocating",2000,1024,1,||{black_box(core::fft_power_spectrum(black_box(&signal)));});
  measure("rms_1024",20000,1024,1,||{black_box(core::rms(black_box(&signal)));});
  eprintln!("Retained Rust behavior: no finite-value validation in ring/decoder, allocation per encode/decode/FFT.");
}
