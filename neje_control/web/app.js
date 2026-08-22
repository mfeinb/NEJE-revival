const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ui = {
  port: $('#serialPort'), protocol: $('#protocol'), protocolHelp: $('#protocolHelp'),
  detectedProtocol: $('#detectedProtocol'),
  connect: $('#connect'), disconnect: $('#disconnect'), badge: $('#connectionBadge'),
  imageFile: $('#imageFile'), renderMode: $('#renderMode'), renderModeHelp: $('#renderModeHelp'),
  openTextDialog: $('#openTextDialog'), textDialog: $('#textDialog'), closeTextDialog: $('#closeTextDialog'),
  textContent: $('#textContent'), textFont: $('#textFont'), textAlign: $('#textAlign'),
  textBold: $('#textBold'), textItalic: $('#textItalic'), textPreview: $('#textPreview'),
  emptyTextPreview: $('#emptyTextPreview'), textReplaceNote: $('#textReplaceNote'),
  textDialogError: $('#textDialogError'), cancelText: $('#cancelText'), createText: $('#createText'),
  toneLabel: $('#toneLabel'), threshold: $('#threshold'), thresholdValue: $('#thresholdValue'),
  invert: $('#invert'), imageInfo: $('#imageInfo'), preview: $('#previewCanvas'),
  rotateLeft: $('#rotateLeft'), rotateRight: $('#rotateRight'),
  flipHorizontal: $('#flipHorizontal'), flipVertical: $('#flipVertical'),
  transformState: $('#transformState'), resetCrop: $('#resetCrop'), lockAspect: $('#lockAspect'),
  moveTool: $('#moveTool'), cropTool: $('#cropTool'), applyCrop: $('#applyCrop'),
  cancelCrop: $('#cancelCrop'), cropActions: $('#cropActions'), editorHelp: $('#editorHelp'),
  advancedEnabled: $('#advancedEnabled'), advancedControls: $('#advancedControls'),
  brightness: $('#brightness'), brightnessValue: $('#brightnessValue'),
  contrast: $('#contrast'), contrastValue: $('#contrastValue'),
  gamma: $('#gamma'), gammaValue: $('#gammaValue'), sharpen: $('#sharpen'), sharpenValue: $('#sharpenValue'),
  ditherAlgorithm: $('#ditherAlgorithm'), resetAdvanced: $('#resetAdvanced'),
  emptyPreview: $('#emptyPreview'), dimensions: $('#dimensions'), burnTime: $('#burnTime'),
  pointMode: $('#pointMode'),
  controlHeading: $('#controlHeading'),
  controlHint: $('#controlHint'),
  materialPreset: $('#materialPreset'), presetHelp: $('#presetHelp'),
  burnTimeValue: $('#burnTimeValue'), power: $('#power'), powerValue: $('#powerValue'),
  powerControls: $('#powerControls'), safety: $('#safetyAck'), outline: $('#outline'),
  start: $('#start'), stop: $('#stop'), phase: $('#phase'), error: $('#error'),
  progress: $('#progress'), statusDetail: $('#statusDetail'),
};

const protocolDescriptions = {
  'dk8-official': 'Official DK-8-KZ v4.0/v4.2 protocol. The status reply selects the matching command path and work grid.',
  'extended-kz': 'Later KZ3000-style framed protocol. This is not the protocol reported by your connected DK-8-KZ.',
  'classic-v3': 'Try this first for older 512 × 512 controllers when the framed protocol gives no response.',
  'classic-v2': 'Same image format as v1, with two-byte jog commands. Try if v3 upload or positioning fails.',
  'classic-v1': 'Earliest one-byte command set. Use for the oldest DK-8-KZ boards.',
};

const protocolProfiles = {
  'dk8-official': { max_width: 550, max_height: 550, power: false, placement: false, jog: true, point: true, home: false, center: false, pause: true, engrave: false, prepare: false },
  'extended-kz': { max_width: 490, max_height: 490, power: true, placement: true, jog: false, home: false, center: false, pause: true },
  'classic-v3': { max_width: 512, max_height: 512, power: false, placement: false, jog: true, home: true, center: true, pause: true },
  'classic-v2': { max_width: 512, max_height: 512, power: false, placement: false, jog: true, home: true, center: true, pause: true },
  'classic-v1': { max_width: 512, max_height: 512, power: false, placement: false, jog: true, home: true, center: true, pause: true },
};

let sourceImage = null;
let sourceKind = null;
let packedBitmap = null;
let preparedImageData = null;
let latestStatus = { connected: false };
let rebuilding = 0;
let sizeKey = '';
let imageRevision = 0;
let actionPending = false;
let preparePending = false;
let preparedKey = '';
let connectPending = false;
let editorMode = 'move';
let laserPoint = null;
let outlineActive = false;
let outlineStateKnown = false;
let errorVisibleUntil = 0;
let rotation = 0;
let flipX = false;
let flipY = false;
let cropEdges = { left: 0, right: 0, top: 0, bottom: 0 };
let cropDraft = null;
let cropEditor = null;
let pointerDrag = null;
let artworkWidth = null;
let artworkHeight = null;
let artworkLeft = null;
let artworkTop = null;
let applyingPreset = false;
let textPreviewToken = 0;
let textSettings = {
  content: '',
  font: 'Arial, Helvetica, sans-serif',
  align: 'center',
  bold: false,
  italic: false,
};
const ERROR_DISPLAY_MS = 20000;

