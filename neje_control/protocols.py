"""Known serial protocols used by NEJE DK-8-KZ firmware revisions."""

from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Callable, Protocol

from .bitmap import (
    MonoBitmap,
    encode_classic_upload,
    encode_dk8_v40_mode4,
    encode_extended_pixels,
)


class Transport(Protocol):
    def write(
        self,
        data: bytes,
        *,
        pace_seconds: float = 0.0,
        cancelled: Callable[[], bool] | None = None,
        progress: Callable[[int, int], None] | None = None,
    ) -> int: ...

    def read_available(self, settle_seconds: float = 0.15) -> bytes: ...

    def set_baudrate(self, baudrate: int) -> None: ...


class ProtocolError(RuntimeError):
    pass


@dataclass(frozen=True)
class BurnSettings:
    burn_time: int = 60
    power: int = 10
    idle_power: int = 1
    left: int | None = None
    top: int | None = None


PROTOCOL_INFO = {
    "dk8-official": {
        "label": "DK-8-KZ official (auto-detect)",
        "max_width": 550,
        "max_height": 550,
        "power": False,
        "pause": True,
        "outline": True,
        "home": True,
        "center": True,
        # These controls move the low-power positioning point by changing the
        # artwork origin, exactly as the official v4.2 application does.
        "jog": True,
        "point": True,
        "placement": True,
        "engrave": False,
        "prepare": False,
    },
    "classic-v1": {
        "label": "Classic v1",
        "max_width": 512,
        "max_height": 512,
        "power": False,
        "pause": True,
        "outline": True,
        "home": True,
        "center": True,
        "jog": True,
    },
    "classic-v2": {
        "label": "Classic v2",
        "max_width": 512,
        "max_height": 512,
        "power": False,
        "pause": True,
        "outline": True,
        "home": True,
        "center": True,
        "jog": True,
    },
    "classic-v3": {
        "label": "Classic v3",
        "max_width": 512,
        "max_height": 512,
        "power": False,
        "pause": True,
        "outline": True,
        "home": True,
        "center": True,
        "jog": True,
    },
    "extended-kz": {
        "label": "KZ framed (2019+)",
        "max_width": 490,
        "max_height": 490,
        "power": True,
        "pause": True,
        "outline": True,
        "home": False,
        "center": False,
        "jog": False,
    },
}


class BaseProtocol:
    name: str

    def __init__(self, transport: Transport, *, sleeper: Callable[[float], None] = time.sleep):
        self.transport = transport
        self.sleep = sleeper
        self.last_action_packets: list[bytes] = []

    @property
    def info(self) -> dict:
        return PROTOCOL_INFO[self.name]

    def initialize(self) -> bytes:
        return b""

    def action(self, name: str, **parameters: int) -> bytes:
        raise ProtocolError(f"{name} is not supported by {self.info['label']}")

    def burn(
        self,
        bitmap: MonoBitmap,
        settings: BurnSettings,
        *,
        cancelled: Callable[[], bool],
        progress: Callable[[int, int, str], None],
    ) -> None:
        raise NotImplementedError

    def prepare(
        self,
        bitmap: MonoBitmap,
        settings: BurnSettings,
        *,
        cancelled: Callable[[], bool],
        progress: Callable[[int, int, str], None],
    ) -> None:
        raise ProtocolError(f"positioning upload is not supported by {self.info['label']}")

    def start_prepared(
        self,
        settings: BurnSettings,
        *,
        progress: Callable[[int, int, str], None],
    ) -> None:
        raise ProtocolError(f"starting a prepared image is not supported by {self.info['label']}")


