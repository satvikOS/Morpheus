import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "services" / "signal-gateway"))

from app.protocol import MRPH_HEADER, encode_sample_batch


class GatewayProtocolTests(unittest.TestCase):
    def test_sequences_are_supplied_by_each_connection(self):
        samples = [[0.1, -0.2], [0.3, -0.4]]
        timestamps = [1.0, 1.004]

        # Independent subscribers each start at zero, even when the stream
        # name and stream identifier are shared.
        first_client = encode_sample_batch(
            "synthetic", 256, samples, timestamps, True, sequence=0
        )
        second_client = encode_sample_batch(
            "synthetic", 256, samples, timestamps, True, sequence=0
        )
        next_packet = encode_sample_batch(
            "synthetic", 256, samples, timestamps, True, sequence=1
        )

        first_header = MRPH_HEADER.unpack_from(first_client)
        second_header = MRPH_HEADER.unpack_from(second_client)
        next_header = MRPH_HEADER.unpack_from(next_packet)
        self.assertEqual(first_header[3], 0)
        self.assertEqual(second_header[3], 0)
        self.assertEqual(next_header[3], 1)
        self.assertEqual(first_header[4], second_header[4])
        self.assertEqual(len(first_client), MRPH_HEADER.size + 2 * (8 + 2 * 4))

    def test_rejects_malformed_samples_and_timestamps(self):
        with self.assertRaises(ValueError):
            encode_sample_batch("bad", 256, [[float("nan")]], [1.0], False, 0)
        with self.assertRaises(ValueError):
            encode_sample_batch("bad", 256, [[0.0]], [float("inf")], False, 0)
        with self.assertRaises(ValueError):
            encode_sample_batch("bad", 256, [[0.0]], [1.0], False, 2**32)


if __name__ == "__main__":
    unittest.main()
