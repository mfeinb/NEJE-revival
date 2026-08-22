// Low-material fit test for the NEJE DK-8-KZ front opening.
// Print this before the full panels. It spans only the opening height and tests
// the same top/bottom snap geometry used by the removable front.

const openingH = Param.number("Front Opening Height", 132.0, {
  min: 105.0, max: 155.0, step: 0.25, unit: "mm",
});
const panelThickness = Param.number("Panel Thickness", 3.0, {
  min: 1.8, max: 5.0, step: 0.1, unit: "mm",
});
const frameThickness = Param.number("Frame Thickness", 3.0, {
  min: 2.0, max: 6.0, step: 0.1, unit: "mm",
});
const overlap = Param.number("Frame Overlap", 6.0, {
  min: 3.0, max: 12.0, step: 0.5, unit: "mm",
});
const interference = Param.number("Clip Interference", 0.25, {
  min: 0.0, max: 0.8, step: 0.05, unit: "mm",
});
const beam = Param.number("Clip Beam Thickness", 1.3, {
  min: 0.8, max: 2.2, step: 0.1, unit: "mm",
});

const stripW = 22;
const stripH = openingH + 2 * overlap;
const clipW = 12;
const depth = frameThickness + 2.0;
const barbH = 1.1;
const bodyY = openingH / 2 - beam / 2 - 0.15;
const barbY = openingH / 2 - beam / 2 + interference / 2;

const strip = roundedRect(stripW, stripH, 3).extrude(panelThickness);
const grip = [
  box(clipW, beam, depth).translate(0, bodyY, panelThickness),
  box(clipW, beam + interference, barbH)
    .translate(0, barbY, panelThickness + depth - barbH),
  box(clipW, beam, depth).translate(0, -bodyY, panelThickness),
  box(clipW, beam + interference, barbH)
    .translate(0, -barbY, panelThickness + depth - barbH),
];

return {
  shape: union(strip, ...grip).color("#e5a13a"),
  notes: "Press across the front opening; adjust height and interference before printing full panels.",
};
