(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NEJEImage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clamp = value => Math.max(0, Math.min(255, value));

  function transformGeometry(sourceWidth, sourceHeight, crop = {}, rotation = 0) {
    const percent = value => Math.max(0, Math.min(45, Math.round(Number(value || 0))));
    const left = percent(crop.left);
    const right = percent(crop.right);
    const top = percent(crop.top);
    const bottom = percent(crop.bottom);
    const sx = Math.round(sourceWidth * left / 100);
    const sy = Math.round(sourceHeight * top / 100);
    const cropWidth = Math.max(1, sourceWidth - sx - Math.round(sourceWidth * right / 100));
    const cropHeight = Math.max(1, sourceHeight - sy - Math.round(sourceHeight * bottom / 100));
    const normalizedRotation = ((Math.round(Number(rotation) / 90) * 90) % 360 + 360) % 360;
    const quarterTurn = normalizedRotation === 90 || normalizedRotation === 270;
    return {
      sx, sy, cropWidth, cropHeight, rotation: normalizedRotation,
      width: quarterTurn ? cropHeight : cropWidth,
      height: quarterTurn ? cropWidth : cropHeight,
    };
  }

  function adjustedLuma(image, width, height, options = {}) {
    const count = width * height;
    const tones = new Float32Array(count);
    const brightness = Number(options.brightness || 0) * 2.55;
    const contrast = Math.max(-100, Math.min(100, Number(options.contrast || 0))) * 2.55;
    const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    const gamma = Math.max(0.2, Math.min(3, Number(options.gamma || 1)));

    for (let pixel = 0; pixel < count; pixel++) {
      const offset = pixel * 4;
      const alpha = image.data[offset + 3] / 255;
      let luma = (
        0.2126 * image.data[offset]
        + 0.7152 * image.data[offset + 1]
        + 0.0722 * image.data[offset + 2]
      ) * alpha + 255 * (1 - alpha);
      luma = clamp(contrastFactor * (luma + brightness - 128) + 128);
      tones[pixel] = clamp(255 * Math.pow(luma / 255, 1 / gamma));
    }

    const sharpen = Math.max(0, Math.min(100, Number(options.sharpen || 0))) / 100;
    if (!sharpen) return tones;
    const source = new Float32Array(tones);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        const left = source[y * width + Math.max(0, x - 1)];
        const right = source[y * width + Math.min(width - 1, x + 1)];
        const up = source[Math.max(0, y - 1) * width + x];
        const down = source[Math.min(height - 1, y + 1) * width + x];
        const neighborAverage = (left + right + up + down) / 4;
        tones[index] = clamp(source[index] + sharpen * (source[index] - neighborAverage));
      }
    }
    return tones;
  }

  function diffuse(tones, width, height, algorithm) {
    const burnMask = new Uint8Array(width * height);
    const atkinson = algorithm === 'atkinson';
    const denominator = atkinson ? 8 : 16;
    const weights = atkinson
      ? [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]]
      : [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]];
    for (let y = 0; y < height; y++) {
      const forward = y % 2 === 0;
      for (let step = 0; step < width; step++) {
        const x = forward ? step : width - 1 - step;
        const index = y * width + x;
        const output = tones[index] >= 128 ? 255 : 0;
        burnMask[index] = Number(output === 255);
        const error = tones[index] - output;
        for (const [rawDx, dy, weight] of weights) {
          const dx = forward ? rawDx : -rawDx;
          const targetX = x + dx;
          const targetY = y + dy;
          if (targetX >= 0 && targetX < width && targetY >= 0 && targetY < height) {
            const target = targetY * width + targetX;
            tones[target] = clamp(tones[target] + error * weight / denominator);
          }
        }
      }
    }
    return burnMask;
  }

  function ordered(tones, width, height) {
    const matrix = [
      0, 8, 2, 10,
      12, 4, 14, 6,
      3, 11, 1, 9,
      15, 7, 13, 5,
    ];
    const burnMask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x;
        const cutoff = (matrix[(y % 4) * 4 + (x % 4)] + 0.5) * 16;
        burnMask[index] = Number(tones[index] >= cutoff);
      }
    }
    return burnMask;
  }

  function buildBurnMask(image, width, height, options = {}) {
    const mode = options.mode || 'threshold';
    const threshold = Number(options.threshold ?? 128);
    const inverted = Boolean(options.inverted);
    const luma = adjustedLuma(image, width, height, options);
    const count = width * height;
    if (mode !== 'dither') {
      const burnMask = new Uint8Array(count);
      for (let pixel = 0; pixel < count; pixel++) {
        burnMask[pixel] = Number(inverted ? luma[pixel] > threshold : luma[pixel] < threshold);
      }
      return burnMask;
    }

    const tones = new Float32Array(count);
    for (let pixel = 0; pixel < count; pixel++) {
      const darkness = inverted ? luma[pixel] : 255 - luma[pixel];
      tones[pixel] = clamp(darkness + threshold - 128);
    }
    return options.dither === 'ordered'
      ? ordered(tones, width, height)
      : diffuse(tones, width, height, options.dither || 'floyd-steinberg');
  }

  return { adjustedLuma, buildBurnMask, transformGeometry };
});