const materialPresets = {
  paper: { burnTime: 6, power: 15 },
  'gray-cardboard': { burnTime: 10, power: 20 },
  basswood: { burnTime: 15, power: 30 },
  bamboo: { burnTime: 20, power: 35 },
  'vegetable-leather': { burnTime: 12, power: 25 },
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function showError(error) {
  ui.error.textContent = error?.message || String(error);
  errorVisibleUntil = Date.now() + ERROR_DISPLAY_MS;
}

function clearError() {
  ui.error.textContent = '';
  errorVisibleUntil = 0;
}

async function refreshPorts() {
  try {
    const { ports } = await api('/api/ports');
    const previous = ui.port.value;
    ui.port.innerHTML = '';
    if (!ports.length) {
      ui.port.add(new Option('No serial devices found', ''));
    } else {
      ports.sort((a, b) => Number(b.likely_neje) - Number(a.likely_neje));
      for (const port of ports) {
        const marker = port.likely_neje ? ' · likely NEJE/CH340' : '';
        ui.port.add(new Option(`${port.device} · ${port.description}${marker}`, port.device));
      }
      if ([...ui.port.options].some(option => option.value === previous)) ui.port.value = previous;
    }
  } catch (error) { showError(error); }
}

function updateProtocolUI() {
  const profile = protocolProfiles[ui.protocol.value];
  const classic = !profile.placement;
  ui.protocolHelp.textContent = protocolDescriptions[ui.protocol.value];
  ui.powerControls.hidden = !profile.power;
  ui.controlHeading.textContent = profile.placement ? 'Artwork positioning' : 'Machine controls';
  ui.controlHint.textContent = ui.protocol.value === 'dk8-official'
    ? (profile.placement ? 'Moves the low-power positioning point in 4-pixel steps' : 'Direct four-byte jog commands from NEJE v4.0')
    : (classic ? 'Controller-specific movement commands' : 'Use Artwork X/Y, then Outline to verify placement');
  const burnMax = ui.protocol.value === 'extended-kz' ? 100 : 240;
  ui.burnTime.max = String(burnMax);
  if (Number(ui.burnTime.value) > burnMax) ui.burnTime.value = ui.protocol.value === 'extended-kz' ? '20' : '70';
  ui.burnTimeValue.textContent = ui.protocol.value === 'extended-kz' ? `${ui.burnTime.value} ms` : ui.burnTime.value;
  if (ui.materialPreset.value !== 'custom') setMaterialPreset(ui.materialPreset.value);
  rebuildPreview();
}

function updateRenderModeUI() {
  const dither = ui.renderMode.value === 'dither';
  ui.toneLabel.textContent = dither ? 'Dither exposure' : 'Threshold';
  ui.thresholdValue.textContent = dither
    ? `${Number(ui.threshold.value) - 128 >= 0 ? '+' : ''}${Number(ui.threshold.value) - 128}`
    : ui.threshold.value;
  ui.renderModeHelp.textContent = dither
    ? 'Simulates grayscale with dot density. Best for photographs; the laser itself remains on/off.'
    : 'Crisp black-or-white conversion controlled by the threshold. Best for text and line art.';
  ui.ditherAlgorithm.disabled = !ui.advancedEnabled.checked || !dither;
}

function updateAdvancedUI() {
  const enabled = ui.advancedEnabled.checked;
  ui.advancedControls.classList.toggle('disabled', !enabled);
  for (const control of [ui.brightness, ui.contrast, ui.gamma, ui.sharpen, ui.ditherAlgorithm, ui.resetAdvanced]) {
    control.disabled = !enabled;
  }
  updateRenderModeUI();
}

function updateAdvancedValues() {
  ui.brightnessValue.textContent = Number(ui.brightness.value) > 0 ? `+${ui.brightness.value}` : ui.brightness.value;
  ui.contrastValue.textContent = Number(ui.contrast.value) > 0 ? `+${ui.contrast.value}` : ui.contrast.value;
  ui.gammaValue.textContent = Number(ui.gamma.value).toFixed(1);
  ui.sharpenValue.textContent = `${ui.sharpen.value}%`;
}

function advancedOptions() {
  if (!ui.advancedEnabled.checked) {
    return { brightness: 0, contrast: 0, gamma: 1, sharpen: 0, dither: 'floyd-steinberg' };
  }
  return {
    brightness: Number(ui.brightness.value),
    contrast: Number(ui.contrast.value),
    gamma: Number(ui.gamma.value),
    sharpen: Number(ui.sharpen.value),
    dither: ui.ditherAlgorithm.value,
  };
}

function updateTransformState() {
  const parts = [];
  if (rotation) parts.push(`${rotation}° rotation`);
  if (flipX) parts.push('horizontal flip');
  if (flipY) parts.push('vertical flip');
  ui.transformState.textContent = parts.length ? parts.join(' · ') : 'No rotation or flip';
}

function transformedSourceCanvas(edges = cropEdges) {
  const geometry = NEJEImage.transformGeometry(sourceImage.naturalWidth, sourceImage.naturalHeight, {
    left: edges.left, right: edges.right, top: edges.top, bottom: edges.bottom,
  }, rotation);
  const { sx, sy, cropWidth, cropHeight } = geometry;
  const cropped = document.createElement('canvas');
  cropped.width = cropWidth;
  cropped.height = cropHeight;
  cropped.getContext('2d').drawImage(sourceImage, sx, sy, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

  const result = document.createElement('canvas');
  result.width = geometry.width;
  result.height = geometry.height;
  const ctx = result.getContext('2d');
  ctx.translate(result.width / 2, result.height / 2);
  ctx.rotate(geometry.rotation * Math.PI / 180);
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(cropped, -cropWidth / 2, -cropHeight / 2);
  return result;
}

function installArtworkSource(image, kind) {
  sourceImage = image;
  sourceKind = kind;
  rotation = 0;
  flipX = false;
  flipY = false;
  cropEdges = { left: 0, right: 0, top: 0, bottom: 0 };
  cropDraft = null;
  editorMode = 'move';
  if (kind === 'text') {
    ui.renderMode.value = 'threshold';
    ui.invert.checked = false;
    updateRenderModeUI();
  }
  ui.openTextDialog.innerHTML = '<span aria-hidden="true">Aa</span> Add text';
  updateTransformState();
  imageRevision += 1;
  resetArtworkGeometry();
  updateEditorUI();
  rebuildPreview();
}

function readTextSettings() {
  return {
    content: ui.textContent.value.replace(/\r/g, ''),
    font: ui.textFont.value,
    align: ui.textAlign.value,
    bold: ui.textBold.checked,
    italic: ui.textItalic.checked,
  };
}

function textLines(content) {
  const lines = content.split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) throw new Error('Enter some text first.');
  if (lines.length > 20) throw new Error('Text artwork is limited to 20 lines.');
  if (lines.some(line => line.length > 180)) throw new Error('A text line is too long. Add a line break to wrap it.');
  return lines;
}

function textFont(settings, size) {
  return `${settings.italic ? 'italic ' : ''}${settings.bold ? '700 ' : '400 '}${size}px ${settings.font}`;
}

function createTextCanvas(settings, { fontSize = 128, maximum = 4096, padding = 48 } = {}) {
  const lines = textLines(settings.content);
  const measure = document.createElement('canvas').getContext('2d');
  const geometryAt = size => {
    measure.font = textFont(settings, size);
    const widths = lines.map(line => measure.measureText(line || ' ').width);
    return NEJEImage.textBlockGeometry(widths, size, 1.22, padding, settings.align);
  };
  let size = fontSize;
  let geometry = geometryAt(size);
  if (geometry.width > maximum || geometry.height > maximum) {
    const scale = Math.min(maximum / geometry.width, maximum / geometry.height);
    size = Math.max(16, Math.floor(size * scale));
    geometry = geometryAt(size);
  }
  if (geometry.width > maximum || geometry.height > maximum) {
    throw new Error('This text block is too large. Shorten it or add line breaks.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = geometry.width;
  canvas.height = geometry.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'black';
  ctx.font = textFont(settings, size);
  ctx.textAlign = geometry.textAlign;
  ctx.textBaseline = 'top';
  lines.forEach((line, index) => ctx.fillText(line, geometry.positions[index].x, geometry.positions[index].y));
  return canvas;
}

function updateTextPreview() {
  const token = ++textPreviewToken;
  requestAnimationFrame(() => {
    if (token !== textPreviewToken || !ui.textDialog.open) return;
    ui.textDialogError.textContent = '';
    try {
      const preview = createTextCanvas(readTextSettings(), { fontSize: 72, maximum: 1200, padding: 28 });
      ui.textPreview.width = preview.width;
      ui.textPreview.height = preview.height;
      ui.textPreview.getContext('2d').drawImage(preview, 0, 0);
      ui.textPreview.style.display = 'block';
      ui.emptyTextPreview.hidden = true;
      ui.createText.disabled = false;
    } catch (error) {
      ui.textPreview.style.display = 'none';
      ui.emptyTextPreview.hidden = false;
      ui.textDialogError.textContent = error.message;
      ui.createText.disabled = true;
    }
  });
}

function openTextEditor() {
  ui.textContent.value = textSettings.content;
  ui.textFont.value = textSettings.font;
  ui.textAlign.value = textSettings.align;
  ui.textBold.checked = textSettings.bold;
  ui.textItalic.checked = textSettings.italic;
  ui.textReplaceNote.hidden = !sourceImage || sourceKind === 'text';
  ui.textDialogError.textContent = '';
  ui.textDialog.showModal();
  updateTextPreview();
  requestAnimationFrame(() => ui.textContent.focus());
}

function closeTextEditor() {
  if (ui.textDialog.open) ui.textDialog.close();
}

function createTextArtwork() {
  try {
    const settings = readTextSettings();
    const canvas = createTextCanvas(settings);
    const image = new Image();
    image.onload = () => {
      textSettings = settings;
      installArtworkSource(image, 'text');
      closeTextEditor();
    };
    image.onerror = () => { ui.textDialogError.textContent = 'The browser could not create the text artwork.'; };
    image.src = canvas.toDataURL('image/png');
  } catch (error) {
    ui.textDialogError.textContent = error.message;
  }
}

function setMaterialPreset(name) {
  const preset = materialPresets[name];
  if (!preset) {
    ui.presetHelp.innerHTML = '<strong>Starting points only:</strong> test on scrap at the lowest setting. Focus, color, coatings, density, and laser age change the result. Never use PVC/vinyl, unknown plastics or coatings, or chrome-tanned leather.';
    return;
  }
  applyingPreset = true;
  ui.burnTime.value = String(Math.min(Number(ui.burnTime.max), preset.burnTime));
  ui.power.value = String(preset.power);
  ui.burnTimeValue.textContent = ui.protocol.value === 'extended-kz' ? `${ui.burnTime.value} ms` : ui.burnTime.value;
  ui.powerValue.textContent = `${ui.power.value}%`;
  applyingPreset = false;
  const strengthNote = capabilities().power
    ? ` Power is set to a conservative ${preset.power}% starting point.`
    : ' This mode-4 controller has no independent laser-strength command; only burn time is changed.';
  ui.presetHelp.innerHTML = `<strong>Starting point applied:</strong>${strengthNote} Test on scrap and remain with the machine. Never use PVC/vinyl, unknown plastics or coatings, or chrome-tanned leather.`;
}

function markMaterialCustom() {
  if (applyingPreset) return;
  ui.materialPreset.value = 'custom';
  setMaterialPreset('custom');
}

function fitDimensions(width, height, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function resetArtworkGeometry() {
  sizeKey = '';
  artworkWidth = null;
  artworkHeight = null;
  artworkLeft = null;
  artworkTop = null;
}

function clampArtwork(maximum) {
  artworkWidth = Math.max(1, Math.min(maximum, Math.round(artworkWidth || 1)));
  artworkHeight = Math.max(1, Math.min(maximum, Math.round(artworkHeight || 1)));
  artworkLeft = Math.max(0, Math.min(maximum - artworkWidth, Math.round(artworkLeft || 0)));
  artworkTop = Math.max(0, Math.min(maximum - artworkHeight, Math.round(artworkTop || 0)));
}

function rebuildPreview() {
  if (!sourceImage) return;
  if (editorMode === 'crop') {
    renderCropEditor();
    return;
  }
  // Invalidate data from the previous protocol or image immediately. Without
  // this, a fast Outline click can send a stale bitmap while preview work is queued.
  packedBitmap = null;
  preparedImageData = null;
  updateButtons();
  const token = ++rebuilding;
  requestAnimationFrame(() => {
    if (token !== rebuilding || editorMode === 'crop') return;
    const profile = protocolProfiles[ui.protocol.value];
    const classic = ui.protocol.value.startsWith('classic-');
    const maximum = profile.max_width;
    const transformed = transformedSourceCanvas();
    const [fittedWidth, fittedHeight] = fitDimensions(transformed.width, transformed.height, maximum, maximum);
    const nextSizeKey = `${ui.protocol.value}:${maximum}:${imageRevision}`;
    if (sizeKey !== nextSizeKey || artworkWidth === null || artworkHeight === null) {
      artworkWidth = fittedWidth;
      artworkHeight = fittedHeight;
      artworkLeft = Math.floor((maximum - artworkWidth) / 2);
      artworkTop = Math.floor((maximum - artworkHeight) / 2);
      sizeKey = nextSizeKey;
    }
    clampArtwork(maximum);

    const width = classic ? maximum : artworkWidth;
    const height = classic ? maximum : artworkHeight;
    const work = document.createElement('canvas');
    work.width = width; work.height = height;
    const ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, width, height);
    const drawX = classic ? artworkLeft : 0;
    const drawY = classic ? artworkTop : 0;
    ctx.drawImage(transformed, drawX, drawY, artworkWidth, artworkHeight);
    const image = ctx.getImageData(0, 0, width, height);
    const rowBytes = Math.ceil(width / 8);
    const packed = new Uint8Array(rowBytes * height);
    const burnMask = NEJEImage.buildBurnMask(image, width, height, {
      mode: ui.renderMode.value,
      threshold: Number(ui.threshold.value),
      inverted: ui.invert.checked,
      ...advancedOptions(),
    });
    for (let pixel = 0; pixel < width * height; pixel++) {
      const offset = pixel * 4;
      const burn = Boolean(burnMask[pixel]);
      const value = burn ? 0 : 255;
      image.data[offset] = value; image.data[offset + 1] = value; image.data[offset + 2] = value; image.data[offset + 3] = 255;
      if (burn) {
        const row = Math.floor(pixel / width);
        const column = pixel % width;
        packed[row * rowBytes + (column >> 3)] |= 0x80 >> (column % 8);
      }
    }
    if (width % 8) {
      const usedBitsMask = (0xff << (8 - width % 8)) & 0xff;
      for (let row = 0; row < height; row++) packed[(row + 1) * rowBytes - 1] &= usedBitsMask;
    }
    const ditherName = ui.advancedEnabled.checked
      ? ui.ditherAlgorithm.options[ui.ditherAlgorithm.selectedIndex].text.split(' · ')[0]
      : 'Floyd–Steinberg';
    const conversion = ui.renderMode.value === 'dither' ? `${ditherName} dither` : 'Threshold';
    const sourceLabel = sourceKind === 'text' ? 'Text artwork' : 'Image';
    ui.imageInfo.textContent = `${sourceLabel} · ${conversion} applied. Move and resize it directly in the preview.`;
    packedBitmap = {
      width,
      height,
      pixels: bytesToBase64(packed),
      left: classic ? 0 : artworkLeft,
      top: classic ? 0 : artworkTop,
    };
    preparedImageData = image;
    renderPlacement();
    updateButtons();
  });
}

function drawArtworkHandles(ctx) {
  if (editorMode !== 'move' || artworkWidth === null) return;
  const x = artworkLeft + .5;
  const y = artworkTop + .5;
  const handle = Math.max(7, Number(capabilities().max_width) / 70);
  ctx.save();
  ctx.strokeStyle = '#18a06d';
  ctx.fillStyle = 'white';
  ctx.lineWidth = Math.max(2, Number(capabilities().max_width) / 275);
  ctx.setLineDash([8, 5]);
  ctx.strokeRect(x, y, Math.max(0, artworkWidth - 1), Math.max(0, artworkHeight - 1));
  ctx.setLineDash([]);
  for (const [hx, hy] of [[x, y], [x + artworkWidth, y], [x, y + artworkHeight], [x + artworkWidth, y + artworkHeight]]) {
    ctx.fillRect(hx - handle / 2, hy - handle / 2, handle, handle);
    ctx.strokeRect(hx - handle / 2, hy - handle / 2, handle, handle);
  }
  ctx.restore();
}

function renderPlacement() {
  if (!packedBitmap || !preparedImageData || editorMode === 'crop') return;
  const profile = protocolProfiles[ui.protocol.value];
  const classic = ui.protocol.value.startsWith('classic-');
  const canvasSize = profile.max_width;
  ui.preview.width = canvasSize; ui.preview.height = canvasSize;
  const ctx = ui.preview.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvasSize, canvasSize);
  ctx.putImageData(preparedImageData, classic ? 0 : artworkLeft, classic ? 0 : artworkTop);
  drawArtworkHandles(ctx);
  if (laserPoint) {
    const { x, y } = laserPoint;
    ctx.save();
    ctx.strokeStyle = '#e23b32';
    ctx.fillStyle = 'rgba(255,255,255,.82)';
    ctx.lineWidth = Math.max(2, canvasSize / 275);
    ctx.beginPath(); ctx.arc(x + .5, y + .5, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 14, y + .5); ctx.lineTo(x + 15, y + .5);
    ctx.moveTo(x + .5, y - 14); ctx.lineTo(x + .5, y + 15);
    ctx.stroke();
    ctx.restore();
  }
  packedBitmap.left = classic ? 0 : artworkLeft;
  packedBitmap.top = classic ? 0 : artworkTop;
  const millimetersPerPixel = 38 / canvasSize;
  ui.dimensions.textContent = `${artworkWidth} × ${artworkHeight} px · ${(artworkWidth * millimetersPerPixel).toFixed(1)} × ${(artworkHeight * millimetersPerPixel).toFixed(1)} mm at (${artworkLeft}, ${artworkTop})`;
  ui.preview.style.display = 'block'; ui.emptyPreview.style.display = 'none';
}

function cropSelectionFromEdges() {
  return {
    x1: cropEdges.left / 100,
    y1: cropEdges.top / 100,
    x2: 1 - cropEdges.right / 100,
    y2: 1 - cropEdges.bottom / 100,
  };
}

function renderCropEditor() {
  if (!sourceImage || editorMode !== 'crop') return;
  const maximum = Number(protocolProfiles[ui.protocol.value].max_width);
  ui.preview.width = maximum;
  ui.preview.height = maximum;
  const ctx = ui.preview.getContext('2d');
  ctx.fillStyle = '#e5e6e2';
  ctx.fillRect(0, 0, maximum, maximum);
  const padding = Math.max(18, Math.round(maximum * .045));
  const [displayWidth, displayHeight] = fitDimensions(
    sourceImage.naturalWidth,
    sourceImage.naturalHeight,
    maximum - padding * 2,
    maximum - padding * 2,
  );
  const imageX = Math.floor((maximum - displayWidth) / 2);
  const imageY = Math.floor((maximum - displayHeight) / 2);
  ctx.drawImage(sourceImage, imageX, imageY, displayWidth, displayHeight);
  cropDraft ||= cropSelectionFromEdges();
  const selection = {
    left: imageX + cropDraft.x1 * displayWidth,
    top: imageY + cropDraft.y1 * displayHeight,
    right: imageX + cropDraft.x2 * displayWidth,
    bottom: imageY + cropDraft.y2 * displayHeight,
  };
  cropEditor = { imageX, imageY, displayWidth, displayHeight, selection };
  ctx.fillStyle = 'rgba(12, 14, 16, .58)';
  ctx.fillRect(imageX, imageY, displayWidth, selection.top - imageY);
  ctx.fillRect(imageX, selection.bottom, displayWidth, imageY + displayHeight - selection.bottom);
  ctx.fillRect(imageX, selection.top, selection.left - imageX, selection.bottom - selection.top);
  ctx.fillRect(selection.right, selection.top, imageX + displayWidth - selection.right, selection.bottom - selection.top);
  ctx.save();
  ctx.strokeStyle = '#ffb84d';
  ctx.fillStyle = 'white';
  ctx.lineWidth = Math.max(2, maximum / 275);
  ctx.strokeRect(selection.left + .5, selection.top + .5, selection.right - selection.left, selection.bottom - selection.top);
  const handle = Math.max(8, maximum / 60);
  const points = [
    [selection.left, selection.top], [(selection.left + selection.right) / 2, selection.top], [selection.right, selection.top],
    [selection.left, (selection.top + selection.bottom) / 2], [selection.right, (selection.top + selection.bottom) / 2],
    [selection.left, selection.bottom], [(selection.left + selection.right) / 2, selection.bottom], [selection.right, selection.bottom],
  ];
  for (const [x, y] of points) {
    ctx.fillRect(x - handle / 2, y - handle / 2, handle, handle);
    ctx.strokeRect(x - handle / 2, y - handle / 2, handle, handle);
  }
  ctx.restore();
  const widthPercent = Math.round((cropDraft.x2 - cropDraft.x1) * 100);
  const heightPercent = Math.round((cropDraft.y2 - cropDraft.y1) * 100);
  ui.dimensions.textContent = `Crop selection · ${widthPercent}% × ${heightPercent}%`;
  ui.preview.style.display = 'block';
  ui.emptyPreview.style.display = 'none';
}

function setEditorMode(mode) {
  if (!sourceImage && mode !== 'move') return;
  editorMode = mode;
  pointerDrag = null;
  if (mode === 'crop') {
    cropDraft = cropSelectionFromEdges();
    renderCropEditor();
  } else {
    cropEditor = null;
    if (packedBitmap && preparedImageData) renderPlacement();
    else rebuildPreview();
  }
  updateEditorUI();
  updateButtons();
}

function updateEditorUI() {
  const hasImage = Boolean(sourceImage);
  const editingLocked = Boolean(latestStatus.uploading || latestStatus.device_running || actionPending || preparePending);
  ui.moveTool.disabled = !hasImage || editingLocked;
  ui.cropTool.disabled = !hasImage || editingLocked;
  for (const control of [ui.rotateLeft, ui.rotateRight, ui.flipHorizontal, ui.flipVertical, ui.lockAspect]) {
    control.disabled = !hasImage || editingLocked || editorMode === 'crop';
  }
  ui.moveTool.classList.toggle('active', editorMode === 'move' && hasImage);
  ui.cropTool.classList.toggle('active', editorMode === 'crop');
  ui.pointMode.classList.toggle('active', editorMode === 'point');
  ui.cropActions.hidden = editorMode !== 'crop';
  ui.preview.classList.toggle('edit-move', editorMode === 'move' && hasImage);
  ui.preview.classList.toggle('edit-crop', editorMode === 'crop');
  ui.preview.classList.toggle('point-mode', editorMode === 'point');
  if (!hasImage) {
    ui.editorHelp.textContent = 'Choose an image, then drag it directly in the preview.';
  } else if (editorMode === 'crop') {
    ui.editorHelp.textContent = 'Drag the crop edges or corners on the original image; drag inside to move the selection. Apply when ready.';
  } else if (editorMode === 'point') {
    ui.editorHelp.textContent = laserPoint
      ? `Laser target: ${laserPoint.x}, ${laserPoint.y}. Click elsewhere to move it.`
      : 'Click the preview to move the idle positioning laser. This tool physically moves the machine.';
  } else {
    ui.editorHelp.textContent = 'Drag the artwork to move it. Drag any corner handle to resize it.';
  }
}

function capabilities() {
  if (latestStatus.connected && latestStatus.protocol === ui.protocol.value) return latestStatus.protocol_info || {};
  return protocolProfiles[ui.protocol.value] || {};
}

function updateButtons() {
  const connected = Boolean(latestStatus.connected) && !(latestStatus.protocol === 'dk8-official' && !latestStatus.verified);
  const uploading = Boolean(latestStatus.uploading);
  ui.connect.disabled = connected || connectPending || !ui.port.value;
  ui.disconnect.disabled = !connected || uploading || connectPending;
  const busy = actionPending || preparePending;
  const cropOpen = editorMode === 'crop';
  ui.start.disabled = !connected || uploading || busy || cropOpen || !packedBitmap || capabilities().engrave === false;
  ui.outline.textContent = outlineActive ? 'Stop outline' : 'Low-power outline';
  ui.outline.disabled = !connected || uploading || busy || cropOpen || !capabilities().outline || (!outlineActive && !packedBitmap);
  ui.stop.disabled = !connected;
  const pointUnavailable = !connected || Boolean(latestStatus.device_running) || !packedBitmap || !capabilities().point;
  if (editorMode === 'point' && pointUnavailable) {
    editorMode = 'move';
    updateEditorUI();
    renderPlacement();
  }
  ui.pointMode.disabled = pointUnavailable || uploading || busy;
  $$('[data-action]').forEach(button => {
    const action = button.dataset.action;
    let allowed = connected && !uploading && !busy;
    if (['up', 'down', 'left', 'right'].includes(action)) allowed &&= Boolean(capabilities().jog);
    if (action === 'home') allowed &&= Boolean(capabilities().home);
    if (action === 'center') allowed &&= Boolean(capabilities().center);
    if (action === 'pause' || action === 'resume') allowed &&= Boolean(capabilities().pause);
    if (action === 'resume' && ui.protocol.value.startsWith('classic')) allowed = false;
    if (capabilities().placement && ['up', 'down', 'left', 'right', 'home', 'center'].includes(action)) allowed &&= Boolean(packedBitmap);
    button.disabled = !allowed;
  });
  updateEditorUI();
}

function renderStatus(status) {
  latestStatus = status;
  if (!status.connected) {
    outlineActive = false;
    outlineStateKnown = false;
    preparedKey = '';
  }
  let workAreaChanged = false;
  if (status.verified && status.protocol === 'dk8-official') {
    const profile = protocolProfiles['dk8-official'];
    workAreaChanged = profile.max_width !== status.protocol_info.max_width || profile.placement !== status.protocol_info.placement;
    Object.assign(profile, status.protocol_info);
  }
  if (status.connected && status.protocol && ui.protocol.value !== status.protocol) {
    ui.protocol.value = status.protocol;
    updateProtocolUI();
  }
  const mode = status.machine_mode ? ` · mode ${status.machine_mode}` : '';
  const verification = status.verified ? 'Data link verified' : 'Connected (unverified)';
  ui.badge.textContent = status.connected ? `${verification}${mode}` : 'Disconnected';
  ui.detectedProtocol.hidden = !(status.verified && status.protocol === 'dk8-official');
  ui.detectedProtocol.textContent = status.verified
    ? `Detected ${status.protocol_info?.label || status.protocol}${mode}. The controller reported a ${status.protocol_info?.max_width} × ${status.protocol_info?.max_height} work grid.`
    : '';
  ui.protocol.disabled = Boolean(status.connected);
  ui.badge.className = `badge ${status.connected ? 'online' : 'offline'}`;
  ui.phase.textContent = status.phase || 'Unknown';
  if (status.error) showError(status.error);
  else if (errorVisibleUntil && Date.now() >= errorVisibleUntil) clearError();
  const total = Number(status.total || 0);
  const sent = Number(status.sent || 0);
  ui.progress.value = total ? Math.round(sent / total * 100) : 0;
  ui.statusDetail.textContent = status.connected
    ? `${status.protocol_info?.label || status.protocol}${mode}${status.uploading ? ` · ${sent.toLocaleString()} / ${total.toLocaleString()} bytes` : ''}${status.last_command_hex ? ` · sent ${status.last_command_hex}` : ''}${status.last_command_reply_hex ? ` · reply ${status.last_command_reply_hex}` : ''}`
    : 'Turn on the engraver and connect its USB data cable.';
  if (workAreaChanged) updateProtocolUI();
  updateButtons();
}

async function connect() {
  clearError();
  if (connectPending) return;
  connectPending = true;
  updateButtons();
  try {
    // A CH340 may disappear and return under a different /dev name. Refresh
    // immediately before opening it instead of trusting the initial page load.
    await refreshPorts();
    if (!ui.port.value) throw new Error('No serial device is available. Reconnect USB and try again.');
    const status = await api('/api/connect', { method: 'POST', body: JSON.stringify({ port: ui.port.value, protocol: ui.protocol.value }) });
    renderStatus(status);
    if (ui.protocol.value === 'dk8-official' && !status.verified) {
      showError(new Error('No DK-8-KZ mode reply was received. Commands are disabled until the controller is identified.'));
    }
  } catch (error) { showError(error); }
  finally { connectPending = false; updateButtons(); }
}

async function sendAction(action, parameters = {}) {
  clearError();
  if (actionPending) return;
  actionPending = true;
  updateButtons();
  try {
    const status = await api('/api/action', {
      method: 'POST',
      body: JSON.stringify({ action, parameters, safety_acknowledged: ui.safety.checked }),
    });
    renderStatus(status);
    return true;
  } catch (error) { showError(error); return false; }
  finally { actionPending = false; updateButtons(); }
}

async function startJob() {
  if (!packedBitmap) return;
  clearError();
  try {
    if (!await ensureOutlineStopped()) return;
    // Mode-4 retains its verified framebuffer. Prepare it once, then /api/jobs
    // can send only burn time + start when this exact image is still resident.
    if (!await ensurePrepared()) return;
    const status = await api('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        ...packedBitmap,
        burn_time: Number(ui.burnTime.value),
        power: Number(ui.power.value),
        idle_power: 1,
        safety_acknowledged: ui.safety.checked,
      }),
    });
    renderStatus(status);
  } catch (error) { showError(error); }
}

