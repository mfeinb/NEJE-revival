import base64
import unittest

from neje_control.service import ControllerService, ServiceError


class FakeSerialTransport:
    def __init__(self, port):
        self.port = port
        self.writes = []
        self.closed = False

    def write(self, data, **kwargs):
        self.writes.append(bytes(data))
        progress = kwargs.get("progress")
        if progress:
            progress(len(data), len(data))
        return len(data)

    def read_available(self, settle_seconds=0.15):
        return b""

    def set_baudrate(self, baudrate):
        self.baudrate = baudrate

    def close(self):
        self.closed = True


class ServiceTests(unittest.TestCase):
    def test_official_handshake_is_verified_and_identifies_mode(self):
        class HandshakeTransport(FakeSerialTransport):
            def read_available(self, settle_seconds=0.15):
                if len(self.writes) == 1:
                    return bytes.fromhex("ff 01 00 00 ff 02 01 00 ff 0a 00 46")
                return b""

        service = ControllerService(HandshakeTransport)
        status = service.connect("fake-port", "dk8-official")
        self.assertTrue(status["verified"])
        self.assertEqual(status["machine_mode"], 4)

        class Mode3Transport(FakeSerialTransport):
            def read_available(self, settle_seconds=0.15):
                if len(self.writes) == 1:
                    return bytes.fromhex("ff 01 00 00 ff 02 01 0a ff 0a 00 46")
                return b""

        service = ControllerService(Mode3Transport)
        status = service.connect("fake-port", "dk8-official")
        self.assertTrue(status["verified"])
        self.assertEqual(status["machine_mode"], 7)
        self.assertEqual(status["protocol_info"]["max_width"], 550)

    def test_engraving_requires_safety_acknowledgement(self):
        service = ControllerService(FakeSerialTransport)
        service.connect("fake-port", "extended-kz")
        payload = {
            "width": 1,
            "height": 1,
            "pixels": base64.b64encode(b"\x80").decode(),
            "burn_time": 10,
            "power": 10,
        }
        with self.assertRaises(ServiceError):
            service.start_job(payload, safety_acknowledged=False)

    def test_outline_requires_safety_acknowledgement(self):
        service = ControllerService(FakeSerialTransport)
        service.connect("fake-port", "extended-kz")
        with self.assertRaises(ServiceError):
            service.action("outline", {"width": 10, "height": 10}, False)

    def test_action_response_is_recorded(self):
        class ReplyTransport(FakeSerialTransport):
            replies = [
                bytes.fromhex("ff 02 01 00 ff 0a 00 46"),
                b"",
                bytes.fromhex("ff 05 00 00"),
            ]

            def read_available(self, settle_seconds=0.15):
                return self.replies.pop(0) if self.replies else b""

        service = ControllerService(ReplyTransport)
        service.connect("fake-port", "dk8-official")
        service.action(
            "outline",
            {"width": 10, "height": 10, "left": 5, "top": 5},
            True,
        )
        self.assertEqual(service.status()["last_command_reply_hex"], "ff 05 00 00")

    def test_click_to_move_is_blocked_while_running(self):
        service = ControllerService(FakeSerialTransport)
        service.connect("fake-port", "dk8-official")
        service._state["device_running"] = True
        with self.assertRaises(ServiceError):
            service.action("point", {"x": 100, "y": 100}, False)

    def test_mode4_verified_bitmap_is_reused_when_engraving_starts(self):
        class Mode4Transport(FakeSerialTransport):
            def __init__(self, port):
                super().__init__(port)
                self.sent_handshake = False
                self.sent_request = False
                self.sent_verification = False

            def read_available(self, settle_seconds=0.15):
                if not self.sent_handshake:
                    self.sent_handshake = True
                    return bytes.fromhex("ff 01 00 00 ff 02 01 00 ff 0a 00 46")
                if self.writes[-1] == bytes.fromhex("ff 06 01 00") and not self.sent_request:
                    self.sent_request = True
                    return bytes.fromhex("ff 05 01 00")
                if len(self.writes[-1]) == 72 * 552 and not self.sent_verification:
                    self.sent_verification = True
                    return bytes.fromhex("ff 0b 00 00")
                return b""

        service = ControllerService(Mode4Transport)
        service.connect("fake-port", "dk8-official")
        payload = {
            "width": 8,
            "height": 1,
            "pixels": base64.b64encode(b"\x80").decode(),
            "burn_time": 70,
            "left": 0,
            "top": 0,
        }
        service.prepare_job(payload)
        service._worker.join(timeout=1)
        self.assertTrue(service.status()["prepared"])
        writes_after_prepare = len(service._transport.writes)

        service.start_job(payload, safety_acknowledged=True)
        service._worker.join(timeout=1)
        new_writes = service._transport.writes[writes_after_prepare:]
        self.assertEqual(new_writes, [
            bytes.fromhex("ff 05 46 00"),
            bytes.fromhex("ff 01 01 00"),
        ])
        self.assertEqual(service.status()["phase"], "Engraving started")


if __name__ == "__main__":
    unittest.main()
