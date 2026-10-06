#include "morpheus/protocol.hpp"
#include "morpheus/ring.hpp"
#include "morpheus/dsp.hpp"
#include "morpheus/recording.hpp"
#include <array>
#include <cmath>
#include <complex>
#include <filesystem>
#include <iostream>
#include <limits>
#include <numbers>
#include <random>
#include <stdexcept>
#include <string>
#include <unistd.h>

namespace {
std::size_t checks=0;
void check(bool condition,const char* expression,int line) {
  ++checks;if (!condition) throw std::runtime_error(std::string(expression)+" at line "+std::to_string(line));
}
#define CHECK(expression) check((expression),#expression,__LINE__)
template<class F> bool throws(F&& fn) { try { fn();return false; } catch (const std::exception&) { return true; } }
bool close(double a,double b,double tolerance=1e-8) { return std::abs(a-b)<=tolerance; }
morpheus::FrameBatch batch() {
  return {1,42,morpheus::fnv1a_stream_id("EEG"),1024,2,{10,10.0009765625},{1,2,3,4}};
}
std::vector<std::uint8_t> encode(const morpheus::FrameBatch& b) {
  std::vector<std::uint8_t> bytes(morpheus::encoded_size(b));std::size_t size=0;
  CHECK(morpheus::encode_into(b,bytes,size)==morpheus::ProtocolError::none);CHECK(size==bytes.size());return bytes;
}
void protocol() {
  const auto original=batch();auto bytes=encode(original);
  CHECK(bytes.size()==56);CHECK(bytes[0]=='M'&&bytes[4]==1&&bytes[8]==42);
  morpheus::FrameBatch out;
  CHECK(morpheus::decode_into(bytes,out)==morpheus::ProtocolError::none);
  CHECK(out.samples==original.samples&&out.timestamps==original.timestamps&&out.stream_id==original.stream_id);
  CHECK(encode(out)==bytes);
  for (std::size_t i=0;i<bytes.size();++i) CHECK(morpheus::decode_into(std::span(bytes.data(),i),out)!=morpheus::ProtocolError::none);
  CHECK(out.samples==original.samples);
  auto mutated=bytes;mutated.push_back(0);CHECK(morpheus::decode_into(mutated,out)==morpheus::ProtocolError::length);
  mutated=bytes;mutated[0]='X';CHECK(morpheus::decode_into(mutated,out)==morpheus::ProtocolError::magic);
  mutated=bytes;mutated[4]=2;CHECK(morpheus::decode_into(mutated,out)==morpheus::ProtocolError::version);
  mutated=bytes;mutated[20]=0;mutated[21]=0;CHECK(morpheus::decode_into(mutated,out)==morpheus::ProtocolError::channels);
  mutated=bytes;mutated[22]=0;mutated[23]=0;CHECK(morpheus::decode_into(mutated,out)==morpheus::ProtocolError::frames);
  morpheus::ProtocolLimits limits;limits.max_scalar_samples=3;CHECK(morpheus::decode_into(bytes,out,limits)==morpheus::ProtocolError::limits);
  auto invalid=original;invalid.sample_rate_hz=std::numeric_limits<float>::infinity();CHECK(morpheus::validate(invalid)==morpheus::ProtocolError::sample_rate);
  invalid=original;invalid.timestamps[0]=std::numeric_limits<double>::quiet_NaN();CHECK(morpheus::validate(invalid)==morpheus::ProtocolError::nonfinite_timestamp);
  invalid=original;invalid.samples[0]=std::numeric_limits<float>::infinity();CHECK(morpheus::validate(invalid)==morpheus::ProtocolError::nonfinite_sample);
  // Build invalid IEEE payload independently of the encoder.
  mutated=bytes;mutated[32]=0;mutated[33]=0;mutated[34]=0x80;mutated[35]=0x7f;
  CHECK(morpheus::decode_into(mutated,out)==morpheus::ProtocolError::nonfinite_sample);
  mutated=bytes;for (std::size_t i=24;i<30;++i) mutated[i]=0;mutated[30]=0xf0;mutated[31]=0x7f;
  CHECK(morpheus::decode_into(mutated,out)==morpheus::ProtocolError::nonfinite_timestamp);
  invalid=original;invalid.sample_rate_hz=0;CHECK(morpheus::validate(invalid)==morpheus::ProtocolError::none);
  std::size_t written=99;CHECK(morpheus::encode_into(original,std::span(bytes.data(),10),written)==morpheus::ProtocolError::output_capacity);CHECK(written==0);
  out.timestamps.reserve(256);out.samples.reserve(1024);const auto* t=out.timestamps.data();const auto* s=out.samples.data();
  for (int i=0;i<100;++i) CHECK(morpheus::decode_into(bytes,out)==morpheus::ProtocolError::none);
  CHECK(t==out.timestamps.data()&&s==out.samples.data());
  // Deterministic malformed-input mutation corpus. Successful decodes must
  // round-trip exactly; rejected inputs must preserve output values.
  std::mt19937 generator(12345);
  for (int i=0;i<20000;++i) {
    mutated=bytes;
    for (int j=0;j<1+i%4;++j) mutated[generator()%mutated.size()]=static_cast<std::uint8_t>(generator());
    const auto before=out;
    const auto result=morpheus::decode_into(mutated,out);
    if (result==morpheus::ProtocolError::none) CHECK(encode(out)==mutated);
    else CHECK(out.samples==before.samples&&out.timestamps==before.timestamps&&out.sequence==before.sequence);
  }
}
void ring_and_sequence() {
  morpheus::MultiChannelRing ring(2,3);
  for (int i=1;i<=4;++i) { const std::array<float,2> frame={static_cast<float>(i),static_cast<float>(i*10)};CHECK(ring.push(i,frame)); }
  std::array<float,6> out{};std::array<double,3> times{};
  CHECK(ring.copy_interleaved(99,out,times)==3);CHECK((out==std::array<float,6>{2,20,3,30,4,40}));CHECK((times==std::array<double,3>{2,3,4}));
  CHECK(ring.frames_written()==4&&ring.size()==3);
  std::array<float,2> channel{};CHECK(ring.copy_channel(1,2,channel)==2);CHECK((channel==std::array<float,2>{30,40}));
  CHECK(!ring.push(5,std::span(channel.data(),1)));
  CHECK(!ring.push(std::numeric_limits<double>::infinity(),channel));
  channel[0]=std::numeric_limits<float>::quiet_NaN();CHECK(!ring.push(5,channel));CHECK(ring.frames_written()==4);
  CHECK(throws([&]{ring.copy_channel(2,3,out);}));
  CHECK(throws([]{morpheus::MultiChannelRing invalid(0,10);}));
  CHECK(throws([]{morpheus::MultiChannelRing invalid(4096,1000000);}));
  morpheus::SequenceTracker sequence;
  for (auto s:std::array<std::uint32_t,6>{0xfffffffeu,0xffffffffu,0u,2u,2u,1u}) sequence.observe(s);
  CHECK(sequence.stats().received==6&&sequence.stats().missing==1&&sequence.stats().duplicates==1&&sequence.stats().stale==1);
}
void dsp() {
  const std::array<float,4> square={1,-1,1,-1};CHECK(close(morpheus::rms(square),1));CHECK(morpheus::peak(square)==1);
  const std::array<float,8> values={0,.1f,7,.2f,-5,.1f,0,0};
  const auto envelope=morpheus::min_max_envelope(values,4);CHECK(envelope.size()==4&&envelope[1].second==7&&envelope[2].first==-5);
  std::vector<float> ramp={10,12,14,16,18};morpheus::detrend(ramp);CHECK(morpheus::peak(ramp)<1e-6);
  ramp={3,4,5};morpheus::remove_dc(ramp);CHECK(ramp[0]==-1&&ramp[1]==0&&ramp[2]==1);
  const std::array<float,1> singleton={5};CHECK(morpheus::fft_power_spectrum(singleton)==std::vector<double>({0,0}));
  CHECK(throws([]{morpheus::FftWorkspace huge(1u<<23);}));
  // Independent O(N^2) DFT oracle for padded/non-padded Hann spectra.
  for (std::size_t size:std::array<std::size_t,4>{2,7,31,128}) {
    std::vector<float> input(size);for (std::size_t i=0;i<size;++i) input[i]=static_cast<float>(std::sin(static_cast<double>(i)*.7)+.3);
    const auto spectrum=morpheus::fft_power_spectrum(input);const auto n=(spectrum.size()-1)*2;
    for (std::size_t k=0;k<spectrum.size();++k) {
      std::complex<double> sum{};
      for (std::size_t j=0;j<size;++j) {
        const double hann=.5-.5*std::cos(2*std::numbers::pi*static_cast<double>(j)/static_cast<double>(size-1));
        const double angle=-2*std::numbers::pi*static_cast<double>(j*k)/static_cast<double>(n);
        sum+=static_cast<double>(input[j])*hann*std::complex<double>(std::cos(angle),std::sin(angle));
      }
      CHECK(close(spectrum[k],std::norm(sum)/static_cast<double>(n*n),1e-10));
    }
  }
  std::vector<float> sine(4096),line(4096);
  for (std::size_t i=0;i<sine.size();++i) {
    sine[i]=static_cast<float>(std::sin(2*std::numbers::pi*10*static_cast<double>(i)/256));
    line[i]=static_cast<float>(std::sin(2*std::numbers::pi*60*static_cast<double>(i)/256));
  }
  CHECK(morpheus::band_power(sine,256,8,13)>100*morpheus::band_power(sine,256,.5,4));
  const auto psd=morpheus::welch_psd(sine,256,256,128);double integrated=0;for (double p:psd) integrated+=p;
  CHECK(close(integrated,.5,1e-5)); // df=1 Hz
  CHECK(throws([&]{morpheus::welch_psd(sine,256,256,256);}));
  auto notch=morpheus::Biquad::notch(256,60,30);CHECK(notch.has_value());
  notch->process_in_place(line);CHECK(morpheus::rms(std::span(line.data()+512,line.size()-512))<.001);
  CHECK(!morpheus::Biquad::notch(256,128,30));CHECK(!morpheus::Biquad::notch(std::numeric_limits<double>::quiet_NaN(),60,30));
  CHECK(!morpheus::Biquad::notch(256,60,1e-320));
  CHECK(morpheus::Biquad::notch(1.7e308,8e307,30).has_value());
  std::vector<float> extreme={std::numeric_limits<float>::max(),-std::numeric_limits<float>::max(),-std::numeric_limits<float>::max()};
  const auto extreme_before=extreme;CHECK(throws([&]{morpheus::remove_dc(extreme);}));CHECK(extreme==extreme_before);
  CHECK(throws([&]{notch->process(std::numeric_limits<float>::infinity());}));
  auto high=*morpheus::Biquad::highpass(256,1),low=*morpheus::Biquad::lowpass(256,40);
  std::vector<float> constant(4096,1);high.process_in_place(constant);CHECK(morpheus::rms(std::span(constant.data()+1024,3072))<1e-6);
  for (std::size_t i=0;i<line.size();++i) line[i]=static_cast<float>(std::sin(2*std::numbers::pi*100*static_cast<double>(i)/256));
  low.process_in_place(line);CHECK(morpheus::rms(std::span(line.data()+1024,3072))<.04);
  const std::array<float,6> quality={0,0,2,-2,0,std::numeric_limits<float>::quiet_NaN()};
  const auto qc=morpheus::channel_qc(quality,1);CHECK(qc.nonfinite==1&&close(qc.clipped_fraction,.4)&&close(qc.flat_step_fraction,.25));
  CHECK(morpheus::line_noise_ratio(sine,256)<1e-5);
}
void hashes_and_recording() {
  morpheus::Sha256 sha;CHECK(sha.hex_digest()=="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  const std::string abc="abc";sha.update(std::span(reinterpret_cast<const std::uint8_t*>(abc.data()),abc.size()));
  CHECK(sha.hex_digest()=="ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  CHECK(morpheus::json_escape("a\n\"\\\t")=="a\\u000a\\\"\\\\\\u0009");
  const std::vector<std::uint8_t> million(1000000,'a');morpheus::Sha256 large;large.update(million);
  CHECK(large.hex_digest()=="cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  const auto directory=std::filesystem::temp_directory_path()/("morpheus-cpp-test-"+std::to_string(::getpid()));
  std::filesystem::create_directories(directory);
  const auto packet=encode(batch());
  { morpheus::SessionRecorder limited(directory,"limited",30);CHECK(throws([&]{limited.append(packet,2);})); }
  std::size_t partials=0;for (const auto& entry:std::filesystem::directory_iterator(directory)) if (entry.path().extension()==".partial") ++partials;
  CHECK(partials==1);
  { morpheus::SessionRecorder recorder(directory,"finished");recorder.append(packet,2);
    const auto file=recorder.finish({"finished",1024,2});CHECK(std::filesystem::exists(file));CHECK(std::filesystem::file_size(file)==80);CHECK(std::filesystem::exists(file.string()+".manifest.json.sha256")); }
  std::filesystem::remove_all(directory);
}
}
int main() {
  try { protocol();ring_and_sequence();dsp();hashes_and_recording();std::cout<<checks<<" assertions passed (20,000 deterministic packet mutations)\n";return 0; }
  catch (const std::exception& error) { std::cerr<<error.what()<<'\n';return 1; }
}
