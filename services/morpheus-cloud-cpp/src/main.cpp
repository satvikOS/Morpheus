// Bounded public health/metadata plane. No acquisition, private raw data,
// persistence, model jobs, or processing authority is hosted in this service.
#include <array>
#include <charconv>
#include <chrono>
#include <csignal>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <poll.h>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <sys/socket.h>
#include <unistd.h>

namespace {
volatile std::sig_atomic_t running=1;
void stop(int) { running=0; }
using Clock=std::chrono::steady_clock;
class Socket {
 public:
  explicit Socket(int value):fd(value) {}
  ~Socket() { if (fd>=0) ::close(fd); }
  Socket(const Socket&)=delete;Socket& operator=(const Socket&)=delete;
  int fd;
};
bool ready(int fd,short event,Clock::time_point deadline) {
  const auto remaining=std::chrono::duration_cast<std::chrono::milliseconds>(deadline-Clock::now()).count();
  if (remaining<=0||!running) return false;
  pollfd descriptor{fd,event,0};
  return ::poll(&descriptor,1,static_cast<int>(remaining))>0&&(descriptor.revents&event);
}
bool write_all(int fd,std::string_view data,Clock::time_point deadline) {
  while (!data.empty()&&ready(fd,POLLOUT,deadline)) {
    const auto size=::send(fd,data.data(),data.size(),0);
    if (size<=0) return false;
    data.remove_prefix(static_cast<std::size_t>(size));
  }
  return data.empty();
}
void response(int fd,int status,std::string_view reason,std::string_view body,Clock::time_point deadline) {
  std::ostringstream head;
  head<<"HTTP/1.1 "<<status<<' '<<reason<<"\r\nContent-Type: application/json; charset=utf-8\r\n"
      <<"Content-Length: "<<body.size()<<"\r\nConnection: close\r\nCache-Control: no-store\r\n"
      <<"X-Content-Type-Options: nosniff\r\n";
  if (status==405) head<<"Allow: GET\r\n";
  head<<"\r\n";
  if (write_all(fd,head.str(),deadline)) (void)write_all(fd,body,deadline);
}
std::string version() {
  return std::string("{\"service\":\"morpheus-cloud-cpp\",\"version\":\"")+MORPHEUS_CLOUD_VERSION+
    "\",\"build_git_commit\":\""+MORPHEUS_GIT_REV+
    "\",\"build_source_dirty\":"+MORPHEUS_SOURCE_DIRTY_JSON+",\"plane\":\"public-metadata\",\"protocol_version\":1,\"raw_private_uploads\":false,"
    "\"acquisition_authority\":false,\"hardware_timing_verified\":false,\"persistent_jobs\":false,"
    "\"capabilities\":[\"health\",\"build-metadata\",\"protocol-metadata\"],"
    "\"limits\":{\"request_header_bytes\":8192,\"request_deadline_ms\":2000,\"listen_backlog\":16,\"active_requests\":1}}\n";
}
bool token_character(unsigned char c) noexcept {
  return (c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||
    std::string_view("!#$%&'*+-.^_`|~").find(static_cast<char>(c))!=std::string_view::npos;
}
bool header_name(std::string_view actual,std::string_view expected) noexcept {
  if (actual.size()!=expected.size()) return false;
  for (std::size_t i=0;i<actual.size();++i) {
    const char normalized=actual[i]>='A'&&actual[i]<='Z'?static_cast<char>(actual[i]-'A'+'a'):actual[i];
    if (normalized!=expected[i]) return false;
  }
  return true;
}
std::string_view trim_header_value(std::string_view value) noexcept {
  while (!value.empty()&&(value.front()==' '||value.front()=='\t')) value.remove_prefix(1);
  while (!value.empty()&&(value.back()==' '||value.back()=='\t')) value.remove_suffix(1);
  return value;
}
// Views into the fixed request buffer; no header map, body allocation, or queue.
// The only supported framing is a single Host and optional Content-Length: 0
// on GET. Duplicate length fields are rejected even if their values agree.
std::string_view check_headers(std::string_view request,std::size_t line_end,std::size_t header_end,
                               bool is_get) noexcept {
  std::size_t hosts=0;bool has_length=false;std::uint64_t length=0;
  for (std::size_t position=line_end+2;position<header_end;) {
    const auto end=request.find("\r\n",position);
    if (end==std::string_view::npos||end>header_end) return "malformed_header_line";
    const auto field=request.substr(position,end-position);
    const auto colon=field.find(':');
    if (colon==std::string_view::npos||colon==0) return "malformed_header_line";
    const auto name=field.substr(0,colon);
    for (char character:name) if (!token_character(static_cast<unsigned char>(character))) return "invalid_header_name";
    auto value=field.substr(colon+1);
    for (char character:value) {
      const auto c=static_cast<unsigned char>(character);
      if ((c<32&&c!='\t')||c==127) return "invalid_header_value";
    }
    value=trim_header_value(value);
    if (header_name(name,"host")) {
      if (++hosts!=1||value.empty()) return "invalid_host_header";
      for (char c:value) if (c==' '||c=='\t'||c==',') return "invalid_host_header";
    } else if (header_name(name,"content-length")) {
      if (has_length||value.empty()) return "ambiguous_content_length";
      has_length=true;
      const auto parsed=std::from_chars(value.data(),value.data()+value.size(),length);
      if (parsed.ec!=std::errc{}||parsed.ptr!=value.data()+value.size()) return "invalid_content_length";
    } else if (header_name(name,"transfer-encoding")) return "transfer_encoding_not_supported";
    position=end+2;
  }
  if (hosts!=1) return "host_header_required";
  if (is_get&&(length!=0||request.size()!=header_end+4)) return "get_body_not_supported";
  return {};
}
void handle(int fd) {
  const auto deadline=Clock::now()+std::chrono::seconds(2);
  std::array<char,8192> buffer{};std::size_t used=0;
  while (used<buffer.size()&&ready(fd,POLLIN,deadline)) {
    const auto size=::recv(fd,buffer.data()+used,buffer.size()-used,0);
    if (size<=0) return;
    used+=static_cast<std::size_t>(size);
    if (std::string_view(buffer.data(),used).find("\r\n\r\n")!=std::string_view::npos) break;
  }
  const std::string_view request(buffer.data(),used);
  const auto header_end=request.find("\r\n\r\n");
  if (header_end==std::string_view::npos) {
    response(fd,used==buffer.size()?431:408,used==buffer.size()?"Request Header Fields Too Large":"Request Timeout","{\"error\":\"bounded_request_rejected\"}\n",Clock::now()+std::chrono::milliseconds(100));return;
  }
  const auto line_end=request.find("\r\n");
  const auto line=request.substr(0,line_end);
  const auto first_space=line.find(' '),second_space=first_space==std::string_view::npos?std::string_view::npos:line.find(' ',first_space+1);
  if (first_space==std::string_view::npos||first_space==0||second_space==std::string_view::npos||second_space==first_space+1||line.find(' ',second_space+1)!=std::string_view::npos) {
    response(fd,400,"Bad Request","{\"error\":\"invalid_request_line\"}\n",deadline);return;
  }
  const auto method=line.substr(0,first_space),http=line.substr(second_space+1);
  std::string target(line.substr(first_space+1,second_space-first_space-1));
  bool valid_line=target[0]=='/'&&target.size()<=1024&&(http=="HTTP/1.1"||http=="HTTP/1.0");
  for (char c:method) if (!token_character(static_cast<unsigned char>(c))) valid_line=false;
  for (char character:target) { const auto c=static_cast<unsigned char>(character);if (c<=32||c==127) valid_line=false; }
  if (!valid_line) { response(fd,400,"Bad Request","{\"error\":\"invalid_request_line\"}\n",deadline);return; }
  const auto framing_error=check_headers(request,line_end,header_end,method=="GET");
  if (!framing_error.empty()) {
    const std::string body="{\"error\":\""+std::string(framing_error)+"\"}\n";
    response(fd,400,"Bad Request",body,deadline);return;
  }
  if (method!="GET") { response(fd,405,"Method Not Allowed","{\"error\":\"read_only_public_service\"}\n",deadline);return; }
  target.resize(target.find('?')==std::string::npos?target.size():target.find('?'));
  // Vercel service routing can preserve the rewrite prefix. Support that
  // contract and direct container requests with the same handlers.
  constexpr std::string_view service_prefix="/api/cloud-cpp";
  if (target.starts_with(service_prefix)&&target.size()>service_prefix.size()&&target[service_prefix.size()]=='/')
    target.erase(0,service_prefix.size());
  if (target=="/health"||target=="/healthz")
    response(fd,200,"OK","{\"status\":\"ok\",\"service\":\"morpheus-cloud-cpp\",\"plane\":\"public-metadata\"}\n",deadline);
  else if (target=="/version"||target=="/metadata") response(fd,200,"OK",version(),deadline);
  else response(fd,404,"Not Found","{\"error\":\"unknown_public_endpoint\"}\n",deadline);
}
void close_response(int fd) {
  // Sending FIN before a bounded discard prevents an unread POST body from
  // turning a completed 405 response into a TCP reset. Nothing is persisted,
  // parsed as an upload, logged, or echoed; the discard has its own tight bound.
  (void)::shutdown(fd,SHUT_WR);
  const auto deadline=Clock::now()+std::chrono::milliseconds(50);
  std::array<char,1024> discard{};std::size_t drained=0;
  while (drained<8192&&ready(fd,POLLIN,deadline)) {
    const auto size=::recv(fd,discard.data(),discard.size(),0);
    if (size<=0) break;
    drained+=static_cast<std::size_t>(size);
  }
}
}
int main() {
  try {
    const char* configured=std::getenv("PORT");const std::string value=configured?configured:"8080";
    std::size_t used=0;const auto port=std::stoul(value,&used);
    if (used!=value.size()||port==0||port>65535) throw std::invalid_argument("PORT must be 1..65535");
    const char* configured_bind=std::getenv("MORPHEUS_CLOUD_BIND");const std::string bind=configured_bind?configured_bind:"127.0.0.1";
    Socket server(::socket(AF_INET,SOCK_STREAM,0));
    if (server.fd<0) throw std::runtime_error("socket failed");
    int reuse=1;(void)::setsockopt(server.fd,SOL_SOCKET,SO_REUSEADDR,&reuse,sizeof(reuse));
    sockaddr_in address{};address.sin_family=AF_INET;address.sin_port=htons(static_cast<std::uint16_t>(port));
    if (::inet_pton(AF_INET,bind.c_str(),&address.sin_addr)!=1) throw std::invalid_argument("MORPHEUS_CLOUD_BIND must be an IPv4 address");
    if (::bind(server.fd,reinterpret_cast<sockaddr*>(&address),sizeof(address))!=0||::listen(server.fd,16)!=0)
      throw std::runtime_error("bind/listen failed");
    std::signal(SIGINT,stop);std::signal(SIGTERM,stop);std::signal(SIGPIPE,SIG_IGN);
    std::cerr<<"Morpheus public metadata HTTP listening on "<<bind<<':'<<port<<'\n';
    while (running) {
      pollfd descriptor{server.fd,POLLIN,0};
      if (::poll(&descriptor,1,250)<=0) continue;
      Socket client(::accept(server.fd,nullptr,nullptr));
      if (client.fd>=0) { handle(client.fd);close_response(client.fd); }
    }
    return 0;
  } catch (const std::exception& error) { std::cerr<<error.what()<<'\n';return 1; }
}
