# NEJE DK-8-KZ printable enclosure inserts

This folder contains a parametric ForgeCAD first pass for two side inserts and
a removable front panel. The parts grip the top and bottom edges of the large
frame openings with compliant printed tongues, so they do not require drilling
or removing the engraver's screws.

## Important: measure before printing

NEJE product pages consistently publish an overall envelope near **160 mm wide,
146 mm deep, and 190–200 mm high**, but no reliable drawing of the large frame
openings or the acrylic thickness was found. The opening defaults in the model
were scaled from product photos and are intentionally provisional.

Use calipers to measure:

1. Front opening width and height at the straight central portions.
2. Side opening width and height.
3. Thickness of the black acrylic frame sheet.

Enter those values in `neje_dk8kz_enclosure.forge.js`. Measure each opening in
at least three places and use the smallest result. If the opening is tapered or
not square, reduce the entered dimension by another 0.2–0.4 mm.

Set `Output Part` to export one panel at a time. The `all` layout is intentionally
spread out for inspection and is wider than a typical hobby-printer bed; most
slicers can also import its three 3MF objects and auto-arrange them.

## Fit workflow

1. Open `snap_fit_coupon.forge.js` in ForgeCAD.
2. Set the measured front opening height and frame thickness.
3. Print it in the same material, layer height, wall count, and orientation as
   the final panels.
4. Start with 0.15–0.25 mm clip interference for PETG. Reduce it if the clip is
   too tight; increase it in 0.05 mm steps if it rattles.
5. Transfer the proven settings to the enclosure model, export the three named
   parts, and slice them broad-face-down with the tongues upward.

PETG is preferable to PLA for the snap tongues because it is tougher and more
heat resistant. Suggested starting point: 0.2 mm layers, 4 walls, 5 top/bottom
layers, 20–30% infill, and no supports. Do not force a test piece against the
acrylic frame; old acrylic can crack around screw holes.

## Front options

`solid` is the safest printable default. `laser-window opening` creates an
aperture for a separate sheet; attach that sheet to the back of the bezel with
thin high-temperature tape or mechanical retainers added after its exact
thickness is known. Ordinary colored acrylic is not laser eye protection. Use
only certified filtering material rated for the wavelength and optical power
of the installed module.

## Safety limitations

These three inserts reduce direct side visibility but are **not, by themselves,
a certified laser enclosure**. The machine still needs a closed top/rear/bottom
strategy, forced fume extraction, a nonflammable work surface, and an interlock
that disables emission when the removable front is off. Printed plastics are
combustible. Never leave the engraver unattended, and never process PVC/vinyl
or unknown materials.

## Commands

```sh
forgecad run enclosure/snap_fit_coupon.forge.js
forgecad run enclosure/neje_dk8kz_enclosure.forge.js
forgecad render 3d enclosure/neje_dk8kz_enclosure.forge.js \
  --camera iso --edges bold
forgecad export 3mf enclosure/neje_dk8kz_enclosure.forge.js
forgecad export stl enclosure/front_panel.forge.js
forgecad export stl enclosure/left_panel.forge.js
forgecad export stl enclosure/right_panel.forge.js
```
