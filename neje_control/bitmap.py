"""Monochrome bitmap validation and device-specific byte encoders."""

from __future__ import annotations

from dataclasses import dataclass
import base64
import struct


class BitmapError(ValueError):
    """Raised when a bitmap payload is malformed or out of range."""


@dataclass(frozen=True)
class MonoBitmap:
    """A top-to-bottom, MSB-first monochrome burn mask.

    A set bit means "burn this pixel". Unused low bits at the right edge must be
    zero, which the browser client guarantees and :meth:`from_base64` enforces.
    """

    width: int
    height: int
    data: bytes

    @property
    def bytes_per_row(self) -> int:
        return (self.width + 7) // 8

    @classmethod
    def from_base64(
        cls,
        width: int,
        height: int,
        encoded: str,
        *,
        max_width: int,
        max_height: int,
    ) -> "MonoBitmap":
        if isinstance(width, bool) or isinstance(height, bool):
            raise BitmapError("width and height must be integers")
        if not isinstance(width, int) or not isinstance(height, int):
            raise BitmapError("width and height must be integers")
        if not 1 <= width <= max_width or not 1 <= height <= max_height:
            raise BitmapError(
                f"bitmap must be between 1x1 and {max_width}x{max_height} pixels"
            )
        try:
            data = base64.b64decode(encoded, validate=True)
        except Exception as exc:  # binascii.Error varies between Python versions
            raise BitmapError("pixels must be valid base64") from exc
        expected = ((width + 7) // 8) * height
        if len(data) != expected:
            raise BitmapError(f"expected {expected} pixel bytes, received {len(data)}")
        if width % 8:
            unused_mask = (1 << (8 - width % 8)) - 1
            row_bytes = (width + 7) // 8
            for row in range(height):
                if data[(row + 1) * row_bytes - 1] & unused_mask:
                    raise BitmapError("unused row padding bits must be zero")
        return cls(width, height, data)


def reverse_bits(value: int) -> int:
    value = ((value & 0xF0) >> 4) | ((value & 0x0F) << 4)
    value = ((value & 0xCC) >> 2) | ((value & 0x33) << 2)
    return ((value & 0xAA) >> 1) | ((value & 0x55) << 1)


def encode_extended_pixels(bitmap: MonoBitmap) -> bytes:
    """Encode the later KZ firmware's alternating serpentine scan rows."""

    row_bytes = bitmap.bytes_per_row
    output = bytearray()
    for row_index in range(bitmap.height):
        start = row_index * row_bytes
        row = bitmap.data[start : start + row_bytes]
        if row_index % 2:
            output.extend(reverse_bits(value) for value in reversed(row))
        else:
            output.extend(row)
    return bytes(output)


def encode_dk8_v40_mode4(
    bitmap: MonoBitmap,
    *,
    left: int | None = None,
    top: int | None = None,
) -> bytes:
    """Place artwork in the fixed framebuffer used by DK-8-KZ v4.0 mode 4.

    NEJE's application always uploads 576 x 552 bits (72 bytes per row), even
    though the usable mode-4 work area is 550 x 550. Artwork is placed within
    that work area and unused framebuffer pixels remain white/off.
    """

    work_width = work_height = 550
    frame_width, frame_height = 576, 552
    if bitmap.width > work_width or bitmap.height > work_height:
        raise BitmapError("DK-8-KZ mode 4 artwork must fit within 550x550 pixels")
    if left is None:
        left = (work_width - bitmap.width) // 2
    if top is None:
        top = (work_height - bitmap.height) // 2
    if left < 0 or top < 0 or left + bitmap.width > work_width or top + bitmap.height > work_height:
        raise BitmapError("DK-8-KZ mode 4 artwork position falls outside the 550x550 work area")

    frame = bytearray((frame_width // 8) * frame_height)
    source_row_bytes = bitmap.bytes_per_row
    destination_row_bytes = frame_width // 8
    for source_y in range(bitmap.height):
        source_start = source_y * source_row_bytes
        destination_y = top + source_y
        for source_x in range(bitmap.width):
            source_byte = bitmap.data[source_start + source_x // 8]
            if source_byte & (0x80 >> (source_x % 8)):
                destination_x = left + source_x
                destination_index = destination_y * destination_row_bytes + destination_x // 8
                frame[destination_index] |= 0x80 >> (destination_x % 8)
    return bytes(frame)


def _bmp_file(bitmap: MonoBitmap) -> bytes:
    """Build the exact 1-bit BMP layout used by the classic protocol."""

    if bitmap.width != 512 or bitmap.height != 512:
        raise BitmapError("classic protocols require a 512x512 bitmap")
    source_stride = bitmap.bytes_per_row
    file_stride = (source_stride + 3) & ~3
    pixel_size = file_stride * bitmap.height
    pixel_offset = 14 + 40 + 8
    file_size = pixel_offset + pixel_size

    file_header = struct.pack("<2sIHHI", b"BM", file_size, 0, 0, pixel_offset)
    info_header = struct.pack(
        "<IiiHHIIiiII",
        40,
        bitmap.width,
        bitmap.height,
        1,
        1,
        0,
        pixel_size,
        2835,
        2835,
        2,
        2,
    )
    # The controller consumes pixel bits directly. Palette entry 1 is white to
    # mirror QImage's historic Mono BMP output after invertPixels().
    palette = b"\x00\x00\x00\x00\xff\xff\xff\x00"
    padding = b"\x00" * (file_stride - source_stride)
    rows = bytearray()
    # QImage was vertically mirrored before saving a bottom-up BMP, resulting
    # in top-to-bottom source rows in the file payload.
    for row in range(bitmap.height):
        start = row * source_stride
        rows.extend(bitmap.data[start : start + source_stride])
        rows.extend(padding)
    return file_header + info_header + palette + bytes(rows)


def encode_classic_upload(bitmap: MonoBitmap, protocol: str) -> bytes:
    bmp = _bmp_file(bitmap)
    if protocol in {"classic-v1", "classic-v2"}:
        return bmp
    if protocol == "classic-v3":
        # EzGraver's v3 implementation explicitly omits the pixel inversion
        # used by v1/v2. QImage's monochrome convention is 0=black, 1=white,
        # while MonoBitmap deliberately uses 1=burn for every browser/API job.
        return bytes(value ^ 0xFF for value in bmp[62:])
    raise ValueError(f"unknown classic protocol: {protocol}")