ui.imageFile.addEventListener('change', () => {
  const file = ui.imageFile.files[0];
  if (!file) return;
  const image = new Image();
  image.onload = () => {
    installArtworkSource(image, 'image');
    URL.revokeObjectURL(image.src);
  };
  image.onerror = () => showError(new Error('The browser could not decode that image.'));
  image.src = URL.createObjectURL(file);
});
ui.openTextDialog.addEventListener('click', openTextEditor);
ui.closeTextDialog.addEventListener('click', closeTextEditor);
ui.cancelText.addEventListener('click', closeTextEditor);
ui.createText.addEventListener('click', createTextArtwork);
for (const control of [ui.textContent, ui.textFont, ui.textAlign, ui.textBold, ui.textItalic]) {
  control.addEventListener('input', updateTextPreview);
}
ui.textDialog.addEventListener('click', event => {
  if (event.target === ui.textDialog) closeTextEditor();
});
ui.renderMode.addEventListener('change', () => { updateRenderModeUI(); rebuildPreview(); });
ui.threshold.addEventListener('input', () => { updateRenderModeUI(); rebuildPreview(); });
ui.invert.addEventListener('change', rebuildPreview);
ui.lockAspect.addEventListener('change', updateEditorUI);
ui.rotateLeft.addEventListener('click', () => {
  rotation = (rotation + 270) % 360;
  imageRevision += 1; resetArtworkGeometry();
  updateTransformState(); rebuildPreview();
});
ui.rotateRight.addEventListener('click', () => {
  rotation = (rotation + 90) % 360;
  imageRevision += 1; resetArtworkGeometry();
  updateTransformState(); rebuildPreview();
});
ui.flipHorizontal.addEventListener('click', () => {
  flipX = !flipX; imageRevision += 1; resetArtworkGeometry();
  updateTransformState(); rebuildPreview();
});
ui.flipVertical.addEventListener('click', () => {
  flipY = !flipY; imageRevision += 1; resetArtworkGeometry();
  updateTransformState(); rebuildPreview();
});
ui.resetCrop.addEventListener('click', () => {
  cropDraft = { x1: 0, y1: 0, x2: 1, y2: 1 };
  renderCropEditor();
});
ui.advancedEnabled.addEventListener('change', () => { updateAdvancedUI(); rebuildPreview(); });
for (const control of [ui.brightness, ui.contrast, ui.gamma, ui.sharpen]) {
  control.addEventListener('input', () => { updateAdvancedValues(); rebuildPreview(); });
}
ui.ditherAlgorithm.addEventListener('change', rebuildPreview);
ui.resetAdvanced.addEventListener('click', () => {
  ui.brightness.value = '0'; ui.contrast.value = '0'; ui.gamma.value = '1'; ui.sharpen.value = '0';
  ui.ditherAlgorithm.value = 'floyd-steinberg';
  updateAdvancedValues(); rebuildPreview();
});
ui.protocol.addEventListener('change', updateProtocolUI);
ui.materialPreset.addEventListener('change', () => setMaterialPreset(ui.materialPreset.value));
ui.burnTime.addEventListener('input', () => {
  ui.burnTimeValue.textContent = ui.protocol.value === 'extended-kz' ? `${ui.burnTime.value} ms` : ui.burnTime.value;
  markMaterialCustom();
});
ui.power.addEventListener('input', () => { ui.powerValue.textContent = `${ui.power.value}%`; markMaterialCustom(); });
$('#refreshPorts').addEventListener('click', refreshPorts);
ui.connect.addEventListener('click', connect);
ui.disconnect.addEventListener('click', async () => {
  try {
    renderStatus(await api('/api/disconnect', { method: 'POST', body: '{}' }));
    outlineActive = false;
    outlineStateKnown = false;
    updateButtons();
  } catch (error) { showError(error); }
});
ui.outline.addEventListener('click', async () => {
  if (outlineActive) {
    if (await sendAction('outline-stop')) {
      outlineActive = false;
      outlineStateKnown = true;
      updateButtons();
    }
    return;
  }
  const max = Number(capabilities().max_width || 0);
  if (!packedBitmap || packedBitmap.width < 1 || packedBitmap.height < 1 || packedBitmap.width > max || packedBitmap.height > max) {
    rebuildPreview();
    showError(new Error(`The image was prepared for a different protocol and is being resized to ${max} × ${max}. Try Outline again when the preview updates.`));
    return;
  }
  if (!await ensureOutlineStopped()) return;
  if (!await ensurePrepared()) return;
  if (await sendAction('outline', {
    width: packedBitmap.width,
    height: packedBitmap.height,
    left: packedBitmap.left,
    top: packedBitmap.top,
  })) {
    outlineActive = true;
    outlineStateKnown = true;
    updateButtons();
  }
});
ui.start.addEventListener('click', startJob);
ui.stop.addEventListener('click', async () => {
  if (await sendAction('stop')) {
    outlineActive = false;
    outlineStateKnown = true;
    updateButtons();
  }
});
ui.moveTool.addEventListener('click', () => setEditorMode('move'));
ui.cropTool.addEventListener('click', () => setEditorMode(editorMode === 'crop' ? 'move' : 'crop'));
ui.applyCrop.addEventListener('click', () => {
  if (!cropDraft) return;
  cropEdges = {
    left: Math.round(cropDraft.x1 * 100),
    right: Math.round((1 - cropDraft.x2) * 100),
    top: Math.round(cropDraft.y1 * 100),
    bottom: Math.round((1 - cropDraft.y2) * 100),
  };
  cropDraft = null;
  imageRevision += 1;
  resetArtworkGeometry();
  editorMode = 'move';
  updateEditorUI();
  rebuildPreview();
});
ui.cancelCrop.addEventListener('click', () => {
  cropDraft = null;
  setEditorMode('move');
});
ui.pointMode.addEventListener('click', () => {
  setEditorMode(editorMode === 'point' ? 'move' : 'point');
});
ui.preview.addEventListener('click', async event => {
  if (editorMode !== 'point' || actionPending || ui.pointMode.disabled) return;
  const rect = ui.preview.getBoundingClientRect();
  const maximum = Number(capabilities().max_width);
  const x = Math.max(0, Math.min(maximum - 1, Math.floor((event.clientX - rect.left) * ui.preview.width / rect.width)));
  const y = Math.max(0, Math.min(maximum - 1, Math.floor((event.clientY - rect.top) * ui.preview.height / rect.height)));
  const previous = laserPoint;
  laserPoint = { x, y };
  renderPlacement();
  updateEditorUI();
  if (!await ensureOutlineStopped() || !await ensurePrepared() || !await sendAction('point', { x, y })) {
    laserPoint = previous;
    renderPlacement();
    updateEditorUI();
  }
});

