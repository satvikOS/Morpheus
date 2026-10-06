#include "morpheus/protocol.hpp"
#include "morpheus/dsp.hpp"
#include <fstream>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <numbers>
#include <stdexcept>

int main(int argc,char** argv) {
  try {
    if (argc==2&&std::string_view(argv[1])=="dsp") {
      std::vector<float> values(256);
      for (std::size_t i=0;i<values.size();++i) values[i]=static_cast<float>(std::sin(2*std::numbers::pi*10*static_cast<double>(i)/256));
      const auto spectrum=morpheus::fft_power_spectrum(values);
      std::cout<<std::setprecision(17)<<"{\"rms\":"<<morpheus::rms(values)<<",\"alpha\":"<<morpheus::band_power(values,256,8,13)<<",\"spectrum\":[";
      for (std::size_t i=0;i<spectrum.size();++i) { if (i) std::cout<<',';std::cout<<spectrum[i]; }
      auto filter=*morpheus::Biquad::notch(256,60,30);std::cout<<"],\"notch\":[";
      for (std::size_t i=0;i<values.size();++i) { if (i) std::cout<<',';std::cout<<filter.process(values[i]); }
      const auto envelope=morpheus::min_max_envelope(values,7);std::cout<<"],\"envelope\":[";
      for (std::size_t i=0;i<envelope.size();++i) { if (i) std::cout<<',';std::cout<<'['<<envelope[i].first<<','<<envelope[i].second<<']'; }
      std::cout<<"]}\n";return 0;
    }
    if (argc!=4||std::string_view(argv[1])!="roundtrip") throw std::invalid_argument("usage: morpheus_protocol_tool roundtrip input output | dsp");
    std::ifstream file(argv[2],std::ios::binary|std::ios::ate);
    if (!file||file.tellg()<0||file.tellg()>16*1024*1024) throw std::runtime_error("input absent or exceeds 16 MiB");
    const auto size=static_cast<std::size_t>(file.tellg());file.seekg(0);
    std::vector<std::uint8_t> bytes(size);file.read(reinterpret_cast<char*>(bytes.data()),static_cast<std::streamsize>(size));
    morpheus::FrameBatch batch;
    const auto result=morpheus::decode_into(bytes,batch);
    if (result!=morpheus::ProtocolError::none) throw std::runtime_error(std::string(morpheus::error_message(result)));
    std::size_t written=0;
    if (morpheus::encode_into(batch,bytes,written)!=morpheus::ProtocolError::none) throw std::runtime_error("encode failed");
    std::ofstream output(argv[3],std::ios::binary);
    output.write(reinterpret_cast<const char*>(bytes.data()),static_cast<std::streamsize>(written));
    if (!output) throw std::runtime_error("output write failed");
    std::cout<<"{\"frames\":"<<batch.timestamps.size()<<",\"channels\":"<<batch.channels<<",\"sequence\":"<<batch.sequence<<",\"bytes\":"<<written<<"}\n";
    return 0;
  } catch (const std::exception& error) { std::cerr<<error.what()<<'\n';return 1; }
}
