#include "morpheus/protocol.hpp"
#include "morpheus/ring.hpp"
#include "morpheus/dsp.hpp"
#include <algorithm>
#include <chrono>
#include <iostream>
#include <numeric>
#include <vector>

namespace {
using Clock=std::chrono::steady_clock;
void barrier(const void* pointer) {
#if defined(__clang__) || defined(__GNUC__)
  asm volatile("" : : "g"(pointer) : "memory");
#else
  (void)pointer;
#endif
}
template<class F> void measure(const char* name,std::size_t iterations,std::size_t scalar_per_op,F&& fn,std::size_t timing_group=1) {
  std::vector<double> samples;samples.reserve(iterations);
  for (int warmup=0;warmup<100;++warmup) fn();
  const auto start=Clock::now();
  for (std::size_t i=0;i<iterations;i+=timing_group) {
    const auto count=std::min(timing_group,iterations-i);
    const auto t=Clock::now();for (std::size_t j=0;j<count;++j) fn();
    samples.push_back(std::chrono::duration<double,std::micro>(Clock::now()-t).count()/static_cast<double>(count));
  }
  const auto elapsed=std::chrono::duration<double>(Clock::now()-start).count();
  std::sort(samples.begin(),samples.end());
  const auto percentile=[&](double q){return samples[static_cast<std::size_t>(q*static_cast<double>(samples.size()-1))];};
  const auto rate=static_cast<double>(iterations)/elapsed;
  std::cout<<name<<','<<iterations<<','<<rate<<','<<rate*static_cast<double>(scalar_per_op)<<','<<percentile(.5)<<','<<percentile(.95)<<','<<percentile(.99)<<'\n';
}
}
int main() {
  constexpr std::size_t channels=256,frames=16;
  morpheus::MultiChannelRing ring(channels,2048);
  std::vector<float> frame(channels,.1f);
  morpheus::FrameBatch batch{1,0,42,2000,channels,std::vector<double>(frames,10),std::vector<float>(frames*channels,.1f)},decoded;
  decoded.timestamps.reserve(frames);decoded.samples.reserve(frames*channels);
  std::vector<std::uint8_t> packet(morpheus::encoded_size(batch));std::size_t written=0;
  (void)morpheus::encode_into(batch,packet,written);
  std::vector<float> signal(1024,.1f);std::vector<double> spectrum(513);morpheus::FftWorkspace fft(1024);
  double sink=0;
  std::cout<<"operation,iterations,operations_per_sec,scalar_samples_per_sec,p50_us,p95_us,p99_us\n";
  measure("ring_push_256ch",100000,channels,[&]{ barrier(&ring);if (!ring.push(10,frame)) std::abort();barrier(&ring); },32);
  measure("encode_256ch_16frames",10000,channels*frames,[&]{ if (morpheus::encode_into(batch,packet,written)!=morpheus::ProtocolError::none) std::abort();barrier(packet.data()); });
  measure("decode_256ch_16frames",10000,channels*frames,[&]{ if (morpheus::decode_into(packet,decoded)!=morpheus::ProtocolError::none) std::abort();sink+=decoded.samples[0]; });
  measure("fft_1024_reused",2000,1024,[&]{ fft.power_into(signal,spectrum);barrier(spectrum.data());sink+=spectrum[0]; });
  measure("rms_1024",20000,1024,[&]{ sink+=morpheus::rms(signal); });
  std::cerr<<"checksum="<<sink<<"; in-process microbenchmark, no device/network synchronization claim\n";
}
