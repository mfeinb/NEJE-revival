# NEJE Revival

A local, cross-platform controller for discontinued **NEJE DK-8-KZ** laser
engravers. It replaces the unsupported vendor GUI with a small Python service
and a browser interface that runs entirely on your computer.

> **Current status:** connection, mode-4 detection, direct movement, and outline
> are verified on the owner's DK-8-KZ. The official mode-4 bitmap upload is
> implemented from NEJE v4.0's exact command path; its first live engraving is
> the remaining hardware validation step.

## What it supports

- macOS, Windows, and Linux through the engraver's CH340 USB-serial interface
- Auto-detection across the official DK-8-KZ v4.0/v4.2 profiles, plus four
  alternative community-documented protocols
- PNG, JPEG, WebP, and BMP input (decoded locally by the browser)
- Aspect-preserving resize, movable X/Y artwork placement, threshold or
  Floyd-Steinberg grayscale dithering, and invert
- Home, center, jog, low-power outline, pause/resume where the selected firmware supports it
- Upload progress, cancellation, reset/stop, and explicit laser-safety interlocks
- Official four-pixel artwork positioning controls and a low-power outline trace
- Click-to-move positioning from the preview using NEJE v4's absolute point commands
- Mode-dependent official work grids, the mode-4 576 × 552 fixed framebuffer,
  512 × 512 classic bitmaps, and 490 × 490 later KZ bitmaps

The app binds to `127.0.0.1` by default. Images are processed in the browser and
are never sent to an internet service.

## Install and run

Python 3.10 or newer is required.

### macOS or Linux

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m neje_control.server
```

### Windows PowerShell

```powershell
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m neje_control.server
```

The app opens [http://127.0.0.1:8765/](http://127.0.0.1:8765/) automatically.
Stop it with `Ctrl-C` in the terminal.

Modern macOS and Linux usually include a CH340 driver. Windows normally obtains
it through Windows Update. The official NEJE instructions identify this model as
a CH340 serial device; if no likely port appears, solve driver/cable detection
before trying firmware protocols.

On Linux, a permission error usually means the user needs serial-port access:

```sh
sudo usermod -a -G dialout "$USER"
```

Log out and back in after changing group membership.

## Safe first connection

This is an open-beam diode laser tool even if old product listings use softer
language. Reflections can injure eyes, and an unattended engraving can start a
fire.

1. Put the engraver on a nonflammable surface under its shield/enclosure. Use
   eye protection rated for the module's wavelength, start ventilation, remove
   flammable clutter, and keep the top power switch within immediate reach.
2. Turn on the engraver and connect its USB data cable. On this machine the
   low-power positioning laser is illuminated whenever the engraver is on. A
   CH340 port is marked “likely NEJE.”
3. Select **DK-8-KZ official (auto-detect)**. The app accepts only the exact mode
   signatures decoded by the original software, then selects that mode's work
   grid.
4. Load an image, then use one brief arrow step. Mode 4 sends direct motor jog
   commands; newer official modes change the artwork origin. **Low-power
   outline** uses the already-lit positioning spot. Avoid repeated movement
   against a mechanical end stop.
5. Load a tiny black mark, choose the lowest practical burn time/power, check
   the safety acknowledgement, and make the first engraving on a known-safe
   scrap such as untreated wood. Stay with the machine and use the physical
   power switch if anything is unexpected.

Protocol choice guide:

| Choice | Image | Identifying behavior |
| --- | ---: | --- |
| DK-8-KZ official | mode-dependent (490, 550, or 2000 square) | Auto-selects direct four-byte controls or seven-byte base-100 position/size frames |
| KZ framed (2019+) | up to 490 × 490 | Different, later `FF AA … 55` protocol; retained for other hardware |
| Classic v3 | 512 × 512 | Four-byte movement/control commands; fast memory erase |
| Classic v2 | 512 × 512 | Two-byte jog commands |
| Classic v1 | 512 × 512 | One-byte jog commands; oldest controller |

Mode 4 uploads NEJE v4.0's fixed 39,744-byte framebuffer at 57,600 baud. Newer
official modes negotiate at 115,200 baud. Both paths wait for the controller's
data request and verification acknowledgement before sending the engraving-start
command.

## What to report after the first test

If connection or movement fails, please provide:

- The port name shown by the app and whether it was marked “likely NEJE”
- The selected protocol and the exact status/error text
- The full handshake bytes and detected machine mode
- What **Home**, **Center**, and one brief jog command did
- A clear photo of the controller board and chip labels, if accessible without
  altering wiring
- Approximate purchase year and laser power label (for example 1000 mW or 3000 mW)

Do not test Upload/Engrave merely to identify a protocol; the official status reply
and positioning controls are safer discriminators.

## Tests

```sh
python3 -m unittest discover -s tests -v
```

The tests verify bitmap validation, classic BMP construction, KZ serpentine row
encoding, command packets, centering, job order, and the server-side safety gate.

## Research basis

- [NEJE's DK-8-KZ driver page](https://neje.club/help/installDriver.htm) says the
  device appears as a CH340 serial port.
- [NEJE's archived DK-8-KZ software page](https://www.neje.club/dkz.htm) documents
  the discontinued Windows-era application and its supported operating systems.
- [EzGraver](https://github.com/camrein/EzGraver) is an archived MIT-licensed,
  cross-platform implementation of three classic NEJE protocols. Its source
  establishes 57,600 baud, command variants, and classic image layouts.
- [HomoFaciens' KZ3000 reverse-engineering write-up](https://www.homofaciens.de/technics-machines-Laser-Engraver-NEJE-KZ3000_en.htm)
  publishes the later framed-protocol capture and Linux source package.
- [Dirk.net's DK-8-KZ account](https://dirk.net/2021/07/10/neje-kz-laser-engraver-from-linux-and-raspberry-pi/)
  reports that later DK-8-KZ units changed protocol and confirms the HomoFaciens
  implementation worked on those machines.
- [NEJE's model tutorial](https://neje.club/tutorials/en_kz.htm) documents the
  two-cable power/data arrangement and physical setup.

No firmware is flashed and no controller-board modification is required. A GRBL
electronics conversion remains a fallback only if the original board is faulty.

## License

MIT. See [LICENSE](LICENSE).