class ClassicProtocol(BaseProtocol):
    COMMON = {
        "start": b"\xf1",
        "pause": b"\xf2",
        "home": b"\xf3",
        "outline": b"\xf4",
        "reset": b"\xf9",
        "center": b"\xfb",
    }

    def _send_burn_time(self, burn_time: int) -> None:
        if not 1 <= burn_time <= 240:
            raise ProtocolError("classic burn time must be from 1 to 240")
        self.transport.write(bytes((burn_time,)))

    def action(self, name: str, **parameters: int) -> bytes:
        if name == "resume":
            raise ProtocolError("classic firmware has no verified resume command")
        if name == "stop":
            name = "reset"
        if name in self.COMMON:
            self.transport.write(self.COMMON[name])
            return b""
        if name in {"up", "down", "left", "right"}:
            self.transport.write(self._jog_packet(name))
            return b""
        raise ProtocolError(f"unknown or unsupported action: {name}")

    def _jog_packet(self, direction: str) -> bytes:
        raise NotImplementedError

    def _start_packet(self, burn_time: int) -> bytes:
        self._send_burn_time(burn_time)
        return self.COMMON["start"]

    @property
    def erase_packet(self) -> bytes:
        return b"\xfe" * 8

    @property
    def erase_wait(self) -> float:
        return 6.0

    def burn(
        self,
        bitmap: MonoBitmap,
        settings: BurnSettings,
        *,
        cancelled: Callable[[], bool],
        progress: Callable[[int, int, str], None],
    ) -> None:
        upload = encode_classic_upload(bitmap, self.name)
        progress(0, len(upload), "Erasing device memory")
        self.transport.write(self.erase_packet)
        self.sleep(self.erase_wait)
        if cancelled():
            self.action("stop")
            return

        def report(sent: int, total: int) -> None:
            progress(sent, total, "Uploading bitmap")

        sent = self.transport.write(upload, cancelled=cancelled, progress=report)
        if sent != len(upload) or cancelled():
            self.action("stop")
            return
        progress(len(upload), len(upload), "Starting engraving")
        self.transport.write(self._start_packet(settings.burn_time))


class ClassicV1(ClassicProtocol):
    name = "classic-v1"

    def _jog_packet(self, direction: str) -> bytes:
        return {"up": b"\xf5", "down": b"\xf6", "left": b"\xf7", "right": b"\xf8"}[direction]


class ClassicV2(ClassicProtocol):
    name = "classic-v2"

    def _jog_packet(self, direction: str) -> bytes:
        value = {"up": 1, "down": 2, "left": 3, "right": 4}[direction]
        return bytes((0xF5, value))


class ClassicV3(ClassicProtocol):
    name = "classic-v3"
    V3_ACTIONS = {
        "start": b"\xff\x01\x01\x00",
        "pause": b"\xff\x01\x02\x00",
        "reset": b"\xff\x04\x01\x00",
        "center": b"\xff\x02\x01\x00",
        "outline": b"\xff\x02\x02\x00",
        "up": b"\xff\x03\x01\x00",
        "down": b"\xff\x03\x02\x00",
        "left": b"\xff\x03\x03\x00",
        "right": b"\xff\x03\x04\x00",
    }

    @property
    def erase_packet(self) -> bytes:
        return b"\xff\x06\x01\x00"

    @property
    def erase_wait(self) -> float:
        return 0.05

    def _jog_packet(self, direction: str) -> bytes:
        return self.V3_ACTIONS[direction]

    def _start_packet(self, burn_time: int) -> bytes:
        if not 1 <= burn_time <= 240:
            raise ProtocolError("classic burn time must be from 1 to 240")
        self.transport.write(bytes((0xFF, 0x05, burn_time, 0x00)))
        return self.V3_ACTIONS["start"]

    def action(self, name: str, **parameters: int) -> bytes:
        if name == "home":
            self.transport.write(b"\xf3")
            return b""
        if name == "stop":
            name = "reset"
        if name == "resume":
            raise ProtocolError("classic v3 has no verified resume command")
        packet = self.V3_ACTIONS.get(name)
        if packet is None:
            raise ProtocolError(f"unknown or unsupported action: {name}")
        self.transport.write(packet)
        return b""


