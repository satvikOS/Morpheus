#include "morpheus/protocol.hpp"
#include <algorithm>
#include <bit>
#include <cmath>
#include <limits>

namespace morpheus {
namespace {
template<class UInt> UInt read_le(std::span<const std::uint8_t> bytes, std::size_t offset) noexcept {
  UInt value = 0;
  for (std::size_t i = 0; i < sizeof(UInt); ++i)
    value |= static_cast<UInt>(bytes[offset+i]) << (8*i);
  return value;
}
template<class UInt> void write_le(std::span<std::uint8_t> out, std::size_t offset, UInt value) noexcept {
  for (std::size_t i = 0; i < sizeof(UInt); ++i)
    out[offset+i] = static_cast<std::uint8_t>(value >> (8*i));
}
ProtocolError dimensions(std::size_t channels, std::size_t frames, ProtocolLimits l) noexcept {
  if (channels == 0 || channels > 65535) return ProtocolError::channels;
  if (frames == 0 || frames > 65535) return ProtocolError::frames;
  if (channels > l.max_channels || frames > l.max_frames ||
      frames > l.max_scalar_samples/channels ||
      l.max_packet_bytes < header_bytes ||
      frames > (l.max_packet_bytes-header_bytes)/(8+4*channels)) return ProtocolError::limits;
  return ProtocolError::none;
}
}
std::string_view error_message(ProtocolError e) noexcept {
  switch (e) {
    case ProtocolError::none: return "ok";
    case ProtocolError::truncated: return "truncated MRPH packet";
    case ProtocolError::magic: return "invalid MRPH magic";
    case ProtocolError::version: return "unsupported MRPH version";
    case ProtocolError::channels: return "invalid channel count";
    case ProtocolError::frames: return "invalid frame count";
    case ProtocolError::limits: return "configured protocol bound exceeded";
    case ProtocolError::length: return "payload length mismatch (including trailing bytes)";
    case ProtocolError::sample_rate: return "sample rate must be finite and nonnegative";
    case ProtocolError::nonfinite_timestamp: return "nonfinite timestamp";
    case ProtocolError::nonfinite_sample: return "nonfinite sample";
    case ProtocolError::output_capacity: return "output buffer too small";
  }
  return "unknown protocol error";
}
std::uint32_t fnv1a_stream_id(std::string_view text) noexcept {
  std::uint32_t hash = 2166136261u;
  for (char byte : text) { hash ^= static_cast<unsigned char>(byte); hash *= 16777619u; }
  return hash;
}
std::size_t encoded_size(const FrameBatch& b) noexcept {
  const auto stride = 8 + 4*static_cast<std::size_t>(b.channels);
  if (b.timestamps.size() > (std::numeric_limits<std::size_t>::max()-header_bytes)/stride) return 0;
  return header_bytes + b.timestamps.size()*stride;
}
ProtocolError validate(const FrameBatch& b, ProtocolLimits limits) noexcept {
  auto result = dimensions(b.channels, b.timestamps.size(), limits);
  if (result != ProtocolError::none) return result;
  if (b.samples.size() != b.timestamps.size()*b.channels) return ProtocolError::length;
  if (!std::isfinite(b.sample_rate_hz) || b.sample_rate_hz < 0) return ProtocolError::sample_rate;
  for (double t : b.timestamps) if (!std::isfinite(t)) return ProtocolError::nonfinite_timestamp;
  for (float x : b.samples) if (!std::isfinite(x)) return ProtocolError::nonfinite_sample;
  return ProtocolError::none;
}
ProtocolError encode_into(const FrameBatch& b, std::span<std::uint8_t> out, std::size_t& written, ProtocolLimits limits) noexcept {
  written = 0;
  const auto result = validate(b, limits);
  if (result != ProtocolError::none) return result;
  const auto size = encoded_size(b);
  if (out.size() < size) return ProtocolError::output_capacity;
  out[0]='M'; out[1]='R'; out[2]='P'; out[3]='H';
  write_le(out,4,protocol_version); write_le(out,6,b.flags);
  write_le(out,8,b.sequence); write_le(out,12,b.stream_id);
  write_le(out,16,std::bit_cast<std::uint32_t>(b.sample_rate_hz));
  write_le(out,20,b.channels); write_le(out,22,static_cast<std::uint16_t>(b.timestamps.size()));
  std::size_t offset = header_bytes;
  for (std::size_t frame = 0; frame < b.timestamps.size(); ++frame) {
    write_le(out,offset,std::bit_cast<std::uint64_t>(b.timestamps[frame])); offset+=8;
    for (std::size_t channel=0;channel<b.channels;++channel) {
      write_le(out,offset,std::bit_cast<std::uint32_t>(b.samples[frame*b.channels+channel])); offset+=4;
    }
  }
  written = size;
  return ProtocolError::none;
}
ProtocolError decode_into(std::span<const std::uint8_t> bytes, FrameBatch& out, ProtocolLimits limits) {
  if (bytes.size()<header_bytes) return ProtocolError::truncated;
  if (!std::equal(bytes.begin(),bytes.begin()+4,"MRPH")) return ProtocolError::magic;
  if (read_le<std::uint16_t>(bytes,4)!=protocol_version) return ProtocolError::version;
  const auto channels=read_le<std::uint16_t>(bytes,20), frames=read_le<std::uint16_t>(bytes,22);
  auto result=dimensions(channels,frames,limits);
  if (result!=ProtocolError::none) return result;
  const auto expected=header_bytes+frames*(8+4*static_cast<std::size_t>(channels));
  if (bytes.size()<expected) return ProtocolError::truncated;
  if (bytes.size()!=expected) return ProtocolError::length;
  const float rate=std::bit_cast<float>(read_le<std::uint32_t>(bytes,16));
  if (!std::isfinite(rate)||rate<0) return ProtocolError::sample_rate;
  std::size_t offset=header_bytes;
  for (std::size_t frame=0;frame<frames;++frame) {
    if (!std::isfinite(std::bit_cast<double>(read_le<std::uint64_t>(bytes,offset)))) return ProtocolError::nonfinite_timestamp;
    offset+=8;
    for (std::size_t channel=0;channel<channels;++channel) {
      if (!std::isfinite(std::bit_cast<float>(read_le<std::uint32_t>(bytes,offset)))) return ProtocolError::nonfinite_sample;
      offset+=4;
    }
  }
  // Reserve both before mutation: allocation failure preserves the previous values.
  out.timestamps.reserve(frames); out.samples.reserve(static_cast<std::size_t>(frames)*channels);
  out.timestamps.resize(frames); out.samples.resize(static_cast<std::size_t>(frames)*channels);
  out.flags=read_le<std::uint16_t>(bytes,6); out.sequence=read_le<std::uint32_t>(bytes,8);
  out.stream_id=read_le<std::uint32_t>(bytes,12); out.sample_rate_hz=rate; out.channels=channels;
  offset=header_bytes;
  for (std::size_t frame=0;frame<frames;++frame) {
    out.timestamps[frame]=std::bit_cast<double>(read_le<std::uint64_t>(bytes,offset)); offset+=8;
    for (std::size_t channel=0;channel<channels;++channel) {
      out.samples[frame*channels+channel]=std::bit_cast<float>(read_le<std::uint32_t>(bytes,offset)); offset+=4;
    }
  }
  return ProtocolError::none;
}
void SequenceTracker::observe(std::uint32_t sequence) noexcept {
  ++stats_.received;
  if (!initialized_) { previous_=sequence; initialized_=true; return; }
  const auto delta=sequence-previous_; // modulo 2^32, covers rollover
  if (delta==0) { ++stats_.duplicates; return; }
  if (delta>=0x80000000u) { ++stats_.stale; return; }
  stats_.missing+=delta-1; previous_=sequence;
}
} // namespace morpheus
