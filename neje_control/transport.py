"""Serial transport abstraction, isolated to make protocol code testable."""

from __future__ import annotations

from contextlib import AbstractContextManager
import errno
import sys
import threading
import time
from typing import Callable


class SerialUnavailable(RuntimeError):
    pass


class SerialTransport(AbstractContextManager["SerialTransport"]):
    def __init__(self, port: str, baudrate: int = 57_600, timeout: float = 0.08):
        try:
            import serial
        except ImportError as exc:
            raise SerialUnavailable(
                "pyserial is not installed; run: python3 -m pip install -r requirements.txt"
            ) from exc
        try:
            self._serial = serial.Serial(
                port=port,
                baudrate=baudrate,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                timeout=timeout,
                write_timeout=3,
                rtscts=False,
                xonxoff=False,
                dsrdtr=False,
            )
            self._serial.rts = True
            self._serial.dtr = True
        except Exception as exc:
            if sys.platform == "darwin" and getattr(exc, "errno", None) == errno.EINVAL:
                raise SerialUnavailable(
                    "macOS can see the CH340 USB adapter, but its AppleUSBCHCOM "
                    "driver is not accepting serial settings after reconnect. Fully "
                    "power off the engraver, unplug both USB and its power supply for "
                    "10 seconds, then reconnect power and USB before trying again."
                ) from exc
            raise SerialUnavailable(f"could not open serial port {port}: {exc}") from exc
        self._lock = threading.RLock()

    @property
    def port(self) -> str:
        return self._serial.port

    def write(
        self,
        data: bytes,
        *,
        pace_seconds: float = 0.0,
        cancelled: Callable[[], bool] | None = None,
        progress: Callable[[int, int], None] | None = None,
    ) -> int:
        sent = 0
        total = len(data)
        with self._lock:
            if pace_seconds:
                for value in data:
                    if cancelled and cancelled():
                        break
                    self._serial.write(bytes((value,)))
                    self._serial.flush()
                    sent += 1
                    if progress and (sent % 32 == 0 or sent == total):
                        progress(sent, total)
                    time.sleep(pace_seconds)
            else:
                chunk_size = 4096
                for offset in range(0, total, chunk_size):
                    if cancelled and cancelled():
                        break
                    chunk = data[offset : offset + chunk_size]
                    self._serial.write(chunk)
                    self._serial.flush()
                    sent += len(chunk)
                    if progress:
                        progress(sent, total)
        return sent

    def read_available(self, settle_seconds: float = 0.15) -> bytes:
        time.sleep(settle_seconds)
        with self._lock:
            waiting = self._serial.in_waiting
            return self._serial.read(waiting) if waiting else b""

    def set_baudrate(self, baudrate: int) -> None:
        if baudrate not in {57_600, 115_200, 230_400, 460_800, 750_000}:
            raise ValueError(f"unsupported controller baud rate: {baudrate}")
        with self._lock:
            self._serial.baudrate = baudrate

    def close(self) -> None:
        with self._lock:
            if self._serial.is_open:
                self._serial.close()

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.close()


def available_ports() -> list[dict[str, str | int | None]]:
    try:
        from serial.tools import list_ports
    except ImportError as exc:
        raise SerialUnavailable(
            "pyserial is not installed; run: python3 -m pip install -r requirements.txt"
        ) from exc
    result = []
    for port in list_ports.comports():
        result.append(
            {
                "device": port.device,
                "description": port.description or "Serial device",
                "vid": port.vid,
                "pid": port.pid,
                "likely_neje": port.vid == 0x1A86 and port.pid in {0x7523, 0x5523},
            }
        )
    return result