function canvasPoint(event) {
  const rect = ui.preview.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * ui.preview.width / rect.width,
    y: (event.clientY - rect.top) * ui.preview.height / rect.height,
    hitRadius: 13 * ui.preview.width / rect.width,
  };
}

function artworkHit(point) {
  const corners = {
    nw: [artworkLeft, artworkTop],
    ne: [artworkLeft + artworkWidth, artworkTop],
    sw: [artworkLeft, artworkTop + artworkHeight],
    se: [artworkLeft + artworkWidth, artworkTop + artworkHeight],
  };
  for (const [handle, [x, y]] of Object.entries(corners)) {
    if (Math.hypot(point.x - x, point.y - y) <= point.hitRadius) return handle;
  }
  if (point.x >= artworkLeft && point.x <= artworkLeft + artworkWidth
      && point.y >= artworkTop && point.y <= artworkTop + artworkHeight) return 'move';
  return null;
}

function beginArtworkDrag(event, point) {
  if (!packedBitmap || artworkWidth === null) return;
  const handle = artworkHit(point);
  if (!handle) return;
  pointerDrag = {
    kind: handle,
    pointerId: event.pointerId,
    startX: point.x,
    startY: point.y,
    left: artworkLeft,
    top: artworkTop,
    width: artworkWidth,
    height: artworkHeight,
  };
  ui.preview.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function updateArtworkDrag(point) {
  const maximum = Number(protocolProfiles[ui.protocol.value].max_width);
  if (pointerDrag.kind === 'move') {
    artworkLeft = pointerDrag.left + point.x - pointerDrag.startX;
    artworkTop = pointerDrag.top + point.y - pointerDrag.startY;
    clampArtwork(maximum);
    renderPlacement();
    return;
  }
  const leftSide = pointerDrag.kind.includes('w');
  const topSide = pointerDrag.kind.includes('n');
  const directionX = leftSide ? -1 : 1;
  const directionY = topSide ? -1 : 1;
  const anchorX = leftSide ? pointerDrag.left + pointerDrag.width : pointerDrag.left;
  const anchorY = topSide ? pointerDrag.top + pointerDrag.height : pointerDrag.top;
  const maximumWidth = directionX > 0 ? maximum - anchorX : anchorX;
  const maximumHeight = directionY > 0 ? maximum - anchorY : anchorY;
  let nextWidth = Math.max(8, Math.min(maximumWidth, Math.abs(point.x - anchorX)));
  let nextHeight = Math.max(8, Math.min(maximumHeight, Math.abs(point.y - anchorY)));
  if (ui.lockAspect.checked) {
    const widthScale = nextWidth / pointerDrag.width;
    const heightScale = nextHeight / pointerDrag.height;
    const wantedScale = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1) ? widthScale : heightScale;
    const minimumScale = Math.max(8 / pointerDrag.width, 8 / pointerDrag.height);
    const maximumScale = Math.min(maximumWidth / pointerDrag.width, maximumHeight / pointerDrag.height);
    const scale = Math.max(minimumScale, Math.min(maximumScale, wantedScale));
    nextWidth = pointerDrag.width * scale;
    nextHeight = pointerDrag.height * scale;
  }
  artworkWidth = Math.max(1, Math.round(nextWidth));
  artworkHeight = Math.max(1, Math.round(nextHeight));
  artworkLeft = Math.round(directionX > 0 ? anchorX : anchorX - artworkWidth);
  artworkTop = Math.round(directionY > 0 ? anchorY : anchorY - artworkHeight);
  clampArtwork(maximum);
  rebuildPreview();
}

