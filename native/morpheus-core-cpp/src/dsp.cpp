#include "morpheus/dsp.hpp"
#include <algorithm>
#include <bit>
#include <cmath>
#include <limits>
#include <numbers>
#include <stdexcept>

namespace morpheus {
namespace {
constexpr std::size_t max_fft_samples=1u<<22;
void finite_values(std::span<const float> values) {
  for (auto value:values) if (!std::isfinite(value)) throw std::invalid_argument("DSP input must be finite");
}
std::size_t fft_size(std::size_t samples) {
  if (samples>max_fft_samples) throw std::invalid_argument("FFT sample bound exceeded");
  return std::max(std::size_t{2},std::bit_ceil(samples));
}
void fft(std::span<std::complex<double>> data) {
  const auto n=data.size();
  std::size_t j=0;
  for (std::size_t i=1;i<n;++i) {
    auto bit=n>>1;
    while (j&bit) { j^=bit; bit>>=1; }
    j^=bit;
    if (i<j) std::swap(data[i],data[j]);
  }
  for (std::size_t len=2;len<=n;len<<=1) {
    const auto angle=-2*std::numbers::pi/static_cast<double>(len);
    const std::complex<double> step(std::cos(angle),std::sin(angle));
    for (std::size_t start=0;start<n;start+=len) {
      std::complex<double> w(1,0);
      for (std::size_t offset=0;offset<len/2;++offset) {
        const auto u=data[start+offset],v=data[start+offset+len/2]*w;
        data[start+offset]=u+v; data[start+offset+len/2]=u-v; w*=step;
      }
    }
  }
}
bool valid_filter(double rate,double hz,double q) {
  return std::isfinite(rate)&&std::isfinite(hz)&&std::isfinite(q)&&rate>0&&hz>0&&hz<rate/2&&q>0;
}
}
float rms(std::span<const float> values) {
  finite_values(values);
  if (values.empty()) return 0;
  double sum=0; for (float value:values) sum+=static_cast<double>(value)*value;
  return static_cast<float>(std::sqrt(sum/static_cast<double>(values.size())));
}
float peak(std::span<const float> values) {
  finite_values(values);
  float result=0; for (float value:values) result=std::max(result,std::abs(value)); return result;
}
void remove_dc(std::span<float> values) {
  finite_values(values);
  if (values.empty()) return;
  double mean=0;for (float value:values) mean+=value;
  mean/=static_cast<double>(values.size());
  for (float value:values) if (std::abs(value-mean)>std::numeric_limits<float>::max())
    throw std::overflow_error("DC removal numeric overflow");
  for (float& value:values) value=static_cast<float>(value-mean);
}
void detrend(std::span<float> values) {
  finite_values(values);
  if (values.size()<2) { remove_dc(values); return; }
  const double center=static_cast<double>(values.size()-1)/2;
  double mean=0,numerator=0,denominator=0;
  for (std::size_t i=0;i<values.size();++i) {
    const double t=static_cast<double>(i)-center;
    mean+=values[i]; numerator+=t*values[i]; denominator+=t*t;
  }
  mean/=static_cast<double>(values.size());
  const double slope=numerator/denominator;
  for (std::size_t i=0;i<values.size();++i)
    if (std::abs(values[i]-mean-slope*(static_cast<double>(i)-center))>std::numeric_limits<float>::max())
      throw std::overflow_error("detrending numeric overflow");
  for (std::size_t i=0;i<values.size();++i)
    values[i]=static_cast<float>(values[i]-mean-slope*(static_cast<double>(i)-center));
}
std::vector<std::pair<float,float>> min_max_envelope(std::span<const float> values,std::size_t buckets) {
  finite_values(values);
  const auto count=std::min(buckets,values.size());
  std::vector<std::pair<float,float>> out(count);
  for (std::size_t bucket=0;bucket<count;++bucket) {
    const auto start=bucket*values.size()/count,end=(bucket+1)*values.size()/count;
    const auto mm=std::minmax_element(values.begin()+static_cast<std::ptrdiff_t>(start),values.begin()+static_cast<std::ptrdiff_t>(end));
    out[bucket]={*mm.first,*mm.second};
  }
  return out;
}
FftWorkspace::FftWorkspace(std::size_t maximum):data_(fft_size(maximum)) {}
std::size_t FftWorkspace::power_into(std::span<const float> values,std::span<double> output) {
  if (values.empty()) return 0;
  finite_values(values);
  const auto n=fft_size(values.size());
  if (n>data_.size() || output.size()<n/2+1) throw std::invalid_argument("FFT workspace/output capacity");
  std::fill_n(data_.begin(),n,std::complex<double>{});
  const double denom=static_cast<double>(std::max(std::size_t{1},values.size()-1));
  for (std::size_t i=0;i<values.size();++i)
    data_[i]=values[i]*(0.5-0.5*std::cos(2*std::numbers::pi*static_cast<double>(i)/denom));
  fft(std::span(data_.data(),n));
  const double norm=static_cast<double>(n)*static_cast<double>(n);
  for (std::size_t i=0;i<=n/2;++i) output[i]=std::norm(data_[i])/norm;
  return n/2+1;
}
std::vector<double> fft_power_spectrum(std::span<const float> values) {
  if (values.empty()) return {};
  FftWorkspace workspace(values.size()); std::vector<double> result(workspace.capacity()/2+1);
  workspace.power_into(values,result); return result;
}
double band_power(std::span<const float> values,double rate,double low,double high) {
  if (values.empty()||!std::isfinite(rate)||!std::isfinite(low)||!std::isfinite(high)||rate<=0||low<0||high<=low) return 0;
  const auto spectrum=fft_power_spectrum(values); const auto n=(spectrum.size()-1)*2;
  double power=0;
  for (std::size_t i=0;i<spectrum.size();++i) {
    const double frequency=static_cast<double>(i)*rate/static_cast<double>(n);
    if (frequency>=low&&frequency<high) power+=spectrum[i];
  }
  return power;
}
std::vector<double> welch_psd(std::span<const float> values,double rate,std::size_t segment,std::size_t overlap) {
  finite_values(values);
  if (!std::isfinite(rate)||rate<=0||segment<3||segment>values.size()||overlap>=segment)
    throw std::invalid_argument("Welch rate/segment/overlap");
  const auto n=fft_size(segment),step=segment-overlap;
  std::vector<double> result(n/2+1,0),window(segment);
  std::vector<std::complex<double>> data(n);
  double energy=0;
  for (std::size_t i=0;i<segment;++i) {
    window[i]=0.5-0.5*std::cos(2*std::numbers::pi*static_cast<double>(i)/static_cast<double>(segment-1));
    energy+=window[i]*window[i];
  }
  const double normalization=rate*energy;
  if (!std::isfinite(normalization)||normalization<=0) throw std::invalid_argument("Welch numeric normalization range");
  std::size_t segments=0;
  for (std::size_t start=0;start<=values.size()-segment;start+=step) {
    double mean=0;for (std::size_t i=0;i<segment;++i) mean+=values[start+i];mean/=static_cast<double>(segment);
    std::fill(data.begin(),data.end(),std::complex<double>{});
    for (std::size_t i=0;i<segment;++i) data[i]=(values[start+i]-mean)*window[i];
    fft(data);
    for (std::size_t i=0;i<result.size();++i) {
      const double sided=(i==0||i==n/2)?1:2;
      const auto power=sided*std::norm(data[i])/normalization;
      if (!std::isfinite(power)||!std::isfinite(result[i]+power)) throw std::overflow_error("Welch numeric overflow");
      result[i]+=power;
    }
    ++segments;
  }
  for (double& value:result) value/=static_cast<double>(segments);
  return result;
}
std::optional<Biquad> Biquad::make(double rate,double hz,double q,int type) {
  if (!valid_filter(rate,hz,q)) return std::nullopt;
  const double omega=2*std::numbers::pi*(hz/rate),c=std::cos(omega),alpha=(std::sin(omega)/2)/q,a0=1+alpha;
  if (!std::isfinite(a0)) return std::nullopt;
  Biquad out;
  if (type==0) { out.b0_=1/a0; out.b1_=-2*c/a0; out.b2_=1/a0; }
  else if (type==1) { out.b0_=(1-c)/(2*a0); out.b1_=(1-c)/a0; out.b2_=out.b0_; }
  else { out.b0_=(1+c)/(2*a0); out.b1_=-(1+c)/a0; out.b2_=out.b0_; }
  out.a1_=-2*c/a0; out.a2_=(1-alpha)/a0; return out;
}
std::optional<Biquad> Biquad::notch(double rate,double hz,double q) { return make(rate,hz,q,0); }
std::optional<Biquad> Biquad::lowpass(double rate,double hz,double q) { return make(rate,hz,q,1); }
std::optional<Biquad> Biquad::highpass(double rate,double hz,double q) { return make(rate,hz,q,2); }
float Biquad::process(float input) {
  if (!std::isfinite(input)) throw std::invalid_argument("filter input must be finite");
  const double x=input,out=b0_*x+z1_,next_z1=b1_*x-a1_*out+z2_,next_z2=b2_*x-a2_*out;
  if (!std::isfinite(next_z1)||!std::isfinite(next_z2)||std::abs(out)>std::numeric_limits<float>::max())
    throw std::overflow_error("filter numeric overflow");
  z1_=next_z1;z2_=next_z2;return static_cast<float>(out);
}
void Biquad::process_in_place(std::span<float> values) {
  finite_values(values); for (float& value:values) value=process(value);
}
ChannelQc channel_qc(std::span<const float> values,double clipping_abs,double tolerance) {
  if (!std::isfinite(clipping_abs)||clipping_abs<=0||!std::isfinite(tolerance)||tolerance<0)
    throw std::invalid_argument("QC thresholds must be finite and valid");
  ChannelQc qc;qc.samples=values.size();
  double energy=0;std::size_t finite=0,clipped=0,flat=0,adjacent=0;
  for (std::size_t i=0;i<values.size();++i) {
    if (!std::isfinite(values[i])) { ++qc.nonfinite; continue; }
    const double x=values[i];++finite;qc.mean+=x;energy+=x*x;qc.peak=std::max(qc.peak,std::abs(x));
    if (std::abs(x)>=clipping_abs) ++clipped;
    if (i&&std::isfinite(values[i-1])) { ++adjacent;if (std::abs(x-values[i-1])<=tolerance) ++flat; }
  }
  if (finite) { qc.mean/=static_cast<double>(finite);qc.rms=std::sqrt(energy/static_cast<double>(finite));qc.clipped_fraction=static_cast<double>(clipped)/static_cast<double>(finite); }
  if (adjacent) qc.flat_step_fraction=static_cast<double>(flat)/static_cast<double>(adjacent);
  return qc;
}
double line_noise_ratio(std::span<const float> values,double rate,double hz,double width) {
  if (!std::isfinite(rate)||rate<=0||!std::isfinite(hz)||!std::isfinite(width)||width<=0||hz<=width||hz+width>=rate/2)
    throw std::invalid_argument("line noise band must lie inside Nyquist range");
  const auto total=band_power(values,rate,0,rate/2);
  return total>0?band_power(values,rate,hz-width,hz+width)/total:0;
}
} // namespace morpheus