class DK8Official(BaseProtocol):
    """Protocols used by NEJE's official DK-8-KZ v4.0/v4.2 apps.

    The controller exchanges four-byte status frames and uses seven-byte
    base-100 coordinate frames.  This is distinct from both EzGraver's older
    protocols and the later ``FF AA ... 55`` KZ3000 framed protocol.
    """

    name = "dk8-official"
    QUERY_STATUS = b"\xff\x09\x00\x00"
    SIMPLE_ACTIONS = {
        "pause": b"\xff\x01\x02\x00",
        "resume": b"\xff\x01\x01\x00",
        "stop": b"\xff\x04\x01\x00",
        "outline-stop": b"\xff\x02\x01\x00",
    }
    # v4.0 profile numbers and behavior. v4.2 renumbered profiles 5-8 as
    # modes 1-4, but retained their geometry command path.
    SIGNATURES = {
        (0x0A, 0x01): (1, 490, "direct"),
        (0x0B, 0x01): (2, 490, "direct"),
        (0x0D, 0x01): (3, 490, "direct"),
        (0x01, 0x00): (4, 550, "direct"),
        (0x0B, 0x02): (5, 490, "geometry"),
        (0x0D, 0x02): (6, 490, "geometry"),
        (0x01, 0x0A): (7, 550, "geometry"),
        (0x0E, 0x01): (8, 2000, "geometry"),
    }
    DIRECT_JOG = {
        "up": b"\xff\x03\x01\x00",
        "down": b"\xff\x03\x02\x00",
        "left": b"\xff\x03\x03\x00",
        "right": b"\xff\x03\x04\x00",
    }

    def __init__(self, transport: Transport, **kwargs):
        super().__init__(transport, **kwargs)
        self.machine_mode: int | None = None
        self.work_size: int | None = None
        self.control_style: str | None = None
        self.handshake: bytes = b""

    @property
    def info(self) -> dict:
        result = dict(PROTOCOL_INFO[self.name])
        if self.work_size is not None:
            result["max_width"] = self.work_size
            result["max_height"] = self.work_size
        if self.control_style == "direct":
            result.update(
                placement=False,
                home=False,
                center=False,
                jog=True,
                # This fixed-frame upload is verified from the official v4.0
                # mode-4 branch. Other old profiles remain locked.
                engrave=self.machine_mode == 4,
                prepare=self.machine_mode == 4,
            )
        elif self.control_style == "geometry":
            result.update(placement=True, home=True, center=True, jog=True)
        return result

    @staticmethod
    def _frames(data: bytes):
        """Yield complete four-byte controller frames from a byte stream."""
        offset = 0
        while offset <= len(data) - 4:
            marker = data.find(b"\xff", offset)
            if marker < 0 or marker > len(data) - 4:
                return
            yield data[marker : marker + 4]
            offset = marker + 4

    @classmethod
    def profile_from_reply(cls, data: bytes) -> tuple[int, int, str] | None:
        # Response command 0x02 identifies the board. The user's 01 00 reply
        # is v4.0 profile 4: 550 square with direct FF 03 jog commands.
        for frame in cls._frames(data):
            if frame[1] != 0x02:
                continue
            profile = cls.SIGNATURES.get((frame[2], frame[3]))
            if profile is not None:
                return profile
        return None

    def initialize(self) -> bytes:
        # This is the exact connection probe sent by Form_LinkAssistant.Connect
        # in the official DK-8-KZ v4.2 program.
        self.transport.write(self.QUERY_STATUS)
        self.handshake = self.transport.read_available(0.6)
        profile = self.profile_from_reply(self.handshake)
        if profile is not None:
            self.machine_mode, self.work_size, self.control_style = profile
        return self.handshake

    @staticmethod
    def _base100(value: int) -> tuple[int, int]:
        if not 0 <= value <= 9999:
            raise ProtocolError("coordinate must be from 0 to 9999")
        return divmod(value, 100)

    @classmethod
    def placement_packet(cls, left: int, top: int) -> bytes:
        left_hi, left_lo = cls._base100(left)
        top_hi, top_lo = cls._base100(top)
        return bytes((0xFF, 0x6E, 0x01, left_hi, left_lo, top_hi, top_lo))

    @classmethod
    def size_packet(cls, width: int, height: int) -> bytes:
        # The official application rounds width up to a complete bitmap byte.
        padded_width = ((width + 7) // 8) * 8
        width_hi, width_lo = cls._base100(padded_width)
        height_hi, height_lo = cls._base100(height)
        return bytes((0xFF, 0x6E, 0x02, width_hi, width_lo, height_hi, height_lo))

    def _validate_geometry(self, width: int, height: int, left: int, top: int) -> None:
        maximum = self.info["max_width"]
        if not 1 <= width <= maximum or not 1 <= height <= maximum:
            raise ProtocolError(f"image must be between 1x1 and {maximum}x{maximum} pixels")
        if left < 0 or top < 0 or left + width > maximum or top + height > maximum:
            raise ProtocolError(
                f"image position falls outside the {maximum}x{maximum} work area"
            )

    def _send_point(self, x: int, y: int) -> list[bytes]:
        maximum = self.info["max_width"]
        if not 0 <= x < maximum or not 0 <= y < maximum:
            raise ProtocolError(
                f"laser point must be inside the {maximum}x{maximum} work area"
            )
        x_hi, x_lo = self._base100(x)
        y_hi, y_lo = self._base100(y)
        packets = [
            bytes((0xFF, 0x0A, x_hi, x_lo)),
            bytes((0xFF, 0x0B, y_hi, y_lo)),
        ]
        for packet in packets:
            self.transport.write(packet)
        return packets

    def _send_geometry(self, *, width: int, height: int, left: int, top: int) -> list[bytes]:
        self._validate_geometry(width, height, left, top)
        packets = [self.placement_packet(left, top), self.size_packet(width, height)]
        for packet in packets:
            self.transport.write(packet)
        return packets

    def action(self, name: str, **parameters: int) -> bytes:
        # Remove delayed status bytes so the displayed reply belongs to this
        # action rather than to the connection probe.
        self.transport.read_available(0.0)
        self.last_action_packets = []

        def send(packet: bytes) -> None:
            self.transport.write(packet)
            self.last_action_packets.append(packet)

        if self.control_style == "direct" and name in self.DIRECT_JOG:
            send(self.DIRECT_JOG[name])
        elif name == "point" and self.control_style in {"direct", "geometry"}:
            # NEJE v4's "any point" tool sends absolute X and Y separately,
            # using base-100 coordinates from a click on its preview.
            self.last_action_packets.extend(self._send_point(
                x=parameters["x"],
                y=parameters["y"],
            ))
        elif self.control_style == "direct" and name == "outline":
            # Exact old-profile *start preview* command from NEJE v4.0.
            send(b"\xff\x02\x02\x00")
        elif self.control_style == "direct" and name == "outline-stop":
            # v4.0 returns its absolute point to the origin before leaving
            # preview, then sends the preview-stop command.
            send(b"\xff\x0a\x00\x00")
            send(b"\xff\x0b\x00\x00")
            send(b"\xff\x02\x01\x00")
        elif name in {"up", "down", "left", "right", "home", "center", "place"}:
            self.last_action_packets.extend(self._send_geometry(
                width=parameters["width"],
                height=parameters["height"],
                left=parameters["left"],
                top=parameters["top"],
            ))
        elif name == "outline":
            self.last_action_packets.extend(self._send_geometry(
                width=parameters["width"],
                height=parameters["height"],
                left=parameters["left"],
                top=parameters["top"],
            ))
            # Starts only the low-power rectangular positioning trace.
            send(b"\xff\x02\x02\x00")
        else:
            packet = self.SIMPLE_ACTIONS.get(name)
            if packet is None:
                raise ProtocolError(f"unknown or unsupported action: {name}")
            send(packet)
        return self.transport.read_available(0.35)

    @staticmethod
    def _contains_response(
        data: bytes,
        command: int,
        data1: int | None = None,
        data2: int | None = None,
    ) -> bool:
        return any(
            frame[1] == command
            and (data1 is None or frame[2] == data1)
            and (data2 is None or frame[3] == data2)
            for frame in DK8Official._frames(data)
        )

    def _read_until_response(
        self,
        command: int,
        timeout: float,
        data1: int | None = None,
        data2: int | None = None,
    ) -> bytes:
        deadline = time.monotonic() + timeout
        received = bytearray()
        while time.monotonic() < deadline:
            remaining = deadline - time.monotonic()
            received.extend(self.transport.read_available(min(0.15, remaining)))
            if self._contains_response(received, command, data1, data2):
                break
        return bytes(received)

    def burn(
        self,
        bitmap: MonoBitmap,
        settings: BurnSettings,
        *,
        cancelled: Callable[[], bool],
        progress: Callable[[int, int, str], None],
    ) -> None:
        if not 1 <= settings.burn_time <= 240:
            raise ProtocolError("DK-8-KZ burn time must be from 1 to 240")
        if self.control_style == "direct":
            self.prepare(
                bitmap,
                settings,
                cancelled=cancelled,
                progress=progress,
            )
            if cancelled():
                return
            self.start_prepared(settings, progress=progress)
            return

        maximum = self.info["max_width"]
        left = (maximum - bitmap.width) // 2 if settings.left is None else settings.left
        top = (maximum - bitmap.height) // 2 if settings.top is None else settings.top
        self._send_geometry(
            width=bitmap.width,
            height=bitmap.height,
            left=left,
            top=top,
        )
        pixels = encode_extended_pixels(bitmap)
        self.transport.write(bytes((0xFF, 0x05, settings.burn_time, 0x00)))
        self.transport.write(b"\xff\x0e\x00\x01")
        self.sleep(0.02)
        self.transport.set_baudrate(115_200)
        self.sleep(0.02)
        self.transport.write(b"\xff\x06\x01\x01")
        request = self.transport.read_available(1.0)
        if not self._contains_response(request, 0x05):
            raise ProtocolError(
                "controller did not request bitmap data; engraving was not started"
            )
        progress(0, len(pixels), "Uploading bitmap")

        def report(sent: int, total: int) -> None:
            progress(sent, total, "Uploading bitmap")

        sent = self.transport.write(pixels, cancelled=cancelled, progress=report)
        if sent != len(pixels) or cancelled():
            self.action("stop")
            return
        completed = self.transport.read_available(1.0)
        if not self._contains_response(completed, 0x06):
            raise ProtocolError(
                "bitmap was sent, but the controller did not confirm it; engraving was not started"
            )
        self.transport.write(b"\xff\x01\x01\x00")
        progress(len(pixels), len(pixels), "Engraving started on the device")

    def start_prepared(
        self,
        settings: BurnSettings,
        *,
        progress: Callable[[int, int, str], None],
    ) -> None:
        """Start the mode-4 bitmap already retained by the controller."""
        if self.control_style != "direct" or self.machine_mode != 4:
            raise ProtocolError("prepared-image start is implemented only for DK-8-KZ mode 4")
        if not 1 <= settings.burn_time <= 240:
            raise ProtocolError("DK-8-KZ burn time must be from 1 to 240")
        self.transport.write(bytes((0xFF, 0x05, settings.burn_time, 0x00)))
        self.sleep(0.02)
        self.transport.write(b"\xff\x01\x01\x00")
        progress(0, 0, "Engraving started on the device")

    def prepare(
        self,
        bitmap: MonoBitmap,
        settings: BurnSettings,
        *,
        cancelled: Callable[[], bool],
        progress: Callable[[int, int, str], None],
    ) -> None:
        if self.control_style != "direct" or self.machine_mode != 4:
            raise ProtocolError("positioning upload is implemented only for DK-8-KZ mode 4")
        if not 1 <= settings.burn_time <= 240:
            raise ProtocolError("DK-8-KZ burn time must be from 1 to 240")
        pixels = encode_dk8_v40_mode4(bitmap, left=settings.left, top=settings.top)
        # The official mode-4 Send Image path issues this request by itself.
        # Burn time is a separate setting and sending it immediately first can
        # prevent older controllers from entering their bitmap receive state.
        self.transport.write(b"\xff\x06\x01\x00")
        request = self._read_until_response(0x05, 3.0, 0x01, 0x00)
        if not self._contains_response(request, 0x05, 0x01, 0x00):
            raise ProtocolError("controller did not request mode-4 bitmap data")
        progress(0, len(pixels), "Uploading image for positioning")

        def report_mode4(sent: int, total: int) -> None:
            progress(sent, total, "Uploading image for positioning")

        sent = self.transport.write(pixels, cancelled=cancelled, progress=report_mode4)
        if sent != len(pixels) or cancelled():
            self.action("stop")
            return
        completed = self._read_until_response(0x0B, 10.0)
        if not self._contains_response(completed, 0x0B):
            raise ProtocolError("mode-4 positioning image was not verified by the controller")
        progress(len(pixels), len(pixels), "Image ready for positioning")


def _u16(value: int) -> bytes:
    if not 0 <= value <= 0xFFFF:
        raise ProtocolError(f"value {value} does not fit in an unsigned 16-bit field")
    return value.to_bytes(2, "big")


class ExtendedKZ(BaseProtocol):
    name = "extended-kz"
    pace_seconds = 0.003
    INIT_1 = b"\xff\x09\x5a\xa5"
    INIT_2 = b"\xff\xaa\x08\x01\x01\x5a\xa5\x55"
    SIMPLE_ACTIONS = {
        "pause": b"\xff\xaa\x08\x02\x01\x01\x00\x55",
        "resume": b"\xff\xaa\x08\x02\x01\x01\x01\x55",
        "stop": b"\xff\xaa\x08\x02\x01\x01\x02\x55",
    }

    def _write(self, data: bytes, **kwargs) -> int:
        return self.transport.write(data, pace_seconds=self.pace_seconds, **kwargs)

    def initialize(self) -> bytes:
        self._write(self.INIT_1)
        first = self.transport.read_available(1.0)
        self._write(self.INIT_2)
        second = self.transport.read_available(1.0)
        return first + second

    @staticmethod
    def settings_packet(settings: BurnSettings) -> bytes:
        if not 1 <= settings.burn_time <= 100:
            raise ProtocolError("KZ burn time must be from 1 to 100 ms")
        if not 1 <= settings.power <= 100:
            raise ProtocolError("KZ laser power must be from 1 to 100 percent")
        if not 1 <= settings.idle_power <= 10:
            raise ProtocolError("KZ idle laser power must be from 1 to 10")
        return bytes(
            (0xFF, 0xAA, 0x0B, 0x03, 0x01, settings.burn_time, settings.power, settings.idle_power, 0, 0, 0x55)
        )

    @staticmethod
    def bitmap_header(
        bitmap: MonoBitmap,
        left: int | None = None,
        top: int | None = None,
    ) -> bytes:
        if bitmap.width > 490 or bitmap.height > 490:
            raise ProtocolError("KZ framed firmware accepts at most 490x490 pixels")
        padded_width = bitmap.bytes_per_row * 8
        data_size = bitmap.bytes_per_row * bitmap.height
        left = (490 - bitmap.width) // 2 if left is None else left
        top = (490 - bitmap.height) // 2 if top is None else top
        if not 0 <= left <= 490 - bitmap.width:
            raise ProtocolError(f"X position must be from 0 to {490 - bitmap.width}")
        if not 0 <= top <= 490 - bitmap.height:
            raise ProtocolError(f"Y position must be from 0 to {490 - bitmap.height}")
        return b"".join(
            (
                b"\xff\xaa\x16\x04\x02\x01",
                _u16(left),
                _u16(top),
                _u16(padded_width),
                _u16(bitmap.height),
                b"\x00\x00",
                _u16(data_size),
                _u16(bitmap.width),
                b"\x10\x55",
            )
        )

    @staticmethod
    def outline_packet(
        width: int,
        height: int,
        enabled: bool = True,
        left: int | None = None,
        top: int | None = None,
    ) -> bytes:
        if not enabled:
            return b"\xff\xaa\x10\x05\x01\x50" + b"\x00" * 9 + b"\x55"
        if not 1 <= width <= 490 or not 1 <= height <= 490:
            raise ProtocolError("outline must be between 1x1 and 490x490 pixels")
        left = (490 - width) // 2 if left is None else left
        top = (490 - height) // 2 if top is None else top
        if not 0 <= left <= 490 - width or not 0 <= top <= 490 - height:
            raise ProtocolError("outline position falls outside the 490x490 work area")
        return b"".join((b"\xff\xaa\x10\x05\x01\x50\x02", _u16(left), _u16(top), _u16(width), _u16(height), b"\x55"))

    def action(self, name: str, **parameters: int) -> bytes:
        if name == "outline":
            self._write(
                self.outline_packet(
                    parameters["width"],
                    parameters["height"],
                    left=parameters.get("left"),
                    top=parameters.get("top"),
                )
            )
            return self.transport.read_available(0.5)
        if name == "outline-stop":
            self._write(self.outline_packet(1, 1, enabled=False))
            return self.transport.read_available(0.5)
        packet = self.SIMPLE_ACTIONS.get(name)
        if packet is None:
            raise ProtocolError(f"unknown or unsupported action: {name}")
        self._write(packet)
        return self.transport.read_available(0.5)

    def burn(
        self,
        bitmap: MonoBitmap,
        settings: BurnSettings,
        *,
        cancelled: Callable[[], bool],
        progress: Callable[[int, int, str], None],
    ) -> None:
        pixels = encode_extended_pixels(bitmap)
        progress(0, len(pixels), "Initializing controller")
        self.initialize()
        if cancelled():
            self.action("stop")
            return
        self._write(self.settings_packet(settings))
        self._write(self.bitmap_header(bitmap, left=settings.left, top=settings.top))

        def report(sent: int, total: int) -> None:
            progress(sent, total, "Uploading bitmap (engraving starts after upload)")

        sent = self._write(pixels, cancelled=cancelled, progress=report)
        if sent != len(pixels) or cancelled():
            self.action("stop")
            return
        progress(len(pixels), len(pixels), "Engraving started on the device")


def create_protocol(name: str, transport: Transport, **kwargs) -> BaseProtocol:
    classes = {
        "dk8-official": DK8Official,
        "classic-v1": ClassicV1,
        "classic-v2": ClassicV2,
        "classic-v3": ClassicV3,
        "extended-kz": ExtendedKZ,
    }
    try:
        return classes[name](transport, **kwargs)
    except KeyError as exc:
        raise ProtocolError(f"unknown protocol: {name}") from exc
