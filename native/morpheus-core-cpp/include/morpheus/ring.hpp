#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <span>
#include <stdexcept>
#include <vector>

namespace morpheus {
// Single owner. Share snapshots across threads through a bounded handoff, not
// concurrent access to this ring. Push/copy never allocate or lock.
class MultiChannelRing {
 public:
  MultiChannelRing(std::size_t channels, std::size_t capacity,
                   std::size_t max_bytes=256*1024*1024)
      : channels_(channels), capacity_(capacity) {
    if (!channels || !capacity || channels>65535 || capacity>(max_bytes/(sizeof(double)+channels*sizeof(float))))
      throw std::invalid_argument("ring dimensions exceed memory budget");
    samples_.resize(channels*capacity); timestamps_.resize(capacity);
  }
  bool push(double timestamp, std::span<const float> frame) noexcept {
    if (frame.size()!=channels_ || !std::isfinite(timestamp)) return false;
    for (auto value:frame) if (!std::isfinite(value)) return false;
    std::copy(frame.begin(),frame.end(),samples_.begin()+static_cast<std::ptrdiff_t>(write_*channels_));
    timestamps_[write_]=timestamp;
    write_=(write_+1)%capacity_; size_=std::min(size_+1,capacity_);
    if (written_!=std::numeric_limits<std::uint64_t>::max()) ++written_;
    return true;
  }
  std::size_t copy_channel(std::size_t channel, std::size_t count, std::span<float> out) const {
    if (channel>=channels_) throw std::out_of_range("ring channel");
    const auto n=std::min({count,size_,out.size()});
    const auto start=(write_+capacity_-n)%capacity_;
    for (std::size_t i=0;i<n;++i) out[i]=samples_[((start+i)%capacity_)*channels_+channel];
    return n;
  }
  std::size_t copy_interleaved(std::size_t count,std::span<float> out,std::span<double> times) const noexcept {
    const auto n=std::min({count,size_,out.size()/channels_,times.size()});
    const auto start=(write_+capacity_-n)%capacity_;
    for (std::size_t i=0;i<n;++i) {
      const auto source=(start+i)%capacity_;
      std::copy_n(samples_.data()+source*channels_,channels_,out.data()+i*channels_);
      times[i]=timestamps_[source];
    }
    return n;
  }
  std::size_t channels() const noexcept { return channels_; }
  std::size_t capacity() const noexcept { return capacity_; }
  std::size_t size() const noexcept { return size_; }
  std::uint64_t frames_written() const noexcept { return written_; }
 private:
  std::size_t channels_,capacity_,write_=0,size_=0;
  std::uint64_t written_=0;
  std::vector<float> samples_;
  std::vector<double> timestamps_;
};
} // namespace morpheus