function cropHit(point) {
  if (!cropEditor) return null;
  const { left, top, right, bottom } = cropEditor.selection;
  const radius = point.hitRadius;
  const nearLeft = Math.abs(point.x - left) <= radius;
  const nearRight = Math.abs(point.x - right) <= radius;
  const nearTop = Math.abs(point.y - top) <= radius;
  const nearBottom = Math.abs(point.y - bottom) <= radius;
  if (nearLeft && nearTop) return 'nw';
  if (nearRight && nearTop) return 'ne';
  if (nearLeft && nearBottom) return 'sw';
  if (nearRight && nearBottom) return 'se';
  if (nearTop && point.x >= left && point.x <= right) return 'n';
  if (nearBottom && point.x >= left && point.x <= right) return 's';
  if (nearLeft && point.y >= top && point.y <= bottom) return 'w';
  if (nearRight && point.y >= top && point.y <= bottom) return 'e';
  if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) return 'move';
  const { imageX, imageY, displayWidth, displayHeight } = cropEditor;
  if (point.x >= imageX && point.x <= imageX + displayWidth
      && point.y >= imageY && point.y <= imageY + displayHeight) return 'new';
  return null;
}

function normalizedCropPoint(point) {
  const { imageX, imageY, displayWidth, displayHeight } = cropEditor;
  return {
    x: Math.max(0, Math.min(1, (point.x - imageX) / displayWidth)),
    y: Math.max(0, Math.min(1, (point.y - imageY) / displayHeight)),
  };
}

