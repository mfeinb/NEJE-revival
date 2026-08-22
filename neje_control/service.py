"""Thread-safe application service used by the local HTTP interface."""

from __future__ import annotations

import threading
from typing import Any, Callable

from .bitmap import MonoBitmap
from .protocols import BurnSettings, PROTOCOL_INFO, BaseProtocol, ProtocolError, create_protocol
from .transport import SerialTransport, SerialUnavailable, available_ports


class ServiceError(RuntimeError):
    pass


class ControllerService:
    def __init__(self, transport_factory: Callable[[str], SerialTransport] = SerialTransport):
        self._transport_factory = transport_factory
        self._transport: SerialTransport | None = None
        self._protocol: BaseProtocol | None = None
        self._port: str | None = None
        self._lock = threading.RLock()
        self._cancel = threading.Event()
        self._worker: threading.Thread | None = None
        self._prepared_signature: tuple[int, int, bytes, int | None, int | None] | None = None
        self._state: dict[str, Any] = {
            "connected": False,
            "uploading": False,
            "device_running": False,
            "phase": "Disconnected",
            "sent": 0,
            "total": 0,
            "error": None,
            "verified": False,
            "handshake_hex": "",
            "machine_mode": None,
            "last_command_reply_hex": "",
            "last_command_hex": "",
            "prepared": False,
        }

    def ports(self) -> list[dict[str, Any]]:
        return available_ports()

    def protocols(self) -> dict[str, dict[str, Any]]:
        return PROTOCOL_INFO

    def connect(self, port: str, protocol_name: str) -> dict[str, Any]:
        if not port or not isinstance(port, str):
            raise ServiceError("select a serial port")
        if protocol_name not in PROTOCOL_INFO:
            raise ServiceError("select a supported protocol")
        with self._lock:
            if self._state["uploading"]:
                raise ServiceError("cannot reconnect while an image is uploading")
            self._close_locked()
            transport = None
            try:
                transport = self._transport_factory(port)
                protocol = create_protocol(protocol_name, transport)
                reply = protocol.initialize()
            except Exception:
                try:
                    if transport is not None:
                        transport.close()
                except Exception:
                    pass
                raise
            self._transport = transport
            self._protocol = protocol
            self._port = port
            self._prepared_signature = None
            machine_mode = getattr(protocol, "machine_mode", None)
            verified = machine_mode is not None if protocol_name == "dk8-official" else False
            self._state.update(
                connected=True,
                uploading=False,
                device_running=False,
                phase=(
                    f"Detected DK-8-KZ mode {machine_mode}"
                    if verified
                    else f"Connected using {protocol.info['label']}"
                ),
                sent=0,
                total=0,
                error=None,
                verified=verified,
                handshake_hex=reply.hex(" "),
                machine_mode=machine_mode,
                last_command_reply_hex="",
                last_command_hex="",
                prepared=False,
            )
            return self.status()

    def disconnect(self) -> None:
        with self._lock:
            if self._state["uploading"]:
                self._cancel.set()
                raise ServiceError("stop requested; wait for upload cancellation before disconnecting")
            self._close_locked()

    def _close_locked(self) -> None:
        if self._transport is not None:
            self._transport.close()
        self._transport = None
        self._protocol = None
        self._port = None
        self._prepared_signature = None
        self._state.update(
            connected=False,
            uploading=False,
            device_running=False,
            phase="Disconnected",
            sent=0,
            total=0,
            error=None,
            verified=False,
            handshake_hex="",
            machine_mode=None,
            last_command_reply_hex="",
            last_command_hex="",
            prepared=False,
        )

    def status(self) -> dict[str, Any]:
        with self._lock:
            result = dict(self._state)
            result["port"] = self._port
            result["protocol"] = self._protocol.name if self._protocol else None
            result["protocol_info"] = self._protocol.info if self._protocol else None
            return result

    def _connected_protocol(self) -> BaseProtocol:
        if self._protocol is None or self._transport is None:
            raise ServiceError("connect to the engraver first")
        return self._protocol

    def action(self, name: str, parameters: dict[str, Any], safety_acknowledged: bool) -> None:
        protocol = self._connected_protocol()
        laser_actions = {"outline"}
        if name in laser_actions and not safety_acknowledged:
            raise ServiceError("confirm the laser safety checklist before using outline")
        if name == "stop" and self._state["uploading"]:
            self._cancel.set()
            with self._lock:
                self._state["phase"] = "Stopping upload safely"
            return
        if self._state["uploading"]:
            raise ServiceError("only Stop is available while an image is uploading")
        if name == "point" and self._state["device_running"]:
            raise ServiceError("click-to-move is available only while the engraver is idle")
        try:
            clean_parameters = {
                key: int(value)
                for key, value in parameters.items()
                if key in {"width", "height", "left", "top", "x", "y"} and value is not None
            }
            with self._lock:
                reply = protocol.action(name, **clean_parameters)
        except (KeyError, TypeError, ValueError, ProtocolError) as exc:
            raise ServiceError(str(exc)) from exc
        with self._lock:
            self._state["error"] = None
            if name == "stop":
                self._state.update(device_running=False, phase="Stopped")
            elif name == "pause":
                self._state.update(device_running=False, phase="Paused")
            elif name == "resume":
                self._state.update(device_running=True, phase="Resumed")
            else:
                self._state["phase"] = f"Sent {name} command"
            self._state["last_command_reply_hex"] = reply.hex(" ")
            self._state["last_command_hex"] = " · ".join(
                packet.hex(" ") for packet in protocol.last_action_packets
            )

    def start_job(
        self,
        payload: dict[str, Any],
        *,
        safety_acknowledged: bool,
    ) -> None:
        protocol = self._connected_protocol()
        if not protocol.info.get("engrave", True):
            raise ServiceError(
                "engraving upload is not implemented for this detected controller profile"
            )
        if not safety_acknowledged:
            raise ServiceError("confirm the laser safety checklist before engraving")
        if self._state["uploading"]:
            raise ServiceError("an image is already uploading")
        bitmap, settings = self._parse_bitmap_payload(protocol, payload)
        signature = self._bitmap_signature(bitmap, settings)
        with self._lock:
            reuse_prepared = bool(
                protocol.info.get("prepare", False)
                and self._state["prepared"]
                and self._prepared_signature == signature
            )

        self._cancel.clear()
        with self._lock:
            self._state.update(
                uploading=True,
                device_running=False,
                phase="Starting prepared image" if reuse_prepared else "Preparing upload",
                sent=0,
                total=0 if reuse_prepared else len(bitmap.data),
                error=None,
                prepared=reuse_prepared,
            )

        def progress(sent: int, total: int, phase: str) -> None:
            with self._lock:
                self._state.update(sent=sent, total=total, phase=phase)

        def run() -> None:
            try:
                if reuse_prepared:
                    protocol.start_prepared(settings, progress=progress)
                else:
                    protocol.burn(
                        bitmap,
                        settings,
                        cancelled=self._cancel.is_set,
                        progress=progress,
                    )
                with self._lock:
                    if self._cancel.is_set():
                        self._state.update(device_running=False, phase="Stopped")
                    else:
                        if protocol.info.get("prepare", False):
                            self._prepared_signature = signature
                        self._state.update(
                            device_running=True,
                            phase="Engraving started",
                            prepared=True,
                            error=None,
                            last_command_reply_hex="",
                            last_command_hex=" · ".join(
                                packet.hex(" ") for packet in protocol.last_action_packets
                            ),
                        )
            except Exception as exc:
                with self._lock:
                    self._prepared_signature = None
                    self._state.update(device_running=False, phase="Job failed", error=str(exc))
            finally:
                with self._lock:
                    self._state["uploading"] = False

        self._worker = threading.Thread(target=run, name="neje-upload", daemon=True)
        self._worker.start()

    def prepare_job(self, payload: dict[str, Any]) -> None:
        protocol = self._connected_protocol()
        if not protocol.info.get("prepare", False):
            raise ServiceError("positioning upload is not supported by this controller profile")
        if self._state["uploading"]:
            raise ServiceError("an image is already uploading")
        if self._state["device_running"]:
            raise ServiceError("stop or pause engraving before preparing a positioning image")
        bitmap, settings = self._parse_bitmap_payload(protocol, payload)
        signature = self._bitmap_signature(bitmap, settings)
        self._cancel.clear()
        with self._lock:
            self._prepared_signature = None
            self._state.update(
                uploading=True,
                device_running=False,
                phase="Preparing positioning image",
                sent=0,
                total=len(bitmap.data),
                error=None,
                prepared=False,
            )

        def progress(sent: int, total: int, phase: str) -> None:
            with self._lock:
                self._state.update(sent=sent, total=total, phase=phase)

        def run() -> None:
            try:
                protocol.prepare(
                    bitmap,
                    settings,
                    cancelled=self._cancel.is_set,
                    progress=progress,
                )
                with self._lock:
                    if self._cancel.is_set():
                        self._state.update(device_running=False, phase="Stopped", prepared=False)
                    else:
                        self._prepared_signature = signature
                        self._state.update(
                            device_running=False,
                            phase="Image ready for positioning",
                            prepared=True,
                        )
            except Exception as exc:
                with self._lock:
                    self._prepared_signature = None
                    self._state.update(
                        device_running=False,
                        phase="Positioning upload failed",
                        error=str(exc),
                        prepared=False,
                    )
            finally:
                with self._lock:
                    self._state["uploading"] = False

        self._worker = threading.Thread(target=run, name="neje-prepare", daemon=True)
        self._worker.start()

    @staticmethod
    def _bitmap_signature(
        bitmap: MonoBitmap,
        settings: BurnSettings,
    ) -> tuple[int, int, bytes, int | None, int | None]:
        """Identity of the framebuffer content retained by mode-4 firmware."""
        return bitmap.width, bitmap.height, bitmap.data, settings.left, settings.top

    @staticmethod
    def _parse_bitmap_payload(
        protocol: BaseProtocol,
        payload: dict[str, Any],
    ) -> tuple[MonoBitmap, BurnSettings]:
        try:
            bitmap = MonoBitmap.from_base64(
                payload["width"],
                payload["height"],
                payload["pixels"],
                max_width=protocol.info["max_width"],
                max_height=protocol.info["max_height"],
            )
            settings = BurnSettings(
                burn_time=int(payload.get("burn_time", 60)),
                power=int(payload.get("power", 10)),
                idle_power=int(payload.get("idle_power", 1)),
                left=int(payload["left"]) if payload.get("left") is not None else None,
                top=int(payload["top"]) if payload.get("top") is not None else None,
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ServiceError(f"invalid image: {exc}") from exc
        return bitmap, settings


__all__ = [
    "ControllerService",
    "SerialUnavailable",
    "ServiceError",
]
