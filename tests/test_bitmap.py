import base64
import struct
import unittest

from neje_control.bitmap import (
    BitmapError,
    MonoBitmap,
    encode_classic_upload,
    encode_dk8_v40_mode4,
    encode_extended_pixels,
    reverse_bits,
)


class BitmapTests(unittest.TestCase):
    def test_mode4_bitmap_uses_fixed_576_by_552_frame(self):
        bitmap = MonoBitmap(8, 2, b"\x80\x01")
        encoded = encode_dk8_v40_mode4(bitmap, left=0, top=0)
        self.assertEqual(len(encoded), 72 * 552)
        self.assertEqual(encoded[0], 0x80)
        self.assertEqual(encoded[72], 0x01)
        self.assertFalse(any(encoded[73:]))

    def test_base64_validation_and_padding(self):
        encoded = base64.b64encode(b"\x80").decode()
        bitmap = MonoBitmap.from_base64(1, 1, encoded, max_width=490, max_height=490)
        self.assertEqual(bitmap.data, b"\x80")
        with self.assertRaises(BitmapError):
            MonoBitmap.from_base64(1, 1, base64.b64encode(b"\x81").decode(), max_width=490, max_height=490)

    def test_serpentine_rows_reverse_byte_and_bit_order(self):
        bitmap = MonoBitmap(16, 2, bytes((0x80, 0x01, 0x12, 0xA0)))
        self.assertEqual(reverse_bits(0x12), 0x48)
        self.assertEqual(encode_extended_pixels(bitmap), bytes((0x80, 0x01, 0x05, 0x48)))

    def test_classic_bmp_has_expected_layout(self):
        data = bytearray(64 * 512)
        data[0] = 0x80
        bitmap = MonoBitmap(512, 512, bytes(data))
        upload = encode_classic_upload(bitmap, "classic-v1")
        self.assertEqual(upload[:2], b"BM")
        self.assertEqual(struct.unpack_from("<I", upload, 10)[0], 62)
        self.assertEqual(len(upload), 62 + 512 * 64)
        self.assertEqual(upload[62], 0x80)
        classic_v3 = encode_classic_upload(bitmap, "classic-v3")
        self.assertEqual(len(classic_v3), 512 * 64)
        self.assertEqual(classic_v3[0], 0x7F)
        self.assertEqual(classic_v3[1], 0xFF)


if __name__ == "__main__":
    unittest.main()
