/* ========================================
   Dual Lens — Application Logic
   ======================================== */
(function () {
  'use strict';

  // ── State ──────────────────────────────
  const V  = { scale: 1, ox: 0, oy: 0 };  // shared / overlay view
  const VA = { scale: 1, ox: 0, oy: 0 };  // pane A view (unsynced)
  const VB = { scale: 1, ox: 0, oy: 0 };  // pane B view (unsynced)

  // A slot holds whatever is currently being compared. `img` is the drawable
  // surface — an <img> for bitmaps, a <canvas> for the rasterised PDF page —
  // so everything downstream (render, diff, inspector) stays format-agnostic.
  function emptySlot() {
    return {
      img: null, src: null, name: null, size: 0,
      kind: 'image',   // 'image' | 'pdf'
      pdf: null,       // PDFDocumentProxy, when kind is 'pdf'
      page: 1,         // 1-based page currently rasterised
      pages: 1,        // total pages in the document
      token: 0,        // guards against out-of-order async renders
    };
  }

  const slots = { A: emptySlot(), B: emptySlot() };

  // Monotonic across slots and clears, so a load that resolves late can never
  // be mistaken for the current one.
  let loadToken = 0;

  // Async work follows the slot *object*: swapping A and B moves the object,
  // so a file dropped on A still lands wherever A's content went.
  function claimSlot(which) {
    slots[which].token = ++loadToken;
    return slots[which].token;
  }

  // Which pane a slot currently occupies, or null once it has been cleared.
  function slotKey(slot) {
    if (slots.A === slot) return 'A';
    if (slots.B === slot) return 'B';
    return null;
  }

  const G = {
    mode: 'normal',        // 'normal' | 'split' | 'fade'
    sync: false,           // user preference; forced on in overlay modes
    diff: false,
    inspect: false,
    theme: 'dark',
    splitX: 0.5,
    opacity: 50,           // fade mode: weight of image B
    threshold: 5,          // diff sensitivity
    diffCache: null,
    hoverSlot: 'A',
    cursor: null,
    draggingDivider: false,
  };

  let needsRender = true;
  let checkerPattern = null;
  let toastTimer = null;
  const DPR = window.devicePixelRatio || 1;

  // ── DOM References ─────────────────────
  const $ = (id) => document.getElementById(id);

  const $viewport    = $('viewport');
  const $paneA       = $('pane-a');
  const $paneB       = $('pane-b');
  const $paneOverlay = $('pane-overlay');
  const $canvasA     = $('canvas-a');
  const $canvasB     = $('canvas-b');
  const $canvasO     = $('canvas-overlay');
  const $dropA       = $('drop-a');
  const $dropB       = $('drop-b');
  const $fileA       = $('file-a');
  const $fileB       = $('file-b');
  const $divider     = $('split-divider');
  const $overlayEmpty= $('overlay-empty');
  const $legendA     = $('legend-a');
  const $legendB     = $('legend-b');

  const $btnSync     = $('btn-sync');
  const $btnDiff     = $('btn-diff');
  const $btnInspect  = $('btn-inspect');
  const $btnOpenA    = $('btn-open-a');
  const $btnOpenB    = $('btn-open-b');
  const $btnSwap     = $('btn-swap');
  const $btnZoomIn   = $('btn-zoom-in');
  const $btnZoomOut  = $('btn-zoom-out');
  const $btnZoomLvl  = $('btn-zoom-level');
  const $btnReset    = $('btn-reset');
  const $btnTheme    = $('btn-theme');
  const $btnHelp     = $('btn-help');
  const $btnHelpClose= $('btn-help-close');

  const $contextBar  = $('context-bar');
  const $ctxFade     = $('ctx-fade');
  const $ctxDiff     = $('ctx-diff');
  const $opacity     = $('opacity-slider');
  const $opacityVal  = $('opacity-value');
  const $ctxPages    = $('ctx-pages');
  const $pageNav     = { A: $('page-nav-a'), B: $('page-nav-b') };
  const $pageInput   = { A: $('page-input-a'), B: $('page-input-b') };
  const $pageTotal   = { A: $('page-total-a'), B: $('page-total-b') };
  const $threshold   = $('threshold-slider');
  const $thresholdVal= $('threshold-value');
  const $diffBusy    = $('diff-busy');

  const $statusA     = $('status-a');
  const $statusB     = $('status-b');
  const $statusDiff  = $('status-diff');
  const $pixelRead   = $('pixel-readout');
  const $pxCoord     = $('px-coord');
  const $pxA         = $('px-a');
  const $pxB         = $('px-b');
  const $pxSwA       = $('px-sw-a');
  const $pxSwB       = $('px-sw-b');
  const $pxDelta     = $('px-delta');

  const $dragOverlay = $('drag-overlay');
  const $zoomMenu    = $('zoom-menu');
  const $helpOverlay = $('help-overlay');
  const $toast       = $('toast');

  const modeButtons = Array.prototype.slice.call(
    document.querySelectorAll('#toolbar [data-mode]')
  );

  const ctxA = $canvasA.getContext('2d');
  const ctxB = $canvasB.getContext('2d');
  const ctxO = $canvasO.getContext('2d');

  // ── Helpers ────────────────────────────
  function isOverlayMode() { return G.mode !== 'normal'; }
  function effectiveSync() { return isOverlayMode() ? true : G.sync; }

  function getView(which) {
    if (which === 'O' || effectiveSync()) return V;
    return which === 'A' ? VA : VB;
  }

  function activeView() { return isOverlayMode() || G.sync ? V : VA; }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function formatSize(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // Last viewport a view was laid out against, so resizes and mode switches can
  // keep the image anchored instead of letting it drift off-screen.
  const viewBox = new WeakMap();

  function copyView(src, dst) {
    dst.scale = src.scale;
    dst.ox = src.ox;
    dst.oy = src.oy;
    const box = viewBox.get(src);
    if (box) viewBox.set(dst, { w: box.w, h: box.h });
  }

  function anchorView(view, pane) {
    const w = pane.clientWidth;
    const h = pane.clientHeight;
    if (!w || !h) return;
    const prev = viewBox.get(view);
    if (prev && prev.w && prev.h) {
      view.ox += (w - prev.w) / 2;
      view.oy += (h - prev.h) / 2;
    }
    viewBox.set(view, { w: w, h: h });
  }

  function scheduleRender() { needsRender = true; }

  function bothLoaded() { return !!(slots.A.img && slots.B.img); }
  function anyLoaded()  { return !!(slots.A.img || slots.B.img); }

  function hex(c) {
    return '#' + [c[0], c[1], c[2]]
      .map((v) => v.toString(16).padStart(2, '0').toUpperCase())
      .join('');
  }

  // ── Preferences ────────────────────────
  const PREFS_KEY = 'dual-lens:prefs';

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
    catch (err) { return {}; }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        theme: G.theme, mode: G.mode, sync: G.sync, diff: G.diff,
        inspect: G.inspect, splitX: G.splitX, opacity: G.opacity,
        threshold: G.threshold,
      }));
    } catch (err) { /* storage unavailable — preferences stay session-only */ }
  }

  // ── Checkerboard ───────────────────────
  function makeCheckerboard() {
    const size = 8;
    const c = document.createElement('canvas');
    c.width = c.height = size * 2;
    const ctx = c.getContext('2d');
    const style = getComputedStyle(document.documentElement);
    ctx.fillStyle = style.getPropertyValue('--checkerboard-b').trim();
    ctx.fillRect(0, 0, size * 2, size * 2);
    ctx.fillStyle = style.getPropertyValue('--checkerboard-a').trim();
    ctx.fillRect(0, 0, size, size);
    ctx.fillRect(size, size, size, size);
    checkerPattern = ctxA.createPattern(c, 'repeat');
  }

  // ── Toast ──────────────────────────────
  function showToast(msg, isError) {
    $toast.textContent = msg;
    $toast.classList.toggle('error', !!isError);
    $toast.hidden = false;
    // Force a reflow so the transition replays on back-to-back toasts.
    void $toast.offsetWidth;
    $toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      $toast.classList.remove('visible');
      setTimeout(() => { $toast.hidden = true; }, 200);
    }, isError ? 2600 : 1400);
  }

  // ── Canvas Sizing ──────────────────────
  function sizeCanvas(canvas, container) {
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = Math.max(1, Math.round(w * DPR));
    canvas.height = Math.max(1, Math.round(h * DPR));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }

  function resizeAll() {
    if (G.mode === 'normal') {
      sizeCanvas($canvasA, $paneA);
      sizeCanvas($canvasB, $paneB);
      if (G.sync) {
        anchorView(V, $paneA);
      } else {
        anchorView(VA, $paneA);
        anchorView(VB, $paneB);
      }
    } else {
      sizeCanvas($canvasO, $paneOverlay);
      anchorView(V, $paneOverlay);
    }
    scheduleRender();
  }

  new ResizeObserver(resizeAll).observe($viewport);

  // ── Fit & Zoom ─────────────────────────
  function fitImage(view, canvasW, canvasH, img) {
    if (!img || !canvasW || !canvasH) return;
    const s = Math.min(canvasW / img.width, canvasH / img.height, 1);
    view.scale = s;
    view.ox = (canvasW - img.width * s) / 2;
    view.oy = (canvasH - img.height * s) / 2;
    viewBox.set(view, { w: canvasW, h: canvasH });
  }

  function paneFor(which) {
    if (isOverlayMode()) return $paneOverlay;
    return which === 'A' ? $paneA : $paneB;
  }

  function fitSlot(which) {
    const img = slots[which].img;
    if (!img) return;
    const pane = paneFor(which);
    fitImage(getView(which), pane.clientWidth, pane.clientHeight, img);
    scheduleRender();
  }

  function fitAll() {
    if (isOverlayMode()) {
      const img = slots.A.img || slots.B.img;
      if (img) fitImage(V, $paneOverlay.clientWidth, $paneOverlay.clientHeight, img);
    } else if (G.sync) {
      const img = slots.A.img || slots.B.img;
      if (img) fitImage(V, $paneA.clientWidth, $paneA.clientHeight, img);
    } else {
      if (slots.A.img) fitImage(VA, $paneA.clientWidth, $paneA.clientHeight, slots.A.img);
      if (slots.B.img) fitImage(VB, $paneB.clientWidth, $paneB.clientHeight, slots.B.img);
    }
    scheduleRender();
  }

  function zoomAt(view, cx, cy, factor) {
    const newScale = clamp(view.scale * factor, 0.05, 32);
    const wx = (cx - view.ox) / view.scale;
    const wy = (cy - view.oy) / view.scale;
    view.ox = cx - wx * newScale;
    view.oy = cy - wy * newScale;
    view.scale = newScale;
  }

  function forEachActiveView(fn) {
    if (isOverlayMode()) {
      fn(V, $paneOverlay);
    } else if (G.sync) {
      fn(V, $paneA);
    } else {
      fn(VA, $paneA);
      fn(VB, $paneB);
    }
  }

  function zoomCenter(factor) {
    forEachActiveView((view, pane) => {
      zoomAt(view, pane.clientWidth / 2, pane.clientHeight / 2, factor);
    });
    scheduleRender();
  }

  function setZoom(scale) {
    forEachActiveView((view, pane) => {
      zoomAt(view, pane.clientWidth / 2, pane.clientHeight / 2, scale / view.scale);
    });
    scheduleRender();
  }

  function toggleActualSize() {
    if (Math.abs(activeView().scale - 1) < 0.001) {
      fitAll();
      showToast('Fit to view');
    } else {
      setZoom(1);
      showToast('100%');
    }
  }

  function updateZoomDisplay() {
    $btnZoomLvl.textContent = Math.round(activeView().scale * 100) + '%';
  }

  // ── Diff Computation ───────────────────
  const WORKER_SRC = [
    'self.onmessage = function (e) {',
    '  var d = e.data;',
    '  var A = new Uint8ClampedArray(d.a), B = new Uint8ClampedArray(d.b);',
    '  var out = new Uint8ClampedArray(A.length), count = 0, t = d.threshold;',
    '  for (var i = 0; i < A.length; i += 4) {',
    '    var dr = A[i] - B[i]; if (dr < 0) dr = -dr;',
    '    var dg = A[i+1] - B[i+1]; if (dg < 0) dg = -dg;',
    '    var db = A[i+2] - B[i+2]; if (db < 0) db = -db;',
    '    var m = dr > dg ? dr : dg; if (db > m) m = db;',
    '    if (m > t) {',
    '      count++;',
    '      out[i] = 255; out[i+1] = 50; out[i+2] = 50;',
    '      out[i+3] = m * 3 > 255 ? 255 : m * 3;',
    '    }',
    '  }',
    '  self.postMessage({ out: out.buffer, count: count, id: d.id }, [out.buffer]);',
    '};',
  ].join('\n');

  let diffWorker = null;
  let workerUnavailable = false;
  let diffToken = 0;
  let pendingDiff = null;
  let diffTimer = null;

  function getWorker() {
    if (diffWorker || workerUnavailable) return diffWorker;
    try {
      const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
      diffWorker = new Worker(URL.createObjectURL(blob));
      diffWorker.onmessage = (ev) => {
        if (!pendingDiff || ev.data.id !== pendingDiff.id) return;
        applyDiffResult(new Uint8ClampedArray(ev.data.out), ev.data.count,
                        pendingDiff.w, pendingDiff.h);
      };
      diffWorker.onerror = () => {
        workerUnavailable = true;
        diffWorker = null;
        setDiffBusy(false);
      };
    } catch (err) {
      workerUnavailable = true;
      diffWorker = null;
    }
    return diffWorker;
  }

  function setDiffBusy(busy) {
    $diffBusy.hidden = !busy;
  }

  function imageDataFor(img, w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, w, h);
  }

  function applyDiffResult(bytes, count, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').putImageData(new ImageData(bytes, w, h), 0, 0);
    G.diffCache = {
      canvas: canvas,
      percentage: ((count / (w * h)) * 100).toFixed(2),
      pixels: count,
    };
    pendingDiff = null;
    setDiffBusy(false);
    scheduleRender();
  }

  function computeDiff() {
    if (!bothLoaded()) {
      G.diffCache = null;
      pendingDiff = null;
      setDiffBusy(false);
      scheduleRender();
      return;
    }

    const w = Math.max(slots.A.img.width, slots.B.img.width);
    const h = Math.max(slots.A.img.height, slots.B.img.height);
    const dataA = imageDataFor(slots.A.img, w, h).data;
    const dataB = imageDataFor(slots.B.img, w, h).data;
    const id = ++diffToken;

    const worker = getWorker();
    if (worker) {
      pendingDiff = { id: id, w: w, h: h };
      setDiffBusy(true);
      worker.postMessage(
        { a: dataA.buffer, b: dataB.buffer, threshold: G.threshold, id: id },
        [dataA.buffer, dataB.buffer]
      );
      return;
    }

    // Fallback: no worker available, compute on the main thread.
    const out = new Uint8ClampedArray(dataA.length);
    let count = 0;
    for (let i = 0; i < dataA.length; i += 4) {
      const dr = Math.abs(dataA[i] - dataB[i]);
      const dg = Math.abs(dataA[i + 1] - dataB[i + 1]);
      const db = Math.abs(dataA[i + 2] - dataB[i + 2]);
      const m = Math.max(dr, dg, db);
      if (m > G.threshold) {
        count++;
        out[i] = 255; out[i + 1] = 50; out[i + 2] = 50;
        out[i + 3] = Math.min(255, m * 3);
      }
    }
    pendingDiff = { id: id, w: w, h: h };
    applyDiffResult(out, count, w, h);
  }

  function scheduleDiff() {
    clearTimeout(diffTimer);
    if (!G.diff) return;
    setDiffBusy(true);
    diffTimer = setTimeout(computeDiff, 120);
  }

  function invalidateDiff() {
    G.diffCache = null;
    pendingDiff = null;
    if (G.diff && bothLoaded()) scheduleDiff();
    else setDiffBusy(false);
  }

  // ── Pixel Inspector ────────────────────
  function makeSourceCanvas(img) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return ctx;
  }

  function samplePixel(which, x, y) {
    const slot = slots[which];
    if (!slot.src || !slot.img) return null;
    if (x < 0 || y < 0 || x >= slot.img.width || y >= slot.img.height) return null;
    try { return slot.src.getImageData(x, y, 1, 1).data; }
    catch (err) { return null; }
  }

  function updateCursor(e, canvas, which) {
    if (!G.inspect) return;
    const view = getView(which);
    const rect = canvas.getBoundingClientRect();
    G.cursor = {
      x: Math.floor((e.clientX - rect.left - view.ox) / view.scale),
      y: Math.floor((e.clientY - rect.top - view.oy) / view.scale),
    };
    scheduleRender();
  }

  function clearCursor() {
    if (!G.cursor) return;
    G.cursor = null;
    scheduleRender();
  }

  function renderInspector() {
    if (!G.inspect || !G.cursor || !anyLoaded()) {
      $pixelRead.hidden = true;
      return;
    }

    const px = samplePixel('A', G.cursor.x, G.cursor.y);
    const py = samplePixel('B', G.cursor.x, G.cursor.y);
    if (!px && !py) {
      $pixelRead.hidden = true;
      return;
    }

    $pixelRead.hidden = false;
    $pxCoord.textContent = G.cursor.x + ', ' + G.cursor.y;

    $pxA.textContent = px ? hex(px) : '—';
    $pxSwA.style.background = px ? hex(px) : 'transparent';
    $pxB.textContent = py ? hex(py) : '—';
    $pxSwB.style.background = py ? hex(py) : 'transparent';

    if (px && py) {
      const d = Math.max(
        Math.abs(px[0] - py[0]),
        Math.abs(px[1] - py[1]),
        Math.abs(px[2] - py[2])
      );
      $pxDelta.textContent = 'Δ' + d;
      $pxDelta.style.color = d > 0 ? 'var(--color-warning)' : 'var(--text-secondary)';
    } else {
      $pxDelta.textContent = '';
    }
  }

  // ── Rendering ──────────────────────────
  function paintChecker(ctx, view, img) {
    if (!checkerPattern) return;
    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.fillStyle = checkerPattern;
    ctx.fillRect(0, 0, img.width * view.scale, img.height * view.scale);
    ctx.restore();
  }

  function paintImage(ctx, img, view) {
    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.scale, view.scale);
    ctx.imageSmoothingEnabled = view.scale <= 2;
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  function paintDiff(ctx, view) {
    if (!G.diff || !G.diffCache) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.scale, view.scale);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(G.diffCache.canvas, 0, 0);
    ctx.restore();
  }

  function drawPixelGrid(ctx, view, imgW, imgH, canvasW, canvasH) {
    const s = view.scale;
    const xStart = Math.max(0, Math.floor(-view.ox / s));
    const xEnd   = Math.min(imgW, Math.ceil((canvasW - view.ox) / s));
    const yStart = Math.max(0, Math.floor(-view.oy / s));
    const yEnd   = Math.min(imgH, Math.ceil((canvasH - view.oy) / s));

    ctx.save();
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)';
    ctx.lineWidth = 1 / s;
    ctx.translate(view.ox, view.oy);
    ctx.scale(s, s);
    ctx.beginPath();
    for (let x = xStart; x <= xEnd; x++) { ctx.moveTo(x, yStart); ctx.lineTo(x, yEnd); }
    for (let y = yStart; y <= yEnd; y++) { ctx.moveTo(xStart, y); ctx.lineTo(xEnd, y); }
    ctx.stroke();
    ctx.restore();
  }

  function renderPane(ctx, canvas, image, view) {
    const w = canvas.width / DPR;
    const h = canvas.height / DPR;

    ctx.save();
    ctx.scale(DPR, DPR);
    ctx.clearRect(0, 0, w, h);

    if (!image) { ctx.restore(); return; }

    paintChecker(ctx, view, image);
    paintImage(ctx, image, view);
    paintDiff(ctx, view);
    if (view.scale > 8) drawPixelGrid(ctx, view, image.width, image.height, w, h);

    ctx.restore();
  }

  function renderOverlay() {
    const w = $canvasO.width / DPR;
    const h = $canvasO.height / DPR;

    $divider.style.left = (G.splitX * 100) + '%';

    ctxO.save();
    ctxO.scale(DPR, DPR);
    ctxO.clearRect(0, 0, w, h);

    const img = slots.A.img || slots.B.img;
    if (!img) { ctxO.restore(); return; }

    paintChecker(ctxO, V, img);

    if (G.mode === 'split') {
      const divPx = G.splitX * w;
      if (slots.A.img) {
        ctxO.save();
        ctxO.beginPath();
        ctxO.rect(0, 0, divPx, h);
        ctxO.clip();
        paintImage(ctxO, slots.A.img, V);
        ctxO.restore();
      }
      if (slots.B.img) {
        ctxO.save();
        ctxO.beginPath();
        ctxO.rect(divPx, 0, w - divPx, h);
        ctxO.clip();
        paintImage(ctxO, slots.B.img, V);
        ctxO.restore();
      }
    } else {
      if (slots.A.img) paintImage(ctxO, slots.A.img, V);
      if (slots.B.img) {
        ctxO.save();
        ctxO.globalAlpha = slots.A.img ? G.opacity / 100 : 1;
        paintImage(ctxO, slots.B.img, V);
        ctxO.restore();
      }
    }

    paintDiff(ctxO, V);
    if (V.scale > 8) drawPixelGrid(ctxO, V, img.width, img.height, w, h);

    ctxO.restore();
  }

  function render() {
    if (G.mode === 'normal') {
      renderPane(ctxA, $canvasA, slots.A.img, getView('A'));
      renderPane(ctxB, $canvasB, slots.B.img, getView('B'));
    } else {
      renderOverlay();
    }
    updateZoomDisplay();
    updateStatusBar();
    renderInspector();
  }

  function renderLoop() {
    if (needsRender) {
      needsRender = false;
      render();
    }
    requestAnimationFrame(renderLoop);
  }

  // ── Status Bar ─────────────────────────
  function slotSummary(which) {
    const s = slots[which];
    if (!s.img) return 'No file';
    const parts = [s.name, formatSize(s.size)];
    if (s.kind === 'pdf') parts.push('page ' + s.page + ' / ' + s.pages);
    parts.push(s.img.width + '×' + s.img.height);
    return parts.join(' · ');
  }

  function updateStatusBar() {
    const a = slotSummary('A');
    const b = slotSummary('B');
    $statusA.textContent = a;
    $statusA.title = a;
    $statusB.textContent = b;
    $statusB.title = b;

    if (G.diff && G.diffCache) {
      $statusDiff.textContent = 'Diff ' + G.diffCache.percentage + '%';
      $statusDiff.hidden = false;
    } else {
      $statusDiff.hidden = true;
    }
  }

  // ── UI State Sync ──────────────────────
  function syncUI() {
    modeButtons.forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.mode === G.mode ? 'true' : 'false');
    });

    $btnSync.setAttribute('aria-pressed', effectiveSync() ? 'true' : 'false');
    $btnSync.disabled = isOverlayMode();
    $btnSync.title = isOverlayMode()
      ? 'Always synced in Split and Fade modes'
      : 'Lock zoom and pan together — Y';

    $btnDiff.setAttribute('aria-pressed', G.diff ? 'true' : 'false');
    $btnDiff.disabled = !bothLoaded();
    $btnDiff.title = bothLoaded()
      ? 'Highlight differing pixels — D'
      : 'Load both images to compare';

    $btnInspect.setAttribute('aria-pressed', G.inspect ? 'true' : 'false');
    $btnInspect.disabled = !anyLoaded();

    $btnSwap.disabled = !anyLoaded();
    $btnReset.disabled = !anyLoaded();
    $btnZoomIn.disabled = !anyLoaded();
    $btnZoomOut.disabled = !anyLoaded();
    $btnZoomLvl.disabled = !anyLoaded();

    $dropA.classList.toggle('hidden', !!slots.A.img);
    $dropB.classList.toggle('hidden', !!slots.B.img);
    $paneA.querySelector('.pane-chrome').hidden = !slots.A.img;
    $paneB.querySelector('.pane-chrome').hidden = !slots.B.img;

    $divider.hidden = G.mode !== 'split' || !anyLoaded();
    $divider.setAttribute('aria-valuenow', Math.round(G.splitX * 100));
    $overlayEmpty.hidden = !isOverlayMode() || anyLoaded();
    $legendA.textContent = slots.A.img ? 'A · ' + slots.A.name : 'A';
    $legendB.textContent = slots.B.img ? 'B · ' + slots.B.name : 'B';

    ['A', 'B'].forEach((which) => {
      const slot = slots[which];
      const isPdf = slot.kind === 'pdf' && !!slot.pdf && slot.pages > 1;
      $pageNav[which].hidden = !isPdf;
      if (!isPdf) return;
      $pageInput[which].max = slot.pages;
      // Leave the field alone while it is being typed into.
      if (document.activeElement !== $pageInput[which]) {
        $pageInput[which].value = slot.page;
      }
      $pageTotal[which].textContent = '/ ' + slot.pages;
      $pageNav[which].querySelectorAll('[data-page-step]').forEach((btn) => {
        const step = parseInt(btn.dataset.pageStep, 10);
        btn.disabled = step < 0 ? slot.page <= 1 : slot.page >= slot.pages;
      });
    });

    $ctxFade.hidden = G.mode !== 'fade';
    $ctxPages.hidden = $pageNav.A.hidden && $pageNav.B.hidden;
    $ctxDiff.hidden = !G.diff;
    $contextBar.hidden = $ctxFade.hidden && $ctxPages.hidden && $ctxDiff.hidden;

    $opacity.value = G.opacity;
    $opacityVal.textContent = G.opacity + '%';
    $threshold.value = G.threshold;
    $thresholdVal.textContent = G.threshold;

    savePrefs();
  }

  // ── PDF Rasterisation ──────────────────
  // PDFs are compared page by page: the page is rasterised to a canvas, and
  // from there it is just another image to the rest of the app.
  // The pdf.js build lives in vendor/pdfjs (see its README for the version).

  // Resolve vendor assets against this script rather than the document so the
  // app keeps working when it is served from a sub-path.
  const VENDOR_BASE = new URL(
    'vendor/pdfjs/',
    (document.currentScript && document.currentScript.src) || document.baseURI
  ).href;

  // 2× the PDF's own 72 dpi user space. Crisp enough to diff body text without
  // turning a long document into hundreds of megabytes of canvas.
  const PDF_SCALE = 2;
  const PDF_MAX_DIM = 8192;      // stay inside browser canvas limits
  const PDF_MAX_PIXELS = 16e6;   // and inside sane memory use

  let pdfLib = null;

  function isPdfFile(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  }

  function loadPdfLib() {
    if (!pdfLib) {
      pdfLib = import(VENDOR_BASE + 'pdf.min.mjs').then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = VENDOR_BASE + 'pdf.worker.min.mjs';
        return lib;
      }).catch((err) => {
        pdfLib = null;   // let the next PDF retry a failed download
        err.engineFailure = true;
        throw err;
      });
    }
    return pdfLib;
  }

  function openPdfDocument(lib, data) {
    return lib.getDocument({
      data: data,
      cMapUrl: VENDOR_BASE + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: VENDOR_BASE + 'standard_fonts/',
      iccUrl: VENDOR_BASE + 'iccs/',
      wasmUrl: VENDOR_BASE + 'wasm/',
      isEvalSupported: false,   // never run scripts embedded in a PDF
    }).promise;
  }

  // Render one page onto a fresh canvas at the highest resolution the caps allow.
  function renderPdfPage(doc, pageNumber) {
    return doc.getPage(pageNumber).then((page) => {
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(
        PDF_SCALE,
        PDF_MAX_DIM / base.width,
        PDF_MAX_DIM / base.height,
        Math.sqrt(PDF_MAX_PIXELS / (base.width * base.height))
      );
      const viewport = page.getViewport({ scale: scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));

      // Pages are transparent outside their painted content; a white sheet
      // matches every PDF viewer and keeps the diff honest.
      return page.render({
        canvas: canvas,
        viewport: viewport,
        background: '#FFFFFF',
      }).promise.then(() => {
        page.cleanup();
        return canvas;
      });
    });
  }

  // A document is torn down through its loading task, which owns the worker.
  function destroyDocument(doc) {
    if (!doc || !doc.loadingTask) return;
    Promise.resolve(doc.loadingTask.destroy())
      .catch(() => { /* already gone, or a render was cancelled with it */ });
  }

  function pdfErrorMessage(err, name) {
    if (err && err.engineFailure) return 'Could not load the PDF engine';
    const kind = err && err.name;
    if (kind === 'PasswordException') return name + ' is password-protected';
    if (kind === 'InvalidPDFException') return name + ' is not a readable PDF';
    if (kind === 'MissingPDFException') return 'Could not read ' + name;
    return 'Could not render ' + name;
  }

  function loadPdf(file, which, announce) {
    const name = file.name || 'document.pdf';
    const slot = slots[which];
    const token = claimSlot(which);
    const stale = () => slot.token !== token || !slotKey(slot);

    showToast('Opening ' + name + '…');

    return file.arrayBuffer()
      .then((buf) => loadPdfLib().then((lib) => openPdfDocument(lib, buf)))
      .then((doc) => {
        if (stale()) { destroyDocument(doc); return false; }
        return renderPdfPage(doc, 1).then((canvas) => {
          if (stale()) { destroyDocument(doc); return false; }
          const wasEmpty = !slot.img;
          releaseDocument(slot);
          slot.kind = 'pdf';
          slot.pdf = doc;
          slot.page = 1;
          slot.pages = doc.numPages;
          slot.name = name;
          slot.size = file.size || 0;
          slot.img = canvas;
          slot.src = makeSourceCanvas(canvas);
          adoptLoaded(slot, wasEmpty, announce);
          return true;
        });
      })
      .catch((err) => {
        if (!stale()) showToast(pdfErrorMessage(err, name), true);
        return false;
      });
  }

  // Re-rasterise the slot's document at a different page.
  function setPdfPage(which, pageNumber) {
    const slot = slots[which];
    if (slot.kind !== 'pdf' || !slot.pdf) return;

    const target = clamp(Math.round(pageNumber), 1, slot.pages);
    if (target === slot.page) return;

    const doc = slot.pdf;
    const token = claimSlot(which);
    const stale = () => slot.pdf !== doc || slot.token !== token || !slotKey(slot);

    slot.page = target;
    syncUI();

    renderPdfPage(doc, target).then((canvas) => {
      if (stale()) return;
      slot.img = canvas;
      slot.src = makeSourceCanvas(canvas);
      invalidateDiff();
      syncUI();
      scheduleRender();
    }).catch(() => {
      if (stale()) return;
      showToast('Could not render page ' + target, true);
    });
  }

  // Page through every open document at once — the usual case is two revisions
  // of the same file, and each slot clamps to its own length.
  function stepPages(delta) {
    const pdfSlots = ['A', 'B'].filter((w) => slots[w].kind === 'pdf' && slots[w].pages > 1);
    if (!pdfSlots.length) return;

    const moved = pdfSlots.filter((w) => {
      const next = clamp(slots[w].page + delta, 1, slots[w].pages);
      if (next === slots[w].page) return false;
      setPdfPage(w, next);
      return true;
    });

    if (!moved.length) {
      showToast(delta > 0 ? 'Last page' : 'First page');
    } else if (moved.length === 1) {
      showToast(moved[0] + ' · page ' + slots[moved[0]].page + ' / ' + slots[moved[0]].pages);
    } else {
      showToast('Page ' + slots.A.page + ' · ' + slots.B.page);
    }
  }

  // ── File Loading ───────────────────────
  // Let go of any PDF the slot was holding, so a replaced document frees its
  // worker instead of parsing on in the background.
  function releaseDocument(slot) {
    const doc = slot.pdf;
    slot.pdf = null;
    destroyDocument(doc);
  }

  // Shared tail of every successful load: frame it, refresh, and say so.
  // `announce` is false to stay silent, or a verb ("Pasted into") to override
  // the default loaded/replaced wording.
  function adoptLoaded(slot, wasEmpty, announce) {
    const which = slotKey(slot);
    if (!which) return;
    if (wasEmpty) fitSlot(which);
    invalidateDiff();
    syncUI();
    scheduleRender();
    if (announce !== false) {
      showToast(typeof announce === 'string'
        ? announce + ' ' + which
        : (wasEmpty ? 'Loaded into ' + which : 'Replaced ' + which));
    }
  }

  function loadImage(file, which, announce) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const slot = slots[which];
    const token = claimSlot(which);
    const stale = () => slot.token !== token || !slotKey(slot);

    return new Promise((resolve) => {
      img.onload = function () {
        URL.revokeObjectURL(url);
        if (stale()) { resolve(false); return; }

        const wasEmpty = !slot.img;
        releaseDocument(slot);
        slot.kind = 'image';
        slot.page = 1;
        slot.pages = 1;
        slot.img = img;
        slot.name = file.name || 'clipboard';
        slot.size = file.size || 0;
        slot.src = makeSourceCanvas(img);
        adoptLoaded(slot, wasEmpty, announce);
        resolve(true);
      };

      img.onerror = function () {
        URL.revokeObjectURL(url);
        if (!stale()) showToast('Could not read ' + (file.name || 'that file'), true);
        resolve(false);
      };

      img.src = url;
    });
  }

  // Resolves true once the file is on screen, false if it failed or was
  // superseded — every loader reports the same way.
  function loadFile(file, which, announce) {
    return isPdfFile(file)
      ? loadPdf(file, which, announce)
      : loadImage(file, which, announce);
  }

  function pickTarget() {
    if (!slots.A.img) return 'A';
    if (!slots.B.img) return 'B';
    return G.hoverSlot || 'A';
  }

  function isSupportedFile(file) {
    if (!file) return false;
    if (isPdfFile(file)) return true;
    return !!file.type && file.type.indexOf('image/') === 0;
  }

  function handleFiles(fileList, which, verb) {
    const files = Array.prototype.slice.call(fileList || []).filter(isSupportedFile);

    if (!files.length) {
      showToast('That file is not an image or PDF', true);
      return;
    }

    if (files.length >= 2) {
      const first = which || 'A';
      const second = first === 'A' ? 'B' : 'A';
      // PDFs land asynchronously, so wait before claiming both are in.
      Promise.all([
        loadFile(files[0], first, false),
        loadFile(files[1], second, false),
      ]).then((results) => {
        if (results[0] && results[1]) showToast('Loaded 2 files');
      });
      return;
    }

    loadFile(files[0], which || pickTarget(), verb);
  }

  function clearSlot(which) {
    releaseDocument(slots[which]);
    slots[which] = emptySlot();
    if (!bothLoaded() && G.diff) {
      G.diff = false;
      G.diffCache = null;
    }
    if (!anyLoaded()) G.cursor = null;
    invalidateDiff();
    syncUI();
    scheduleRender();
    showToast('Cleared ' + which);
  }

  function swapSlots() {
    if (!anyLoaded()) return;
    const tmp = slots.A;
    slots.A = slots.B;
    slots.B = tmp;

    const t = { scale: VA.scale, ox: VA.ox, oy: VA.oy };
    copyView(VB, VA);
    copyView(t, VB);

    syncUI();
    scheduleRender();
    showToast('Swapped A ↔ B');
  }

  function openPicker(which) {
    (which === 'A' ? $fileA : $fileB).click();
  }

  $fileA.addEventListener('change', (e) => { handleFiles(e.target.files, 'A'); e.target.value = ''; });
  $fileB.addEventListener('change', (e) => { handleFiles(e.target.files, 'B'); e.target.value = ''; });

  $dropA.addEventListener('click', () => openPicker('A'));
  $dropB.addEventListener('click', () => openPicker('B'));

  document.querySelectorAll('.pane-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const slot = btn.dataset.slot;
      if (btn.dataset.act === 'open') openPicker(slot);
      else clearSlot(slot);
    });
  });

  [[$paneA, 'A'], [$paneB, 'B']].forEach(([pane, which]) => {
    pane.addEventListener('pointerenter', () => { G.hoverSlot = which; });
  });

  // ── Clipboard Paste ────────────────────
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const files = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind !== 'file') continue;
      const f = items[i].getAsFile();
      if (isSupportedFile(f)) files.push(f);
    }
    if (!files.length) return;
    e.preventDefault();
    handleFiles(files, null, 'Pasted into');
  });

  // ── Global Drag & Drop ─────────────────
  let dragWatch = null;
  let lastDragOver = 0;

  function hasFiles(e) {
    const dt = e.dataTransfer;
    if (!dt) return false;
    return Array.prototype.indexOf.call(dt.types || [], 'Files') !== -1;
  }

  function hideDragOverlay() {
    $dragOverlay.hidden = true;
    document.querySelectorAll('.drag-target').forEach((t) => t.classList.remove('active'));
    clearInterval(dragWatch);
    dragWatch = null;
  }

  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    lastDragOver = Date.now();
    if ($dragOverlay.hidden) $dragOverlay.hidden = false;
    if (!dragWatch) {
      dragWatch = setInterval(() => {
        if (Date.now() - lastDragOver > 250) hideDragOverlay();
      }, 120);
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    hideDragOverlay();
  });

  window.addEventListener('dragend', hideDragOverlay);

  document.querySelectorAll('.drag-target').forEach((target) => {
    target.addEventListener('dragover', (e) => {
      e.preventDefault();
      target.classList.add('active');
      G.hoverSlot = target.dataset.slot;
    });
    target.addEventListener('dragleave', () => target.classList.remove('active'));
    target.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideDragOverlay();
      handleFiles(e.dataTransfer.files, target.dataset.slot);
    });
  });

  // ── Pointer: Pan, Pinch, Inspect ───────
  function distance(p, q) { return Math.hypot(q.x - p.x, q.y - p.y); }
  function midpoint(p, q) { return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }; }

  function setupPointer(canvas, which) {
    const points = new Map();
    let pinchDist = 0;
    let pinchMid = null;
    let panStart = null;

    function beginPan(x, y) {
      const view = getView(which);
      panStart = { x: x, y: y, ox: view.ox, oy: view.oy };
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (G.draggingDivider) return;
      canvas.setPointerCapture(e.pointerId);
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (points.size === 2) {
        const p = Array.from(points.values());
        pinchDist = distance(p[0], p[1]);
        pinchMid = midpoint(p[0], p[1]);
        panStart = null;
      } else if (points.size === 1) {
        beginPan(e.clientX, e.clientY);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (points.has(e.pointerId)) points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      updateCursor(e, canvas, which);

      if (points.size >= 2) {
        const p = Array.from(points.values());
        const d = distance(p[0], p[1]);
        const m = midpoint(p[0], p[1]);
        const view = getView(which);
        const rect = canvas.getBoundingClientRect();
        if (pinchDist > 0 && d > 0) {
          zoomAt(view, m.x - rect.left, m.y - rect.top, d / pinchDist);
        }
        if (pinchMid) {
          view.ox += m.x - pinchMid.x;
          view.oy += m.y - pinchMid.y;
        }
        pinchDist = d;
        pinchMid = m;
        scheduleRender();
      } else if (panStart) {
        const view = getView(which);
        view.ox = panStart.ox + (e.clientX - panStart.x);
        view.oy = panStart.oy + (e.clientY - panStart.y);
        scheduleRender();
      }
    });

    function endPointer(e) {
      points.delete(e.pointerId);
      if (points.size < 2) { pinchDist = 0; pinchMid = null; }
      if (points.size === 1) {
        const p = Array.from(points.values())[0];
        beginPan(p.x, p.y);
      } else if (points.size === 0) {
        panStart = null;
      }
    }

    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('pointerleave', clearCursor);
    canvas.addEventListener('dblclick', toggleActualSize);

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.pow(0.999, e.deltaY * (e.deltaMode === 1 ? 16 : 1));
      zoomAt(getView(which), e.clientX - rect.left, e.clientY - rect.top,
             clamp(factor, 0.5, 2));
      scheduleRender();
    }, { passive: false });
  }

  setupPointer($canvasA, 'A');
  setupPointer($canvasB, 'B');
  setupPointer($canvasO, 'O');

  // ── Split Divider ──────────────────────
  function setSplit(value) {
    G.splitX = clamp(value, 0.02, 0.98);
    $divider.setAttribute('aria-valuenow', Math.round(G.splitX * 100));
    scheduleRender();
  }

  $divider.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    G.draggingDivider = true;
    $divider.setPointerCapture(e.pointerId);
    $divider.focus();
  });

  $divider.addEventListener('pointermove', (e) => {
    if (!G.draggingDivider) return;
    const rect = $paneOverlay.getBoundingClientRect();
    setSplit((e.clientX - rect.left) / rect.width);
  });

  function endDivider(e) {
    if (!G.draggingDivider) return;
    G.draggingDivider = false;
    try { $divider.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
    savePrefs();
  }

  $divider.addEventListener('pointerup', endDivider);
  $divider.addEventListener('pointercancel', endDivider);

  $divider.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();  // the document handler covers the unfocused case
    const step = (e.shiftKey ? 0.1 : 0.01) * (e.key === 'ArrowLeft' ? -1 : 1);
    setSplit(G.splitX + step);
    savePrefs();
  });

  // ── Mode Switching ─────────────────────
  const MODE_LABELS = { normal: 'Normal', split: 'Split', fade: 'Fade' };

  function setMode(mode) {
    const wasOverlay = isOverlayMode();
    G.mode = mode;

    if (mode === 'normal') {
      $paneOverlay.hidden = true;
      $paneA.style.display = '';
      $paneB.style.display = '';
      if (wasOverlay && !G.sync) {
        copyView(V, VA);
        copyView(V, VB);
      }
    } else {
      $paneA.style.display = 'none';
      $paneB.style.display = 'none';
      $paneOverlay.hidden = false;
      if (!wasOverlay) copyView(G.sync ? V : VA, V);
    }

    syncUI();
    resizeAll();
  }

  function cycleMode() {
    const order = ['normal', 'split', 'fade'];
    const next = order[(order.indexOf(G.mode) + 1) % order.length];
    setMode(next);
    showToast(MODE_LABELS[next] + ' view');
  }

  function toggleSync() {
    if (isOverlayMode()) {
      showToast('Sync is always on in ' + MODE_LABELS[G.mode] + ' view');
      return;
    }
    G.sync = !G.sync;
    if (G.sync) copyView(VA, V);
    else { copyView(V, VA); copyView(V, VB); }
    syncUI();
    scheduleRender();
    showToast('Sync ' + (G.sync ? 'on' : 'off'));
  }

  function toggleDiff() {
    if (!bothLoaded()) {
      showToast('Diff needs both images', true);
      return;
    }
    G.diff = !G.diff;
    if (G.diff && !G.diffCache) scheduleDiff();
    syncUI();
    scheduleRender();
    showToast('Diff ' + (G.diff ? 'on' : 'off'));
  }

  function toggleInspect() {
    if (!anyLoaded()) {
      showToast('Load an image first', true);
      return;
    }
    G.inspect = !G.inspect;
    if (!G.inspect) G.cursor = null;
    syncUI();
    scheduleRender();
    showToast('Inspector ' + (G.inspect ? 'on' : 'off'));
  }

  function toggleTheme() {
    G.theme = G.theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', G.theme);
    makeCheckerboard();
    savePrefs();
    scheduleRender();
    showToast(G.theme === 'dark' ? 'Dark theme' : 'Light theme');
  }

  // ── Zoom Menu ──────────────────────────
  function openZoomMenu() {
    const rect = $btnZoomLvl.getBoundingClientRect();
    $zoomMenu.hidden = false;
    const menuRect = $zoomMenu.getBoundingClientRect();
    $zoomMenu.style.top = (rect.bottom + 8) + 'px';
    $zoomMenu.style.left =
      clamp(rect.left + rect.width / 2 - menuRect.width / 2,
            8, window.innerWidth - menuRect.width - 8) + 'px';
    $btnZoomLvl.setAttribute('aria-expanded', 'true');
  }

  function closeZoomMenu() {
    $zoomMenu.hidden = true;
    $btnZoomLvl.setAttribute('aria-expanded', 'false');
  }

  $btnZoomLvl.addEventListener('click', (e) => {
    e.stopPropagation();
    if ($zoomMenu.hidden) openZoomMenu();
    else closeZoomMenu();
  });

  $zoomMenu.querySelectorAll('[data-zoom]').forEach((item) => {
    item.addEventListener('click', () => {
      const value = item.dataset.zoom;
      if (value === 'fit') { fitAll(); showToast('Fit to view'); }
      else { setZoom(parseFloat(value)); showToast(Math.round(parseFloat(value) * 100) + '%'); }
      closeZoomMenu();
    });
  });

  document.addEventListener('click', (e) => {
    if (!$zoomMenu.hidden && !$zoomMenu.contains(e.target)) closeZoomMenu();
  });

  window.addEventListener('resize', closeZoomMenu);

  // ── Help Modal ─────────────────────────
  let lastFocused = null;

  function openHelp() {
    lastFocused = document.activeElement;
    $helpOverlay.hidden = false;
    $btnHelpClose.focus();
  }

  function closeHelp() {
    $helpOverlay.hidden = true;
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function toggleHelp() {
    if ($helpOverlay.hidden) openHelp();
    else closeHelp();
  }

  $btnHelp.addEventListener('click', toggleHelp);
  $btnHelpClose.addEventListener('click', closeHelp);
  $helpOverlay.addEventListener('click', (e) => {
    if (e.target === $helpOverlay) closeHelp();
  });

  // ── Toolbar Events ─────────────────────
  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setMode(btn.dataset.mode);
      showToast(MODE_LABELS[btn.dataset.mode] + ' view');
    });
  });

  $btnSync.addEventListener('click', toggleSync);
  $btnDiff.addEventListener('click', toggleDiff);
  $btnInspect.addEventListener('click', toggleInspect);
  $btnOpenA.addEventListener('click', () => openPicker('A'));
  $btnOpenB.addEventListener('click', () => openPicker('B'));
  $btnSwap.addEventListener('click', swapSlots);
  $btnZoomIn.addEventListener('click', () => zoomCenter(1.2));
  $btnZoomOut.addEventListener('click', () => zoomCenter(0.8));
  $btnReset.addEventListener('click', () => { fitAll(); showToast('Fit to view'); });
  $btnTheme.addEventListener('click', toggleTheme);

  $opacity.addEventListener('input', () => {
    G.opacity = parseInt($opacity.value, 10);
    $opacityVal.textContent = G.opacity + '%';
    scheduleRender();
  });
  $opacity.addEventListener('change', savePrefs);

  document.querySelectorAll('[data-page-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const which = btn.dataset.slot;
      setPdfPage(which, slots[which].page + parseInt(btn.dataset.pageStep, 10));
    });
  });

  ['A', 'B'].forEach((which) => {
    const input = $pageInput[which];
    const commit = () => {
      const value = parseInt(input.value, 10);
      if (isNaN(value)) input.value = slots[which].page;
      else setPdfPage(which, value);
      input.value = slots[which].page;
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); input.blur(); }
      else if (e.key === 'Escape') { input.value = slots[which].page; input.blur(); }
    });
  });

  $threshold.addEventListener('input', () => {
    G.threshold = parseInt($threshold.value, 10);
    $thresholdVal.textContent = G.threshold;
    scheduleDiff();
  });
  $threshold.addEventListener('change', savePrefs);

  // ── Keyboard Shortcuts ─────────────────
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$zoomMenu.hidden) { closeZoomMenu(); return; }
      if (!$helpOverlay.hidden) { closeHelp(); return; }
      return;
    }

    const el = e.target;
    const isRange = el.tagName === 'INPUT' && el.type === 'range';
    const isTextEntry = (el.tagName === 'INPUT' && !isRange) ||
                        el.tagName === 'TEXTAREA' || el.isContentEditable;

    // A focused slider keeps its own arrow/Home/End keys, but every other
    // shortcut still works so the toolbar sliders never trap the keyboard.
    if (isTextEntry) return;
    if (isRange && /^(Arrow|Home$|End$|Page)/.test(e.key)) return;
    if (!$helpOverlay.hidden) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key) {
      case '1': e.preventDefault(); setMode('normal'); showToast('Normal view'); break;
      case '2': e.preventDefault(); setMode('split');  showToast('Split view');  break;
      case '3': e.preventDefault(); setMode('fade');   showToast('Fade view');   break;
      case 's': case 'S': e.preventDefault(); cycleMode(); break;
      case 'y': case 'Y': e.preventDefault(); toggleSync(); break;
      case 'd': case 'D': e.preventDefault(); toggleDiff(); break;
      case 'i': case 'I': e.preventDefault(); toggleInspect(); break;
      case 'x': case 'X': e.preventDefault(); swapSlots(); break;
      case 't': case 'T': e.preventDefault(); toggleTheme(); break;
      case 'f': case 'F': case 'r': case 'R':
        e.preventDefault(); fitAll(); showToast('Fit to view'); break;
      case '0': e.preventDefault(); setZoom(1); showToast('100%'); break;
      case '+': case '=': e.preventDefault(); zoomCenter(1.2); break;
      case '-': case '_': e.preventDefault(); zoomCenter(0.8); break;
      case '?': e.preventDefault(); toggleHelp(); break;
      case '[': e.preventDefault(); stepPages(-1); break;
      case ']': e.preventDefault(); stepPages(1); break;
      case 'ArrowLeft':
        if (G.mode === 'split') { e.preventDefault(); setSplit(G.splitX - (e.shiftKey ? 0.1 : 0.01)); savePrefs(); }
        break;
      case 'ArrowRight':
        if (G.mode === 'split') { e.preventDefault(); setSplit(G.splitX + (e.shiftKey ? 0.1 : 0.01)); savePrefs(); }
        break;
    }
  });

  // ── Init ───────────────────────────────
  function init() {
    const prefs = loadPrefs();
    const prefersLight = window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches;

    G.theme     = prefs.theme || (prefersLight ? 'light' : 'dark');
    G.mode      = ['normal', 'split', 'fade'].indexOf(prefs.mode) !== -1 ? prefs.mode : 'normal';
    G.sync      = !!prefs.sync;
    G.inspect   = !!prefs.inspect;
    G.diff      = false;   // needs both images loaded, so never restored
    G.splitX    = typeof prefs.splitX === 'number' ? clamp(prefs.splitX, 0.02, 0.98) : 0.5;
    G.opacity   = typeof prefs.opacity === 'number' ? clamp(prefs.opacity, 0, 100) : 50;
    G.threshold = typeof prefs.threshold === 'number' ? clamp(prefs.threshold, 0, 64) : 5;

    document.documentElement.setAttribute('data-theme', G.theme);
    makeCheckerboard();
    setMode(G.mode);
    resizeAll();
    requestAnimationFrame(renderLoop);
  }

  init();

})();