function beginCropDrag(event, point) {
  const handle = cropHit(point);
  if (!handle) return;
  const normalized = normalizedCropPoint(point);
  pointerDrag = {
    kind: handle,
    pointerId: event.pointerId,
    startX: normalized.x,
    startY: normalized.y,
    selection: { ...cropDraft },
  };
  if (handle === 'new') cropDraft = { x1: normalized.x, y1: normalized.y, x2: normalized.x, y2: normalized.y };
  ui.preview.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function updateCropDrag(point) {
  const current = normalizedCropPoint(point);
  const start = pointerDrag.selection;
  const minimum = .02;
  if (pointerDrag.kind === 'new') {
    cropDraft = {
      x1: Math.min(pointerDrag.startX, current.x),
      y1: Math.min(pointerDrag.startY, current.y),
      x2: Math.max(pointerDrag.startX, current.x),
      y2: Math.max(pointerDrag.startY, current.y),
    };
  } else if (pointerDrag.kind === 'move') {
    const width = start.x2 - start.x1;
    const height = start.y2 - start.y1;
    const dx = Math.max(-start.x1, Math.min(1 - start.x2, current.x - pointerDrag.startX));
    const dy = Math.max(-start.y1, Math.min(1 - start.y2, current.y - pointerDrag.startY));
    cropDraft = { x1: start.x1 + dx, x2: start.x2 + dx, y1: start.y1 + dy, y2: start.y2 + dy };
    cropDraft.x2 = cropDraft.x1 + width;
    cropDraft.y2 = cropDraft.y1 + height;
  } else {
    cropDraft = { ...start };
    if (pointerDrag.kind.includes('w')) cropDraft.x1 = Math.min(start.x2 - minimum, current.x);
    if (pointerDrag.kind.includes('e')) cropDraft.x2 = Math.max(start.x1 + minimum, current.x);
    if (pointerDrag.kind.includes('n')) cropDraft.y1 = Math.min(start.y2 - minimum, current.y);
    if (pointerDrag.kind.includes('s')) cropDraft.y2 = Math.max(start.y1 + minimum, current.y);
  }
  cropDraft.x1 = Math.max(0, Math.min(1 - minimum, cropDraft.x1));
  cropDraft.y1 = Math.max(0, Math.min(1 - minimum, cropDraft.y1));
  cropDraft.x2 = Math.max(cropDraft.x1 + minimum, Math.min(1, cropDraft.x2));
  cropDraft.y2 = Math.max(cropDraft.y1 + minimum, Math.min(1, cropDraft.y2));
  renderCropEditor();
}

ui.preview.addEventListener('pointerdown', event => {
  if (latestStatus.uploading || latestStatus.device_running || actionPending || preparePending) return;
  const point = canvasPoint(event);
  if (editorMode === 'move') beginArtworkDrag(event, point);
  if (editorMode === 'crop') beginCropDrag(event, point);
});
ui.preview.addEventListener('pointermove', event => {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const point = canvasPoint(event);
  if (editorMode === 'move') updateArtworkDrag(point);
  if (editorMode === 'crop') updateCropDrag(point);
});
function finishPointerDrag(event) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  if (ui.preview.hasPointerCapture(event.pointerId)) ui.preview.releasePointerCapture(event.pointerId);
  pointerDrag = null;
}
ui.preview.addEventListener('pointerup', finishPointerDrag);
ui.preview.addEventListener('pointercancel', finishPointerDrag);

