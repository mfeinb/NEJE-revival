import unittest

from neje_control.bitmap import MonoBitmap
from neje_control.protocols import (
    BurnSettings,
    ClassicV1,
    ClassicV2,
    ClassicV3,
    DK8Official,
    ExtendedKZ,
    ProtocolError,
)


class FakeTransport:
    def __init__(self, reply=b""):
        self.writes = []
        self.reply = reply

    def write(self, data, **kwargs):
        self.writes.append((bytes(data), kwargs.get("pace_seconds", 0)))
        progress = kwargs.get("progress")
        if progress:
            progress(len(data), len(data))
        return len(data)

    def read_available(self, settle_seconds=0.15):
        result, self.reply = self.reply, b""
        return result

    def set_baudrate(self, baudrate):
        self.baudrate = baudrate


class ProtocolPacketTests(unittest.TestCase):
    def test_official_v42_signature_maps_to_v40_profile_7(self):
        reply = bytes.fromhex("ff 01 00 00 ff 02 01 0a ff 0a 00 46")
        transport = FakeTransport(reply=reply)
        protocol = DK8Official(transport)
        self.assertEqual(protocol.initialize(), reply)
        self.assertEqual(transport.writes[0][0], bytes.fromhex("ff 09 00 00"))
        self.assertEqual(protocol.machine_mode, 7)
        self.assertEqual(protocol.info["max_width"], 550)

    def test_official_v42_geometry_and_outline_packets(self):
        transport = FakeTransport()
        protocol = DK8Official(transport)
        protocol.machine_mode = 7
        protocol.work_size = 550
        protocol.control_style = "geometry"
        protocol.action("outline", width=151, height=187, left=10, top=20)
        packets = [entry[0] for entry in transport.writes]
        self.assertEqual(packets[0], bytes.fromhex("ff 6e 01 00 0a 00 14"))
        # Width is rounded up to 152 (19 complete bytes), as in v4.2.
        self.assertEqual(packets[1], bytes.fromhex("ff 6e 02 01 34 01 57"))
        self.assertEqual(packets[2], bytes.fromhex("ff 02 02 00"))

    def test_official_v40_profile_4_uses_direct_jog_and_outline(self):
        transport = FakeTransport(reply=bytes.fromhex("ff 02 01 00 ff 0a 00 46"))
        protocol = DK8Official(transport)
        protocol.initialize()
        self.assertEqual(protocol.machine_mode, 4)
        self.assertEqual(protocol.info["max_width"], 550)
        self.assertFalse(protocol.info["placement"])
        self.assertTrue(protocol.info["engrave"])
        self.assertTrue(protocol.info["point"])
        protocol.action("right")
        protocol.action("point", x=275, y=149)
        protocol.action("outline", width=550, height=550)
        packets = [entry[0] for entry in transport.writes]
        self.assertIn(bytes.fromhex("ff 03 04 00"), packets)
        self.assertIn(bytes.fromhex("ff 0a 02 4b"), packets)
        self.assertIn(bytes.fromhex("ff 0b 01 31"), packets)
        self.assertEqual(packets[-1], bytes.fromhex("ff 02 02 00"))
        protocol.action("outline-stop")
        packets = [entry[0] for entry in transport.writes]
        self.assertEqual(packets[-3:], [
            bytes.fromhex("ff 0a 00 00"),
            bytes.fromhex("ff 0b 00 00"),
            bytes.fromhex("ff 02 01 00"),
        ])

        with self.assertRaises(ProtocolError):
            protocol.action("point", x=550, y=0)

    def test_official_v40_profile_4_upload_is_verified_before_start(self):
        class Mode4Transport(FakeTransport):
            def __init__(self):
                super().__init__()
                self.replies = [
                    bytes.fromhex("ff 05 01 00"),
                    bytes.fromhex("ff 0b 00 00"),
                ]

            def read_available(self, settle_seconds=0.15):
                return self.replies.pop(0) if self.replies else b""

        transport = Mode4Transport()
        protocol = DK8Official(transport, sleeper=lambda _: None)
        protocol.machine_mode = 4
        protocol.work_size = 550
        protocol.control_style = "direct"
        phases = []
        protocol.burn(
            MonoBitmap(8, 1, b"\x80"),
            BurnSettings(burn_time=70, left=0, top=0),
            cancelled=lambda: False,
            progress=lambda sent, total, phase: phases.append(phase),
        )
        packets = [entry[0] for entry in transport.writes]
        self.assertEqual(packets[0], bytes.fromhex("ff 06 01 00"))
        self.assertEqual(len(packets[1]), 72 * 552)
        self.assertEqual(packets[2], bytes.fromhex("ff 05 46 00"))
        self.assertEqual(packets[3], bytes.fromhex("ff 01 01 00"))
        self.assertIn("Engraving started on the device", phases)

    def test_official_v40_prepare_upload_does_not_start_engraving(self):
        class Mode4PrepareTransport(FakeTransport):
            def __init__(self):
                super().__init__()
                self.replies = [
                    bytes.fromhex("ff 05 01 00"),
                    bytes.fromhex("ff 0b 00 00"),
                ]

            def read_available(self, settle_seconds=0.15):
                return self.replies.pop(0) if self.replies else b""

        transport = Mode4PrepareTransport()
        protocol = DK8Official(transport, sleeper=lambda _: None)
        protocol.machine_mode = 4
        protocol.work_size = 550
        protocol.control_style = "direct"
        phases = []
        protocol.prepare(
            MonoBitmap(8, 1, b"\x80"),
            BurnSettings(burn_time=70, left=0, top=0),
            cancelled=lambda: False,
            progress=lambda sent, total, phase: phases.append(phase),
        )
        packets = [entry[0] for entry in transport.writes]
        self.assertEqual(packets[0], bytes.fromhex("ff 06 01 00"))
        self.assertEqual(len(packets[1]), 72 * 552)
        self.assertEqual(len(packets), 2)
        self.assertNotIn(bytes.fromhex("ff 05 46 00"), packets)
        self.assertNotIn(bytes.fromhex("ff 01 01 00"), packets)
        self.assertIn("Image ready for positioning", phases)

    def test_official_v40_accepts_complete_upload_without_optional_confirmation(self):
        class Mode4NoConfirmationTransport(FakeTransport):
            def __init__(self):
                super().__init__()
                self.replies = [bytes.fromhex("ff 05 01 00"), b""]

            def read_available(self, settle_seconds=0.15):
                return self.replies.pop(0) if self.replies else b""

        transport = Mode4NoConfirmationTransport()
        protocol = DK8Official(transport, sleeper=lambda _: None)
        protocol.machine_mode = 4
        protocol.work_size = 550
        protocol.control_style = "direct"
        phases = []
        protocol.prepare(
            MonoBitmap(8, 1, b"\x80"),
            BurnSettings(burn_time=70, left=0, top=0),
            cancelled=lambda: False,
            progress=lambda sent, total, phase: phases.append(phase),
        )
        packets = [entry[0] for entry in transport.writes]
        self.assertEqual(packets[0], bytes.fromhex("ff 06 01 00"))
        self.assertEqual(len(packets[1]), 72 * 552)
        self.assertEqual(len(packets), 2)
        self.assertIn("Image transferred; controller omitted final confirmation", phases)

    def test_official_v40_starts_prepared_image_without_uploading_again(self):
        transport = FakeTransport()
        protocol = DK8Official(transport, sleeper=lambda _: None)
        protocol.machine_mode = 4
        protocol.work_size = 550
        protocol.control_style = "direct"
        phases = []
        protocol.start_prepared(
            BurnSettings(burn_time=70, left=0, top=0),
            progress=lambda sent, total, phase: phases.append(phase),
        )
        packets = [entry[0] for entry in transport.writes]
        self.assertEqual(packets, [
            bytes.fromhex("ff 05 46 00"),
            bytes.fromhex("ff 01 01 00"),
        ])
        self.assertIn("Engraving started on the device", phases)

    def test_classic_jog_variants(self):
        t1, t2, t3 = FakeTransport(), FakeTransport(), FakeTransport()
        ClassicV1(t1).action("right")
        ClassicV2(t2).action("right")
        ClassicV3(t3).action("right")
        self.assertEqual(t1.writes[0][0], b"\xf8")
        self.assertEqual(t2.writes[0][0], b"\xf5\x04")
        self.assertEqual(t3.writes[0][0], b"\xff\x03\x04\x00")

    def test_extended_settings_packet(self):
        packet = ExtendedKZ.settings_packet(BurnSettings(burn_time=100, power=10, idle_power=1))
        self.assertEqual(packet, b"\xff\xaa\x0b\x03\x01\x64\x0a\x01\x00\x00\x55")
        with self.assertRaises(ProtocolError):
            ExtendedKZ.settings_packet(BurnSettings(power=0))

    def test_extended_bitmap_header_is_centered_and_big_endian(self):
        bitmap = MonoBitmap(151, 187, bytes(19 * 187))
        header = ExtendedKZ.bitmap_header(bitmap)
        self.assertEqual(len(header), 22)
        self.assertEqual(
            header,
            bytes.fromhex("ff aa 16 04 02 01 00 a9 00 97 00 98 00 bb 00 00 0d e1 00 97 10 55"),
        )
        positioned = ExtendedKZ.bitmap_header(bitmap, left=10, top=20)
        self.assertEqual(positioned[6:10], bytes.fromhex("00 0a 00 14"))

    def test_extended_outline_packets(self):
        self.assertEqual(
            ExtendedKZ.outline_packet(151, 187),
            bytes.fromhex("ff aa 10 05 01 50 02 00 a9 00 97 00 97 00 bb 55"),
        )
        self.assertEqual(len(ExtendedKZ.outline_packet(1, 1, enabled=False)), 16)
        positioned = ExtendedKZ.outline_packet(151, 187, left=10, top=20)
        self.assertEqual(positioned[7:11], bytes.fromhex("00 0a 00 14"))

    def test_extended_burn_sequence(self):
        transport = FakeTransport(reply=b"OK")
        protocol = ExtendedKZ(transport)
        bitmap = MonoBitmap(8, 2, b"\x80\x01")
        phases = []
        protocol.burn(
            bitmap,
            BurnSettings(20, 10, 1),
            cancelled=lambda: False,
            progress=lambda sent, total, phase: phases.append(phase),
        )
        packets = [entry[0] for entry in transport.writes]
        self.assertEqual(packets[0], ExtendedKZ.INIT_1)
        self.assertEqual(packets[1], ExtendedKZ.INIT_2)
        self.assertEqual(packets[-1], b"\x80\x80")
        self.assertIn("Engraving started on the device", phases)


if __name__ == "__main__":
    unittest.main()
