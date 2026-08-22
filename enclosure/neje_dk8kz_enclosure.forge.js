// Parametric snap-in enclosure panels for the NEJE DK-8-KZ.
//
// Print orientation: broad face on the bed, snap tongues pointing upward.
// The published machine envelope is about 160 x 146 x 200 mm, but NEJE did
// not publish the opening dimensions. The defaults below are photo-scaled
// starting values and MUST be replaced with measurements from the machine.

const panelThickness = Param.number("Panel Thickness", 3.0, {
  min: 1.8, max: 5.0, step: 0.1, unit: "mm",
});
const frameThickness = Param.number("Frame Thickness", 3.0, {
  min: 2.0, max: 6.0, step: 0.1, unit: "mm",
});
const overlap = Param.number("Frame Overlap", 6.0, {
  min: 3.0, max: 12.0, step: 0.5, unit: "mm",
});
const clipInterference = Param.number("Clip Interference", 0.25, {
  min: 0.0, max: 0.8, step: 0.05, unit: "mm",
});
const clipBeam = Param.number("Clip Beam Thickness", 1.3, {
  min: 0.8, max: 2.2, step: 0.1, unit: "mm",
});
const clipWidth = Param.number("Clip Width", 12.0, {
  min: 7.0, max: 20.0, step: 0.5, unit: "mm",
});

const frontOpeningW = Param.number("Front Opening Width", 112.0, {
  min: 90.0, max: 135.0, step: 0.5, unit: "mm",
});
const frontOpeningH = Param.number("Front Opening Height", 132.0, {
  min: 105.0, max: 155.0, step: 0.5, unit: "mm",
});
const sideOpeningW = Param.number("Side Opening Width", 91.0, {
  min: 70.0, max: 115.0, step: 0.5, unit: "mm",
});
const sideOpeningH = Param.number("Side Opening Height", 126.0, {
  min: 100.0, max: 150.0, step: 0.5, unit: "mm",
});

const frontStyle = Param.choice(
  "Front Style",
  "solid",
  ["solid", "laser-window opening"]
);
const windowW = Param.number("Window Width", 88.0, {
  min: 50.0, max: 105.0, step: 1.0, unit: "mm",
});
const windowH = Param.number("Window Height", 98.0, {
  min: 50.0, max: 120.0, step: 1.0, unit: "mm",
});
const sideStyle = Param.choice(
  "Side Style",
  "solid",
  ["solid", "vent slots"]
);
const outputPart = Param.choice(
  "Output Part",
  "all",
  ["all", "front only", "left only", "right only"]
);

function snapTongues(openingW, openingH, count) {
  const tongueDepth = frameThickness + 2.0;
  const barbHeight = 1.1;
  const bodyY = openingH / 2 - clipBeam / 2 - 0.15;
  const barbY = openingH / 2 - clipBeam / 2 + clipInterference / 2;
  const xs = count === 1
    ? [0]
    : [-openingW * 0.27, openingW * 0.27];
  const pieces = [];

  for (const x of xs) {
    // Opposed cantilever tongues flex toward the center of the opening.
    pieces.push(
      box(clipWidth, clipBeam, tongueDepth)
        .translate(x, bodyY, panelThickness),
      box(clipWidth, clipBeam + clipInterference, barbHeight)
        .translate(
          x,
          barbY,
          panelThickness + tongueDepth - barbHeight
        ),
      box(clipWidth, clipBeam, tongueDepth)
        .translate(x, -bodyY, panelThickness),
      box(clipWidth, clipBeam + clipInterference, barbHeight)
        .translate(
          x,
          -barbY,
          panelThickness + tongueDepth - barbHeight
        )
    );
  }
  return pieces;
}

function pullTab(outerH) {
  const tabW = 34;
  const tabH = 11;
  const tab = roundedRect(tabW, tabH, 3)
    .extrude(panelThickness)
    .translate(0, -(outerH + tabH) / 2 + 1.0, 0);
  const fingerSlot = roundedRect(18, 4.5, 2.25)
    .extrude(panelThickness + 2)
    .translate(0, -(outerH + tabH) / 2 + 1.0, -1);
  return difference(tab, fingerSlot);
}

function makeFront() {
  const outerW = frontOpeningW + 2 * overlap;
  const outerH = frontOpeningH + 2 * overlap;
  let plate = roundedRect(outerW, outerH, 7).extrude(panelThickness);

  if (frontStyle === "laser-window opening") {
    const cut = roundedRect(windowW, windowH, 5)
      .extrude(panelThickness + 2)
      .translate(0, 0, -1);
    plate = difference(plate, cut);
  }

  return union(
    plate,
    pullTab(outerH),
    ...snapTongues(frontOpeningW, frontOpeningH, 2)
  );
}

function ventCutters() {
  const cutters = [];
  for (let i = -3; i <= 3; i += 1) {
    cutters.push(
      roundedRect(48, 3.2, 1.6)
        .extrude(panelThickness + 2)
        .translate(0, i * 8, -1)
    );
  }
  return cutters;
}

function makeSide() {
  const outerW = sideOpeningW + 2 * overlap;
  const outerH = sideOpeningH + 2 * overlap;
  let plate = roundedRect(outerW, outerH, 7).extrude(panelThickness);
  if (sideStyle === "vent slots") {
    plate = difference(plate, ...ventCutters());
  }
  return union(
    plate,
    ...snapTongues(sideOpeningW, sideOpeningH, 1)
  );
}

const front = makeFront();
const left = makeSide();
const right = makeSide();

if (outputPart === "front only") {
  return { name: "Removable front", shape: front.color("#d98b2b") };
}
if (outputPart === "left only") {
  return { name: "Left side", shape: left.color("#30343b") };
}
if (outputPart === "right only") {
  return { name: "Right side", shape: right.color("#30343b") };
}

// Flat print layout with at least 10 mm between parts.
const sideOuterW = sideOpeningW + 2 * overlap;
const frontOuterW = frontOpeningW + 2 * overlap;
const spacing = 10;
const leftX = -(frontOuterW + sideOuterW) / 2 - spacing;
const rightX = (frontOuterW + sideOuterW) / 2 + spacing;

return [
  { name: "Removable front", shape: front, color: "#d98b2b" },
  { name: "Left side", shape: left.translate(leftX, 0, 0), color: "#30343b" },
  { name: "Right side", shape: right.translate(rightX, 0, 0), color: "#30343b" },
];