async function ensureOutlineStopped() {
  if (ui.protocol.value !== 'dk8-official' || (outlineStateKnown && !outlineActive)) return true;
  const stopped = await sendAction('outline-stop');
  if (stopped) {
    outlineActive = false;
    outlineStateKnown = true;
    updateButtons();
  }
  return stopped;
}

function currentPreparationKey() {
  if (!packedBitmap) return '';
  return [
    ui.protocol.value,
    imageRevision,
    ui.renderMode.value,
    ui.threshold.value,
    Number(ui.invert.checked),
    Number(ui.advancedEnabled.checked),
    ui.brightness.value,
    ui.contrast.value,
    ui.gamma.value,
    ui.sharpen.value,
    ui.ditherAlgorithm.value,
    rotation,
    Number(flipX),
    Number(flipY),
    cropEdges.left,
    cropEdges.right,
    cropEdges.top,
    cropEdges.bottom,
    artworkWidth,
    artworkHeight,
    artworkLeft,
    artworkTop,
    packedBitmap.width,
    packedBitmap.height,
    packedBitmap.left,
    packedBitmap.top,
  ].join(':');
}

async function ensurePrepared() {
  if (!capabilities().prepare) return true;
  const key = currentPreparationKey();
  if (key && preparedKey === key && latestStatus.prepared) return true;
  if (!packedBitmap || preparePending) return false;
  preparePending = true;
  updateButtons();
  clearError();
  try {
    let status = await api('/api/prepare', {
      method: 'POST',
      body: JSON.stringify({
        ...packedBitmap,
        burn_time: Number(ui.burnTime.value),
        power: Number(ui.power.value),
        idle_power: 1,
      }),
    });
    renderStatus(status);
    const deadline = Date.now() + 20000;
    while (status.uploading && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 150));
      status = await api('/api/status');
      renderStatus(status);
    }
    if (status.uploading) throw new Error('Positioning image upload timed out. Use Stop / reset before retrying.');
    if (status.error) throw new Error(status.error);
    if (!status.prepared) throw new Error('The controller did not confirm the positioning image.');
    preparedKey = key;
    return true;
  } catch (error) {
    preparedKey = '';
    showError(error);
    return false;
  } finally {
    preparePending = false;
    updateButtons();
  }
}
function sendPositionAction(action) {
  if (!packedBitmap) return;
  const step = 4;
  let left = artworkLeft;
  let top = artworkTop;
  if (action === 'up') top -= step;
  if (action === 'down') top += step;
  if (action === 'left') left -= step;
  if (action === 'right') left += step;
  if (action === 'home') { left = 0; top = 0; }
  if (action === 'center') {
    left = Math.floor((Number(capabilities().max_width) - packedBitmap.width) / 2);
    top = Math.floor((Number(capabilities().max_height) - packedBitmap.height) / 2);
  }
  left = Math.max(0, Math.min(Number(capabilities().max_width) - artworkWidth, left));
  top = Math.max(0, Math.min(Number(capabilities().max_height) - artworkHeight, top));
  artworkLeft = left;
  artworkTop = top;
  renderPlacement();
  sendAction(action, { width: packedBitmap.width, height: packedBitmap.height, left, top });
}

$$('[data-action]').forEach(button => button.addEventListener('click', () => {
  const action = button.dataset.action;
  if (capabilities().placement && ['up', 'down', 'left', 'right', 'home', 'center'].includes(action)) {
    sendPositionAction(action);
  } else {
    sendAction(action);
  }
}));

async function poll() {
  try { renderStatus(await api('/api/status')); } catch (error) { showError(error); }
}

updateRenderModeUI();
updateAdvancedValues();
updateAdvancedUI();
updateTransformState();
updateProtocolUI();
updateEditorUI();
refreshPorts().then(poll);
setInterval(poll, 800);
