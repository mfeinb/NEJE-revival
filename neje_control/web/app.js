const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ui = {
  port: $('#serialPort'), protocol: $('#protocol'), protocolHelp: $('#protocolHelp'),
  detectedProtocol: $('#detectedProtocol'),
  connect: $('#connect'), disconnect: $('#disconnect'), badge: $('#connectionBadge'),
  imageFile: $('#imageFile'), renderMode: $('#renderMode'), renderModeHelp: $('#renderModeHelp'),
  toneLabel: $('#toneLabel'), threshold: $('#threshold'), thresholdValue: $('#thresholdValue'),
  invert: $('#invert'), imageInfo: $('#imageInfo'), preview: $('#previewCanvas'),
  rotateLeft: $('#rotateLeft'), rotateRight: $('#rotateRight'),
  flipHorizontal: $('#flipHorizontal'), flipVertical: $('#flipVertical'),
  transformState: $('#transformState'), resetCrop: $('#resetCrop'),
  cropLeft: $('#cropLeft'), cropRight: $('#cropRight'), cropTop: $('#cropTop'), cropBottom: $('#cropBottom'),
  lockAspect: $('#lockAspect'), artworkHeight: $('#artworkHeight'),
  artworkHeightNumber: $('#artworkHeightNumber'), artworkHeightValue: $('#artworkHeightValue'),
  advancedEnabled: $('#advancedEnabled'), advancedControls: $('#advancedControls'),
  brightness: $('#brightness'), brightnessValue: $('#brightnessValue'),
  contrast: $('#contrast'), contrastValue: $('#contrastValue'),
  gamma: $('#gamma'), gammaValue: $('#gammaValue'), sharpen: $('#sharpen'), sharpenValue: $('#sharpenValue'),
  ditherAlgorithm: $('#ditherAlgorithm'), resetAdvanced: $('#resetAdvanced'),
  emptyPreview: $('#emptyPreview'), dimensions: $('#dimensions'), burnTime: $('#burnTime'),
  pointMode: $('#pointMode'), pointHelp: $('#pointHelp'),
  artworkWidth: $('#artworkWidth'), artworkWidthNumber: $('#artworkWidthNumber'),
  artworkWidthValue: $('#artworkWidthValue'),
  placementControls: $('#placementControls'), positionX: $('#positionX'),
  positionXNumber: $('#positionXNumber'), positionY: $('#positionY'),
  positionYNumber: $('#positionYNumber'), positionXValue: $('#positionXValue'),
  positionYValue: $('#positionYValue'), placementHelp: $('#placementHelp'),
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
let packedBitmap = null;
let preparedImageData = null;
let latestStatus = { connected: false };
let rebuilding = 0;
let placementKey = '';
let sizeKey = '';
let imageRevision = 0;
let actionPending = false;
let preparePending = false;
let preparedKey = '';
let connectPending = false;
let pointModeEnabled = false;
let laserPoint = null;
let outlineActive = false;
let outlineStateKnown = false;
let errorVisibleUntil = 0;
let rotation = 0;
let flipX = false;
let flipY = false;
let applyingPreset = false;
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

function updatePlacementHelp() {
  const profile = protocolProfiles[ui.protocol.value];
  const classicProtocol = ui.protocol.value.startsWith('classic-');
  let help = profile.placement
    ? 'Changes the artwork origin sent to the controller. The arrow pad also adjusts this position.'
    : 'Changes where pixels are stored in the mode-4 engraving buffer. It does not jog the machine; use the separate arrow pad for that.';
  if (sourceImage && !classicProtocol && Number(ui.positionX.max) === 0) {
    help += ' Reduce Artwork width to enable horizontal movement.';
  }
  ui.placementHelp.textContent = help;
}

function updateProtocolUI() {
  const profile = protocolProfiles[ui.protocol.value];
  const classic = !profile.placement;
  const classicProtocol = ui.protocol.value.startsWith('classic-');
  ui.protocolHelp.textContent = protocolDescriptions[ui.protocol.value];
  ui.powerControls.hidden = !profile.power;
  ui.placementControls.hidden = classicProtocol;
  updatePlacementHelp();
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

function cropValue(control) {
  const value = Math.round(Number(control.value));
  control.value = String(Math.max(0, Math.min(45, Number.isFinite(value) ? value : 0)));
  return Number(control.value);
}

function transformedSourceCanvas() {
  const geometry = NEJEImage.transformGeometry(sourceImage.naturalWidth, sourceImage.naturalHeight, {
    left: cropValue(ui.cropLeft), right: cropValue(ui.cropRight),
    top: cropValue(ui.cropTop), bottom: cropValue(ui.cropBottom),
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

function syncNumberInput(range, number) {
  number.min = range.min;
  number.max = range.max;
  number.value = range.value;
  number.disabled = range.disabled;
}

function applyNumberInput(range, number, callback) {
  const value = Number(number.value);
  if (!Number.isFinite(value)) {
    number.value = range.value;
    return;
  }
  range.value = String(Math.max(Number(range.min), Math.min(Number(range.max), Math.round(value))));
  number.value = range.value;
  callback();
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

function rebuildPreview() {
  if (!sourceImage) return;
  // Invalidate data from the previous protocol or image immediately. Without
  // this, a fast Outline click can send a stale 512px Classic bitmap while the
  // older preview is still rebuilding on the next animation frame.
  packedBitmap = null;
  preparedImageData = null;
  updateButtons();
  const token = ++rebuilding;
  requestAnimationFrame(() => {
    if (token !== rebuilding) return;
    const profile = protocolProfiles[ui.protocol.value];
    const classic = ui.protocol.value.startsWith('classic-');
    const max = profile.max_width;
    const transformed = transformedSourceCanvas();
    const [fittedWidth, fittedHeight] = fitDimensions(transformed.width, transformed.height, max, max);
    const nextSizeKey = `${ui.protocol.value}:${max}:${imageRevision}`;
    const locked = ui.lockAspect.checked;
    ui.artworkWidth.max = String(locked ? fittedWidth : max);
    ui.artworkHeight.max = String(locked ? fittedHeight : max);
    ui.artworkWidth.disabled = false;
    ui.artworkHeight.disabled = locked;
    if (sizeKey !== nextSizeKey) {
      ui.artworkWidth.value = String(fittedWidth);
      ui.artworkHeight.value = String(fittedHeight);
      sizeKey = nextSizeKey;
    }
    const contentWidth = Math.max(1, Math.min(Number(ui.artworkWidth.max), Number(ui.artworkWidth.value)));
    const contentHeight = locked
      ? Math.max(1, Math.round(transformed.height * contentWidth / transformed.width))
      : Math.max(1, Math.min(max, Number(ui.artworkHeight.value)));
    ui.artworkWidth.value = String(contentWidth);
    ui.artworkHeight.value = String(contentHeight);
    syncNumberInput(ui.artworkWidth, ui.artworkWidthNumber);
    syncNumberInput(ui.artworkHeight, ui.artworkHeightNumber);
    ui.artworkWidthValue.textContent = `${contentWidth} px · ${(contentWidth * 38 / max).toFixed(1)} mm`;
    ui.artworkHeightValue.textContent = `${contentHeight} px · ${(contentHeight * 38 / max).toFixed(1)} mm`;
    const width = classic ? 512 : contentWidth;
    const height = classic ? 512 : contentHeight;
    const work = document.createElement('canvas');
    work.width = width; work.height = height;
    const ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, width, height);
    const x = classic ? Math.floor((width - contentWidth) / 2) : 0;
    const y = classic ? Math.floor((height - contentHeight) / 2) : 0;
    ctx.drawImage(transformed, x, y, contentWidth, contentHeight);
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
    // Unused low bits in the final byte of each row must stay off. Keeping
    // this explicit protects device uploads if the packing loop changes later.
    if (width % 8) {
      const usedBitsMask = (0xff << (8 - width % 8)) & 0xff;
      for (let row = 0; row < height; row++) {
        packed[(row + 1) * rowBytes - 1] &= usedBitsMask;
      }
    }
    const ditherName = ui.advancedEnabled.checked
      ? ui.ditherAlgorithm.options[ui.ditherAlgorithm.selectedIndex].text.split(' · ')[0]
      : 'Floyd–Steinberg';
    const conversion = ui.renderMode.value === 'dither' ? `${ditherName} dither` : 'Threshold';
    const sizing = locked ? 'Aspect ratio locked.' : 'Custom width and height applied.';
    ui.imageInfo.textContent = classic
      ? `${conversion} applied. ${sizing} Centered in the classic firmware's required 512 × 512 frame.`
      : (profile.placement
        ? `${conversion} applied. ${sizing} X/Y place it inside the ${max} × ${max} work area.`
        : `${conversion} applied. ${sizing} Positioned inside the ${max} × ${max} work area.`);
    packedBitmap = { width, height, pixels: bytesToBase64(packed) };
    preparedImageData = image;
    if (!classic) {
      const key = `${ui.protocol.value}:${imageRevision}:${width}x${height}`;
      ui.positionX.max = String(max - width);
      ui.positionY.max = String(max - height);
      if (placementKey !== key) {
        ui.positionX.value = String(Math.floor((max - width) / 2));
        ui.positionY.value = String(Math.floor((max - height) / 2));
        placementKey = key;
      }
      syncNumberInput(ui.positionX, ui.positionXNumber);
      syncNumberInput(ui.positionY, ui.positionYNumber);
      packedBitmap.left = Number(ui.positionX.value);
      packedBitmap.top = Number(ui.positionY.value);
    }
    renderPlacement();
    updateButtons();
  });
}

function renderPlacement() {
  if (!packedBitmap || !preparedImageData) return;
  const profile = protocolProfiles[ui.protocol.value];
  const classic = ui.protocol.value.startsWith('classic-');
  const canvasSize = profile.max_width;
  ui.preview.width = canvasSize; ui.preview.height = canvasSize;
  const ctx = ui.preview.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvasSize, canvasSize);
  const left = classic ? 0 : Number(ui.positionX.value);
  const top = classic ? 0 : Number(ui.positionY.value);
  ctx.putImageData(preparedImageData, left, top);
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
  if (!classic) {
    packedBitmap.left = left;
    packedBitmap.top = top;
    ui.positionXValue.textContent = `${left} px · ${(left * 38 / canvasSize).toFixed(1)} mm`;
    ui.positionYValue.textContent = `${top} px · ${(top * 38 / canvasSize).toFixed(1)} mm`;
    syncNumberInput(ui.positionX, ui.positionXNumber);
    syncNumberInput(ui.positionY, ui.positionYNumber);
  }
  updatePlacementHelp();
  const millimetersPerPixel = 38 / canvasSize;
  ui.dimensions.textContent = classic
    ? `512 × 512 px · 38 × 38 mm`
    : `${packedBitmap.width} × ${packedBitmap.height} px · ${(packedBitmap.width * millimetersPerPixel).toFixed(1)} × ${(packedBitmap.height * millimetersPerPixel).toFixed(1)} mm at (${left}, ${top})`;
  ui.preview.style.display = 'block'; ui.emptyPreview.style.display = 'none';
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
  ui.start.disabled = !connected || uploading || busy || !packedBitmap || capabilities().engrave === false;
  ui.outline.textContent = outlineActive ? 'Stop outline' : 'Low-power outline';
  ui.outline.disabled = !connected || uploading || busy || !capabilities().outline || (!outlineActive && !packedBitmap);
  ui.stop.disabled = !connected;
  const pointUnavailable = !connected || Boolean(latestStatus.device_running) || !packedBitmap || !capabilities().point;
  if (pointModeEnabled && pointUnavailable) {
    pointModeEnabled = false;
    updatePointModeUI();
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
}

function updatePointModeUI() {
  ui.pointMode.textContent = pointModeEnabled ? 'Disable click-to-move' : 'Enable click-to-move';
  ui.preview.classList.toggle('point-mode', pointModeEnabled);
  if (pointModeEnabled) {
    ui.pointHelp.textContent = laserPoint
      ? `Laser target: ${laserPoint.x}, ${laserPoint.y}. Click another point to move it.`
      : 'Click a point in the preview to move the idle positioning laser there.';
  } else {
    ui.pointHelp.textContent = laserPoint
      ? `Last laser target: ${laserPoint.x}, ${laserPoint.y}. Enable to move again.`
      : 'Click-to-move is off, preventing accidental movement.';
  }
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
    sourceImage = image;
    rotation = 0;
    flipX = false;
    flipY = false;
    for (const control of [ui.cropLeft, ui.cropRight, ui.cropTop, ui.cropBottom]) control.value = '0';
    updateTransformState();
    imageRevision += 1;
    sizeKey = '';
    placementKey = '';
    rebuildPreview();
    URL.revokeObjectURL(image.src);
  };
  image.onerror = () => showError(new Error('The browser could not decode that image.'));
  image.src = URL.createObjectURL(file);
});
ui.renderMode.addEventListener('change', () => { updateRenderModeUI(); rebuildPreview(); });
ui.threshold.addEventListener('input', () => { updateRenderModeUI(); rebuildPreview(); });
ui.invert.addEventListener('change', rebuildPreview);
ui.artworkWidth.addEventListener('input', () => { ui.artworkWidthNumber.value = ui.artworkWidth.value; rebuildPreview(); });
ui.artworkWidthNumber.addEventListener('change', () => applyNumberInput(ui.artworkWidth, ui.artworkWidthNumber, rebuildPreview));
ui.artworkHeight.addEventListener('input', () => { ui.artworkHeightNumber.value = ui.artworkHeight.value; rebuildPreview(); });
ui.artworkHeightNumber.addEventListener('change', () => applyNumberInput(ui.artworkHeight, ui.artworkHeightNumber, rebuildPreview));
ui.lockAspect.addEventListener('change', rebuildPreview);
ui.rotateLeft.addEventListener('click', () => {
  rotation = (rotation + 270) % 360;
  imageRevision += 1; sizeKey = ''; placementKey = '';
  updateTransformState(); rebuildPreview();
});
ui.rotateRight.addEventListener('click', () => {
  rotation = (rotation + 90) % 360;
  imageRevision += 1; sizeKey = ''; placementKey = '';
  updateTransformState(); rebuildPreview();
});
ui.flipHorizontal.addEventListener('click', () => {
  flipX = !flipX; imageRevision += 1;
  updateTransformState(); rebuildPreview();
});
ui.flipVertical.addEventListener('click', () => {
  flipY = !flipY; imageRevision += 1;
  updateTransformState(); rebuildPreview();
});
for (const cropControl of [ui.cropLeft, ui.cropRight, ui.cropTop, ui.cropBottom]) {
  cropControl.addEventListener('change', () => {
    cropValue(cropControl); imageRevision += 1; sizeKey = ''; placementKey = ''; rebuildPreview();
  });
}
ui.resetCrop.addEventListener('click', () => {
  for (const control of [ui.cropLeft, ui.cropRight, ui.cropTop, ui.cropBottom]) control.value = '0';
  imageRevision += 1; sizeKey = ''; placementKey = ''; rebuildPreview();
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
ui.positionX.addEventListener('input', () => { ui.positionXNumber.value = ui.positionX.value; renderPlacement(); });
ui.positionXNumber.addEventListener('change', () => applyNumberInput(ui.positionX, ui.positionXNumber, renderPlacement));
ui.positionY.addEventListener('input', () => { ui.positionYNumber.value = ui.positionY.value; renderPlacement(); });
ui.positionYNumber.addEventListener('change', () => applyNumberInput(ui.positionY, ui.positionYNumber, renderPlacement));
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
ui.pointMode.addEventListener('click', () => {
  pointModeEnabled = !pointModeEnabled;
  updatePointModeUI();
});
ui.preview.addEventListener('click', async event => {
  if (!pointModeEnabled || actionPending || ui.pointMode.disabled) return;
  const rect = ui.preview.getBoundingClientRect();
  const maximum = Number(capabilities().max_width);
  const x = Math.max(0, Math.min(maximum - 1, Math.floor((event.clientX - rect.left) * ui.preview.width / rect.width)));
  const y = Math.max(0, Math.min(maximum - 1, Math.floor((event.clientY - rect.top) * ui.preview.height / rect.height)));
  const previous = laserPoint;
  laserPoint = { x, y };
  renderPlacement();
  updatePointModeUI();
  if (!await ensureOutlineStopped() || !await ensurePrepared() || !await sendAction('point', { x, y })) {
    laserPoint = previous;
    renderPlacement();
    updatePointModeUI();
  }
});

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
    ui.cropLeft.value,
    ui.cropRight.value,
    ui.cropTop.value,
    ui.cropBottom.value,
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
  let left = Number(ui.positionX.value);
  let top = Number(ui.positionY.value);
  if (action === 'up') top -= step;
  if (action === 'down') top += step;
  if (action === 'left') left -= step;
  if (action === 'right') left += step;
  if (action === 'home') { left = 0; top = 0; }
  if (action === 'center') {
    left = Math.floor((Number(capabilities().max_width) - packedBitmap.width) / 2);
    top = Math.floor((Number(capabilities().max_height) - packedBitmap.height) / 2);
  }
  left = Math.max(0, Math.min(Number(ui.positionX.max), left));
  top = Math.max(0, Math.min(Number(ui.positionY.max), top));
  ui.positionX.value = String(left);
  ui.positionY.value = String(top);
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
updatePointModeUI();
refreshPorts().then(poll);
setInterval(poll, 800);
