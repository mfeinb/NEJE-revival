'use strict';

const assert = require('node:assert/strict');
const { adjustedLuma, buildBurnMask, transformGeometry } = require('../neje_control/web/image_processing.js');

function image(...pixels) {
  return { data: new Uint8ClampedArray(pixels.flat()) };
}

const blackWhite = image([0, 0, 0, 255], [255, 255, 255, 255]);
assert.deepEqual([...buildBurnMask(blackWhite, 2, 1, { mode: 'threshold', threshold: 128 })], [1, 0]);
assert.deepEqual([...buildBurnMask(blackWhite, 2, 1, { mode: 'threshold', threshold: 128, inverted: true })], [0, 1]);

const gray = image([96, 96, 96, 255], [160, 160, 160, 255]);
const brighter = adjustedLuma(gray, 2, 1, { brightness: 20 });
assert.ok(brighter[0] > 96 && brighter[1] > 160);
const highContrast = adjustedLuma(gray, 2, 1, { contrast: 50 });
assert.ok(highContrast[0] < 96 && highContrast[1] > 160);

const midGray = image(...Array.from({ length: 16 }, () => [128, 128, 128, 255]));
const ordered = buildBurnMask(midGray, 4, 4, { mode: 'dither', threshold: 128, dither: 'ordered' });
assert.equal([...ordered].reduce((sum, value) => sum + value, 0), 8);

for (const dither of ['floyd-steinberg', 'atkinson', 'ordered']) {
  const mask = buildBurnMask(midGray, 4, 4, { mode: 'dither', threshold: 128, dither });
  assert.equal(mask.length, 16);
  assert.ok([...mask].every(value => value === 0 || value === 1));
}

assert.deepEqual(
  transformGeometry(100, 50, { left: 10, right: 20, top: 10, bottom: 20 }, 0),
  { sx: 10, sy: 5, cropWidth: 70, cropHeight: 35, rotation: 0, width: 70, height: 35 },
);
assert.deepEqual(
  transformGeometry(100, 50, { left: 10, right: 20, top: 10, bottom: 20 }, 90),
  { sx: 10, sy: 5, cropWidth: 70, cropHeight: 35, rotation: 90, width: 35, height: 70 },
);
assert.deepEqual(
  transformGeometry(100, 100, { left: 80, right: 80, top: 98, bottom: 98 }, 0),
  { sx: 80, sy: 98, cropWidth: 1, cropHeight: 1, rotation: 0, width: 1, height: 1 },
);

console.log('image-processing tests passed');
