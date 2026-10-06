//! Executes the retained Rust implementation as the migration oracle.
#[path = "../../morpheus-core/src/lib.rs"]
mod core;
use std::{env,fs};
fn main() -> Result<(),Box<dyn std::error::Error>> {
  let args:Vec<String>=env::args().collect();
  if args.len()==2&&args[1]=="dsp" {
    let values:Vec<f32>=(0..256).map(|i|(2.0*std::f64::consts::PI*10.0*i as f64/256.0).sin() as f32).collect();
    let spectrum=core::fft_power_spectrum(&values);
    let mut notch=core::Biquad::notch(256.0,60.0,30.0).unwrap();
    let filtered:Vec<f32>=values.iter().map(|x|notch.process(*x)).collect();
    let envelope=core::min_max_envelope(&values,7);
    print!("{{\"rms\":{},\"alpha\":{},\"spectrum\":[",core::rms(&values),core::band_power(&values,256.0,8.0,13.0));
    for (i,x) in spectrum.iter().enumerate() {if i>0 {print!(",");}print!("{x}");}
    print!("],\"notch\":[");
    for (i,x) in filtered.iter().enumerate() {if i>0 {print!(",");}print!("{x}");}
    print!("],\"envelope\":[");
    for (i,(min,max)) in envelope.iter().enumerate() {if i>0 {print!(",");}print!("[{min},{max}]");}
    println!("]}}");return Ok(());
  }
  if args.len()!=4||args[1]!="roundtrip" {return Err("usage: rust_reference roundtrip input output | dsp".into());}
  let batch=core::FrameBatch::decode(&fs::read(&args[2])?)?;
  fs::write(&args[3],batch.encode()?)?;Ok(())
}
