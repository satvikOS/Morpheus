#pragma once
#include <array>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <span>
#include <string>

namespace morpheus {
class Sha256 {
 public:
  void update(std::span<const std::uint8_t> bytes) noexcept;
  std::string hex_digest() const;
 private:
  void block(const std::uint8_t* bytes) noexcept;
  std::array<std::uint32_t,8> state_={0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
  std::array<std::uint8_t,64> buffer_{};
  std::uint64_t bytes_=0;
  std::size_t buffered_=0;
};
std::string json_escape(std::string_view text);
struct RecordingMetadata {
  std::string stream_name;
  float sample_rate_hz=0;
  std::uint16_t channels=0;
  std::uint64_t udp_sent=0,udp_errors=0,deadline_misses=0;
};
// A recording remains .partial until normal finalization. Abrupt termination
// cannot manufacture a complete integrity manifest. Hashing is incremental.
class SessionRecorder {
 public:
  SessionRecorder(const std::filesystem::path& dir,std::string_view stream,
                  std::uint64_t max_bytes=1024ull*1024*1024);
  ~SessionRecorder();
  SessionRecorder(const SessionRecorder&)=delete;
  SessionRecorder& operator=(const SessionRecorder&)=delete;
  void append(std::span<const std::uint8_t> packet,std::size_t frames);
  std::filesystem::path finish(const RecordingMetadata& metadata);
  std::uint64_t bytes() const noexcept { return bytes_; }
 private:
  void write(std::span<const std::uint8_t> bytes);
  std::filesystem::path path_;
  FILE* file_=nullptr;
  Sha256 sha_;
  std::uint64_t max_bytes_,started_ns_=0,bytes_=0,packets_=0,frames_=0;
};
} // namespace morpheus
