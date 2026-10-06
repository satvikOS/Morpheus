#include "morpheus/protocol.hpp"
#include "morpheus/ring.hpp"
#include "morpheus/recording.hpp"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <iostream>
#include <memory>
#include <netdb.h>
#include <numbers>
#include <string>
#include <thread>
#include <unistd.h>

namespace {
volatile std::sig_atomic_t running=1;
void stop(int) { running=0; }
std::string environment(const char* name,std::string fallback={}) {
  const auto value=std::getenv(name);return value?std::string(value):fallback;
}
double number(const std::string& text,double low,double high) {
  std::size_t used=0;const auto result=std::stod(text,&used);
  if (used!=text.size()||!std::isfinite(result)||result<low||result>high) throw std::invalid_argument("invalid numeric argument: "+text);
  return result;
}
std::size_t integer(const std::string& text,std::size_t low,std::size_t high) {
  const auto result=number(text,static_cast<double>(low),static_cast<double>(high));
  if (std::floor(result)!=result) throw std::invalid_argument("expected integer: "+text);
  return static_cast<std::size_t>(result);
}
struct Config {
  std::string stream=environment("MORPHEUS_STREAM_NAME","Morpheus C++ Engineering Reference");
  std::string rate=environment("MORPHEUS_SAMPLE_RATE","1024"),channels=environment("MORPHEUS_CHANNELS","8");
  std::string batch=environment("MORPHEUS_BATCH_FRAMES","16"),ring=environment("MORPHEUS_RING_SECONDS","8");
  std::string target=environment("MORPHEUS_UDP_TARGET"),directory=environment("MORPHEUS_RECORD_DIR");
  std::string duration="0",record_budget=environment("MORPHEUS_MAX_RECORD_BYTES","1073741824");
};
Config parse(int argc,char** argv) {
  Config c;
  for (int i=1;i<argc;++i) {
    const std::string option=argv[i];
    if (option=="--help") {
      std::cout<<"Morpheus C++ synthetic engineering gateway\n"
               <<"--rate Hz --channels N --batch N --ring-seconds N --duration seconds\n"
               <<"--stream name --udp-target host:port --record-dir path --max-record-bytes N\n"
               <<"No physical acquisition or clock synchronization is claimed. Ctrl-C finalizes recordings.\n";
      std::exit(0);
    }
    if (i+1>=argc) throw std::invalid_argument("missing value for "+option);
    const std::string value=argv[++i];
    if (option=="--rate") c.rate=value;
    else if (option=="--channels") c.channels=value;
    else if (option=="--batch") c.batch=value;
    else if (option=="--ring-seconds") c.ring=value;
    else if (option=="--duration") c.duration=value;
    else if (option=="--stream") c.stream=value;
    else if (option=="--udp-target") c.target=value;
    else if (option=="--record-dir") c.directory=value;
    else if (option=="--max-record-bytes") c.record_budget=value;
    else throw std::invalid_argument("unknown option: "+option);
  }
  if (c.stream.size()>256) throw std::invalid_argument("stream name exceeds 256 bytes");
  return c;
}
class DatagramSink {
 public:
  explicit DatagramSink(const std::string& target) {
    const auto colon=target.rfind(':');
    if (colon==std::string::npos) throw std::invalid_argument("UDP target must be host:port");
    const auto host=target.substr(0,colon),service=target.substr(colon+1);
    (void)integer(service,1,65535);
    addrinfo hints{},*result=nullptr;hints.ai_family=AF_UNSPEC;hints.ai_socktype=SOCK_DGRAM;
    const int error=::getaddrinfo(host.c_str(),service.c_str(),&hints,&result);
    if (error) throw std::runtime_error(::gai_strerror(error));
    for (auto* current=result;current;current=current->ai_next) {
      fd_=::socket(current->ai_family,current->ai_socktype,current->ai_protocol);
      if (fd_>=0&&::connect(fd_,current->ai_addr,current->ai_addrlen)==0) break;
      if (fd_>=0) ::close(fd_);fd_=-1;
    }
    ::freeaddrinfo(result);
    if (fd_<0) throw std::runtime_error("unable to connect UDP target");
    if (::fcntl(fd_,F_SETFL,O_NONBLOCK)<0) { ::close(fd_);fd_=-1;throw std::runtime_error("unable to make UDP socket nonblocking"); }
  }
  ~DatagramSink() { if (fd_>=0) ::close(fd_); }
  bool send(std::span<const std::uint8_t> packet) noexcept {
    const auto sent=::send(fd_,packet.data(),packet.size(),0);
    return sent>=0&&static_cast<std::size_t>(sent)==packet.size();
  }
 private:
  int fd_=-1;
};
}
int main(int argc,char** argv) {
  try {
    const auto config=parse(argc,argv);
    const float rate=static_cast<float>(number(config.rate,1,200000));
    const auto channels=integer(config.channels,1,4096),requested_batch=integer(config.batch,1,65535);
    const auto max_datagram_frames=(48*1024-morpheus::header_bytes)/(8+channels*4);
    const auto batch_frames=std::min(requested_batch,max_datagram_frames);
    const auto seconds=integer(config.ring,1,120);
    const auto duration=number(config.duration,0,86400*7);
    const auto budget=integer(config.record_budget,20,static_cast<std::size_t>(1ull<<50));
    const auto capacity=std::max(static_cast<std::size_t>(std::ceil(rate))*seconds,batch_frames*2);
    morpheus::MultiChannelRing ring(channels,capacity);
    std::unique_ptr<DatagramSink> udp;
    if (!config.target.empty()) udp=std::make_unique<DatagramSink>(config.target);
    std::unique_ptr<morpheus::SessionRecorder> recorder;
    if (!config.directory.empty()) recorder=std::make_unique<morpheus::SessionRecorder>(config.directory,config.stream,budget);
    morpheus::FrameBatch batch;
    batch.flags=morpheus::flag_simulated;batch.stream_id=morpheus::fnv1a_stream_id(config.stream);
    batch.sample_rate_hz=rate;batch.channels=static_cast<std::uint16_t>(channels);
    batch.timestamps.resize(batch_frames);batch.samples.resize(batch_frames*channels);
    std::vector<std::uint8_t> packet(morpheus::encoded_size(batch));
    std::vector<double> phase(channels,0);
    morpheus::RecordingMetadata metadata{config.stream,rate,static_cast<std::uint16_t>(channels)};
    std::signal(SIGINT,stop);std::signal(SIGTERM,stop);
    using clock=std::chrono::steady_clock;
    const auto start=clock::now();
    const auto interval=std::chrono::duration_cast<clock::duration>(std::chrono::duration<double>(static_cast<double>(batch_frames)/rate));
    const auto end=duration>0?start+std::chrono::duration_cast<clock::duration>(std::chrono::duration<double>(duration)):clock::time_point::max();
    auto deadline=start;
    const double origin=std::chrono::duration<double>(std::chrono::system_clock::now().time_since_epoch()).count();
    std::uint64_t frames=0,packets=0;
    std::cerr<<"Morpheus C++ "<<MORPHEUS_NATIVE_VERSION<<" synthetic reference | "<<rate<<" Hz | "<<channels<<" ch | batch="<<batch_frames<<" | bounded ring="<<capacity<<" frames\n";
    if (batch_frames!=requested_batch) std::cerr<<"Batch reduced to fit 48 KiB UDP packet bound.\n";
    while (running&&(duration==0||std::chrono::duration<double>(clock::now()-start).count()<duration)) {
      for (std::size_t f=0;f<batch_frames;++f) {
        batch.timestamps[f]=origin+static_cast<double>(frames+f)/rate;
        for (std::size_t c=0;c<channels;++c) {
          phase[c]+=2*std::numbers::pi*(6+static_cast<double>(c)*0.17)/rate;
          // Keep long-running phase bounded without changing generated frequency.
          phase[c]=std::fmod(phase[c],2*std::numbers::pi*100000);
          const double secondary=phase[c]*(1.9+static_cast<double>(c%5)*0.03);
          batch.samples[f*channels+c]=static_cast<float>(std::sin(phase[c])*0.12+std::sin(secondary)*0.035);
        }
        if (!ring.push(batch.timestamps[f],std::span(batch.samples.data()+f*channels,channels)))
          throw std::runtime_error("generated frame failed validation");
      }
      std::size_t written=0;
      const auto result=morpheus::encode_into(batch,packet,written);
      if (result!=morpheus::ProtocolError::none) throw std::runtime_error(std::string(morpheus::error_message(result)));
      // Record before disposable display transport. Failure stops acquisition;
      // it is never converted into a silent recording gap.
      if (recorder) recorder->append(std::span(packet.data(),written),batch_frames);
      if (udp) { if (udp->send(std::span(packet.data(),written))) ++metadata.udp_sent;else ++metadata.udp_errors; }
      ++batch.sequence;++packets;frames+=batch_frames;
      deadline+=interval;
      const auto now=clock::now();
      if (now>deadline) { ++metadata.deadline_misses;if (now-deadline>std::chrono::seconds(1)) deadline=now; }
      else {
        // Large packets at low rates must not delay Ctrl-C or a requested stop
        // by an entire batch interval. The raw clock remains logical sample time.
        const auto wake=std::min(deadline,end);
        while (running&&clock::now()<wake)
          std::this_thread::sleep_until(std::min(wake,clock::now()+std::chrono::milliseconds(50)));
      }
    }
    if (recorder) std::cerr<<"recording="<<recorder->finish(metadata)<<"\n";
    const auto elapsed=std::chrono::duration<double>(clock::now()-start).count();
    std::cout<<"{\"simulated\":true,\"frames\":"<<frames<<",\"packets\":"<<packets
             <<",\"ring_frames\":"<<ring.size()<<",\"ring_capacity\":"<<ring.capacity()
             <<",\"udp_sent\":"<<metadata.udp_sent<<",\"udp_errors\":"<<metadata.udp_errors
             <<",\"deadline_misses\":"<<metadata.deadline_misses<<",\"elapsed_seconds\":"<<elapsed<<"}\n";
    return 0;
  } catch (const std::exception& error) { std::cerr<<"Morpheus native error: "<<error.what()<<"\n";return 1; }
}
