/* ========================================
   Dual Lens — Application Logic
   ======================================== */
(function () {
  'use strict';

  // ── State ──────────────────────────────
  const V  = { scale: 1, ox: 0, oy: 0 };
  const VA = { scale: 1, ox: 0, oy: 0 };
  const VB = { scale: 1, ox: 0, oy: 0 };

  const G = {
    mode: 'normal',
    sync: false,
    diff: false,
    theme: 'light',
    splitX: 0.5,
    imageA: null,
    imageB: null,
    diffCache: null,
    dragging: null,
    dragStartX: 0,
    dragStartY: 0,
    dragStartOx: 0,
    dragStartOy: 0,
    draggingDivider: false,
  };

  let needsRender = true;
  let checkerPattern = null;
  let toastTimer = null;
  const DPR = window.devicePixelRatio || 1;

  // ── DOM References ─────────────────────
  const $toolbar     = document.getElementById('toolbar');
  const $viewport    = document.getElementById('viewport');
  const $paneA       = document.getElementById('pane-a');
  const $paneB       = document.getElementById('pane-b');
  const $paneOverlay = document.getElementById('pane-overlay');
  const $canvasA     = document.getElementById('canvas-a');
  const $canvasB     = document.getElementById('canvas-b');
  const $canvasO     = document.getElementById('canvas-overlay');
  const $dropA       = document.getElementById('drop-a');
  const $dropB       = document.getElementById('drop-b');
  const $fileA       = document.getElementById('file-a');
  const $fileB       = document.getElementById('file-b');
  const $divider     = document.getElementById('split-divider');
  const $btnNormal   = document.getElementById('btn-normal');
  const $btnSplit    = document.getElementById('btn-split');
  const $btnSync     = document.getElementById('btn-sync');
  const $btnDiff     = document.getElementById('btn-diff');
  const $btnZoomIn   = document.getElementById('btn-zoom-in');
  const $btnZoomOut  = document.getElementById('btn-zoom-out');
  const $btnReset    = document.getElementById('btn-reset');
  const $btnTheme    = document.getElementById('btn-theme');
  const $zoomLevel   = document.getElementById('zoom-level');
  const $statusA     = document.getElementById('status-a');
  const $statusB     = document.getElementById('status-b');
  const $statusDiff  = document.getElementById('status-diff');
  const $toast       = document.getElementById('toast');

  const ctxA = $canvasA.getContext('2d');
  const ctxB = $canvasB.getContext('2d');
  const ctxO = $canvasO.getContext('2d');

  // ── Helpers ────────────────────────────
  function getView(which) {
    if (G.mode === 'overlay' || G.sync) return V;
    return which === 'A' ? VA : VB;
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function copyView(src, dst) {
    dst.scale = src.scale;
    dst.ox = src.ox;
    dst.oy = src.oy;
  }

  function scheduleRender() { needsRender = true; }

  // ── Checkerboard ───────────────────────
  function makeCheckerboard() {
    const size = 8;
    const c = document.createElement('canvas');
    c.width = c.height = size * 2;
    const ctx = c.getContext('2d');
    const style = getComputedStyle(document.documentElement);
    const a = style.getPropertyValue('--checkerboard-a').trim();
    const b = style.getPropertyValue('--checkerboard-b').trim();
    ctx.fillStyle = b;
    ctx.fillRect(0, 0, size * 2, size * 2);
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, size, size);
    ctx.fillRect(size, size, size, size);
    checkerPattern = ctxA.createPattern(c, 'repeat');
  }

  // ── Toast ──────────────────────────────
  function showToast(msg) {
    $toast.textContent = msg;
    $toast.hidden = false;
    $toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      $toast.classList.remove('visible');
      setTimeout(() => { $toast.hidden = true; }, 200);
    }, 1200);
  }

  // ── Canvas Sizing ──────────────────────
  function sizeCanvas(canvas, container) {
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = w * DPR;
    canvas.height = h * DPR;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }

  function resizeAll() {
    if (G.mode === 'normal') {
      sizeCanvas($canvasA, $paneA);
      sizeCanvas($canvasB, $paneB);
    } else {
      sizeCanvas($canvasO, $paneOverlay);
    }
    scheduleRender();
  }

  const resizeObserver = new ResizeObserver(resizeAll);
  resizeObserver.observe($viewport);

  // ── Fit Image ──────────────────────────
  function fitImage(view, canvasW, canvasH, img) {
    if (!img) return;
    const s = Math.min(canvasW / img.width, canvasH / img.height, 1);
    view.scale = s;
    view.ox = (canvasW - img.width * s) / 2;
    view.oy = (canvasH - img.height * s) / 2;
  }

  function fitAll() {
    if (G.mode === 'normal') {
      const wA = $paneA.clientWidth;
      const hA = $paneA.clientHeight;
      const wB = $paneB.clientWidth;
      const hB = $paneB.clientHeight;
      if (G.sync) {
        const img = G.imageA || G.imageB;
        if (img) fitImage(V, wA, hA, img);
      } else {
        if (G.imageA) fitImage(VA, wA, hA, G.imageA);
        if (G.imageB) fitImage(VB, wB, hB, G.imageB);
      }
    } else {
      const w = $paneOverlay.clientWidth;
      const h = $paneOverlay.clientHeight;
      const img = G.imageA || G.imageB;
      if (img) fitImage(V, w, h, img);
    }
    scheduleRender();
  }

  // ── Zoom ───────────────────────────────
  function zoomAt(view, cx, cy, factor) {
    const newScale = clamp(view.scale * factor, 0.05, 20);
    const wx = (cx - view.ox) / view.scale;
    const wy = (cy - view.oy) / view.scale;
    view.ox = cx - wx * newScale;
    view.oy = cy - wy * newScale;
    view.scale = newScale;
  }

  function zoomCenter(factor) {
    if (G.mode === 'normal') {
      const cxA = $paneA.clientWidth / 2;
      const cyA = $paneA.clientHeight / 2;
      if (G.sync) {
        zoomAt(V, cxA, cyA, factor);
      } else {
        zoomAt(VA, cxA, cyA, factor);
        const cxB = $paneB.clientWidth / 2;
        const cyB = $paneB.clientHeight / 2;
        zoomAt(VB, cxB, cyB, factor);
      }
    } else {
      const cx = $paneOverlay.clientWidth / 2;
      const cy = $paneOverlay.clientHeight / 2;
      zoomAt(V, cx, cy, factor);
    }
    scheduleRender();
  }

  function updateZoomDisplay() {
    const v = G.mode === 'overlay' || G.sync ? V : VA;
    $zoomLevel.textContent = Math.round(v.scale * 100) + '%';
  }

  // ── Diff Computation ───────────────────
  function computeDiff() {
    if (!G.imageA || !G.imageB) {
      G.diffCache = null;
      return;
    }

    const w = Math.max(G.imageA.width, G.imageB.width);
    const h = Math.max(G.imageA.height, G.imageB.height);

    const tmpA = new OffscreenCanvas(w, h);
    const cA = tmpA.getContext('2d');
    cA.drawImage(G.imageA, 0, 0);
    const dataA = cA.getImageData(0, 0, w, h).data;

    const tmpB = new OffscreenCanvas(w, h);
    const cB = tmpB.getContext('2d');
    cB.drawImage(G.imageB, 0, 0);
    const dataB = cB.getImageData(0, 0, w, h).data;

    const diffCanvas = new OffscreenCanvas(w, h);
    const cD = diffCanvas.getContext('2d');
    const diffImg = cD.createImageData(w, h);
    const out = diffImg.data;

    let diffCount = 0;
    const total = w * h;
    const THRESHOLD = 5;

    for (let i = 0; i < dataA.length; i += 4) {
      const dr = Math.abs(dataA[i]     - dataB[i]);
      const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
      const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
      const maxD = Math.max(dr, dg, db);

      if (maxD > THRESHOLD) {
        diffCount++;
        out[i]     = 255;
        out[i + 1] = 50;
        out[i + 2] = 50;
        out[i + 3] = Math.min(255, maxD * 2);
      }
    }

    cD.putImageData(diffImg, 0, 0);

    G.diffCache = {
      canvas: diffCanvas,
      percentage: ((diffCount / total) * 100).toFixed(2),
    };
  }

  // ── Pixel Grid ─────────────────────────
  function drawPixelGrid(ctx, view, imgW, imgH, canvasW, canvasH) {
    const s = view.scale;
    const ox = view.ox;
    const oy = view.oy;

    const xStart = Math.max(0, Math.floor(-ox / s));
    const xEnd   = Math.min(imgW, Math.ceil((canvasW - ox) / s));
    const yStart = Math.max(0, Math.floor(-oy / s));
    const yEnd   = Math.min(imgH, Math.ceil((canvasH - oy) / s));

    ctx.save();
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)';
    ctx.lineWidth = 1 / s;
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    ctx.beginPath();
    for (let x = xStart; x <= xEnd; x++) {
      ctx.moveTo(x, yStart);
      ctx.lineTo(x, yEnd);
    }
    for (let y = yStart; y <= yEnd; y++) {
      ctx.moveTo(xStart, y);
      ctx.lineTo(xEnd, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── Rendering ──────────────────────────
  function renderPane(ctx, canvas, image, view) {
    const w = canvas.width / DPR;
    const h = canvas.height / DPR;

    ctx.save();
    ctx.scale(DPR, DPR);

    // Clear
    ctx.clearRect(0, 0, w, h);

    if (!image) {
      ctx.restore();
      return;
    }

    // Checkerboard behind image area
    if (checkerPattern) {
      ctx.save();
      ctx.translate(view.ox, view.oy);
      ctx.scale(view.scale, view.scale);
      ctx.fillStyle = checkerPattern;
      ctx.setTransform(DPR, 0, 0, DPR, view.ox * DPR, view.oy * DPR);
      ctx.fillRect(0, 0, image.width * view.scale, image.height * view.scale);
      ctx.restore();
    }

    // Image
    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.scale, view.scale);
    ctx.imageSmoothingEnabled = view.scale <= 2;
    ctx.drawImage(image, 0, 0);
    ctx.restore();

    // Diff overlay
    if (G.diff && G.diffCache) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.translate(view.ox, view.oy);
      ctx.scale(view.scale, view.scale);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(G.diffCache.canvas, 0, 0);
      ctx.restore();
    }

    // Pixel grid
    if (view.scale > 8) {
      drawPixelGrid(ctx, view, image.width, image.height, w, h);
    }

    ctx.restore();
  }

  function renderOverlay() {
    const w = $canvasO.width / DPR;
    const h = $canvasO.height / DPR;
    const divPx = G.splitX * w;

    ctxO.save();
    ctxO.scale(DPR, DPR);
    ctxO.clearRect(0, 0, w, h);

    const img = G.imageA || G.imageB;
    if (!img) {
      ctxO.restore();
      return;
    }

    // Checkerboard
    if (checkerPattern) {
      ctxO.save();
      ctxO.setTransform(DPR, 0, 0, DPR, V.ox * DPR, V.oy * DPR);
      const cw = (img ? img.width : 0) * V.scale;
      const ch = (img ? img.height : 0) * V.scale;
      ctxO.fillStyle = checkerPattern;
      ctxO.fillRect(0, 0, cw, ch);
      ctxO.restore();
    }

    // Image A (left side)
    if (G.imageA) {
      ctxO.save();
      ctxO.beginPath();
      ctxO.rect(0, 0, divPx, h);
      ctxO.clip();
      ctxO.translate(V.ox, V.oy);
      ctxO.scale(V.scale, V.scale);
      ctxO.imageSmoothingEnabled = V.scale <= 2;
      ctxO.drawImage(G.imageA, 0, 0);
      ctxO.restore();
    }

    // Image B (right side)
    if (G.imageB) {
      ctxO.save();
      ctxO.beginPath();
      ctxO.rect(divPx, 0, w - divPx, h);
      ctxO.clip();
      ctxO.translate(V.ox, V.oy);
      ctxO.scale(V.scale, V.scale);
      ctxO.imageSmoothingEnabled = V.scale <= 2;
      ctxO.drawImage(G.imageB, 0, 0);
      ctxO.restore();
    }

    // Diff overlay
    if (G.diff && G.diffCache) {
      ctxO.save();
      ctxO.globalCompositeOperation = 'screen';
      ctxO.translate(V.ox, V.oy);
      ctxO.scale(V.scale, V.scale);
      ctxO.imageSmoothingEnabled = false;
      ctxO.drawImage(G.diffCache.canvas, 0, 0);
      ctxO.restore();
    }

    // Pixel grid
    if (V.scale > 8) {
      drawPixelGrid(ctxO, V, img.width, img.height, w, h);
    }

    ctxO.restore();

    // Divider position
    $divider.style.left = (G.splitX * 100) + '%';
  }

  function render() {
    if (G.mode === 'normal') {
      renderPane(ctxA, $canvasA, G.imageA, getView('A'));
      renderPane(ctxB, $canvasB, G.imageB, getView('B'));
    } else {
      renderOverlay();
    }
    updateZoomDisplay();
    updateStatusBar();
  }

  function renderLoop() {
    if (needsRender) {
      needsRender = false;
      render();
    }
    requestAnimationFrame(renderLoop);
  }

  // ── Status Bar ─────────────────────────
  function updateStatusBar() {
    if (G.imageA) {
      $statusA.textContent = 'A: ' + G.imageA.width + '×' + G.imageA.height;
    } else {
      $statusA.textContent = 'No image';
    }
    if (G.imageB) {
      $statusB.textContent = 'B: ' + G.imageB.width + '×' + G.imageB.height;
    } else {
      $statusB.textContent = 'No image';
    }
    if (G.diff && G.diffCache) {
      $statusDiff.textContent = 'Diff: ' + G.diffCache.percentage + '%';
      $statusDiff.hidden = false;
    } else {
      $statusDiff.hidden = true;
    }
  }

  // ── Image Loading ──────────────────────
  function loadImage(file, which) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      if (which === 'A') {
        G.imageA = img;
        $dropA.classList.add('hidden');
        const view = getView('A');
        fitImage(view, $paneA.clientWidth, $paneA.clientHeight, img);
      } else {
        G.imageB = img;
        $dropB.classList.add('hidden');
        const view = getView('B');
        fitImage(view, $paneB.clientWidth, $paneB.clientHeight, img);
      }
      G.diffCache = null;
      if (G.diff && G.imageA && G.imageB) computeDiff();
      scheduleRender();
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  // ── Drop Zone Events ──────────────────
  function setupDropZone(dropEl, fileInput, which) {
    dropEl.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) loadImage(e.target.files[0], which);
      e.target.value = '';
    });

    dropEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropEl.classList.add('drag-over');
    });

    dropEl.addEventListener('dragleave', () => {
      dropEl.classList.remove('drag-over');
    });

    dropEl.addEventListener('drop', (e) => {
      e.preventDefault();
      dropEl.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0], which);
    });
  }

  setupDropZone($dropA, $fileA, 'A');
  setupDropZone($dropB, $fileB, 'B');

  // ── Pointer Pan ────────────────────────
  function setupPan(canvas, which) {
    canvas.addEventListener('pointerdown', (e) => {
      if (G.draggingDivider) return;
      if (e.button !== 0) return;
      const view = getView(which);
      G.dragging = which;
      G.dragStartX = e.clientX;
      G.dragStartY = e.clientY;
      G.dragStartOx = view.ox;
      G.dragStartOy = view.oy;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });

    canvas.addEventListener('pointermove', (e) => {
      if (G.dragging !== which) return;
      const view = getView(which);
      view.ox = G.dragStartOx + (e.clientX - G.dragStartX);
      view.oy = G.dragStartOy + (e.clientY - G.dragStartY);
      scheduleRender();
    });

    canvas.addEventListener('pointerup', (e) => {
      if (G.dragging === which) {
        G.dragging = null;
        canvas.releasePointerCapture(e.pointerId);
        canvas.style.cursor = '';
      }
    });
  }

  setupPan($canvasA, 'A');
  setupPan($canvasB, 'B');

  // Overlay canvas pan
  $canvasO.addEventListener('pointerdown', (e) => {
    if (G.draggingDivider) return;
    if (e.button !== 0) return;
    G.dragging = 'O';
    G.dragStartX = e.clientX;
    G.dragStartY = e.clientY;
    G.dragStartOx = V.ox;
    G.dragStartOy = V.oy;
    $canvasO.setPointerCapture(e.pointerId);
    $canvasO.style.cursor = 'grabbing';
  });

  $canvasO.addEventListener('pointermove', (e) => {
    if (G.dragging !== 'O') return;
    V.ox = G.dragStartOx + (e.clientX - G.dragStartX);
    V.oy = G.dragStartOy + (e.clientY - G.dragStartY);
    scheduleRender();
  });

  $canvasO.addEventListener('pointerup', (e) => {
    if (G.dragging === 'O') {
      G.dragging = null;
      $canvasO.releasePointerCapture(e.pointerId);
      $canvasO.style.cursor = '';
    }
  });

  // ── Wheel Zoom ─────────────────────────
  function handleWheel(e, which) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = e.target.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    if (G.mode === 'overlay') {
      zoomAt(V, cx, cy, factor);
    } else if (G.sync) {
      zoomAt(V, cx, cy, factor);
    } else {
      zoomAt(which === 'A' ? VA : VB, cx, cy, factor);
    }
    scheduleRender();
  }

  $canvasA.addEventListener('wheel', (e) => handleWheel(e, 'A'), { passive: false });
  $canvasB.addEventListener('wheel', (e) => handleWheel(e, 'B'), { passive: false });
  $canvasO.addEventListener('wheel', (e) => handleWheel(e, 'O'), { passive: false });

  // ── Split Divider Drag ─────────────────
  $divider.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    G.draggingDivider = true;
    $divider.setPointerCapture(e.pointerId);
  });

  $divider.addEventListener('pointermove', (e) => {
    if (!G.draggingDivider) return;
    const rect = $paneOverlay.getBoundingClientRect();
    G.splitX = clamp((e.clientX - rect.left) / rect.width, 0.05, 0.95);
    scheduleRender();
  });

  $divider.addEventListener('pointerup', (e) => {
    G.draggingDivider = false;
    $divider.releasePointerCapture(e.pointerId);
  });

  // ── Mode Switching ─────────────────────
  function setMode(mode) {
    G.mode = mode;

    if (mode === 'normal') {
      $paneOverlay.hidden = true;
      $paneA.style.display = '';
      $paneB.style.display = '';
      $btnNormal.setAttribute('aria-pressed', 'true');
      $btnNormal.classList.replace('btn-secondary', 'btn-primary');
      $btnSplit.setAttribute('aria-pressed', 'false');
      $btnSplit.classList.replace('btn-primary', 'btn-secondary');
      if (!G.sync) {
        copyView(V, VA);
        copyView(V, VB);
      }
    } else {
      $paneA.style.display = 'none';
      $paneB.style.display = 'none';
      $paneOverlay.hidden = false;
      $btnSplit.setAttribute('aria-pressed', 'true');
      $btnSplit.classList.replace('btn-secondary', 'btn-primary');
      $btnNormal.setAttribute('aria-pressed', 'false');
      $btnNormal.classList.replace('btn-primary', 'btn-secondary');
      copyView(VA, V);
      G.sync = true;
      $btnSync.setAttribute('aria-pressed', 'true');
    }

    resizeAll();
  }

  function toggleSync() {
    if (G.mode === 'overlay') return;
    G.sync = !G.sync;
    $btnSync.setAttribute('aria-pressed', G.sync ? 'true' : 'false');
    if (G.sync) {
      copyView(VA, V);
    } else {
      copyView(V, VA);
      copyView(V, VB);
    }
    scheduleRender();
  }

  function toggleDiff() {
    G.diff = !G.diff;
    $btnDiff.setAttribute('aria-pressed', G.diff ? 'true' : 'false');
    if (G.diff && !G.diffCache && G.imageA && G.imageB) {
      computeDiff();
    }
    scheduleRender();
  }

  // ── Theme ──────────────────────────────
  function toggleTheme() {
    G.theme = G.theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', G.theme);
    makeCheckerboard();
    scheduleRender();
  }

  // ── Toolbar Button Events ──────────────
  $btnNormal.addEventListener('click', () => { setMode('normal'); showToast('Normal mode'); });
  $btnSplit.addEventListener('click', () => { setMode('overlay'); showToast('Split mode'); });
  $btnSync.addEventListener('click', () => { toggleSync(); showToast('Sync ' + (G.sync ? 'ON' : 'OFF')); });
  $btnDiff.addEventListener('click', () => { toggleDiff(); showToast('Diff ' + (G.diff ? 'ON' : 'OFF')); });
  $btnZoomIn.addEventListener('click', () => zoomCenter(1.2));
  $btnZoomOut.addEventListener('click', () => zoomCenter(0.8));
  $btnReset.addEventListener('click', fitAll);
  $btnTheme.addEventListener('click', () => { toggleTheme(); showToast(G.theme === 'dark' ? 'Dark theme' : 'Light theme'); });

  // ── Keyboard Shortcuts ─────────────────
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case '+':
      case '=':
        e.preventDefault();
        zoomCenter(1.2);
        showToast('Zoom in');
        break;
      case '-':
        e.preventDefault();
        zoomCenter(0.8);
        showToast('Zoom out');
        break;
      case 'r':
      case 'R':
        e.preventDefault();
        fitAll();
        showToast('Fit to view');
        break;
      case 'd':
      case 'D':
        e.preventDefault();
        toggleDiff();
        showToast('Diff ' + (G.diff ? 'ON' : 'OFF'));
        break;
      case 's':
      case 'S':
        e.preventDefault();
        setMode(G.mode === 'normal' ? 'overlay' : 'normal');
        showToast(G.mode === 'overlay' ? 'Split mode' : 'Normal mode');
        break;
      case 'y':
      case 'Y':
        e.preventDefault();
        toggleSync();
        showToast('Sync ' + (G.sync ? 'ON' : 'OFF'));
        break;
    }
  });

  // ── Prevent default drag on viewport ───
  $viewport.addEventListener('dragover', (e) => e.preventDefault());
  $viewport.addEventListener('drop', (e) => e.preventDefault());

  // ── Init ───────────────────────────────
  makeCheckerboard();
  resizeAll();
  requestAnimationFrame(renderLoop);

})();
