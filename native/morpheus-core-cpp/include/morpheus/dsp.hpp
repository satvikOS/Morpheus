#pragma once
#include <complex>
#include <cstddef>
#include <optional>
#include <span>
#include <utility>
#include <vector>

namespace morpheus {
float rms(std::span<const float> values);
float peak(std::span<const float> values);
void remove_dc(std::span<float> values);
void detrend(std::span<float> values);
std::vector<std::pair<float,float>> min_max_envelope(std::span<const float> values,std::size_t buckets);
// Reusable FFT workspace. The Rust-compatible spectrum is Hann-windowed,
// zero-padded, |FFT|^2 / N^2; this is not a calibrated PSD in physical units.
class FftWorkspace {
 public:
  explicit FftWorkspace(std::size_t max_samples);
  std::size_t power_into(std::span<const float> values,std::span<double> output);
  std::size_t capacity() const noexcept { return data_.size(); }
 private:
  std::vector<std::complex<double>> data_;
};
std::vector<double> fft_power_spectrum(std::span<const float> values);
double band_power(std::span<const float> values,double sample_rate,double low_hz,double high_hz);
// One-sided Welch PSD (units: input units squared / Hz), Hann windows,
// segment mean removed, configurable overlap, no padded partial segments.
std::vector<double> welch_psd(std::span<const float> values,double sample_rate,
                             std::size_t segment_size,std::size_t overlap);
class Biquad {
 public:
  static std::optional<Biquad> notch(double sample_rate,double hz,double q);
  static std::optional<Biquad> lowpass(double sample_rate,double hz,double q=0.7071067811865476);
  static std::optional<Biquad> highpass(double sample_rate,double hz,double q=0.7071067811865476);
  float process(float input);
  void process_in_place(std::span<float> values);
  void reset() noexcept { z1_=z2_=0; }
 private:
  static std::optional<Biquad> make(double sample_rate,double hz,double q,int type);
  double b0_=0,b1_=0,b2_=0,a1_=0,a2_=0,z1_=0,z2_=0;
};
struct ChannelQc {
  std::size_t samples=0, nonfinite=0;
  double mean=0, rms=0, peak=0, clipped_fraction=0, flat_step_fraction=0;
};
// Thresholds are instrument configuration, never a clinical classifier.
ChannelQc channel_qc(std::span<const float> values,double clipping_abs,double flat_step_tolerance=1e-8);
double line_noise_ratio(std::span<const float> values,double rate,double line_hz=60,double half_width=1);
} // namespace morpheus
