//! Native bounded signal primitives for Morpheus.
//!
//! This crate intentionally starts small: deterministic memory use, no heap
//! growth on the hot path, and no external dependencies. It is the foundation
//! for future acquisition-side DSP and FFI bindings.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RingError {
    ZeroChannels,
    ZeroCapacity,
    FrameWidth { expected: usize, received: usize },
    ChannelOutOfRange { channel: usize, channels: usize },
}

#[derive(Debug, Clone)]
pub struct MultiChannelRing {
    channels: usize,
    capacity: usize,
    data: Vec<f32>,
    write_index: usize,
    len: usize,
    frames_written: u64,
}

impl MultiChannelRing {
    pub fn new(channels: usize, capacity: usize) -> Result<Self, RingError> {
        if channels == 0 {
            return Err(RingError::ZeroChannels);
        }
        if capacity == 0 {
            return Err(RingError::ZeroCapacity);
        }

        Ok(Self {
            channels,
            capacity,
            data: vec![0.0; channels * capacity],
            write_index: 0,
            len: 0,
            frames_written: 0,
        })
    }

    #[inline]
    pub fn channels(&self) -> usize {
        self.channels
    }

    #[inline]
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    #[inline]
    pub fn frames_written(&self) -> u64 {
        self.frames_written
    }

    /// Pushes one synchronized frame. No allocation occurs after construction.
    #[inline]
    pub fn push_frame(&mut self, frame: &[f32]) -> Result<(), RingError> {
        if frame.len() != self.channels {
            return Err(RingError::FrameWidth {
                expected: self.channels,
                received: frame.len(),
            });
        }

        let base = self.write_index * self.channels;
        self.data[base..base + self.channels].copy_from_slice(frame);

        self.write_index += 1;
        if self.write_index == self.capacity {
            self.write_index = 0;
        }

        self.len = (self.len + 1).min(self.capacity);
        self.frames_written = self.frames_written.saturating_add(1);
        Ok(())
    }

    /// Copies the newest requested samples from a channel into a caller-owned
    /// buffer. Returns the number of samples written.
    pub fn copy_channel(
        &self,
        channel: usize,
        count: usize,
        output: &mut [f32],
    ) -> Result<usize, RingError> {
        if channel >= self.channels {
            return Err(RingError::ChannelOutOfRange {
                channel,
                channels: self.channels,
            });
        }

        let n = count.min(self.len).min(output.len());
        if n == 0 {
            return Ok(0);
        }

        let start = (self.write_index + self.capacity - n) % self.capacity;

        for (offset, slot) in output.iter_mut().take(n).enumerate() {
            let frame_index = (start + offset) % self.capacity;
            *slot = self.data[frame_index * self.channels + channel];
        }

        Ok(n)
    }

    /// Copies the newest synchronized frames in interleaved channel order.
    pub fn copy_interleaved(&self, count: usize, output: &mut [f32]) -> usize {
        let max_frames = output.len() / self.channels;
        let n = count.min(self.len).min(max_frames);
        if n == 0 {
            return 0;
        }

        let start = (self.write_index + self.capacity - n) % self.capacity;

        for frame_offset in 0..n {
            let frame_index = (start + frame_offset) % self.capacity;
            let source = &self.data[
                frame_index * self.channels..(frame_index + 1) * self.channels
            ];
            let target_start = frame_offset * self.channels;
            output[target_start..target_start + self.channels].copy_from_slice(source);
        }

        n
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_preserves_recent_frames() {
        let mut ring = MultiChannelRing::new(2, 3).unwrap();
        ring.push_frame(&[1.0, 10.0]).unwrap();
        ring.push_frame(&[2.0, 20.0]).unwrap();
        ring.push_frame(&[3.0, 30.0]).unwrap();
        ring.push_frame(&[4.0, 40.0]).unwrap();

        let mut out = [0.0; 3];
        let written = ring.copy_channel(0, 3, &mut out).unwrap();

        assert_eq!(written, 3);
        assert_eq!(out, [2.0, 3.0, 4.0]);
        assert_eq!(ring.frames_written(), 4);
    }

    #[test]
    fn interleaved_snapshot_stays_synchronized() {
        let mut ring = MultiChannelRing::new(2, 4).unwrap();
        ring.push_frame(&[1.0, 10.0]).unwrap();
        ring.push_frame(&[2.0, 20.0]).unwrap();

        let mut out = [0.0; 4];
        let frames = ring.copy_interleaved(2, &mut out);

        assert_eq!(frames, 2);
        assert_eq!(out, [1.0, 10.0, 2.0, 20.0]);
    }

    #[test]
    fn rejects_wrong_frame_width() {
        let mut ring = MultiChannelRing::new(4, 8).unwrap();
        assert_eq!(
            ring.push_frame(&[1.0, 2.0]),
            Err(RingError::FrameWidth {
                expected: 4,
                received: 2,
            })
        );
    }
}
