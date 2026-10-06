#include "morpheus/recording.hpp"
#include "morpheus/protocol.hpp"
#include <chrono>
#include <cerrno>
#include <fstream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <system_error>
#include <sys/stat.h>
#include <unistd.h>

namespace morpheus {
namespace {
std::uint64_t unix_ns() {
  return static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::system_clock::now().time_since_epoch()).count());
}
void durable_close(FILE*& file) {
  if (std::fflush(file)!=0 || ::fsync(::fileno(file))!=0) throw std::system_error(errno,std::generic_category(),"recording flush");
  const auto result=std::fclose(file);file=nullptr;
  if (result!=0) throw std::system_error(errno,std::generic_category(),"recording close");
}
void atomic_text(const std::filesystem::path& target,std::string_view contents) {
  const auto temporary=target.string()+".partial";
  FILE* file=std::fopen(temporary.c_str(),"wb");
  if (!file) throw std::system_error(errno,std::generic_category(),"manifest create");
  try {
    if (::fchmod(::fileno(file),0600)!=0) throw std::system_error(errno,std::generic_category(),"manifest permissions");
    if (std::fwrite(contents.data(),1,contents.size(),file)!=contents.size())
      throw std::runtime_error("manifest write failed");
    durable_close(file);std::filesystem::rename(temporary,target);
  } catch (...) { if (file) std::fclose(file);throw; }
}
}
std::string json_escape(std::string_view text) {
  constexpr char hex[]="0123456789abcdef";
  std::string out;out.reserve(text.size());
  for (char character:text) {
    const auto c=static_cast<unsigned char>(character);
    if (c=='"'||c=='\\') { out+='\\';out+=static_cast<char>(c); }
    else if (c<32) { out+="\\u00";out+=hex[c>>4];out+=hex[c&15]; }
    else out+=static_cast<char>(c);
  }
  return out;
}
SessionRecorder::SessionRecorder(const std::filesystem::path& dir,std::string_view stream,std::uint64_t max_bytes):max_bytes_(max_bytes),started_ns_(unix_ns()) {
  if (max_bytes<20) throw std::invalid_argument("record budget too small");
  std::filesystem::create_directories(dir);
  std::string name;
  for (char character:stream) {
    const auto c=static_cast<unsigned char>(character);
    if ((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='-'||c=='_') {
      if (name.size()<80) name+=static_cast<char>(c);
    }
  }
  if (name.empty()) name="session";
  path_=dir/(name+"-"+std::to_string(started_ns_)+"-"+std::to_string(::getpid())+".mrph.partial");
  file_=std::fopen(path_.c_str(),"wbx");
  if (!file_) throw std::system_error(errno,std::generic_category(),"record create");
  // Keep files private even in permissive environments.
  if (::fchmod(::fileno(file_),0600)!=0) {
    const auto error=errno;std::fclose(file_);file_=nullptr;
    throw std::system_error(error,std::generic_category(),"record permissions");
  }
  std::array<std::uint8_t,20> header={'M','R','P','H','S','E','S','S','I','O','N',1};
  for (std::size_t i=0;i<8;++i) header[12+i]=static_cast<std::uint8_t>(started_ns_>>(8*i));
  try { write(header); } catch (...) { std::fclose(file_);file_=nullptr;throw; }
}
SessionRecorder::~SessionRecorder() { if (file_) std::fclose(file_); }
void SessionRecorder::write(std::span<const std::uint8_t> bytes) {
  if (bytes.size()>max_bytes_-bytes_) throw std::runtime_error("recording byte budget exceeded; incomplete .partial preserved");
  if (std::fwrite(bytes.data(),1,bytes.size(),file_)!=bytes.size()) throw std::runtime_error("recording write failed; incomplete .partial preserved");
  sha_.update(bytes);bytes_+=bytes.size();
}
void SessionRecorder::append(std::span<const std::uint8_t> packet,std::size_t frames) {
  if (!file_) throw std::logic_error("recorder already closed");
  if (packet.size()>std::numeric_limits<std::uint32_t>::max()||packet.size()+4>max_bytes_-bytes_)
    throw std::runtime_error("recording packet exceeds byte budget; incomplete .partial preserved");
  std::array<std::uint8_t,4> length{};
  for (std::size_t i=0;i<4;++i) length[i]=static_cast<std::uint8_t>(packet.size()>>(8*i));
  write(length);write(packet);++packets_;frames_+=frames;
}
std::filesystem::path SessionRecorder::finish(const RecordingMetadata& m) {
  if (!file_) throw std::logic_error("recorder already closed");
  durable_close(file_);
  auto complete=path_;complete.replace_extension();std::filesystem::rename(path_,complete);
  const auto manifest=complete.string()+".manifest.json";
  std::ostringstream json;
  json.precision(17);
  json<<"{\n  \"schema\": \"morpheus-native-session-v1\",\n"
      <<"  \"software\": \"morpheus-gateway-cpp\",\n  \"software_version\": \""<<MORPHEUS_NATIVE_VERSION<<"\",\n"
      <<"  \"build_git_commit\": \""<<MORPHEUS_GIT_REV<<"\",\n"
      <<"  \"build_source_dirty\": "<<(MORPHEUS_SOURCE_DIRTY?"true":"false")<<",\n"
      <<"  \"protocol_version\": 1,\n  \"integrity_status\": \"complete-unverified-authorship\",\n"
      <<"  \"source\": \"synthetic-engineering-reference\",\n  \"simulated\": true,\n"
      <<"  \"clock_domain\": \"synthetic-unix-origin-logical-sample-clock\",\n  \"pacing_clock\": \"steady_clock\",\n"
      <<"  \"hardware_clock_verified\": false,\n  \"units\": \"arbitrary\",\n"
      <<"  \"stream\": \""<<json_escape(m.stream_name)<<"\",\n"
      <<"  \"sample_rate_hz\": "<<m.sample_rate_hz<<",\n  \"channels\": "<<m.channels<<",\n"
      <<"  \"packets\": "<<packets_<<",\n  \"frames\": "<<frames_<<",\n"
      <<"  \"started_unix_ns\": "<<started_ns_<<",\n  \"stopped_unix_ns\": "<<unix_ns()<<",\n"
      <<"  \"bytes\": "<<bytes_<<",\n  \"sha256\": \""<<sha_.hex_digest()<<"\",\n"
      <<"  \"udp_sent\": "<<m.udp_sent<<",\n  \"udp_errors\": "<<m.udp_errors<<",\n"
      <<"  \"deadline_misses\": "<<m.deadline_misses<<"\n}\n";
  const auto contents=json.str();atomic_text(manifest,contents);
  Sha256 manifest_hash;manifest_hash.update(std::span(reinterpret_cast<const std::uint8_t*>(contents.data()),contents.size()));
  atomic_text(manifest+".sha256",manifest_hash.hex_digest()+"\n");
  return complete;
}
} // namespace morpheus
