#pragma once
#include <cstddef>
#include <cstdint>
#include <span>
#include <string_view>
#include <vector>

namespace morpheus {
inline constexpr std::size_t header_bytes = 24;
inline constexpr std::uint16_t protocol_version = 1;
inline constexpr std::uint16_t flag_simulated = 1;
struct ProtocolLimits {
  std::size_t max_packet_bytes = 16 * 1024 * 1024;
  std::size_t max_channels = 4096;
  std::size_t max_frames = 65535;
  std::size_t max_scalar_samples = 4 * 1024 * 1024;
};
struct FrameBatch {
  std::uint16_t flags = 0;
  std::uint32_t sequence = 0, stream_id = 0;
  float sample_rate_hz = 0;
  std::uint16_t channels = 0;
  std::vector<double> timestamps;
  std::vector<float> samples; // time-major interleaved values
};
enum class ProtocolError {
  none, truncated, magic, version, channels, frames, limits, length,
  sample_rate, nonfinite_timestamp, nonfinite_sample, output_capacity
};
std::string_view error_message(ProtocolError error) noexcept;
std::uint32_t fnv1a_stream_id(std::string_view text) noexcept;
std::size_t encoded_size(const FrameBatch& batch) noexcept;
ProtocolError validate(const FrameBatch& batch, ProtocolLimits limits = {}) noexcept;
// Buffer form allocates nothing. On failure bytes_written is zero.
ProtocolError encode_into(const FrameBatch& batch, std::span<std::uint8_t> out,
                          std::size_t& bytes_written, ProtocolLimits limits = {}) noexcept;
// Decode validates every wire value before changing out. Reuse reserved vectors
// to avoid steady-state allocation; caller owns the batch and its memory.
ProtocolError decode_into(std::span<const std::uint8_t> bytes, FrameBatch& out,
                          ProtocolLimits limits = {});

struct SequenceStats {
  std::uint64_t received = 0, missing = 0, duplicates = 0, stale = 0;
};
class SequenceTracker {
 public:
  void observe(std::uint32_t sequence) noexcept;
  void reset() noexcept { initialized_ = false; stats_ = {}; }
  const SequenceStats& stats() const noexcept { return stats_; }
 private:
  bool initialized_ = false;
  std::uint32_t previous_ = 0;
  SequenceStats stats_;
};
} // namespace morpheus
