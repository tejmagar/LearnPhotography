'use strict';
(function () {
  const $ = (s) => document.querySelector(s);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const SANS = '"Inter", system-ui, sans-serif';
  const MONO = '"JetBrains Mono", ui-monospace, monospace';

  /* ------------------------------------------------------------------ data */

  const SENSORS = {
    ff: { label: 'Full frame', w: 36, h: 24 },
    apsc: { label: 'APS-C', w: 23.5, h: 15.6 },
    m43: { label: 'Micro 4/3', w: 17.3, h: 13 },
    one: { label: '1 inch', w: 13.2, h: 8.8 },
    phone: { label: 'Phone', w: 9.8, h: 7.4 },
  };
  const APERTURES = [1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22];
  const SHUTTERS = [1 / 4000, 1 / 3200, 1 / 2500, 1 / 2000, 1 / 1600, 1 / 1250, 1 / 1000, 1 / 800, 1 / 640, 1 / 500, 1 / 400,
    1 / 320, 1 / 250, 1 / 200, 1 / 160, 1 / 125, 1 / 100, 1 / 80, 1 / 60, 1 / 50, 1 / 40, 1 / 30, 1 / 25, 1 / 20, 1 / 15,
    1 / 13, 1 / 10, 1 / 8, 1 / 6, 1 / 5, 1 / 4, 0.3, 0.4, 0.5, 0.6, 0.8, 1];
  const ISOS = [100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 25600];
  const SCENES = [
    { id: 'sun', label: 'Bright sun', ev: 15 },
    { id: 'cloudy', label: 'Cloudy', ev: 12 },
    { id: 'golden', label: 'Golden hour', ev: 10 },
    { id: 'indoor', label: 'Indoors', ev: 7 },
    { id: 'night', label: 'Night', ev: 4 },
  ];
  const F_MIN = 14, F_MAX = 200, D_MIN = 0.2, D_MAX = 100;
  const CAM_H = 1.3;          // camera height above ground, metres
  const CAR_SPEED = 10;       // metres per second
  const CAR_X = 3.4, CAR_Z = 12;
  const SUBJ_MIN = 0.25, SUBJ_MAX = 60;
  const WALL_MIN = 1, WALL_MAX = 60;
  const DY_MIN = -195, DY_MAX = 175;

  // The three light sources traced in the ray diagram.
  // Everything in the scene that sends light into the camera.
  const OBJ = {
    fg: { d: 1.0, name: 'Leaves', color: [255, 111, 168], dy: 84 },
    subj: { d: 4, name: 'Person', color: [255, 181, 71], dy: -72 },
    wall: { d: 8, name: 'Wall', color: [255, 138, 92], dy: -20 },
    car: { d: 12, name: 'Car', color: [178, 140, 255], dy: 34 },
    tree: { d: 21, name: 'Tree', color: [140, 220, 110], dy: -112 },
    bg: { d: 30, name: 'Lights', color: [87, 199, 255], dy: -150 },
    mtn: { d: Infinity, name: 'Mountains', color: [230, 150, 200], dy: -46 },
  };
  const OBJ_KEYS = ['fg', 'subj', 'wall', 'car', 'tree', 'bg', 'mtn'];

  const DEFAULTS = {
    f: 50, N: 2.8, t: 1 / 125, iso: 100, sensor: 'ff', focus: 4, subjD: 4, wallD: 8, macro: false, scene: 'golden',
    handheld: false, exaggerate: true, flip: false, everywhere: false, guides: false, subjX: 0, hideFg: false, lens: 'prime', zoomGroups: true, rays: { fg: false, subj: true, wall: true, car: false, tree: false, bg: true, mtn: false },
    dy: { fg: 84, subj: -72, wall: -20, car: 34, tree: -112, bg: -150, mtn: -46 },
  };
  let S = clone(DEFAULTS);

  const LAYERED_PRESET = {
    f: 50, N: 2.8, t: 1 / 250, iso: 200, subjD: 3.5, focus: 3.5, wallD: 10, scene: 'golden', guides: true,
    rays: { fg: true, subj: true, wall: true, car: false, tree: false, bg: false, mtn: false },
  };
  let currentChapter = '';
  let showChapter = () => {};
  let checkSamples = () => {};

  /* ---------------------------------------------------------------- optics */

  // Thin lens: image distance (mm) for an object at d metres.
  const imgDist = (f, d) => (isFinite(d) ? (f * d * 1000) / (d * 1000 - f) : f);
  // Long lenses cannot open as wide: front glass is limited to about 90 mm.
  // Zoom lens: a convex front group and a concave rear group. Changing the spacing between
  // them changes the combined focal length: 1/f = 1/f1 + 1/f2 - s/(f1*f2).
  const ZOOM = { min: 24, max: 200, f1: 40, f2: -30, nWide: 3.5, nTele: 5.6 };
  const zoomSpacing = (f) => ZOOM.f1 + ZOOM.f2 - (ZOOM.f1 * ZOOM.f2) / f;
  const isZoom = () => S.lens === 'zoom';
  // Widest aperture. Primes: limited by front glass (about 90 mm). This zoom: f/3.5 at 24 mm to f/5.6 at 200 mm.
  const minN = (f) => (isZoom()
    ? ZOOM.nWide * (ZOOM.nTele / ZOOM.nWide) ** (Math.log(f / ZOOM.min) / Math.log(ZOOM.max / ZOOM.min))
    : Math.max(1.4, f / 90));
  // Closest distance the lens can focus. The focusing mechanism can only push the
  // lens so far away from the sensor; a macro lens is built to push it much further.
  const mfd = () => (S.macro ? Math.max(0.15, S.f * 0.0025) : Math.max(0.2, S.f * 0.009));
  const diagOf = (s) => Math.hypot(s.w, s.h);
  const cropOf = (s) => 43.27 / diagOf(s);
  const fovDeg = (size, v) => (2 * Math.atan(size / (2 * v)) * 180) / Math.PI;

  // Diameter (mm) of the blur disc on the sensor for something at d metres.
  function cocMM(d) {
    const v = imgDist(S.f, S.focus), vd = imgDist(S.f, d), D = S.f / S.N;
    return (D * Math.abs(vd - v)) / vd;
  }
  function dof() {
    const c = diagOf(SENSORS[S.sensor]) / 1500, f = S.f;
    const H = (f * f) / (S.N * c) + f;
    if (!isFinite(S.focus)) return { near: H / 1000, far: Infinity, c };
    const s = S.focus * 1000;
    const near = (s * (H - f)) / (H + s - 2 * f);
    const far = s >= H ? Infinity : (s * (H - f)) / (H - s);
    return { near: near / 1000, far: far / 1000, c };
  }
  const sceneEV = () => SCENES.find((x) => x.id === S.scene).ev;
  const settingsEV = () => Math.log2((S.N * S.N) / S.t) - Math.log2(S.iso / 100);
  const evOffset = () => sceneEV() - settingsEV();

  const fmtT = (t) => (t >= 0.3 ? `${+t.toFixed(1)} s` : `1/${Math.round(1 / t)} s`);
  const fmtD = (d) => (!isFinite(d) ? '∞' : d < 1 ? `${Math.round(d * 100)} cm` : d < 10 ? `${d.toFixed(1)} m` : `${Math.round(d)} m`);
  const nearestIdx = (arr, val) => {
    let best = 0;
    arr.forEach((x, i) => { if (Math.abs(Math.log(x / val)) < Math.abs(Math.log(arr[best] / val))) best = i; });
    return best;
  };

  /* --------------------------------------------------------- canvas helpers */

  function fitCanvas(can, w, h) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    can.width = Math.round(w * dpr);
    can.height = Math.round(h * dpr);
    const ctx = can.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  function text(ctx, str, x, y, o = {}) {
    ctx.font = `${o.weight || 500} ${o.size || 12}px ${o.mono ? MONO : SANS}`;
    ctx.fillStyle = o.color || '#c9d1dc';
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.base || 'middle';
    ctx.fillText(str, x, y);
  }
  function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  function poly(ctx, pts) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath(); ctx.fill();
  }
  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2); ctx.fill(); }
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath(); ctx.fill();
  }
  function ellipse(ctx, x, y, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), rot, 0, Math.PI * 2); ctx.fill(); }
  function apertureShape(ctx, x, y, r, rot) {
    ctx.beginPath();
    if (S.N < 4) { ctx.arc(x, y, r, 0, Math.PI * 2); return; }
    for (let i = 0; i < 7; i++) {
      const a = rot + (i * Math.PI * 2) / 7;
      i ? ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)) : ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    ctx.closePath();
  }

  /* -------------------------------------------------------------- diagram */

  const DW = 1200, DH = 470;
  const dctx = fitCanvas($('#diagram'), DW, DH);
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  // Diagram camera: zoom and pan, in diagram units.
  const view = { scale: 1, tx: 0, ty: 0 };
  const VIEW_MAX = 8;
  function clampView() {
    view.scale = clamp(view.scale, 1, VIEW_MAX);
    view.tx = clamp(view.tx, DW - DW * view.scale, 0);
    view.ty = clamp(view.ty, DH - DH * view.scale, 0);
  }
  // Zoom around a point given in screen-space diagram units (before the view transform).
  function zoomAt(sx, sy, factor) {
    const ns = clamp(view.scale * factor, 1, VIEW_MAX), k = ns / view.scale;
    view.tx = sx - (sx - view.tx) * k; view.ty = sy - (sy - view.ty) * k; view.scale = ns;
    clampView(); afterView();
  }
  function zoomToward(x, y, scale) {   // x, y in diagram units
    view.scale = clamp(scale, 1, VIEW_MAX);
    view.tx = DW / 2 - x * view.scale; view.ty = DH / 2 - y * view.scale;
    clampView(); afterView();
  }
  function afterView() {
    const z = document.getElementById('zoomLevel');
    if (z) z.textContent = `${Math.round(view.scale * 100)}%`;
    drawDiagram();
  }
  let shutterAnim = null;
  let focusLineActive = false;
  let lastA = 1;

  function geometry() {
    const sen = SENSORS[S.sensor];
    const f = S.f, v = imgDist(f, S.focus);
    const sc = Math.min(4.4, 400 / f);              // px per mm inside the camera
    const cy = 226, sensorX = 1112;
    // Focusing moves the lens by only a few mm, so that movement is drawn E times larger.
    const vMin = imgDist(f, mfd());
    const E = S.exaggerate ? clamp((0.5 * f) / (vMin - f), 1, 5) : 1;
    const dispV = f + (v - f) * E;
    const lensX = sensorX - dispV * sc;
    const lensMinX = sensorX - (f + (vMin - f) * E) * sc;   // lens position at closest focus
    const glassD = f / minN(f), D = f / S.N;
    return {
      sen, v, sc, cy, sensorX, lensX, D, E, Fx: lensX + f * sc,
      gH: (glassD * sc) / 2, aH: (D * sc) / 2, sHalf: (sen.h * sc) / 2,
      objL: 40, objR: lensMinX - 70,
    };
  }
  // Where the two glass groups sit around the aperture, and how the bending is split.
  function lensGroups(G) {
    if (!isZoom()) return { gf: 13, gr: 13, over: 0.5 };
    const half = Math.max(12, zoomSpacing(S.f) * 1.1) / 2;
    return { gf: half, gr: half, over: 1.7 };   // front bends past the final direction, the concave rear bends it back out
  }
  function objX(G, d) {
    if (!isFinite(d) || d >= D_MAX) return G.objL;
    const u = (Math.log(d) - Math.log(D_MIN)) / (Math.log(D_MAX) - Math.log(D_MIN));
    return G.objL + (1 - u) * (G.objR - G.objL);
  }
  function xToD(G, x) {
    const u = 1 - (x - G.objL) / (G.objR - G.objL);
    return D_MIN * (D_MAX / D_MIN) ** u;
  }
  function hitFocusLine(G, x, y) {
    const xf = objX(G, S.focus);
    return (Math.abs(x - xf) < 48 && y > 28 && y < 56) || (Math.abs(x - xf) < 9 && y > 28 && y < DH - 30);
  }
  function hitObject(G, x, y) {
    for (const key of ['subj', 'fg', 'wall', 'car', 'tree', 'bg', 'mtn']) {
      const X = objX(G, OBJ[key].d), Y = G.cy + OBJ[key].dy;
      const below = key === 'subj' ? 78 : key === 'tree' ? 64 : key === 'bg' ? 70 : key === 'wall' ? 56 : 34;
      if (Math.abs(x - X) < 26 && y > Y - 30 && y < Y + below) return key;
    }
    return null;
  }
  function shutterState() {
    if (!shutterAnim) return null;
    const e = performance.now() - shutterAnim.start;
    return {
      p1: clamp(e / shutterAnim.travel, 0, 1),
      p2: clamp((e - shutterAnim.expo) / shutterAnim.travel, 0, 1), e,
    };
  }

  function drawDiagram() {
    const ctx = dctx, G = geometry(), sh = shutterState();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(DPR * view.scale, 0, 0, DPR * view.scale, DPR * view.tx, DPR * view.ty);
    const { cy, lensX, sensorX, sc, sHalf, gH, aH } = G;
    const bodyHalf = Math.max(sHalf + 40, 100);
    const axisY = DH - 26;

    // How much to stretch focus shifts so the crossing point is visible.
    let maxShift = 0;
    for (const k in OBJ) maxShift = Math.max(maxShift, Math.abs(imgDist(S.f, OBJ[k].d) - G.v) * sc);
    const A = S.exaggerate ? clamp(maxShift > 0 ? (0.55 * (sensorX - lensX)) / maxShift : 20, 1, 20) : 1;
    lastA = A;

    // depth of field band
    const df = dof();
    const xFar = objX(G, df.far), xNear = objX(G, clamp(df.near, D_MIN, D_MAX));
    ctx.fillStyle = 'rgba(74,222,128,0.07)';
    ctx.fillRect(xFar, 30, Math.max(2, xNear - xFar), axisY - 40);
    text(ctx, 'in focus zone (depth of field)', (xFar + xNear) / 2, 18, { color: '#4ade80', size: 11, align: 'center' });

    // field of view wedge (lines from sensor edges through the lens center)
    const slope = sHalf / (sensorX - lensX);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 30, DW, axisY - 40); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    poly(ctx, [[lensX, cy], [0, cy - slope * lensX], [0, cy + slope * lensX]]);
    ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.2;
    line(ctx, sensorX, cy + sHalf, 0, cy - slope * lensX);
    line(ctx, sensorX, cy - sHalf, 0, cy + slope * lensX);
    ctx.setLineDash([]);
    ctx.restore();
    const fd = Math.min(420, lensX - 160);
    const fovY = Math.min(axisY - 30, cy + slope * fd + 16);
    text(ctx, `field of view ${fovDeg(G.sen.h, G.v).toFixed(1)}° (vertical)`, lensX - fd, fovY,
      { color: '#e7e9ee', size: 12, align: 'center', weight: 600 });
    if (G.E > 1.05 && G.v - S.f > 0.05) {
      text(ctx, 'number is true, the lines exaggerate focus breathing', lensX - fd, fovY + 14,
        { color: '#98a1b0', size: 10, align: 'center' });
    }

    // optical axis
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
    line(ctx, 0, cy, DW, cy);

    // distance axis
    ctx.strokeStyle = '#2d3340'; line(ctx, G.objL, axisY, G.objR, axisY);
    [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].forEach((d) => {
      const x = objX(G, d);
      ctx.strokeStyle = '#3a4150'; line(ctx, x, axisY - 4, x, axisY + 4);
      text(ctx, d === 100 ? '100 m+' : `${d} m`, x, axisY + 14, { size: 10, color: '#7b8494', align: 'center' });
    });
    text(ctx, 'distance from camera (log scale)', G.objL + 2, axisY - 12, { size: 10, color: '#7b8494', align: 'left' });

    // too close to focus
    const xm = objX(G, mfd()), xmin = objX(G, D_MIN);
    ctx.fillStyle = 'rgba(255,80,80,0.08)'; ctx.fillRect(xm, 30, xmin - xm + 30, axisY - 40);
    ctx.strokeStyle = 'rgba(255,90,90,0.55)'; ctx.setLineDash([2, 3]); line(ctx, xm, 30, xm, axisY - 6); ctx.setLineDash([]);
    text(ctx, 'too close', (xm + xmin) / 2 + 10, axisY - 26, { size: 10, align: 'center', color: '#ff7a7a' });
    text(ctx, 'to focus', (xm + xmin) / 2 + 10, axisY - 14, { size: 10, align: 'center', color: '#ff7a7a' });

    // focus plane: a draggable line
    const xf = objX(G, S.focus);
    ctx.strokeStyle = focusLineActive ? '#4ade80' : 'rgba(74,222,128,0.7)';
    ctx.lineWidth = focusLineActive ? 2 : 1.4; ctx.setLineDash([4, 4]);
    line(ctx, xf, 50, xf, axisY - 6); ctx.setLineDash([]);
    const hw = 46;
    ctx.fillStyle = focusLineActive ? '#4ade80' : '#1f3b2a'; ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 1.2;
    rr(ctx, xf - hw, 32, hw * 2, 20, 10); ctx.stroke();
    ctx.fillStyle = focusLineActive ? '#0b1a10' : '#4ade80';
    poly(ctx, [[xf - hw + 6, 42], [xf - hw + 12, 37], [xf - hw + 12, 47]]);
    poly(ctx, [[xf + hw - 6, 42], [xf + hw - 12, 37], [xf + hw - 12, 47]]);
    text(ctx, `focus ${fmtD(S.focus)}`, xf, 42.5, { color: focusLineActive ? '#0b1a10' : '#c9f5d8', size: 11, align: 'center', weight: 600 });
    text(ctx, 'drag', xf, 62, { color: 'rgba(74,222,128,0.7)', size: 10, align: 'center' });

    // camera body and lens barrel
    ctx.fillStyle = '#151922'; ctx.strokeStyle = '#2c3240'; ctx.lineWidth = 1.5;
    rr(ctx, sensorX - 30, cy - bodyHalf, 80, bodyHalf * 2, 12); ctx.stroke();
    ctx.fillStyle = 'rgba(21,25,34,0.75)';
    const barrelX = lensX - lensGroups(G).gf - 13;
    ctx.fillRect(barrelX, cy - gH - 14, sensorX - 30 - barrelX, (gH + 14) * 2);
    ctx.strokeRect(barrelX, cy - gH - 14, sensorX - 30 - barrelX, (gH + 14) * 2);

    // rays
    const spots = [];
    const on = OBJ_KEYS.filter((k) => S.rays[k]);
    const nRays = on.length > 3 ? 7 : 13;
    if (S.everywhere) drawEverywhere(ctx, G);
    for (const key of ['mtn', 'bg', 'tree', 'car', 'wall', 'fg', 'subj']) if (S.rays[key]) spots.push(drawSource(ctx, G, key, A, sh, nRays));

    // lens glass
    // A real lens is several pieces of glass with the aperture in the middle.
    // The bending is drawn at the aperture plane (thin lens model).
    const LG = lensGroups(G), fxg = lensX - LG.gf, rxg = lensX + LG.gr;
    ctx.fillStyle = 'rgba(120,190,255,0.16)'; ctx.strokeStyle = 'rgba(160,210,255,0.7)'; ctx.lineWidth = 1.5;
    ellipse(ctx, fxg, cy, 7, gH + 6); ctx.stroke();
    if (!isZoom()) { ellipse(ctx, rxg, cy, 6, gH); ctx.stroke(); }
    else {
      // concave group: thin in the middle, thick at the edges
      const h = gH * 0.85, w = 7;
      ctx.beginPath(); ctx.moveTo(rxg - w, cy - h); ctx.lineTo(rxg + w, cy - h);
      ctx.quadraticCurveTo(rxg + 1, cy, rxg + w, cy + h); ctx.lineTo(rxg - w, cy + h);
      ctx.quadraticCurveTo(rxg - 1, cy, rxg - w, cy - h); ctx.closePath();
      ctx.fillStyle = 'rgba(255,170,120,0.16)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,190,150,0.8)'; ctx.stroke();
    }

    // aperture blades
    ctx.fillStyle = '#4a505d'; ctx.strokeStyle = '#6b7282'; ctx.lineWidth = 1;
    ctx.fillRect(lensX - 3, cy - gH - 12, 6, gH + 12 - aH); ctx.strokeRect(lensX - 3, cy - gH - 12, 6, gH + 12 - aH);
    ctx.fillRect(lensX - 3, cy + aH, 6, gH + 12 - aH); ctx.strokeRect(lensX - 3, cy + aH, 6, gH + 12 - aH);
    text(ctx, `aperture f/${S.N} (inside the lens)`, lensX, cy + gH + 30, { size: 12, align: 'center', weight: 600, color: '#e7e9ee' });
    text(ctx, `opening ${G.D.toFixed(1)} mm`, lensX, cy + gH + 45, { size: 11, align: 'center', color: '#98a1b0' });
    const lblY = cy - gH - 22;
    if (!isZoom()) {
      text(ctx, 'Front glass', fxg - 5, lblY - 26, { size: 11, align: 'right', color: '#a8d2ff', weight: 600 });
      text(ctx, 'convex lens', fxg - 5, lblY - 13, { size: 10, align: 'right', color: '#a8d2ff' });
      text(ctx, 'bends light inward', fxg - 5, lblY, { size: 10, align: 'right', color: '#7fb4e8' });
      text(ctx, 'Rear glass', rxg + 5, lblY - 26, { size: 11, align: 'left', color: '#a8d2ff', weight: 600 });
      text(ctx, 'convex lens', rxg + 5, lblY - 13, { size: 10, align: 'left', color: '#a8d2ff' });
      text(ctx, 'bends it inward again', rxg + 5, lblY, { size: 10, align: 'left', color: '#7fb4e8' });
    } else {
      const showG = S.zoomGroups;
      text(ctx, 'Front group', fxg - 5, lblY - 26, { size: 11, align: 'right', color: '#a8d2ff', weight: 600 });
      text(ctx, showG ? `convex, f₁ = +${ZOOM.f1} mm` : 'convex lens', fxg - 5, lblY - 13, { size: 10, align: 'right', color: '#a8d2ff' });
      text(ctx, 'bends light inward strongly', fxg - 5, lblY, { size: 10, align: 'right', color: '#7fb4e8' });
      text(ctx, 'Rear group', rxg + 5, lblY - 26, { size: 11, align: 'left', color: '#ffc29e', weight: 600 });
      text(ctx, showG ? `concave, f₂ = ${ZOOM.f2} mm` : 'concave lens', rxg + 5, lblY - 13, { size: 10, align: 'left', color: '#ffc29e' });
      text(ctx, 'spreads it back out a little', rxg + 5, lblY, { size: 10, align: 'left', color: '#e8a882' });
      if (showG) {
        const sy = cy + gH + 8;
        ctx.strokeStyle = '#ffd08a'; ctx.lineWidth = 1.2;
        line(ctx, fxg, sy, rxg, sy); line(ctx, fxg, sy - 4, fxg, sy + 4); line(ctx, rxg, sy - 4, rxg, sy + 4);
        text(ctx, `spacing ${zoomSpacing(S.f).toFixed(1)} mm`, rxg + 8, sy - 6, { size: 11, color: '#ffd08a', weight: 600 });
        text(ctx, `→ f = ${S.f} mm`, rxg + 8, sy + 8, { size: 11, color: '#ffd08a', weight: 600 });
      }
    }
    ctx.strokeStyle = 'rgba(160,210,255,0.35)'; ctx.lineWidth = 1;
    line(ctx, fxg - 1, lblY + 6, fxg, cy - gH - 7); line(ctx, rxg + 1, lblY + 6, rxg, cy - gH - 1);

    // shutter curtains
    const shX = sensorX - 12, shTop = cy - sHalf, shH = sHalf * 2;
    ctx.fillStyle = '#7d8696';
    if (!sh) {
      ctx.fillRect(shX, shTop - 22, 4, 18); ctx.fillRect(shX, shTop + shH + 4, 4, 18);
    } else {
      ctx.fillRect(shX, shTop + sh.p1 * shH, 4, (1 - sh.p1) * shH);
      ctx.fillRect(shX, shTop, 4, sh.p2 * shH);
    }
    text(ctx, 'shutter', shX + 2, shTop - 32, { size: 11, align: 'center', color: '#a3abb9' });

    // sensor
    const sg = ctx.createLinearGradient(sensorX, 0, sensorX + 5, 0);
    sg.addColorStop(0, '#4ade80'); sg.addColorStop(1, '#1f7a44');
    ctx.fillStyle = sg; ctx.fillRect(sensorX - 2, cy - sHalf, 6, sHalf * 2);
    text(ctx, 'sensor', sensorX + 2, cy + sHalf + 16, { size: 12, align: 'center', weight: 600, color: '#4ade80' });
    text(ctx, `${G.sen.label}, ${G.sen.h} mm tall`, sensorX + 2, cy + sHalf + 31, { size: 10, align: 'center', color: '#98a1b0' });
    text(ctx, 'image lands upside down', sensorX + 2, cy + sHalf + 45, { size: 10, align: 'center', color: '#98a1b0' });

    // where light lands on the sensor
    const sTop = cy - sHalf, sBot = cy + sHalf;
    for (const sp of spots) {
      let y1 = Math.min(sp.y1, sp.y2), y2 = Math.max(sp.y1, sp.y2);
      if (y2 < sTop || y1 > sBot) {
        const yy = y2 < sTop ? Math.max(y2, 40) : Math.min(y1, axisY - 20);
        ctx.fillStyle = rgba(sp.color, 0.9); ctx.fillRect(sensorX - 3, yy - 1, 8, 3);
        text(ctx, 'misses the sensor (outside the frame)', sensorX - 16, yy, { size: 10, align: 'right', color: rgba(sp.color, 1) });
        continue;
      }
      y1 = Math.max(y1, sTop); y2 = Math.min(y2, sBot);
      ctx.save(); ctx.shadowColor = rgba(sp.color, 1); ctx.shadowBlur = 10;
      ctx.fillStyle = rgba(sp.color, 0.95);
      ctx.fillRect(sensorX - 3, y1 - 1.5, 8, Math.max(3, y2 - y1 + 3));
      ctx.restore();
    }

    // focal point F: where light from very far away comes together
    const Fx = G.Fx, py = Math.min(aH, gH * 0.55) * 0.85;
    ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
    for (const yy of [cy - py, cy + py]) { line(ctx, lensX - 110, yy, lensX, yy); line(ctx, lensX, yy, Fx, cy); }
    ctx.restore();
    text(ctx, 'light from far away', lensX - 112, cy - py - 9, { size: 10, color: 'rgba(255,255,255,0.55)' });
    ctx.fillStyle = '#fff'; poly(ctx, [[Fx, cy - 5], [Fx + 5, cy], [Fx, cy + 5], [Fx - 5, cy]]);
    text(ctx, 'F', Fx, cy - 13, { size: 12, align: 'center', color: '#fff', weight: 700 });

    // lens to sensor distance
    const dimY = Math.max(16, cy - Math.max(gH + 64, bodyHalf + 20) - 14);
    ctx.strokeStyle = '#6b7282'; ctx.lineWidth = 1;
    line(ctx, lensX, dimY, sensorX, dimY);
    line(ctx, lensX, dimY - 5, lensX, dimY + 5); line(ctx, sensorX, dimY - 5, sensorX, dimY + 5);
    text(ctx, `lens to sensor ${G.v.toFixed(2)} mm (changes when you focus)`, (lensX + sensorX) / 2, dimY - 11,
      { size: 11, align: 'center', color: '#c9d1dc' });

    // focal length (fixed) and focus extension (changes)
    const brY = cy + Math.max(gH + 82, bodyHalf + 56);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    line(ctx, lensX, brY, Fx, brY); line(ctx, lensX, brY - 5, lensX, brY + 5); line(ctx, Fx, brY - 5, Fx, brY + 5);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    line(ctx, Fx, cy + 6, Fx, brY - 5); ctx.setLineDash([]);
    text(ctx, `focal length ${S.f} mm`, (lensX + Fx) / 2, brY - 11, { size: 12, align: 'center', color: '#fff', weight: 600 });
    text(ctx, 'lens to F, fixed by the glass', (lensX + Fx) / 2, brY + 13, { size: 10, align: 'center', color: '#98a1b0' });
    const ext = G.v - S.f;
    ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2.5; line(ctx, Fx, brY, sensorX, brY);
    text(ctx, `+${ext.toFixed(2)} mm`, sensorX + 8, brY, { size: 11, color: '#4ade80', weight: 600 });
    text(ctx, 'focus extension', sensorX + 8, brY + 13, { size: 10, color: '#4ade80' });
    if (S.focus <= mfd() + 1e-6) {
      text(ctx, `lens fully extended: closest focus ${fmtD(mfd())}`, (lensX + sensorX) / 2, dimY - 26,
        { size: 11, align: 'center', color: '#ff7a7a', weight: 600 });
    }

    // scale bar and stretch note
    const sbY = cy + bodyHalf + 16, sbX2 = sensorX + 50;
    ctx.strokeStyle = '#98a1b0'; ctx.lineWidth = 2; line(ctx, sbX2 - 10 * sc, sbY, sbX2, sbY);
    text(ctx, '10 mm', sbX2 - 5 * sc, sbY + 11, { size: 10, align: 'center', color: '#98a1b0' });
    if (A > 1.05 || G.E > 1.05) {
      text(ctx, `stretched to be visible: lens movement ×${G.E.toFixed(0)}, focus shifts ×${A.toFixed(0)}`, DW - 14, axisY + 14,
        { size: 10, align: 'right', color: '#7b8494' });
    }

    // scene objects
    for (const key of OBJ_KEYS) drawObjectIcon(ctx, G, key);
    if (photons.on) drawPhotons(ctx, G);
  }

  function drawSource(ctx, G, key, A, sh, n) {
    const o = OBJ[key];
    const X = objX(G, o.d), Y = G.cy + o.dy;
    const vd = imgDist(S.f, o.d);
    const ix = G.sensorX + (vd - G.v) * G.sc * A;   // where these rays meet
    const m = (G.cy - Y) / (G.lensX - X);            // straight ray through lens center
    const iy = G.cy + m * (ix - G.lensX);
    const yAt = (yl, x) => (Math.abs(ix - G.lensX) < 1e-6 ? yl : yl + ((iy - yl) * (x - G.lensX)) / (ix - G.lensX));
    const top = G.cy - G.aH, bot = G.cy + G.aH, sx = G.sensorX - 2;

    // light cones
    ctx.fillStyle = rgba(o.color, 0.07);
    poly(ctx, [[X, Y], [G.lensX, top], [G.lensX, bot]]);
    ctx.fillStyle = rgba(o.color, 0.15);
    if (ix < sx) {
      poly(ctx, [[G.lensX, top], [G.lensX, bot], [ix, iy]]);
      poly(ctx, [[ix, iy], [sx, yAt(top, sx)], [sx, yAt(bot, sx)]]);
    } else {
      poly(ctx, [[G.lensX, top], [sx, yAt(top, sx)], [sx, yAt(bot, sx)], [G.lensX, bot]]);
    }

    // Each ray bends twice: about half at the front glass, the rest at the rear glass.
    // yl is where the ray crosses the aperture plane.
    const LG = lensGroups(G), fx = G.lensX - LG.gf, rx = G.lensX + LG.gr;
    const bend = (yl) => {
      const m1 = (yl - Y) / (G.lensX - X);
      const m2 = (iy - yl) / (ix - G.lensX || 1e-6);
      const mm = m1 + (m2 - m1) * LG.over;            // direction between the two glass groups
      const yf = yl - mm * LG.gf, yr = yl + mm * LG.gr;
      const after = ix - rx < 4
        ? (x) => yr + m2 * (x - rx)
        : (x) => yr + ((iy - yr) * (x - rx)) / (ix - rx);
      return { yf, yr, after };
    };
    const pathTo = (yl, ex, ey, b) => {
      ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(fx, b.yf); ctx.lineTo(G.lensX, yl);
      ctx.lineTo(rx, b.yr); ctx.lineTo(ex, ey); ctx.stroke();
    };

    // individual rays: the ones that hit a blade stop there
    ctx.lineWidth = 1.1;
    for (let i = 0; i < n; i++) {
      const yl = G.cy - G.gH + (i * 2 * G.gH) / (n - 1);
      const pass = Math.abs(yl - G.cy) <= G.aH + 0.01;
      const b = bend(yl);
      ctx.strokeStyle = rgba(o.color, pass ? 0.8 : 0.2);
      if (!pass) {
        ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(fx, b.yf); ctx.lineTo(G.lensX - 3, yl); ctx.stroke();
        continue;
      }
      let ex = sx, ey = b.after(sx);
      if (sh) {
        const u = (ey - (G.cy - G.sHalf)) / (2 * G.sHalf);
        if (u >= 0 && u <= 1 && (u > sh.p1 || u < sh.p2)) { ex = G.sensorX - 12; ey = b.after(ex); }
      }
      pathTo(yl, ex, ey, b);
    }
    // edge rays of the opening, drawn brighter
    ctx.strokeStyle = rgba(o.color, 1); ctx.lineWidth = 1.6;
    for (const yl of [top, bot]) { const b = bend(yl); pathTo(yl, sx, b.after(sx), b); }

    if (Math.abs(ix - sx) > 4) {
      if (ix > sx) {
        ctx.setLineDash([3, 4]); ctx.strokeStyle = rgba(o.color, 0.5); ctx.lineWidth = 1;
        line(ctx, sx, yAt(top, sx), ix, iy); line(ctx, sx, yAt(bot, sx), ix, iy); ctx.setLineDash([]);
        ctx.strokeStyle = rgba(o.color, 0.9); ctx.beginPath(); ctx.arc(ix, iy, 4, 0, Math.PI * 2); ctx.stroke();
        if (ix < DW - 10) text(ctx, 'would meet here', ix, iy + 14, { size: 10, align: 'center', color: rgba(o.color, 0.9) });
      } else {
        ctx.fillStyle = rgba(o.color, 1); circle(ctx, ix, iy, 3);
      }
    }
    return { y1: yAt(top, sx), y2: yAt(bot, sx), color: o.color };
  }

  function drawObjectIcon(ctx, G, key) {
    const o = OBJ[key], on = S.rays[key];
    const X = objX(G, o.d), Y = G.cy + o.dy;
    const c = rgba(o.color, on ? 1 : 0.35);
    ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 2;
    if (key === 'subj') {
      circle(ctx, X, Y, 7);
      line(ctx, X, Y + 8, X, Y + 40); line(ctx, X - 12, Y + 20, X + 12, Y + 20);
      line(ctx, X, Y + 40, X - 9, Y + 62); line(ctx, X, Y + 40, X + 9, Y + 62);
    } else if (key === 'bg') {
      ctx.lineWidth = 1.5; line(ctx, X - 26, Y - 6, X - 26, Y + 70); line(ctx, X + 26, Y - 6, X + 26, Y + 70);
      ctx.beginPath(); ctx.moveTo(X - 26, Y - 6); ctx.quadraticCurveTo(X, Y + 12, X + 26, Y - 6); ctx.stroke();
      for (const dx of [-16, 0, 16]) circle(ctx, X + dx, Y + (dx ? 0 : 3), dx ? 3 : 5);
    } else if (key === 'car') {
      rr(ctx, X - 16, Y - 5, 32, 10, 3); rr(ctx, X - 9, Y - 11, 17, 7, 3);
      ctx.fillStyle = '#0b0d11'; circle(ctx, X - 9, Y + 6, 3.5); circle(ctx, X + 9, Y + 6, 3.5);
    } else if (key === 'tree') {
      ctx.lineWidth = 3; line(ctx, X, Y + 18, X, Y + 60);
      circle(ctx, X, Y + 14, 14); ctx.fillStyle = 'rgba(11,13,17,0.35)'; circle(ctx, X + 4, Y + 18, 7);
    } else if (key === 'wall') {
      ctx.fillStyle = rgba(o.color, on ? 0.35 : 0.15); ctx.fillRect(X - 9, Y - 26, 18, 80);
      ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.strokeRect(X - 9, Y - 26, 18, 80);
      ctx.lineWidth = 1; ctx.strokeStyle = rgba(o.color, on ? 0.6 : 0.25);
      for (let yy = Y - 16; yy < Y + 54; yy += 10) line(ctx, X - 9, yy, X + 9, yy);
      text(ctx, 'drag', X, Y + 64, { size: 10, align: 'center', color: rgba(o.color, 0.8) });
    } else if (key === 'mtn') {
      poly(ctx, [[X - 24, Y + 30], [X, Y], [X + 26, Y + 30]]);
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; poly(ctx, [[X - 6, Y + 7], [X, Y], [X + 6, Y + 7]]);
    } else {
      for (let i = 0; i < 4; i++) ellipse(ctx, X - 8 + i * 6, Y + (i % 2 ? 5 : -5), 9, 4, i % 2 ? 0.6 : -0.6);
    }
    ctx.fillStyle = '#fff'; circle(ctx, X, Y, on ? 2.2 : 1.4);
    const sharp = cocMM(o.d) < dof().c;
    const below = o.dy > 0;
    text(ctx, `${o.name} ${fmtD(o.d)}${sharp ? '  ✓ sharp' : ''}`, X, below ? Y + 24 : Y - 20,
      { size: 11, align: 'center', color: c, weight: 600 });
    if (key === 'subj') text(ctx, 'drag me', X, Y + 76, { size: 10, align: 'center', color: rgba(o.color, 0.8) });
    if (o.dy < 0 && key !== 'bg' && key !== 'wall') { ctx.strokeStyle = rgba(o.color, 0.25); ctx.setLineDash([2, 3]); ctx.lineWidth = 1; line(ctx, X, Y + (key === 'subj' ? 64 : key === 'tree' ? 62 : key === 'mtn' ? 30 : 8), X, G.cy); ctx.setLineDash([]); }
  }

  /* ------------------------------------------- light particle animation */

  // Same ray geometry as drawSource, packaged for the particles.
  function sourceGeom(G, key) {
    const o = OBJ[key], X = objX(G, o.d), Y = G.cy + o.dy;
    const vd = imgDist(S.f, o.d);
    const ix = G.sensorX + (vd - G.v) * G.sc * lastA;
    const m = (G.cy - Y) / (G.lensX - X), iy = G.cy + m * (ix - G.lensX);
    const LG = lensGroups(G), fx = G.lensX - LG.gf, rx = G.lensX + LG.gr, sx = G.sensorX - 2;
    const bend = (yl) => {
      const m1 = (yl - Y) / (G.lensX - X), m2 = (iy - yl) / (ix - G.lensX || 1e-6), mm = m1 + (m2 - m1) * LG.over;
      const yf = yl - mm * LG.gf, yr = yl + mm * LG.gr;
      const after = ix - rx < 4 ? (x) => yr + m2 * (x - rx) : (x) => yr + ((iy - yr) * (x - rx)) / (ix - rx);
      return { yf, yr, after };
    };
    const path = (yl, pass) => {
      const b = bend(yl);
      return pass
        ? [[X, Y], [fx, b.yf], [G.lensX, yl], [rx, b.yr], [sx, b.after(sx)]]
        : [[X, Y], [fx, b.yf], [G.lensX - 3, yl]];
    };
    return { o, X, Y, path };
  }

  function strayEnd(G, X, Y, a) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let t = 3000;
    const hitV = (x, half) => {
      if (dx <= 0) return;
      const tt = (x - X) / dx, yy = Y + dy * tt;
      if (tt > 0 && Math.abs(yy - G.cy) <= half) t = Math.min(t, tt);
    };
    const bodyHalf = Math.max(G.sHalf + 40, 100);
    hitV(G.lensX - lensGroups(G).gf - 13, G.gH + 14);   // front of the lens barrel
    hitV(G.sensorX - 30, bodyHalf);       // front of the camera body
    // canvas edges
    if (dx > 0) t = Math.min(t, (DW - X) / dx); if (dx < 0) t = Math.min(t, -X / dx);
    if (dy > 0) t = Math.min(t, (DH - Y) / dy); if (dy < 0) t = Math.min(t, -Y / dy);
    return [X + dx * t, Y + dy * t];
  }
  // Light leaving a subject in every direction. Only a thin cone reaches the lens opening.
  function drawEverywhere(ctx, G) {
    const on = OBJ_KEYS.filter((k) => S.rays[k]);
    for (const key of on) {
      const o = OBJ[key], X = objX(G, o.d), Y = G.cy + o.dy;
      const glow = ctx.createRadialGradient(X, Y, 0, X, Y, 60);
      glow.addColorStop(0, rgba(o.color, 0.22)); glow.addColorStop(1, rgba(o.color, 0));
      ctx.fillStyle = glow; circle(ctx, X, Y, 60);
      const n = on.length > 3 ? 36 : 60;
      ctx.lineWidth = 1;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.03;
        const [ex, ey] = strayEnd(G, X, Y, a);
        const g = ctx.createLinearGradient(X, Y, ex, ey);
        g.addColorStop(0, rgba(o.color, 0.35)); g.addColorStop(1, rgba(o.color, 0.04));
        ctx.strokeStyle = g; line(ctx, X, Y, ex, ey);
      }
    }
    const k = on.includes('subj') ? 'subj' : on[0];
    if (k) {
      const X = objX(G, OBJ[k].d), Y = G.cy + OBJ[k].dy;
      text(ctx, 'light scatters in every direction', X + 14, Y - 40, { size: 11, color: '#ffffff', weight: 600 });
      text(ctx, 'only the thin cone toward the lens is caught', X + 14, Y - 27, { size: 10, color: '#c9d1dc' });
    }
  }

  const photons = { on: false, list: [], hits: [], blocks: [], passed: 0, blocked: 0, glow: 0, last: 0, spawnAcc: 0, statT: 0 };
  const PHOTON_SPEED = 430, PHOTON_RATE = 16;   // px per second, particles per second per subject

  function spawnStray(G, key) {
    const o = OBJ[key], X = objX(G, o.d), Y = G.cy + o.dy;
    const a = Math.random() * Math.PI * 2, end = strayEnd(G, X, Y, a);
    const len = Math.hypot(end[0] - X, end[1] - Y);
    photons.list.push({ pts: [[X, Y], end], cum: [0, len], len, s: 0, pass: false, stray: true, color: o.color });
  }
  function spawnPhoton(G, key) {
    const g = sourceGeom(G, key);
    const yl = G.cy + (Math.random() * 2 - 1) * G.gH;
    const pass = Math.abs(yl - G.cy) <= G.aH;
    const pts = g.path(yl, pass), cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    photons.list.push({ pts, cum, len: cum[cum.length - 1], s: 0, pass, color: g.o.color });
  }
  function photonPos(p, s) {
    s = clamp(s, 0, p.len);
    let i = 1; while (i < p.cum.length - 1 && p.cum[i] < s) i++;
    const a = p.pts[i - 1], b = p.pts[i], seg = p.cum[i] - p.cum[i - 1] || 1, t = (s - p.cum[i - 1]) / seg;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  function photonTick(now) {
    if (!photons.on) return;
    const dt = Math.min(0.05, (now - (photons.last || now)) / 1000); photons.last = now;
    const G = geometry(), on = OBJ_KEYS.filter((k) => S.rays[k]);
    photons.spawnAcc += dt * PHOTON_RATE;
    while (photons.spawnAcc >= 1) {
      photons.spawnAcc -= 1; on.forEach((k) => spawnPhoton(G, k));
      if (S.everywhere) on.forEach((k) => { for (let j = 0; j < 4; j++) spawnStray(G, k); });
    }
    let arrived = 0;
    photons.list = photons.list.filter((p) => {
      p.s += PHOTON_SPEED * dt;
      if (p.s < p.len) return true;
      const end = p.pts[p.pts.length - 1];
      if (p.stray) return false;
      if (p.pass) { photons.passed++; arrived++; photons.hits.push({ x: end[0], y: end[1], c: p.color, t: 1 }); }
      else { photons.blocked++; photons.blocks.push({ x: end[0], y: end[1], t: 1 }); }
      return false;
    });
    photons.hits.forEach((h) => { h.t -= dt * 2.5; }); photons.hits = photons.hits.filter((h) => h.t > 0);
    photons.blocks.forEach((h) => { h.t -= dt * 1.8; }); photons.blocks = photons.blocks.filter((h) => h.t > 0);
    photons.glow += (arrived / Math.max(dt, 1e-3) / (PHOTON_RATE * Math.max(1, on.length)) - photons.glow) * Math.min(1, dt * 3);
    drawDiagram();
    if (now - photons.statT > 200) { photons.statT = now; updateLightStats(); }
    requestAnimationFrame(photonTick);
  }
  function drawPhotons(ctx, G) {
    const { cy, lensX, sensorX, sHalf, gH, aH } = G;
    // the center ray: always passes, and decides where the point lands
    ctx.save();
    for (const key of OBJ_KEYS) {
      if (!S.rays[key]) continue;
      const pts = sourceGeom(G, key).path(cy, true);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.setLineDash([8, 5]);
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach((q) => ctx.lineTo(q[0], q[1])); ctx.stroke();
    }
    ctx.restore();
    text(ctx, 'white dashed: center ray, always passes, decides WHERE each point lands', lensX - 30, cy + gH + 66,
      { size: 10, align: 'right', color: '#ffffff' });
    if (gH - aH > 6) {
      text(ctx, 'blocked by blades', lensX - 24, cy - (gH + aH) / 2 + 4, { size: 10, align: 'right', color: '#ff7a7a', weight: 600 });
      text(ctx, 'blocked by blades', lensX - 20, cy + (gH + aH) / 2, { size: 10, align: 'right', color: '#ff7a7a', weight: 600 });
    }
    // sensor glow: brighter when more light gets through
    const g = clamp(photons.glow, 0, 1);
    ctx.save(); ctx.shadowColor = '#b6ffcf'; ctx.shadowBlur = 25 * g;
    ctx.fillStyle = `rgba(210,255,225,${0.15 + 0.75 * g})`; ctx.fillRect(sensorX - 2, cy - sHalf, 6, sHalf * 2);
    ctx.restore();
    // particles
    for (const p of photons.list) {
      const [x, y] = photonPos(p, p.s), [tx, ty] = photonPos(p, p.s - 22);
      const grad = ctx.createLinearGradient(tx, ty, x, y);
      grad.addColorStop(0, rgba(p.color, 0)); grad.addColorStop(1, rgba(p.color, p.stray ? 0.35 : p.pass ? 0.9 : 0.6));
      ctx.strokeStyle = grad; ctx.lineWidth = p.stray ? 1.4 : 2.2; line(ctx, tx, ty, x, y);
      ctx.fillStyle = p.stray ? rgba(p.color, 0.7) : '#fff'; circle(ctx, x, y, p.stray ? 1.4 : 2);
    }
    for (const h of photons.hits) {
      ctx.fillStyle = rgba(h.c, h.t * 0.8); circle(ctx, h.x, h.y, 3 + (1 - h.t) * 6);
    }
    for (const b of photons.blocks) {
      ctx.strokeStyle = `rgba(255,90,90,${b.t})`; ctx.lineWidth = 1.6;
      line(ctx, b.x - 4, b.y - 4, b.x + 4, b.y + 4); line(ctx, b.x - 4, b.y + 4, b.x + 4, b.y - 4);
    }
  }
  function updateLightStats() {
    const total = photons.passed + photons.blocked;
    const pct = total ? Math.round((photons.passed / total) * 100) : 0;
    const area = Math.round(((minN(S.f) / S.N) ** 2) * 100);
    $('#lightStats').innerHTML = total
      ? `<b>${photons.passed}</b> reached the sensor, <b class="bad">${photons.blocked}</b> blocked (${pct}% got through in this side view). Real opening is a circle, so it passes ${area}% of the light the lens can take in.`
      : 'Dots of light leave each subject in every direction toward the lens.';
    $('#lightBar').style.width = `${pct}%`;
  }
  function togglePhotons() {
    photons.on = !photons.on;
    $('#playLight').textContent = photons.on ? '❚❚ Pause light' : '▶ Play light';
    $('#playLight').classList.toggle('on', photons.on);
    $('.light-sim').classList.toggle('active', photons.on);
    if (photons.on) {
      Object.assign(photons, { list: [], hits: [], blocks: [], passed: 0, blocked: 0, glow: 0, last: 0, spawnAcc: 0 });
      updateLightStats(); requestAnimationFrame(photonTick);
    } else drawDiagram();
  }

  /* ------------------------------------------------------ small canvases */

  const irisCtx = fitCanvas($('#iris'), 72, 72);
  function drawIris() {
    const ctx = irisCtx, cx = 36, cy = 36, R = 32;
    ctx.clearRect(0, 0, 72, 72);
    ctx.fillStyle = '#07080b'; circle(ctx, cx, cy, R + 3);
    const g = ctx.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, R);
    g.addColorStop(0, '#6a8fb8'); g.addColorStop(1, '#16253a');
    ctx.fillStyle = g; circle(ctx, cx, cy, R);
    const ratio = minN(S.f) / S.N, r = R * ratio, rot = S.N * 0.3;
    const pts = [];
    for (let i = 0; i < 7; i++) { const a = rot + (i * Math.PI * 2) / 7; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    if (ratio > 0.97) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, Math.PI * 2, true); }
    else { ctx.moveTo(pts[0][0], pts[0][1]); pts.forEach((p) => ctx.lineTo(p[0], p[1])); ctx.closePath(); }
    ctx.fillStyle = '#2b2f38'; ctx.fill('evenodd');
    if (ratio <= 0.97) {
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
      ctx.strokeStyle = '#535a68'; ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const a = pts[i], b = pts[(i + 1) % 7], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
        line(ctx, a[0], a[1], b[0] + (dx / L) * R * 2, b[1] + (dy / L) * R * 2);
      }
      ctx.restore();
    }
    ctx.strokeStyle = '#3a404c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  }

  const SPW = 320, SPH = 170;
  const spCtx = fitCanvas($('#spots'), SPW, SPH);
  function drawSpots() {
    const ctx = spCtx, span = 4, box = { x: 6, y: 6, w: SPW - 12, h: SPH - 40 };
    const pxmm = box.w / span;
    ctx.clearRect(0, 0, SPW, SPH);
    ctx.fillStyle = '#0d1a12'; ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = 'rgba(74,222,128,0.12)'; ctx.lineWidth = 1;
    for (let x = 0; x <= span; x += 0.5) line(ctx, box.x + x * pxmm, box.y, box.x + x * pxmm, box.y + box.h);
    for (let y = 0; y <= box.h; y += pxmm / 2) line(ctx, box.x, box.y + y, box.x + box.w, box.y + y);
    ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    const keys = OBJ_KEYS, cell = box.w / keys.length;
    keys.forEach((k, i) => {
      const o = OBJ[k], c = cocMM(o.d), x = box.x + cell * (i + 0.5), y = box.y + box.h / 2;
      const r = Math.max(1.5, (c * pxmm) / 2);
      ctx.save(); ctx.beginPath(); ctx.rect(box.x + cell * i + 1, box.y, cell - 2, box.h); ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(o.color, 0.55); apertureShape(ctx, x, y, r, 0.3); ctx.fill();
      ctx.strokeStyle = rgba(o.color, 0.9); ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
    keys.forEach((k, i) => {
      const o = OBJ[k], c = cocMM(o.d), x = box.x + cell * (i + 0.5);
      text(ctx, o.name, x, SPH - 24, { size: 10, align: 'center', color: rgba(o.color, 1), weight: 600 });
      text(ctx, c < dof().c ? 'sharp' : c.toFixed(2), x, SPH - 10, { size: 10, align: 'center', mono: true });
    });
    text(ctx, '4 mm of sensor, zoomed in (sizes in mm)', box.x + box.w - 6, box.y + 10, { size: 10, align: 'right', color: '#6f9c7f' });
  }

  /* ---------------------------------------------------------- photo scene */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(11);
  const TUFTS = [];
  for (let i = 0; i < 700; i++) {
    const Z = 1 / (rnd() * (1 / 0.8 - 1 / 120) + 1 / 120);
    const X = (rnd() - 0.5) * Z * 2.4;
    if (Math.abs(X) < 0.9) continue;
    TUFTS.push({ X, Z, w: 0.08 + rnd() * 0.12, h: 0.04 + rnd() * 0.06, c: rnd() < 0.5 ? '#2b4520' : '#587534' });
  }
  const TREES = [
    { x: -13, z: 22, h: 7 }, { x: -8.5, z: 19, h: 5.6 }, { x: -4.4, z: 24, h: 6.8 },
    { x: 5.4, z: 21, h: 6.2 }, { x: 9.6, z: 18, h: 7.4 }, { x: 14.5, z: 23, h: 6 },
  ].map((t) => {
    const blobs = [];
    for (let i = 0; i < 8; i++) blobs.push({ dx: (rnd() - 0.5) * 2.4, dy: t.h * (0.5 + rnd() * 0.42), r: 1 + rnd() * 0.8 });
    return { ...t, blobs };
  });
  const BULB_COLORS = ['255,214,140', '255,186,105', '255,240,205'];

  const FILTER_OK = (() => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 9;
      const x = c.getContext('2d'); if (!('filter' in x)) return false;
      x.filter = 'blur(2px)'; x.fillStyle = '#fff'; x.fillRect(4, 4, 1, 1);
      return x.getImageData(2, 4, 1, 1).data[3] > 0;
    } catch (e) { return false; }
  })();

  const pool = {};
  function layer(name, w, h) {
    let c = pool[name];
    if (!c) c = pool[name] = document.createElement('canvas');
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    if (FILTER_OK) x.filter = 'none';
    x.clearRect(0, 0, w, h);
    return [c, x];
  }
  // Fallback blur for browsers without ctx.filter: shrink, then scale back up.
  function blurFallback(src, sigma) {
    const s = Math.max(1.5, sigma * 1.2);
    const w = Math.max(1, Math.round(src.width / s)), h = Math.max(1, Math.round(src.height / s));
    const [a, ax] = layer('fbA', w, h);
    ax.imageSmoothingQuality = 'high'; ax.drawImage(src, 0, 0, w, h);
    const [b, bx] = layer('fbB', w * 2, h * 2);
    bx.imageSmoothingQuality = 'high'; bx.drawImage(a, 0, 0, w * 2, h * 2);
    return b;
  }
  function drawBlurred(dst, src, sigma, dx, dy) {
    if (sigma < 0.35) { dst.drawImage(src, dx, dy); return; }
    if (FILTER_OK) {
      dst.filter = `blur(${sigma.toFixed(2)}px)`; dst.drawImage(src, dx, dy); dst.filter = 'none';
    } else if (sigma < 1.2) {
      dst.drawImage(src, dx, dy);
    } else {
      dst.drawImage(blurFallback(src, sigma), dx, dy, src.width, src.height);
    }
  }
  // Draw in world metres (y up) for an object at distance Z.
  const setWorld = (x, L, Z) => x.setTransform(L.k / Z, 0, 0, -L.k / Z, L.cx, L.cy + (L.camH * L.k) / Z);

  function drawSky(x, L) {
    const { w, h, cx, cy, k } = L;
    const g = x.createLinearGradient(0, cy - 0.55 * k, 0, cy);
    g.addColorStop(0, '#1f2b5c'); g.addColorStop(0.4, '#4a4f8c'); g.addColorStop(0.72, '#c8798a');
    g.addColorStop(0.9, '#f3a96a'); g.addColorStop(1, '#ffd59a');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    const sx = cx - 0.2 * k, sy = cy - 0.06 * k;
    const glow = x.createRadialGradient(sx, sy, 0, sx, sy, 0.2 * k);
    glow.addColorStop(0, 'rgba(255,236,190,0.9)'); glow.addColorStop(0.15, 'rgba(255,210,150,0.4)'); glow.addColorStop(1, 'rgba(255,190,120,0)');
    x.fillStyle = glow; x.fillRect(0, 0, w, h);
    x.fillStyle = '#fff6dc'; circle(x, sx, sy, Math.max(1.5, 0.0047 * k));
    const ridges = [
      { b: 0.032, a: 0.018, s: 1, c: '#8d6a8a', f: [7, 17, 41] },
      { b: 0.016, a: 0.01, s: 4, c: '#5e4766', f: [11, 29, 67] },
    ];
    for (const r of ridges) {
      x.fillStyle = r.c; x.beginPath(); x.moveTo(0, h);
      for (let px = 0; px <= w; px += 3) {
        const a = (px - cx) / k;
        const e = r.b + r.a * (0.6 * Math.sin(a * r.f[0] + r.s) + 0.3 * Math.sin(a * r.f[1] + r.s * 2) + 0.1 * Math.sin(a * r.f[2]));
        x.lineTo(px, cy - e * k);
      }
      x.lineTo(w, h); x.closePath(); x.fill();
    }
  }
  function drawGround(x, L) {
    const { w, h, cx, cy, k, camH } = L;
    const P = (X, Z) => [cx + (X / Z) * k, cy + (camH * k) / Z];
    const g = x.createLinearGradient(0, cy, 0, cy + (camH * k) / 1.5);
    g.addColorStop(0, '#b8946c'); g.addColorStop(0.03, '#8c7d4c'); g.addColorStop(0.3, '#5f7438'); g.addColorStop(1, '#34501f');
    x.fillStyle = g; x.fillRect(0, cy, w, h - cy);
    const pg = x.createLinearGradient(0, cy, 0, cy + (camH * k) / 1.5);
    pg.addColorStop(0, '#e2bf93'); pg.addColorStop(0.3, '#b99a74'); pg.addColorStop(1, '#94785a');
    x.fillStyle = pg; poly(x, [P(-0.8, 0.35), P(-0.8, 800), P(0.8, 800), P(0.8, 0.35)]);
    for (let Z = 0.6; Z < 80; Z += 0.5) {
      const [x1, y] = P(-0.8, Z), [x2] = P(0.8, Z);
      if (y > h) continue;
      x.strokeStyle = `rgba(60,40,25,${0.35 * Math.min(1, 6 / Z)})`;
      x.lineWidth = Math.max(0.5, (0.02 / Z) * k); line(x, x1, y, x2, y);
    }
    for (const t of TUFTS) {
      const sx = cx + (t.X / t.Z) * k, sy = cy + (camH * k) / t.Z;
      if (sx < -20 || sx > w + 20 || sy > h + 10) continue;
      const ww = (t.w / t.Z) * k, hh = (t.h / t.Z) * k;
      if (ww < 0.5) continue;
      x.fillStyle = t.c; ellipse(x, sx, sy - hh * 0.4, ww / 2, hh / 2);
    }
  }
  function drawLights(x, L, M) {
    const bulbs = [];
    const toScreen = (X, Y, Z) => [L.cx + (X / Z) * L.k - M, L.cy - ((Y - L.camH) / Z) * L.k - M];
    let Z = 30; setWorld(x, L, Z);
    x.fillStyle = '#2b2230'; x.fillRect(-11.6, 0, 0.16, 4.9); x.fillRect(11.44, 0, 0.16, 4.9);
    const wy = (X) => 4.6 - 1.0 * (1 - (X / 11.5) ** 2);
    x.strokeStyle = '#2b2230'; x.lineWidth = 0.035; x.beginPath();
    for (let X = -11.5; X <= 11.5; X += 0.25) X === -11.5 ? x.moveTo(X, wy(X)) : x.lineTo(X, wy(X));
    x.stroke();
    let i = 0;
    for (let X = -11.2; X <= 11.2; X += 0.62, i++) {
      const [sx, sy] = toScreen(X, wy(X) - 0.08, Z);
      bulbs.push({ sx, sy, Z, size: 0.08, c: BULB_COLORS[i % 3] });
    }
    Z = 45; setWorld(x, L, Z);
    for (const X of [-19, -7, 7, 19]) {
      x.fillStyle = '#2b2230'; x.fillRect(X - 0.08, 0, 0.16, 4.2);
      const [sx, sy] = toScreen(X, 4.3, Z);
      bulbs.push({ sx, sy, Z, size: 0.35, c: '255,226,170' });
    }
    x.setTransform(1, 0, 0, 1, 0, 0);
    return bulbs;
  }
  // Out of focus points of light become discs the size of the blur spot (bokeh).
  function drawBokeh(m, bulbs, k, pxPerMM, PW, PH) {
    m.save(); m.globalCompositeOperation = 'lighter';
    const cache = {};
    for (const b of bulbs) {
      const coc = cache[b.Z] ?? (cache[b.Z] = cocMM(b.Z) * pxPerMM);
      const base = Math.max(1.4, (b.size / b.Z) * k);
      const d = Math.max(base, coc), r = d / 2;
      if (b.sx < -r || b.sx > PW + r || b.sy < -r || b.sy > PH + r) continue;
      const a = clamp((base / d) ** 2 * 2.4, 0.05, 1);
      apertureShape(m, b.sx, b.sy, r, 0.3);
      m.fillStyle = `rgba(${b.c},${a})`; m.fill();
      if (d > 8) { m.lineWidth = Math.max(1, r * 0.1); m.strokeStyle = `rgba(${b.c},${a * 0.7})`; m.stroke(); }
    }
    m.restore();
  }
  function drawTrees(x, L) {
    for (const t of TREES) {
      setWorld(x, L, t.z);
      x.fillStyle = '#3b2b22'; x.fillRect(t.x - 0.18, 0, 0.36, t.h * 0.55);
      x.fillStyle = '#2d4a2c'; for (const b of t.blobs) circle(x, t.x + b.dx, b.dy, b.r);
      x.fillStyle = '#4a6a3a'; for (const b of t.blobs) circle(x, t.x + b.dx - 0.25, b.dy + 0.2, b.r * 0.55);
    }
    x.setTransform(1, 0, 0, 1, 0, 0);
  }
  function drawCar(x, L, cx0) {
    setWorld(x, L, CAR_Z);
    x.fillStyle = 'rgba(0,0,0,0.25)'; ellipse(x, cx0, 0.02, 2.1, 0.12);
    x.fillStyle = '#2f7dd1'; rr(x, cx0 - 2, 0.28, 4, 0.62, 0.18);
    x.fillStyle = '#2a6db8'; rr(x, cx0 - 1.15, 0.85, 2.2, 0.58, 0.22);
    x.fillStyle = '#a9d4f5'; rr(x, cx0 - 1, 0.92, 0.95, 0.42, 0.1); rr(x, cx0 + 0.1, 0.92, 0.85, 0.42, 0.1);
    x.fillStyle = '#16181c'; circle(x, cx0 - 1.25, 0.32, 0.32); circle(x, cx0 + 1.25, 0.32, 0.32);
    x.fillStyle = '#8a8f99'; circle(x, cx0 - 1.25, 0.32, 0.14); circle(x, cx0 + 1.25, 0.32, 0.14);
    x.fillStyle = '#fff3c4'; rr(x, cx0 + 1.86, 0.55, 0.14, 0.12, 0.03);
    x.fillStyle = '#ff4d4d'; rr(x, cx0 - 2, 0.55, 0.1, 0.12, 0.03);
    x.setTransform(1, 0, 0, 1, 0, 0);
  }
  // A plain brick wall with a string of small lights, to show background blur and bokeh.
  const WALL_X1 = -5.2, WALL_X2 = 1.6, WALL_H = 2.6;
  function drawWall(x, L, M) {
    const Z = OBJ.wall.d; setWorld(x, L, Z);
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(WALL_X1, -0.02, WALL_X2 - WALL_X1, 0.06);
    x.fillStyle = '#a65a3e'; x.fillRect(WALL_X1, 0, WALL_X2 - WALL_X1, WALL_H);
    x.strokeStyle = '#6f3523'; x.lineWidth = 0.025;
    let row = 0;
    for (let y = 0.2; y < WALL_H; y += 0.2, row++) {
      x.beginPath(); x.moveTo(WALL_X1, y); x.lineTo(WALL_X2, y); x.stroke();
      for (let bx = WALL_X1 + (row % 2 ? 0.2 : 0.4); bx < WALL_X2; bx += 0.4) {
        x.beginPath(); x.moveTo(bx, y - 0.2); x.lineTo(bx, y); x.stroke();
      }
    }
    x.fillStyle = '#c8b8a2'; x.fillRect(WALL_X1 - 0.05, WALL_H, WALL_X2 - WALL_X1 + 0.1, 0.1);
    const wy = (X) => 2.35 - 0.25 * Math.sin(((X - WALL_X1) / (WALL_X2 - WALL_X1)) * Math.PI);
    x.strokeStyle = '#3a2a22'; x.lineWidth = 0.015; x.beginPath();
    for (let X = WALL_X1 + 0.1; X <= WALL_X2 - 0.1; X += 0.1) X === WALL_X1 + 0.1 ? x.moveTo(X, wy(X)) : x.lineTo(X, wy(X));
    x.stroke();
    x.setTransform(1, 0, 0, 1, 0, 0);
    const bulbs = [];
    let i = 0;
    for (let X = WALL_X1 + 0.25; X <= WALL_X2 - 0.2; X += 0.32, i++) {
      bulbs.push({ sx: L.cx + (X / Z) * L.k - M, sy: L.cy - ((wy(X) - 0.04 - L.camH) / Z) * L.k - M, Z, size: 0.035, c: BULB_COLORS[i % 3] });
    }
    return bulbs;
  }

  function drawPerson(x, L) {
    setWorld(x, L, OBJ.subj.d);
    x.translate(S.subjX, 0);
    x.fillStyle = 'rgba(0,0,0,0.28)'; ellipse(x, 0, 0.01, 0.35, 0.05);
    x.fillStyle = '#2b3550'; rr(x, -0.17, 0.05, 0.15, 0.85, 0.04); rr(x, 0.02, 0.05, 0.15, 0.85, 0.04);
    x.fillStyle = '#e8e2d6'; rr(x, -0.2, 0, 0.19, 0.08, 0.03); rr(x, 0.01, 0, 0.19, 0.08, 0.03);
    x.fillStyle = '#d9534f'; rr(x, -0.24, 0.82, 0.48, 0.62, 0.1);
    rr(x, -0.33, 0.88, 0.11, 0.53, 0.05); rr(x, 0.22, 0.88, 0.11, 0.53, 0.05);
    x.fillStyle = '#b8403c'; x.fillRect(-0.006, 0.84, 0.012, 0.56);
    x.fillStyle = '#e0ac8a'; circle(x, -0.275, 0.86, 0.05); circle(x, 0.275, 0.86, 0.05);
    x.fillRect(-0.045, 1.4, 0.09, 0.1);
    x.fillStyle = '#f2c14e'; rr(x, -0.14, 1.36, 0.28, 0.08, 0.03);
    x.fillStyle = '#3b2a20'; circle(x, 0, 1.6, 0.118);
    x.fillStyle = '#e0ac8a'; ellipse(x, 0, 1.565, 0.098, 0.105);
    x.fillStyle = '#3b2a20'; ellipse(x, 0, 1.655, 0.1, 0.045);
    x.setTransform(1, 0, 0, 1, 0, 0);
  }
  function drawLeaves(x, L) {
    setWorld(x, L, 1.0);
    const branch = (p0, c, p1, flip) => {
      x.strokeStyle = '#3a2a1e'; x.lineWidth = 0.012;
      x.beginPath(); x.moveTo(p0[0], p0[1]); x.quadraticCurveTo(c[0], c[1], p1[0], p1[1]); x.stroke();
      for (let i = 0; i <= 10; i++) {
        const t = 0.3 + (i / 10) * 0.7, u = 1 - t;
        const px = u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0];
        const py = u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1];
        const tx = 2 * u * (c[0] - p0[0]) + 2 * t * (p1[0] - c[0]), ty = 2 * u * (c[1] - p0[1]) + 2 * t * (p1[1] - c[1]);
        const ang = Math.atan2(ty, tx) + (i % 2 ? 0.9 : -0.9) * flip;
        x.fillStyle = i % 3 ? '#3f7d3a' : '#5e9c48';
        ellipse(x, px + Math.cos(ang) * 0.04, py + Math.sin(ang) * 0.04, 0.05, 0.02, ang);
      }
    };
    branch([-1.1, 1.95], [-0.6, 1.75], [-0.2, 1.38], 1);
    branch([1.1, 0.95], [0.6, 1.0], [0.27, 1.14], -1);
    x.setTransform(1, 0, 0, 1, 0, 0);
  }

  // Exposure and noise
  const TO_LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; TO_LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
  const toSRGB = (l) => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055) * 255;
  const tone = (v) => (v <= 0.8 ? v : 0.8 + 0.2 * (1 - Math.exp(-(v - 0.8) / 0.2)));
  const NOISE = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) NOISE[i] = (Math.random() + Math.random() + Math.random() - 1.5) * 2;

  const PW = 960, MARGIN = 130;
  let HITS = [], PHOTO_GEO = null;
  // opts.canvas / opts.width draw somewhere else (gallery samples); opts.sample skips the lab overlays.
  function renderPhoto(opts = {}) {
    const PW = opts.width || 960;
    const sen = SENSORS[S.sensor];
    const PH = Math.round((PW * sen.h) / sen.w);
    const pc = opts.canvas || $('#photo');
    if (pc.width !== PW || pc.height !== PH) { pc.width = PW; pc.height = PH; }
    const m = pc.getContext('2d');
    m.setTransform(1, 0, 0, 1, 0, 0); m.globalAlpha = 1; m.globalCompositeOperation = 'source-over';
    m.clearRect(0, 0, PW, PH);

    const v = imgDist(S.f, S.focus), k = (v / sen.w) * PW, M = MARGIN;
    const LW = PW + 2 * M, LH = PH + 2 * M;
    const L = { w: LW, h: LH, cx: LW / 2, cy: LH / 2, k, camH: CAM_H };
    const pxPerMM = PW / sen.w;
    const sig = (d) => Math.min(40, (cocMM(d) * pxPerMM) / 3);

    // clickable regions, nearest first
    const box = (key, x1, y1, x2, y2, Z) => {
      const sx = (X) => L.cx + (X / Z) * k - M, sy = (Y) => L.cy - ((Y - CAM_H) / Z) * k - M;
      return { key, x1: sx(x1), x2: sx(x2), y1: sy(y2), y2: sy(y1), Z };
    };
    const hits = [
      ...(S.hideFg ? [] : [box('fg', -1.1, 1.3, -0.15, 2.0, 1.0), box('fg', 0.2, 0.9, 1.1, 1.25, 1.0)]),
      box('subj', S.subjX - 0.34, 0, S.subjX + 0.34, 1.75, OBJ.subj.d),
      box('wall', WALL_X1, 0, WALL_X2, WALL_H, OBJ.wall.d),
      box('car', CAR_X - 2.1, 0, CAR_X + 2.1, 1.5, CAR_Z),
      ...TREES.map((t) => box('tree', t.x - 2.2, 0, t.x + 2.2, t.h + 1, t.z)),
      box('bg', -11.7, 3.3, 11.7, 5, 30),
    ].sort((a, b) => a.Z - b.Z);
    if (!opts.sample) { HITS = hits; PHOTO_GEO = { cy: L.cy - M, k, PW, PH }; }
    let c, x;

    [c, x] = layer('sky', LW, LH); drawSky(x, L); drawBlurred(m, c, sig(Infinity), -M, -M);

    // ground: blur each distance band by its own amount
    [c, x] = layer('ground', LW, LH); drawGround(x, L);
    const zs = [0.3, 0.5, 0.7, 0.9, 1.2, 1.6, 2.1, 2.8, 3.6, 4.6, 6, 8, 11, 15, 21, 30, 45, 70, 120, 250, 800, Infinity];
    for (let i = zs.length - 1; i > 0; i--) {
      const zn = zs[i - 1], zf = zs[i];
      const yTop = Math.floor(L.cy + (isFinite(zf) ? (CAM_H * k) / zf : 0) - M);
      const yBot = Math.ceil(L.cy + (CAM_H * k) / zn - M);
      if (yBot < 0 || yTop > PH) continue;
      m.save(); m.beginPath(); m.rect(0, yTop, PW, yBot - yTop + 1); m.clip();
      drawBlurred(m, c, sig(isFinite(zf) ? Math.sqrt(zn * zf) : Infinity), -M, -M);
      m.restore();
    }

    // everything else, drawn from far to near so closer things cover farther ones
    const items = [
      { z: 30, draw() {
        [c, x] = layer('lights', LW, LH);
        const bulbs = drawLights(x, L, M);
        drawBlurred(m, c, sig(30), -M, -M);
        drawBokeh(m, bulbs, k, pxPerMM, PW, PH);
      } },
      { z: 21, draw() { [c, x] = layer('trees', LW, LH); drawTrees(x, L); drawBlurred(m, c, sig(21), -M, -M); } },
      { z: CAR_Z, draw() {
        // car: smear it over the distance it travels while the shutter is open
        const [tc, tx] = layer('carTmp', LW, LH); drawCar(tx, L, CAR_X);
        [c, x] = layer('car', LW, LH);
        const motion = ((CAR_SPEED * S.t) / CAR_Z) * k;
        const n = clamp(Math.ceil(motion / 1.5), 1, 64);
        if (n === 1) x.drawImage(tc, 0, 0);
        else {
          x.globalCompositeOperation = 'lighter'; x.globalAlpha = 1 / n;
          for (let i = 0; i < n; i++) x.drawImage(tc, -motion / 2 + (motion * i) / (n - 1), 0);
          x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
        }
        drawBlurred(m, c, sig(CAR_Z), -M, -M);
      } },
      { z: OBJ.wall.d, draw() {
        [c, x] = layer('wall', LW, LH);
        const wb = drawWall(x, L, M);
        drawBlurred(m, c, sig(OBJ.wall.d), -M, -M);
        drawBokeh(m, wb, k, pxPerMM, PW, PH);
      } },
      { z: OBJ.subj.d, draw() { [c, x] = layer('subj', LW, LH); drawPerson(x, L); drawBlurred(m, c, sig(OBJ.subj.d), -M, -M); } },
      { z: 1.0, draw() { if (S.hideFg) return; [c, x] = layer('fg', LW, LH); drawLeaves(x, L); drawBlurred(m, c, sig(1.0), -M, -M); } },
    ];
    items.sort((a, b) => b.z - a.z).forEach((it) => it.draw());

    // camera shake while handheld
    if (S.handheld) {
      const shake = 0.05 * S.t * k;
      if (shake > 0.6) {
        const [sc, sx] = layer('shake', PW, PH); sx.drawImage(pc, 0, 0);
        m.clearRect(0, 0, PW, PH);
        const ns = clamp(Math.ceil(shake / 1.2), 2, 48);
        m.globalCompositeOperation = 'lighter'; m.globalAlpha = 1 / ns;
        for (let i = 0; i < ns; i++) {
          const t = i / (ns - 1) - 0.5;
          m.drawImage(sc, t * shake * 0.85, t * shake * 0.5 + Math.sin(t * 6) * shake * 0.08);
        }
        m.globalAlpha = 1; m.globalCompositeOperation = 'source-over';
      }
    }

    // exposure (brightness) and sensor noise
    const gain = 2 ** clamp(evOffset(), -10, 10);
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) lut[i] = toSRGB(tone(TO_LIN[i] * gain));
    const img = m.getImageData(0, 0, PW, PH), d = img.data;
    const sigma = 0.9 * Math.sqrt(S.iso / 100) * (36 / sen.w) ** 0.75;
    let seed = (Math.random() * 4294967296) >>> 0;
    for (let i = 0; i < d.length; i += 4) {
      let r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
      if (sigma > 0.4) {
        const sh = sigma * (1.25 - (0.5 * (r + g + b)) / 765);
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const nl = NOISE[seed >>> 16];
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const n1 = NOISE[seed >>> 16] * 0.45;
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const n2 = NOISE[seed >>> 16] * 0.45;
        r += (nl + n1) * sh; g += (nl - n1 * 0.5 + n2 * 0.5) * sh; b += (nl + n2) * sh;
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
    m.putImageData(img, 0, 0);
    if (opts.sample) {
      if (S.guides) {   // a simple rule of thirds grid on samples
        m.strokeStyle = 'rgba(255,255,255,0.55)'; m.lineWidth = Math.max(1, PW / 400); m.setLineDash([PW / 80, PW / 120]);
        for (const t of [1 / 3, 2 / 3]) { line(m, PW * t, 0, PW * t, PH); line(m, 0, PH * t, PW, PH * t); }
        m.setLineDash([]);
      }
      return;
    }
    drawGuides();
    renderChecklist();
  }
  let photoQueued = false;
  function schedulePhoto() {
    if (photoQueued) return;
    photoQueued = true;
    requestAnimationFrame(() => { photoQueued = false; renderPhoto(); });
  }

  /* ------------------------------------------------------------------- UI */

  const posToF = (p) => F_MIN * (F_MAX / F_MIN) ** (p / 1000);
  const fToPos = (f) => (1000 * Math.log(f / F_MIN)) / Math.log(F_MAX / F_MIN);
  const posToD = (p) => (p >= 995 ? Infinity : D_MIN * (D_MAX / D_MIN) ** (p / 990));
  const dToPos = (d) => (!isFinite(d) ? 1000 : (990 * Math.log(d / D_MIN)) / Math.log(D_MAX / D_MIN));

  function clampAperture() {
    const lo = minN(S.f);
    if (S.N < lo - 0.01) S.N = APERTURES.find((a) => a >= lo - 0.01);
  }

  function buildUI() {
    $('#flPresets').innerHTML = [24, 35, 50, 85, 135, 200].map((f) => `<button data-f="${f}">${f} mm</button>`).join('');
    $('#focusPresets').innerHTML = OBJ_KEYS.map((k) => `<button data-obj="${k}">${OBJ[k].name}</button>`).join('');
    $('#sensorSeg').innerHTML = Object.entries(SENSORS).map(([id, s]) => `<button data-sensor="${id}">${s.label}</button>`).join('');
    $('#sceneSeg').innerHTML = SCENES.map((s) => `<button data-scene="${s.id}">${s.label}</button>`).join('');
    $('#rayToggles').innerHTML = OBJ_KEYS.map((k) => {
      const o = OBJ[k];
      return `<label class="pill" style="--c:${rgba(o.color, 1)}"><input type="checkbox" data-ray="${k}"><i></i><span>${o.name}</span></label>`;
    }).join('') + '<button class="pill-btn" data-rays="all">All</button><button class="pill-btn" data-rays="none">None</button>';

    $('#ap').addEventListener('input', (e) => {
      const wanted = APERTURES[+e.target.value];
      S.N = wanted;
      photons.passed = photons.blocked = 0;
      clampAperture(); update();
      const hint = $('#apHint');
      if (S.N !== wanted) {
        hint.textContent = `This ${isZoom() ? 'zoom ' : ''}lens cannot open to f/${wanted} at ${S.f} mm. f/${S.N} is the widest it goes here.${isZoom() ? ' Zoom out to open wider.' : ''}`;
        hint.classList.remove('flash'); void hint.offsetWidth; hint.classList.add('flash');
      }
    });
    $('#fl').addEventListener('input', (e) => {
      S.f = Math.round(posToF(+e.target.value));
      if (isZoom()) S.f = clamp(S.f, ZOOM.min, ZOOM.max);
      clampAperture(); update();
    });
    $('#focus').addEventListener('input', (e) => { S.focus = Math.max(mfd(), posToD(+e.target.value)); update(); });
    $('#macro').addEventListener('change', (e) => { S.macro = e.target.checked; update(); });
    document.querySelectorAll('[data-lens-select]').forEach((sel) => sel.addEventListener('change', (e) => {
      S.lens = e.target.value;
      if (isZoom()) S.f = clamp(S.f, ZOOM.min, ZOOM.max);
      clampAperture(); update();
    }));
    document.querySelectorAll('[data-zoom-groups]').forEach((cb) => cb.addEventListener('change', (e) => {
      S.zoomGroups = e.target.checked; update();
    }));
    $('#sh').addEventListener('input', (e) => { S.t = SHUTTERS[+e.target.value]; update(); });
    $('#iso').addEventListener('input', (e) => { S.iso = ISOS[+e.target.value]; update(); });
    $('#handheld').addEventListener('change', (e) => { S.handheld = e.target.checked; update(); });
    $('#exaggerate').addEventListener('change', (e) => { S.exaggerate = e.target.checked; update(); });
    $('#everywhere').addEventListener('change', (e) => { S.everywhere = e.target.checked; update(); });

    document.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.f) { S.f = isZoom() ? clamp(+b.dataset.f, ZOOM.min, ZOOM.max) : +b.dataset.f; clampAperture(); update(); }
      else if (b.dataset.obj) { focusOn(b.dataset.obj); }
      else if (b.dataset.rays) { OBJ_KEYS.forEach((k) => { S.rays[k] = b.dataset.rays === 'all'; }); update(); }
      else if (b.dataset.sensor) { S.sensor = b.dataset.sensor; update(); }
      else if (b.dataset.scene) { S.scene = b.dataset.scene; update(); }
      else if (b.dataset.fix) { fixExposure(b.dataset.fix); }
    });
    $('#rayToggles').addEventListener('change', (e) => {
      const k = e.target.dataset.ray; if (k) { S.rays[k] = e.target.checked; update(); }
    });
    $('#resetAll').addEventListener('click', () => { const keep = { lens: S.lens }; S = Object.assign(clone(DEFAULTS), keep); clampAperture(); update(); });
    $('#shoot').addEventListener('click', takePhoto);
    $('#playLight').addEventListener('click', togglePhotons);
    $('#guidesBtn').addEventListener('click', () => { S.guides = !S.guides; update(); });
    $('#layeredBtn').addEventListener('click', () => {
      const keepFlip = S.flip, keepLens = S.lens;
      S = Object.assign(clone(DEFAULTS), clone(LAYERED_PRESET), { flip: keepFlip, lens: keepLens });
      S.rays = Object.assign(clone(DEFAULTS.rays), LAYERED_PRESET.rays);
      if (isZoom()) S.f = clamp(S.f, ZOOM.min, ZOOM.max);
      clampAperture(); update();
    });
    $('#zoomIn').addEventListener('click', () => zoomAt(DW / 2, DH / 2, 1.5));
    $('#zoomOut').addEventListener('click', () => zoomAt(DW / 2, DH / 2, 1 / 1.5));
    $('#zoomReset').addEventListener('click', () => { view.scale = 1; view.tx = 0; view.ty = 0; afterView(); });
    $('#zoomLens').addEventListener('click', () => {
      const G = geometry();
      zoomToward((G.lensX + G.sensorX) / 2, G.cy, clamp(900 / (G.sensorX - G.lensX + 160), 1.5, 5));
    });
    $('#flip').addEventListener('click', () => { S.flip = !S.flip; update(); });
  }

  function fixExposure(which) {
    const target = 2 ** sceneEV();
    if (which === 'shutter') S.t = SHUTTERS[nearestIdx(SHUTTERS, (S.N * S.N) / (target * (S.iso / 100)))];
    if (which === 'iso') S.iso = ISOS[nearestIdx(ISOS, (100 * S.N * S.N) / (S.t * target))];
    if (which === 'aperture') {
      const want = Math.sqrt(target * S.t * (S.iso / 100));
      S.N = APERTURES[nearestIdx(APERTURES, want)]; clampAperture();
    }
    update();
  }

  function sync() {
    const sen = SENSORS[S.sensor], v = imgDist(S.f, S.focus), D = S.f / S.N;
    $('#ap').value = APERTURES.indexOf(S.N);
    const wideIdx = APERTURES.findIndex((a) => a >= minN(S.f) - 0.01);
    $('#apLimitBar').style.width = `${(wideIdx / (APERTURES.length - 1)) * 100}%`;
    $('#apLimit').classList.toggle('hidden', wideIdx === 0);
    $('#apLimitText').textContent = wideIdx > 0 ? `wider than f/${APERTURES[wideIdx]} not possible at ${S.f} mm` : '';
    $('#apOut').textContent = `f/${S.N}`;
    const lo = minN(S.f);
    $('#apHint').textContent = lo > 1.41
      ? `Opening ${D.toFixed(1)} mm. At ${S.f} mm this lens opens to f/${APERTURES.find((a) => a >= lo - 0.01)} at most.`
      : `Opening is ${S.f} mm ÷ ${S.N} = ${D.toFixed(1)} mm wide. Bigger number, smaller hole.`;

    document.querySelectorAll('[data-lens-select]').forEach((sel) => { sel.value = S.lens; });
    document.querySelectorAll('[data-zoom-groups]').forEach((cb) => { cb.checked = S.zoomGroups; cb.disabled = !isZoom(); });
    $('#zoomGroupsRow').classList.toggle('off', !isZoom());
    $('#zoomGroupsRow2').classList.toggle('hidden', !isZoom());
    $('#lensHint').textContent = isZoom()
      ? `One lens, ${ZOOM.min} to ${ZOOM.max} mm. Turning the zoom ring moves glass groups inside, which changes the focal length. Widest aperture f/${ZOOM.nWide} to f/${ZOOM.nTele}.`
      : 'One fixed focal length. Moving the focal length slider means swapping to a different prime lens.';
    $('#fl').min = isZoom() ? Math.ceil(fToPos(ZOOM.min)) : 0;
    $('#fl').max = isZoom() ? Math.floor(fToPos(ZOOM.max)) : 1000;
    $('#fl').value = fToPos(S.f);
    document.querySelector('[data-ctl="focal"] label').textContent = isZoom() ? 'Focal length (zoom ring)' : 'Focal length';
    renderZoomExplain();
    $('#flOut').textContent = `${S.f} mm`;
    document.querySelectorAll('[data-f]').forEach((b) => { b.disabled = isZoom() && (+b.dataset.f < ZOOM.min || +b.dataset.f > ZOOM.max); });
    $('#flHint').textContent = `Distance from the lens center to F, where light from far away meets. Sees ${fovDeg(sen.w, v).toFixed(1)}° across. ${S.f < 35 ? 'Wide angle.' : S.f <= 60 ? 'Close to how your eyes see.' : 'Telephoto: zoomed in.'}`;

    $('#senOut').textContent = `${sen.w} × ${sen.h} mm`;
    $('#senHint').textContent = `Crop factor ×${cropOf(sen).toFixed(2)}, so ${S.f} mm frames like ${Math.round(S.f * cropOf(sen))} mm on full frame.`;

    $('#focus').value = dToPos(S.focus);
    $('#focusOut').textContent = fmtD(S.focus);
    $('#focusHint').textContent = `Lens is ${(v - S.f).toFixed(2)} mm further out than at infinity. Closest focus: ${fmtD(mfd())}.`;
    $('#macro').checked = S.macro;
    renderApertureExplain();
    renderBokehExplain();
    const ext = v - S.f, sd = isFinite(S.focus) ? `${Math.round(S.focus * 1000)}` : '∞';
    $('#focalMeaning').innerHTML = focalMeaningHTML(v, ext);
    $('#focusExplain').innerHTML = `
      <div class="fe-box"><span class="fe-k">Focal length</span><strong>${S.f} mm</strong>
        <p>Fixed. It is how strongly the glass bends light. Light from very far away comes together ${S.f} mm behind the lens, at point <b>F</b>. Only zooming or changing lenses changes it.</p></div>
      <div class="fe-box"><span class="fe-k">Focus distance</span><strong>${fmtD(S.focus)}</strong>
        <p>Drag the green line in the scene, or click a subject. Light from closer things arrives more spread out, so it needs more room behind the lens to come together.</p></div>
      <div class="fe-box hi"><span class="fe-k">Lens to sensor</span><strong>${v.toFixed(2)} mm</strong>
        <p>= ${S.f} mm + <b>${ext.toFixed(2)} mm</b>. To focus, the lens slides away from the sensor by that much. The glass itself does not change.</p></div>
      <div class="fe-formula">Lens formula: 1/focal length = 1/focus distance + 1/lens to sensor
        <code>1/${S.f} = 1/${sd} + 1/${v.toFixed(2)}</code><span>(all in mm)</span></div>
      ${focusDetailsHTML(v, ext)}`;

    $('#sh').value = SHUTTERS.indexOf(S.t);
    $('#shOut').textContent = fmtT(S.t);
    const carCm = CAR_SPEED * S.t * 100;
    $('#shHint').textContent = `The car moves ${carCm < 10 ? carCm.toFixed(1) : Math.round(carCm)} cm while the shutter is open.`;

    $('#iso').value = ISOS.indexOf(S.iso);
    $('#isoOut').textContent = `ISO ${S.iso}`;
    $('#isoHint').textContent = S.iso <= 200 ? 'Base ISO: the cleanest image.' : `Signal boosted ×${S.iso / 100}. ${S.iso >= 3200 ? 'Grain is easy to see.' : 'A little grain.'}`;

    $('#sceneOut').textContent = `EV ${sceneEV()}`;
    $('#handheld').checked = S.handheld;
    $('#exaggerate').checked = S.exaggerate;
    $('#everywhere').checked = S.everywhere;
    document.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('on', +b.dataset.f === S.f));
    document.querySelectorAll('[data-obj]').forEach((b) => {
      b.classList.toggle('on', Math.abs(1 / OBJ[b.dataset.obj].d - 1 / S.focus) < 0.002);
    });
    document.querySelectorAll('[data-sensor]').forEach((b) => b.classList.toggle('on', b.dataset.sensor === S.sensor));
    document.querySelectorAll('[data-scene]').forEach((b) => b.classList.toggle('on', b.dataset.scene === S.scene));
    document.querySelectorAll('[data-ray]').forEach((i) => { i.checked = !!S.rays[i.dataset.ray]; });
  }

  function renderZoomExplain() {
    const el = $('#zoomExplain');
    if (!isZoom()) {
      el.innerHTML = `<h3>Current lens: prime</h3>
        <p>A prime lens has one fixed focal length. Its glass never moves relative to itself, only the whole lens slides to focus. To see wider or closer you swap lenses (or walk). Pick <b>Zoom lens</b> under "Lens" in the settings to see how one lens can change its focal length.</p>
        ${ringsHTML()}`;
      return;
    }
    const s = zoomSpacing(S.f), f1 = ZOOM.f1, f2 = ZOOM.f2;
    const rows = [24, 35, 50, 85, 135, 200].map((f) => `<tr class="${f === S.f ? 'cur' : ''}"><td>${f} mm</td><td>${zoomSpacing(f).toFixed(1)} mm</td><td>f/${minN(f).toFixed(1)}</td></tr>`).join('');
    el.innerHTML = `
      <h3>Current lens: zoom, ${ZOOM.min} to ${ZOOM.max} mm</h3>
      <div class="fe-cols">
        <div>
          <p><b>Zooming changes how strongly the whole lens bends light</b>, which is exactly what focal length is. But no piece of glass changes shape. Each group keeps its own strength. What changes is the <b>spacing</b> between them.</p>
          <p>Here the front group is convex (f₁ = +${f1} mm, bends light in) and the rear group is concave (f₂ = ${f2} mm, spreads it out). Together:</p>
          <div class="eq">1/f = 1/f₁ + 1/f₂ − spacing / (f₁ · f₂)</div>
          <p class="live">Now: 1/f = 1/${f1} + 1/(${f2}) − ${s.toFixed(1)} / (${f1} × ${f2}) → <b>f = ${S.f} mm</b>.</p>
          <p>Moving the groups only a few millimetres changes the focal length a lot. Real zoom lenses use 3 to 5 groups, and some of them move only to keep the image focused on the sensor while you zoom. The diagram shows a simplified two group version.</p>
        </div>
        <div>
          <table class="fm-table"><thead><tr><th>Zoom ring at</th><th>Group spacing</th><th>Widest aperture</th></tr></thead><tbody>${rows}</tbody></table>
          <p><b>The aperture is not fixed.</b> You can always close it down to f/22. What changes as you zoom is the <b>widest</b> it can open: f/${ZOOM.nWide} at ${ZOOM.min} mm up to f/${ZOOM.nTele} at ${ZOOM.max} mm. <span class="live">At ${S.f} mm the widest is f/${minN(S.f).toFixed(1)}, so the nearest stop is f/${APERTURES.find((a) => a >= minN(S.f) - 0.01)}. You are at f/${S.N}.</span></p>
          <p><b>Why the widest gets smaller when you zoom in.</b> The f-number is focal length ÷ opening. The opening, as seen through the front glass, does grow as you zoom in (${(ZOOM.min / ZOOM.nWide).toFixed(1)} mm at ${ZOOM.min} mm, ${(ZOOM.max / ZOOM.nTele).toFixed(1)} mm at ${ZOOM.max} mm), but slower than the focal length, so the f-number rises. Zooming in pushes a too-wide aperture to the widest allowed. Zooming back out does not widen it again by itself.</p>
          <p><b>Variable vs constant aperture.</b> Variable zooms (f/3.5 to f/5.6) are small and cheap. Constant aperture zooms (for example 24 to 70 mm f/2.8) open to f/2.8 at every focal length, which needs bigger, heavier, pricier front glass.</p>
          <p><b>Zoom vs prime:</b> a zoom gives many focal lengths in one lens. A prime is usually smaller, sharper and opens wider (f/1.4 to f/1.8) because it only has to work at one focal length.</p>
        </div>
      </div>
      ${ringsHTML()}`;
  }

  // Zoom ring vs focus ring: which one changes focal length, which one adds extension.
  function ringsHTML() {
    const zoom = isZoom();
    const d = isFinite(S.focus) ? S.focus : 2;              // use 2 m as the example when focused at infinity
    const dmm = d * 1000, ext = (f) => (f * f) / (dmm - f);
    const fs = zoom ? [24, 50, 100, 200] : [24, 35, 50, 85, 135, 200];
    if (!fs.includes(S.f)) fs.push(S.f);
    fs.sort((a, b) => a - b);
    const rows = fs.map((f) => `<tr class="${f === S.f ? 'cur' : ''}"><td>${f} mm${f === S.f ? ' (now)' : ''}</td><td>+${ext(f) < 10 ? ext(f).toFixed(2) : ext(f).toFixed(1)} mm</td><td>${(f + ext(f)).toFixed(f + ext(f) < 100 ? 2 : 1)} mm</td></tr>`).join('');
    const e = ext(S.f);
    return `
      <div class="rings">
        <h3>How the lens works: ${zoom ? 'zoom ring and focus ring' : 'the focus ring'}</h3>
        <div class="fe-cols">
          <div>
            ${zoom ? `<p><b>Zoom ring:</b> moves the glass groups closer together or further apart. That <b>changes the focal length</b> (${ZOOM.min} mm to ${ZOOM.max} mm), which changes how much you see.</p>` : `<p><b>No zoom ring.</b> A prime's focal length (${S.f} mm) never changes. To change it you swap to another lens.</p>`}
            <p><b>Focus ring:</b> adds a small <b>extension</b>, moving the lens slightly further from the sensor. That changes which distance is sharp. The focal length stays ${zoom ? 'wherever you zoomed it' : 'the same'}.</p>
            <p><b>Adding extension does not change the focal length.</b> The total distance from the lens to the sensor is called the <b>image distance</b> (lens to sensor):</p>
            <div class="eq">image distance = ${zoom ? 'current ' : ''}focal length + focus extension</div>
            <p class="live">Now: ${S.f} mm, focused at ${fmtD(d)}${isFinite(S.focus) ? '' : ' (example, you are at ∞)'}: extension = ${S.f}² / (${dmm.toLocaleString()} − ${S.f}) ≈ ${e.toFixed(2)} mm, so lens to sensor ≈ ${(S.f + e).toFixed(2)} mm.</p>
          </div>
          <div>
            <p>${zoom ? 'Same focus distance, different zoom settings' : 'Same focus distance on different prime lenses'} (focused at ${fmtD(d)}):</p>
            <table class="fm-table"><thead><tr><th>Focal length</th><th>Focus extension</th><th>Lens to sensor</th></tr></thead><tbody>${rows}</tbody></table>
            <p class="dim">${zoom ? 'Zooming in really changes the focal length. Then refocusing at the same distance needs a bigger extension, because extension grows with focal length squared.' : 'Longer lenses need much more extension for the same distance, because it grows with focal length squared.'}</p>
          </div>
        </div>
      </div>`;
  }

  function renderBokehExplain() {
    const sen = SENSORS[S.sensor];
    const c = cocMM(S.wallD), cInf = cocMM(Infinity), px = (c / sen.w) * 6000;
    const sharp = c < dof().c;
    const where = imgDist(S.f, S.wallD) < imgDist(S.f, S.focus) ? 'in front of' : 'behind';
    const shape = S.N >= 4 ? `a 7-sided shape, because at f/${S.N} the blades make a polygon` : `round, because at f/${S.N} the opening is almost a circle`;
    $('#bokehExplain').innerHTML = `
      <h3>How background blur (bokeh) is made</h3>
      <ol>
        <li>The lens is focused at <b>${fmtD(S.focus)}</b>. Light from one spot on the wall (${fmtD(S.wallD)}) comes together <b>${where}</b> the sensor instead of on it.</li>
        <li>So that one spot lands as a small <b>disc</b>, not a dot. <span class="live">${sharp ? 'Right now the wall is inside the depth of field, so its discs are too small to notice and it looks sharp.' : `Right now each disc is ${c.toFixed(2)} mm wide on the sensor, about ${Math.round(px)} pixels in a 24 MP photo.`}</span></li>
        <li>Every spot on the wall does the same. Millions of overlapping discs mix together, so the bricks melt into a soft blur.</li>
        <li>Small bright lights show single discs clearly. Those are the <b>bokeh balls</b>. Each one has the shape of the aperture opening: <span class="live">${shape}</span>.</li>
        <li>Blur gets bigger with a wider aperture (wider cone), a longer focal length, the subject closer to you, and the background further behind it. <span class="live">Moving the wall all the way to infinity would only grow the disc to ${cInf.toFixed(2)} mm, so past a point, distance stops adding much.</span></li>
      </ol>`;
  }

  function renderApertureExplain() {
    const sen = SENSORS[S.sensor], D = S.f / S.N, area = Math.PI * (D / 2) ** 2;
    const fullArea = Math.PI * (S.f / minN(S.f) / 2) ** 2;
    const airy = 2.44 * 0.55 * S.N;                       // µm, green light
    const pixel = (sen.w / 6000) * 1000;                  // µm, a 6000 px wide sensor
    const px = airy / pixel;
    const sweet = S.N < 4 ? 'A wide aperture: most light and the finest possible detail, but rays through the edges of the glass add small flaws.'
      : S.N <= 8 ? 'Sweet spot: lens flaws and diffraction are both small. Usually the sharpest setting.'
      : S.N <= 11 ? 'Still sharp, with a slight softening starting from diffraction.'
      : 'Diffraction is now softening fine detail across the whole frame.';
    const dSub = OBJ.subj.d * 1000, frac = (D * D) / (16 * dSub * dSub);
    const oneIn = Math.round(1 / frac);
    $('#apExplain').innerHTML = `
      <div class="ax-col wide everywhere-col">
        <h3>Light bounces off every object in every direction</h3>
        <p>Sunlight or lamplight hits each object. A matte surface like skin, cloth or brick scatters that light out in <b>all directions</b>, like a tiny lamp. A shiny surface like a mirror or wet metal sends most of it off in one direction instead. The ray diagram only draws the light heading toward the lens, because that is the only part the camera ever sees. Turn on <b>"Light goes everywhere"</b> under the diagram to see the rest.</p>
        <p>The lens catches only a very thin cone of it. Spread over a sphere around the subject, the share that enters the opening is (opening ÷ 4 × distance)².</p>
        <p class="live">Right now: the person is ${fmtD(OBJ.subj.d)} away and the opening is ${D.toFixed(1)} mm, so the camera catches about 1 in ${oneIn.toLocaleString()} of the light leaving each point on them. Everyone standing around sees the same person because each of them catches a different part of that same scattered light.</p>
      </div>
      <div class="ax-col">
        <h3>Why a wider aperture adds light</h3>
        <p>Every point in the scene sends light toward the whole front of the lens. The aperture decides how much of that cone gets through. Light gathered depends on the <b>area</b> of the hole, so doubling the area doubles the light.</p>
        <p>The f-number is focal length ÷ opening width. Each full stop (f/2.8 → f/4 → f/5.6) shrinks the area by half, so it halves the light.</p>
        <p class="live">Now: f/${S.N} = ${S.f} mm ÷ ${D.toFixed(1)} mm. Area ${Math.round(area)} mm², ${Math.round((area / fullArea) * 100)}% of what this lens can take in.</p>
      </div>
      <div class="ax-col">
        <h3>Why the framing does not change</h3>
        <p>Where a point lands on the sensor is decided by the ray through the <b>center</b> of the lens. Every aperture, even f/22, lets that ray through.</p>
        <p>The outer rays from the same point land on the <b>same spot</b> when it is in focus. They only add more brightness there. The field of view is set by the sensor edges and the lens center, and the aperture is not part of that.</p>
        <p class="live">So closing the aperture makes the photo darker and the background sharper, but the edges of the picture stay exactly where they were.</p>
      </div>
      <div class="ax-col wide">
        <h3>What the blocked light was carrying</h3>
        <ul>
          <li><b>The same color.</b> For a matte point in focus, every ray has the same color, so blocking some does not change what color that point looks.</li>
          <li><b>More light, so less grain.</b> Light arrives as random particles (photons). Fewer of them means more random speckle, so you must make it up with a slower shutter or higher ISO.</li>
          <li><b>Where the blur goes.</b> For out of focus things the rays land in different spots and smear into a disc. Blocking the outer rays shrinks that disc, which is why the background gets sharper.</li>
          <li><b>The finest detail.</b> Light is a wave, so even a perfectly focused point lands as a tiny dot. A smaller hole makes that dot bigger (diffraction). <span class="live">At f/${S.N} the smallest dot is ${airy.toFixed(1)} µm, ${px < 1 ? 'smaller than one pixel' : 'about ' + px.toFixed(1) + ' pixels'} on a 24 MP ${sen.label.toLowerCase()} sensor.</span> ${sweet}</li>
          <li><b>Slightly different viewpoints.</b> Rays through the top of the lens see the subject from a few mm higher than rays through the bottom. Shiny surfaces can look different across the lens, a wide aperture can see around thin things like a fence wire, and light field cameras record these directions so you can refocus after the shot.</li>
        </ul>
      </div>`;
  }

  // "What is focal length?" with a small labelled drawing and live numbers.
  function focalMeaningHTML(v, ext) {
    const f = S.f, X0 = 150, FP = 300;                    // lens x, focal length in drawing units
    const E = ext > 0 ? clamp((ext / f) * FP * 4, 8, 150) : 0;
    const Fx = X0 + FP, Sx = Fx + E, ay = 112;
    const near = isFinite(S.focus);
    // a near subject's rays meet at the sensor, behind F
    const subj = near
      ? `<line x1="16" y1="${ay}" x2="${X0}" y2="${ay - 45}" class="fl-sub"/><line x1="16" y1="${ay}" x2="${X0}" y2="${ay + 45}" class="fl-sub"/>
         <line x1="${X0}" y1="${ay - 45}" x2="${Sx}" y2="${ay}" class="fl-sub"/><line x1="${X0}" y1="${ay + 45}" x2="${Sx}" y2="${ay}" class="fl-sub"/>
         <circle cx="16" cy="${ay}" r="4" class="fl-subdot"/><text x="16" y="${ay + 20}" class="fl-t sub" text-anchor="start">subject ${fmtD(S.focus)}</text>`
      : '';
    return `
      <div class="fe-wide fe-meaning">
        <h4>What is focal length?</h4>
        <svg viewBox="0 0 640 215" class="fl-svg" role="img" aria-label="Focal length is the distance from the lens center to F. Lens to sensor equals focal length plus extension.">
          <line x1="0" y1="${ay}" x2="640" y2="${ay}" class="fl-axis"/>
          <line x1="16" y1="${ay - 30}" x2="${X0}" y2="${ay - 30}" class="fl-par"/><line x1="16" y1="${ay + 30}" x2="${X0}" y2="${ay + 30}" class="fl-par"/>
          <line x1="${X0}" y1="${ay - 30}" x2="${Fx}" y2="${ay}" class="fl-par"/><line x1="${X0}" y1="${ay + 30}" x2="${Fx}" y2="${ay}" class="fl-par"/>
          <text x="4" y="${ay - 62}" class="fl-t dim" text-anchor="start">dashed: light from very far away (parallel)</text>
          ${subj}
          <ellipse cx="${X0}" cy="${ay}" rx="9" ry="58" class="fl-lens"/>
          <text x="${X0 + 14}" y="${ay - 50}" class="fl-t" text-anchor="start">lens center</text>
          <path d="M${Fx} ${ay - 6} L${Fx + 6} ${ay} L${Fx} ${ay + 6} L${Fx - 6} ${ay} Z" class="fl-F"/>
          <text x="${Fx}" y="${ay - 12}" class="fl-t b" text-anchor="middle">F</text>
          <rect x="${Sx - 2}" y="${ay - 40}" width="5" height="80" class="fl-sensor"/>
          <text x="${Sx + 8}" y="${ay - 30}" class="fl-t green" text-anchor="start">sensor</text>
          <line x1="${X0}" y1="${ay + 72}" x2="${Fx}" y2="${ay + 72}" class="fl-dim"/>
          <line x1="${X0}" y1="${ay + 66}" x2="${X0}" y2="${ay + 78}" class="fl-dim"/><line x1="${Fx}" y1="${ay + 66}" x2="${Fx}" y2="${ay + 78}" class="fl-dim"/>
          <text x="${(X0 + Fx) / 2}" y="${ay + 92}" class="fl-t b" text-anchor="middle">focal length f = ${f} mm (lens center to F)</text>
          ${E > 0 ? `<line x1="${Fx}" y1="${ay + 72}" x2="${Sx}" y2="${ay + 72}" class="fl-ext"/>
          <text x="${Sx + 6}" y="${ay + 76}" class="fl-t green" text-anchor="start">+${ext.toFixed(2)} mm extension</text>` : ''}
          <line x1="${X0}" y1="${ay - 82}" x2="${Sx}" y2="${ay - 82}" class="fl-dim2"/>
          <text x="${(X0 + Sx) / 2}" y="${ay - 88}" class="fl-t" text-anchor="middle">lens to sensor = ${f} + ${ext.toFixed(2)} = ${v.toFixed(2)} mm</text>
        </svg>
        <div class="fe-cols">
          <div>
            <p><b>Focal length is a distance between two points: the lens's optical center and its focal point F.</b> F is where light from very far away, arriving as parallel rays, comes together behind the lens.</p>
            <p>It tells you <b>how strongly the lens bends light</b>. Short focal length: bends strongly, light meets close behind the lens, wide view. Long focal length: bends gently, light meets far behind, narrow magnified view.</p>
            <p class="dim">It is not the length of the lens barrel and not measured from the front glass. It is measured from the optical center (the principal plane), which in a real lens with many elements can sit anywhere, even outside the glass.</p>
          </div>
          <div>
            <p><b>Focal length + extension = lens to sensor.</b></p>
            <p>Focused at infinity, F sits right on the sensor, so the extension is 0 and lens to sensor equals the focal length. Light from anything closer meets <b>behind</b> F, so the lens moves out by the extension to put that meeting point on the sensor.</p>
            <div class="eq">extension = f² / (d − f) &nbsp; lens to sensor = f + extension</div>
            <p class="live">Now: ${f} mm + ${ext.toFixed(2)} mm = ${v.toFixed(2)} mm, focused at ${fmtD(S.focus)}.${E > 0 ? ' The extension is drawn 4× larger here so you can see it.' : ''}</p>
          </div>
        </div>
      </div>`;
  }

  // What focusing changes, how much travel is used, and the extension table for this lens.
  function focusDetailsHTML(v, ext) {
    const sen = SENSORS[S.sensor], lim = mfd(), vMax = imgDist(S.f, lim), extMax = vMax - S.f;
    const used = clamp(ext / extMax, 0, 1);
    const fovNow = fovDeg(sen.w, v), fovInf = fovDeg(sen.w, S.f);
    const rows = [Infinity, 3, 1, lim].filter((d, i, arr) => !isFinite(d) || (d >= lim && arr.indexOf(d) === i));
    const near = (d) => (isFinite(d) && isFinite(S.focus) ? Math.abs(d - S.focus) / d < 0.02 : d === S.focus);
    const all = rows.some(near) ? rows : rows.concat([S.focus]);
    all.sort((p, q) => (isFinite(p) ? 1 / p : 0) - (isFinite(q) ? 1 / q : 0));
    const tr = all.map((d) => {
      const vv = imgDist(S.f, d), isNow = near(d);
      const label = !isFinite(d) ? '∞ (home position)' : d === lim ? `${fmtD(d)} (closest)` : fmtD(d);
      return `<tr class="${isNow ? 'cur' : ''}"><td>${label}${isNow ? ' (now)' : ''}</td><td>${vv.toFixed(2)} mm</td><td>+${(vv - S.f).toFixed(2)} mm</td></tr>`;
    }).join('');
    const curRow = '';
    return `
      <div class="fe-wide fe-changed">
        <h4>What changed in the lens to focus at ${fmtD(S.focus)}</h4>
        <div class="fe-cols">
          <div><span class="tag yes">Changed</span>
            <p><b>Lens position.</b> The whole lens moved ${ext.toFixed(2)} mm away from the sensor (lens to sensor ${v.toFixed(2)} mm).</p>
            <p class="dim">Side effect: the view got slightly narrower, ${fovNow.toFixed(1)}° across instead of ${fovInf.toFixed(1)}° at infinity. This is called focus breathing.</p></div>
          <div><span class="tag no">Not changed</span>
            <p><b>Focal length</b> (${S.f} mm), the <b>shape of the glass</b> and how strongly it bends light, and the <b>aperture</b> (f/${S.N}).</p></div>
        </div>
        <div class="travel">
          <div class="travel-head"><span>Focus travel used</span><span>${ext.toFixed(2)} of ${extMax.toFixed(2)} mm (${Math.round(used * 100)}%)</span></div>
          <div class="travel-bar"><div style="width:${used * 100}%"></div></div>
          <div class="travel-ends"><span>∞: 0 mm, the home position</span><span>${fmtD(lim)}: lens fully extended${S.macro ? ' (macro lens)' : ''}</span></div>
        </div>
      </div>
      <div class="fe-wide fe-table">
        <h4>Focal length is set at infinity. Focusing = focal length + extension.</h4>
        <p>A ${S.f} mm lens is built so light from very far away comes together ${S.f} mm behind it. That is the home position with zero extension. Anything closer needs the lens moved forward:</p>
        <table><thead><tr><th>Focused at</th><th>Lens to sensor</th><th>Extension</th></tr></thead><tbody>${tr}${curRow}</tbody></table>
        <p>The closest focus distance is simply where the focusing mechanism (a screw thread inside the barrel called the helicoid) runs out of extension. You cannot focus "past infinity" because that is the zero extension stop.</p>
      </div>
      ${breathingHTML(lim)}
      ${fewMillimetresHTML(extMax, lim)}
      <div class="fe-wide fe-notes">
        <h4>Three details real lenses add</h4>
        <ul>
          <li><b>The ${S.f} mm is not measured from the glass you can see.</b> It is measured from the lens's optical center (the principal plane), which in a real lens with many elements can even sit outside the glass.</li>
          <li><b>Extension tubes</b> are empty rings between the camera and the lens. They add extension the lens cannot reach by itself, so it focuses much closer, but it can no longer focus at infinity. The "Macro lens" switch in the sidebar shows the same idea: more extension, closer focus.</li>
          <li><b>Internal focusing.</b> Most modern lenses do not move the whole lens. They move a small group of glass inside, which slightly changes the effective focal length instead of adding pure extension. The result is the same, but such lenses can frame a little differently up close. This simulator uses the simple "whole lens moves" model.</li>
        </ul>
      </div>`;
  }

  // Focus breathing: the view narrows as you focus closer, mostly at short distances.
  function breathingHTML(lim) {
    const f = S.f, sen = SENSORS[S.sensor];
    const fov = (d) => fovDeg(sen.w, imgDist(f, d));
    const fInf = fov(Infinity);
    const ds = [Infinity, 10, 3, 1, 0.5, lim].filter((d) => !isFinite(d) || d >= lim - 1e-9).filter((d, i, a) => a.indexOf(d) === i);
    const near = (d) => (isFinite(d) && isFinite(S.focus) ? Math.abs(d - S.focus) / d < 0.02 : d === S.focus);
    const all = ds.some(near) ? ds : ds.concat([S.focus]);
    all.sort((p, q) => (isFinite(p) ? 1 / p : 0) - (isFinite(q) ? 1 / q : 0));
    const rows = all.map((d) => {
      const v = fov(d), loss = ((fInf - v) / fInf) * 100, now = near(d);
      const label = !isFinite(d) ? '∞' : d === lim ? `${fmtD(d)} (closest)` : fmtD(d);
      return `<tr class="${now ? 'cur' : ''}"><td>${label}${now ? ' (now)' : ''}</td><td>+${(imgDist(f, d) - f).toFixed(2)} mm</td><td>${v.toFixed(1)}°</td><td>${loss < 0.05 ? '0' : '-' + loss.toFixed(1)}%</td></tr>`;
    }).join('');
    const far3 = fInf - fov(3), close = fov(Math.max(1, lim)) - fov(lim);
    const macroV = imgDist(f, Math.max(0.15, f * 0.0025)), macroFov = fovDeg(sen.w, macroV);
    return `
      <div class="fe-wide fe-breath">
        <h4>Focus breathing: the view gets narrower as you focus closer</h4>
        <div class="fe-cols">
          <div>
            <p>The field of view is the angle from the sensor edges through the lens center. Focusing closer moves the lens further from the sensor, so that angle shrinks a little. You see a bit less and things look a bit bigger, like a tiny zoom.</p>
            <p><b>Most of it happens up close</b>, for the same reason most of the focus movement does: the extension f² / (d − f) stays tiny far away and shoots up near the lens.</p>
            <p class="live">Your ${f} mm lens loses only ${far3.toFixed(1)}° between ∞ and 3 m, but ${close.toFixed(1)}° between ${fmtD(Math.max(1, lim))} and ${fmtD(lim)}.</p>
            <p><b>A macro lens breathes much more.</b> It moves far out to focus very close. <span class="live">At about ${fmtD(Math.max(0.15, f * 0.0025))} a ${f} mm macro lens sits ${macroV.toFixed(0)} mm from the sensor and sees ${macroFov.toFixed(1)}° instead of ${fInf.toFixed(1)}°.</span> At life size (1:1) the lens is twice its focal length from the sensor.</p>
          </div>
          <div>
            <table class="fm-table"><thead><tr><th>Focused at</th><th>Extension</th><th>View across</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table>
            <p class="dim">Video shooters notice breathing when focus moves between two people and the frame seems to zoom slightly. Cinema lenses are designed to keep it small.</p>
            ${S.exaggerate ? '<p class="warn-note">With "Stretch focus shifts" on, the lens movement in the diagram is drawn larger, so the dashed field of view lines narrow more than they really do. The degree numbers and the photo use the true values. Untick it to see the true size.</p>' : ''}
          </div>
        </div>
      </div>`;
  }

  // Why such a small movement covers every distance.
  function fewMillimetresHTML(extMax, lim) {
    const f = S.f, sen = SENSORS[S.sensor];
    const extAt = (d) => (isFinite(d) ? (f * f) / (d * 1000 - f) : 0);
    const marks = [Infinity, 10, 3, 1, 0.5, lim].filter((d) => !isFinite(d) || d >= lim - 1e-9)
      .filter((d, i, arr) => arr.indexOf(d) === i);
    const markHTML = marks.map((d, i) => {
      const pos = clamp(extAt(d) / extMax, 0, 1) * 100;
      return `<div class="fm-mark ${i % 2 ? 'low' : ''}" style="left:${pos}%"><i></i><span>${!isFinite(d) ? '∞' : fmtD(d)}<br><em>+${extAt(d).toFixed(2)}</em></span></div>`;
    }).join('');
    const nowPos = clamp(extAt(S.focus) / extMax, 0, 1) * 100;
    const farShare = Math.round((extAt(1) / extMax) * 100);
    const lenses = [14, 24, 35, 50, 85, 135, 200];
    const cmpD = 1;
    const cmp = lenses.map((L) => {
      const e = (L * L) / (cmpD * 1000 - L);
      return `<tr class="${L === f ? 'cur' : ''}"><td>${L} mm</td><td>${(L * L).toLocaleString()} mm²</td><td>+${e < 10 ? e.toFixed(2) : e.toFixed(1)} mm</td></tr>`;
    }).join('');
    const c = diagOf(sen) / 1500, tol = S.N * c;
    return `
      <div class="fe-wide fe-few">
        <h4>Why a few millimetres is enough to focus on everything</h4>
        <div class="fe-cols">
          <div>
            <p><b>Start from the lens formula</b> and solve for the lens to sensor distance:</p>
            <div class="eq">1/f = 1/d + 1/v &nbsp;→&nbsp; v = f·d / (d − f) &nbsp;→&nbsp; <b>extension = v − f = f² / (d − f)</b></div>
            <p class="dim">f = focal length, d = focus distance, v = lens to sensor, all in mm.</p>
            <p class="live">Your lens: f² = ${f}² = ${(f * f).toLocaleString()} mm². At ${fmtD(S.focus)}: ${(f * f).toLocaleString()} / (${isFinite(S.focus) ? Math.round(S.focus * 1000).toLocaleString() : '∞'} − ${f}) = +${extAt(S.focus).toFixed(2)} mm.</p>
          </div>
          <div>
            <p><b>How the optics behaves.</b> What the lens reacts to is not the distance itself but how spread out the light is when it arrives. From a mountain the rays are practically parallel. From 10 m they spread only slightly. From 30 cm they clearly spread.</p>
            <p>That spread goes like <b>1 / distance</b>, so big changes far away barely change it. Going from 10 m to infinity changes the light less than going from 30 cm to 35 cm. That is why the lens barely moves for far things and moves a lot for close ones.</p>
          </div>
        </div>
        <div class="fm-strip">
          <div class="fm-head"><span>Where each distance sits along this lens's focus travel</span><span class="live">1 m to ∞ uses only ${farShare}% of the travel</span></div>
          <div class="fm-track"><div class="fm-far" style="width:${farShare}%"></div><div class="fm-now" style="left:${nowPos}%"></div>${markHTML}</div>
        </div>
        <div class="fe-cols">
          <div>
            <p><b>It grows with focal length squared.</b> Extension needed to focus at ${cmpD} m:</p>
            <table class="fm-table"><thead><tr><th>Lens</th><th>f²</th><th>Extension</th></tr></thead><tbody>${cmp}</tbody></table>
          </div>
          <div>
            <p>So wide lenses need tiny movements and can focus very close. Telephoto lenses would need huge travel to focus close (a 200 mm lens needs 50 mm just to reach 1 m), so they are built with a closest focus of about 1.5 to 2 m instead.</p>
            <p><b>The catch: it must be very precise.</b> The sensor only stays acceptably sharp if the lens is within about f-number × ${c.toFixed(3)} mm of the right spot (the depth of focus).</p>
            <p class="live">At f/${S.N} on ${sen.label.toLowerCase()}: ±${tol.toFixed(3)} mm. Autofocus motors have to place the lens to within hundredths of a millimetre.</p>
          </div>
        </div>
      </div>`;
  }

  // Composition overlay: rule of thirds and the three layers with the eye path.
  function drawGuides() {
    const gc = $('#guides');
    if (!PHOTO_GEO) return;
    const { PW, PH } = PHOTO_GEO;
    if (gc.width !== PW || gc.height !== PH) { gc.width = PW; gc.height = PH; }
    const ctx = gc.getContext('2d');
    ctx.clearRect(0, 0, PW, PH);
    gc.classList.toggle('hidden', !S.guides);
    if (!S.guides) return;
    // keep labels readable however small the photo is shown
    const shown = gc.getBoundingClientRect().width || PW;
    const u = clamp(PW / shown, 1, 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.5 * u; ctx.setLineDash([8 * u, 6 * u]);
    for (const t of [1 / 3, 2 / 3]) { line(ctx, PW * t, 0, PW * t, PH); line(ctx, 0, PH * t, PW, PH * t); }
    ctx.setLineDash([]);
    const inFrame = (b) => b && b.x2 > 0 && b.x1 < PW && b.y2 > 0 && b.y1 < PH;
    const pick = (keys) => { for (const k of keys) { const b = HITS.find((h) => h.key === k && inFrame(h)); if (b) return b; } return null; };
    const center = (b, yBias = 0.5) => [clamp((b.x1 + b.x2) / 2, 40, PW - 40), clamp(b.y1 + (b.y2 - b.y1) * yBias, 40, PH - 40)];
    const layers = [
      { n: 1, name: 'Foreground', b: pick(['fg']), c: '#ff6fa8' },
      { n: 2, name: 'Subject', b: pick(['subj']), c: '#ffb547', yb: 0.25 },
      { n: 3, name: 'Background', b: pick(['wall', 'tree', 'bg', 'car']), c: '#57c7ff', yb: 0.3 },
    ].filter((l) => l.b);
    const pts = layers.map((l) => center(l.b, l.yb ?? 0.5));
    // eye path
    if (pts.length > 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2.5 * u; ctx.setLineDash([10 * u, 8 * u]);
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
        ctx.quadraticCurveTo((ax + bx) / 2, Math.min(ay, by) - 60, bx, by);
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    layers.forEach((l, i) => {
      const [x, y] = pts[i];
      ctx.strokeStyle = l.c; ctx.lineWidth = 2 * u; ctx.strokeRect(l.b.x1, l.b.y1, l.b.x2 - l.b.x1, l.b.y2 - l.b.y1);
      const fs = 12 * u;
      ctx.fillStyle = l.c; circle(ctx, x, y, fs * 0.95);
      text(ctx, String(l.n), x, y + u, { size: fs, align: 'center', weight: 700, color: '#111' });
      ctx.font = `600 ${fs}px ${SANS}`; const w = ctx.measureText(l.name).width + fs;
      const lx = x + fs * 1.3 + w > PW ? x - fs * 1.3 - w : x + fs * 1.3;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; rr(ctx, lx, y - fs * 0.8, w, fs * 1.6, 4 * u);
      text(ctx, l.name, lx + fs / 2, y + u, { size: fs, weight: 600, color: '#fff' });
    });
  }

  function renderChecklist() {
    const sen = SENSORS[S.sensor], lim = dof().c, off = evOffset();
    const subjC = cocMM(OBJ.subj.d), bgC = cocMM(S.wallD);
    const eq = S.f * cropOf(sen), safeT = 1 / eq;
    const fgIn = PHOTO_GEO && HITS.some((h) => h.key === 'fg' && h.x2 > 0 && h.x1 < PHOTO_GEO.PW && h.y2 > 0 && h.y1 < PHOTO_GEO.PH);
    const noiseOk = S.iso <= (sen.w < 15 ? 400 : sen.w < 24 ? 1600 : 3200);
    const motion = ((CAR_SPEED * S.t) / CAR_Z) * (imgDist(S.f, S.focus) / sen.w) * 960;
    const items = [
      [Math.abs(off) < 0.7, 'Exposure looks right', Math.abs(off) < 0.7 ? `meter at ${off >= 0 ? '+' : ''}${off.toFixed(1)}` : `meter at ${off.toFixed(1)}, use "Fix brightness"`],
      [subjC < lim, 'Subject is sharp', subjC < lim ? 'focus is on the person' : 'click the person to focus on them'],
      [bgC > lim * 4, 'Background is soft', bgC > lim * 4 ? `wall blur ${bgC.toFixed(2)} mm` : 'open the aperture or move the wall back'],
      [!!fgIn, 'Foreground layer in frame', fgIn ? 'the leaves add depth' : 'use a longer focal length or bring the leaves in'],
      [!S.handheld || S.t <= safeT * 1.01, 'No camera shake', S.handheld ? `handheld rule: 1/${Math.round(eq)} s or faster` : 'on a tripod'],
      [motion < 5, 'Moving things frozen', motion < 5 ? 'shutter fast enough for the car' : `car smears ${motion.toFixed(0)} px, use a faster shutter`],
      [noiseOk, 'Low grain', noiseOk ? `ISO ${S.iso} is clean on ${sen.label.toLowerCase()}` : `ISO ${S.iso} is grainy on ${sen.label.toLowerCase()}`],
    ];
    const score = items.filter((i) => i[0]).length;
    $('#checklist').innerHTML = `
      <div class="ck-score"><b>${score}/${items.length}</b> ${score === items.length ? 'Ready. Take the photo.' : 'Fix the red items.'}</div>
      <ul>${items.map(([ok, t, d]) => `<li class="${ok ? 'ok' : 'bad'}"><i>${ok ? '✓' : '✕'}</i><span><b>${t}</b><small>${d}</small></span></li>`).join('')}</ul>`;
  }

  function renderStats() {
    const sen = SENSORS[S.sensor], v = imgDist(S.f, S.focus), crop = cropOf(sen), df = dof();
    const off = evOffset(), PWpx = PW;
    const bgC = cocMM(30);
    const motionPx = ((CAR_SPEED * S.t) / CAR_Z) * (v / sen.w) * PWpx;
    const total = isFinite(df.far) ? fmtD(df.far - df.near) : 'to infinity';
    const lightFrac = (S.N / 1.4) ** 2;
    const items = [
      ['Field of view', `${fovDeg(sen.w, v).toFixed(1)}° × ${fovDeg(sen.h, v).toFixed(1)}°`, 'across × up and down'],
      ['35 mm equivalent', `${Math.round(S.f * crop)} mm`, `crop factor ×${crop.toFixed(2)}`],
      ['Aperture opening', `${(S.f / S.N).toFixed(1)} mm`, lightFrac < 1.05 ? 'wide open' : `1/${lightFrac < 10 ? lightFrac.toFixed(1) : Math.round(lightFrac)} the light of f/1.4`],
      ['Depth of field', `${fmtD(df.near)} to ${fmtD(df.far)}`, `sharp zone ${total}`],
      ['Background blur', `${bgC.toFixed(2)} mm`, `disc is ${((bgC / sen.w) * 100).toFixed(1)}% of frame width`],
      ['Car motion blur', `${motionPx.toFixed(motionPx < 10 ? 1 : 0)} px`, motionPx < 1.5 ? 'frozen' : 'smeared'],
      ['Lens to sensor', `${v.toFixed(1)} mm`, 'changes when you focus'],
      ['Exposure', `${off >= 0 ? '+' : ''}${off.toFixed(1)} EV`, meterMsg(off)],
    ];
    $('#stats').innerHTML = items.map(([a, b, c]) => `<div><dt>${a}</dt><dd>${b}<small>${c}</small></dd></div>`).join('');
  }
  function meterMsg(off) {
    if (Math.abs(off) < 0.35) return 'Looks right';
    if (off > 2) return 'Far too bright, highlights blown';
    if (off > 0) return 'A bit too bright';
    if (off < -2) return 'Far too dark';
    return 'A bit too dark';
  }
  function updateMeter() {
    const off = evOffset();
    $('#needle').style.left = `${((clamp(off, -3, 3) + 3) / 6) * 100}%`;
    $('#meterVal').textContent = `${off >= 0 ? '+' : ''}${off.toFixed(1)} EV`;
    $('#meterMsg').textContent = meterMsg(off);
  }

  function update() {
    OBJ.subj.d = S.subjD;
    OBJ.wall.d = S.wallD;
    for (const k of OBJ_KEYS) OBJ[k].dy = S.dy[k];
    $('.photo-wrap').classList.toggle('flipped', S.flip);
    $('#guidesBtn').classList.toggle('on', S.guides);
    $('#flip').classList.toggle('on', S.flip);
    if (S.focus < mfd()) S.focus = mfd();
    sync();
    drawDiagram();
    drawIris();
    drawSpots();
    renderStats();
    updateMeter();
    renderChecklist();
    schedulePhoto();
    save();
  }

  /* --------------------------------------------------------------- shutter */

  function takePhoto() {
    if (shutterAnim) return;
    const travel = 700;
    const expo = clamp(700 * (S.t * 250) ** 0.6, 90, 4000);
    shutterAnim = { start: performance.now(), travel, expo };
    $('#shoot').disabled = true;
    const c1 = $('#cur1'), c2 = $('#cur2'), badge = $('#badge');
    c1.style.display = c2.style.display = 'block';
    badge.textContent = `Slow motion. Real exposure ${fmtT(S.t)}`;
    badge.classList.add('show');
    const tick = () => {
      const st = shutterState();
      c1.style.top = `${st.p1 * 100}%`; c1.style.height = `${(1 - st.p1) * 100}%`;
      c2.style.top = '0'; c2.style.height = `${st.p2 * 100}%`;
      drawDiagram();
      if (st.e < travel + expo + 250) { requestAnimationFrame(tick); return; }
      shutterAnim = null;
      c1.style.display = c2.style.display = 'none';
      const wrap = $('.photo-wrap');
      wrap.classList.remove('flash'); void wrap.offsetWidth; wrap.classList.add('flash');
      badge.textContent = `Captured: f/${S.N}, ${fmtT(S.t)}, ISO ${S.iso}`;
      setTimeout(() => badge.classList.remove('show'), 2200);
      $('#shoot').disabled = false;
      drawDiagram();
    };
    requestAnimationFrame(tick);
  }

  /* --------------------------------------------------------------- lessons */

  /* ------------------------------------------------- saved settings */

  const STORE_KEY = 'cameraLab.v1';
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const out = Object.assign({}, S, { focus: isFinite(S.focus) ? S.focus : 'inf' });
        localStorage.setItem(STORE_KEY, JSON.stringify({ chapter: currentChapter, s: out }));
      } catch (e) { /* storage blocked: settings just won't persist */ }
    }, 250);
  }
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!raw || !raw.s) return null;
      const v = raw.s, st = clone(DEFAULTS);
      if (APERTURES.includes(v.N)) st.N = v.N;
      if (SHUTTERS.includes(v.t)) st.t = v.t;
      if (ISOS.includes(v.iso)) st.iso = v.iso;
      if (SENSORS[v.sensor]) st.sensor = v.sensor;
      if (SCENES.some((x) => x.id === v.scene)) st.scene = v.scene;
      if (v.f >= F_MIN && v.f <= F_MAX) st.f = Math.round(v.f);
      if (v.focus === 'inf') st.focus = Infinity; else if (v.focus >= D_MIN && v.focus <= D_MAX) st.focus = v.focus;
      if (v.subjD >= SUBJ_MIN && v.subjD <= SUBJ_MAX) st.subjD = v.subjD;
      if (v.wallD >= WALL_MIN && v.wallD <= WALL_MAX) st.wallD = v.wallD;
      if (v.lens === 'prime' || v.lens === 'zoom') st.lens = v.lens;
      if (typeof v.subjX === 'number') st.subjX = clamp(v.subjX, -3, 3);
      for (const k of ['handheld', 'exaggerate', 'macro', 'flip', 'everywhere', 'zoomGroups', 'guides', 'hideFg']) if (typeof v[k] === 'boolean') st[k] = v[k];
      if (v.dy) for (const k of OBJ_KEYS) if (typeof v.dy[k] === 'number') st.dy[k] = clamp(v.dy[k], DY_MIN, DY_MAX);
      if (v.rays) for (const k of OBJ_KEYS) if (typeof v.rays[k] === 'boolean') st.rays[k] = v.rays[k];
      return { st, chapter: typeof raw.chapter === 'string' ? raw.chapter : '' };
    } catch (e) { return null; }
  }

  /* ---------------------------------------------------------------- course */

  // Presets come from data attributes as JSON. "t" may be "1/125", "focus" may be "inf".
  function parsePreset(str) {
    let p = {};
    try { p = JSON.parse(str || '{}'); } catch (e) { return {}; }
    if (typeof p.t === 'string') p.t = p.t.includes('/') ? 1 / +p.t.split('/')[1] : +p.t;
    for (const k of ['focus', 'subjD', 'wallD']) if (p[k] === 'inf') p[k] = Infinity;
    return p;
  }
  // A full state: defaults plus the preset (used for chapter set-up, samples and challenges).
  function stateFrom(p) {
    const st = Object.assign(clone(DEFAULTS), p);
    if (p.focus === Infinity) st.focus = Infinity;
    st.rays = Object.assign(clone(DEFAULTS.rays), p.rays || {});
    st.dy = Object.assign(clone(DEFAULTS.dy), p.dy || {});
    return st;
  }
  function applyFull(p, keepLens) {
    const lens = S.lens;
    S = stateFrom(p);
    if (keepLens && !('lens' in p)) S.lens = lens;
    if (isZoom()) S.f = clamp(S.f, ZOOM.min, ZOOM.max);
    clampAperture(); update(); flashLab();
  }
  function applyTry(p) {
    const rays = p.rays, dy = p.dy;
    Object.assign(S, p);
    if (p.focus === Infinity) S.focus = Infinity;
    if (rays) S.rays = Object.assign({}, S.rays, rays);
    if (dy) S.dy = Object.assign({}, S.dy, dy);
    if (isZoom()) S.f = clamp(S.f, ZOOM.min, ZOOM.max);
    clampAperture(); update(); flashLab();
  }
  function runAction(a) {
    const [name, arg] = a.split(':');
    if (name === 'play') { if (!photons.on) togglePhotons(); }
    else if (name === 'stop') { if (photons.on) togglePhotons(); }
    else if (name === 'everywhere') { S.everywhere = !S.everywhere; update(); }
    else if (name === 'flip') { S.flip = !S.flip; update(); }
    else if (name === 'guides') { S.guides = !S.guides; update(); }
    else if (name === 'closeup') $('#zoomLens').click();
    else if (name === 'viewreset') $('#zoomReset').click();
    else if (name === 'shoot') takePhoto();
    else if (name === 'focus') focusOn(arg);
    else if (name === 'fix') fixExposure(arg);
    else if (name === 'tab') showTab(arg);
    flashLab();
  }
  // brief highlight so the reader notices the lab changed
  function flashLab() {
    const lab = $('#lab'); if (!lab) return;
    lab.classList.remove('pulse'); void lab.offsetWidth; lab.classList.add('pulse');
  }
  function showTab(name) {
    document.querySelectorAll('[data-tab-btn]').forEach((b) => b.classList.toggle('on', b.dataset.tabBtn === name));
    document.querySelectorAll('[data-tab]').forEach((p) => p.classList.toggle('hidden', p.dataset.tab !== name));
    if (name === 'spots') drawSpots();
  }

  // Gallery samples: render each one once, when it scrolls into view.
  const sampleQueue = [];
  let sampleBusy = false;
  function renderSample(fig) {
    const canvas = fig.querySelector('canvas');
    const saved = S, sd = OBJ.subj.d, wd = OBJ.wall.d, sdy = OBJ_KEYS.map((k) => OBJ[k].dy);
    try {
      S = stateFrom(parsePreset(fig.dataset.sample));
      clampAperture();
      if (S.focus < mfd()) S.focus = mfd();
      OBJ.subj.d = S.subjD; OBJ.wall.d = S.wallD;
      renderPhoto({ canvas, width: 520, sample: true });
      fig.classList.add('ready');
    } finally {
      S = saved; OBJ.subj.d = sd; OBJ.wall.d = wd; OBJ_KEYS.forEach((k, i) => { OBJ[k].dy = sdy[i]; });
    }
  }
  function pumpSamples() {
    if (sampleBusy || !sampleQueue.length) return;
    sampleBusy = true;
    setTimeout(() => {
      const fig = sampleQueue.shift();
      try { renderSample(fig); } catch (e) { fig.dataset.err = String(e && e.message); }
      sampleBusy = false; pumpSamples();
    }, 16);
  }
  function setupSamples() {
    const figs = document.querySelectorAll('figure.sample');
    figs.forEach((fig) => {
      const p = parsePreset(fig.dataset.sample), st = stateFrom(p);
      const tag = document.createElement('div');
      tag.className = 'sample-settings';
      tag.textContent = `${st.f} mm · f/${st.N} · ${fmtT(st.t)} · ISO ${st.iso}`;
      fig.querySelector('figcaption').appendChild(tag);
      const btn = document.createElement('button');
      btn.className = 'sample-load'; btn.type = 'button'; btn.textContent = 'Load in lab';
      btn.addEventListener('click', () => applyFull(p, false));
      fig.appendChild(btn);
    });
    // render samples that are on screen or close to it
    const pending = new Set(figs);
    const course = $('#course');
    const check = () => {
      const cr = course.getBoundingClientRect();
      const top = Math.max(cr.top, 0) - 500, bottom = Math.min(cr.bottom, window.innerHeight) + 500;
      for (const f of pending) {
        const r = f.getBoundingClientRect();
        if (r.bottom > top && r.top < bottom && r.width > 0) { pending.delete(f); sampleQueue.push(f); }
      }
      pumpSamples();
    };
    course.addEventListener('scroll', check, { passive: true });
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    checkSamples = check;
    check();
  }

  // Table of contents, reading progress and "which chapter am I in".
  function setupCourse() {
    const course = $('#course'), chapters = [...document.querySelectorAll('.chapter')];
    $('#toc').innerHTML = `
      <div class="toc-head"><span>Course 1: the camera</span><span id="tocProgress">0%</span></div>
      <div class="toc-bar"><div id="tocBar"></div></div>
      <ol>${chapters.map((c, i) => `<li><button data-goto="${c.id}"><b>${i + 1}</b>${c.dataset.title}</button></li>`).join('')}</ol>`;
    const toc = $('#toc'), tocBtn = $('#tocBtn');
    const openToc = (open) => { toc.hidden = !open; tocBtn.setAttribute('aria-expanded', String(open)); };
    tocBtn.addEventListener('click', (e) => { e.stopPropagation(); openToc(toc.hidden); });
    document.addEventListener('click', (e) => { if (!toc.hidden && !e.target.closest('#tocMenu')) openToc(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openToc(false); });
    toc.addEventListener('click', (e) => {
      const b = e.target.closest('[data-goto]'); if (!b) return;
      openToc(false);
      if ($('.layout').classList.contains('course-hidden')) $('#toggleCourse').click();
      showChapter(b.dataset.goto);
    });
    // One chapter at a time, with Previous / Next at the top and bottom.
    chapters.forEach((ch, i) => {
      const prev = chapters[i - 1], next = chapters[i + 1];
      const nav = (where) => `
        <nav class="ch-nav ${where}" aria-label="Chapter navigation">
          ${prev ? `<button class="ch-prev" data-goto="${prev.id}"><span>← Previous</span><b>${i}. ${prev.dataset.title}</b></button>` : '<span></span>'}
          <span class="ch-count">Chapter ${i + 1} of ${chapters.length}</span>
          ${next ? `<button class="ch-next" data-goto="${next.id}"><span>Next →</span><b>${i + 2}. ${next.dataset.title}</b></button>` : '<span></span>'}
        </nav>`;
      ch.insertAdjacentHTML('afterbegin', nav('top'));
      ch.insertAdjacentHTML('beforeend', nav('bottom'));
    });
    showChapter = (id) => {
      const ch = document.getElementById(id) || chapters[0];
      const idx = chapters.indexOf(ch);
      chapters.forEach((c) => c.classList.toggle('active', c === ch));
      course.scrollTop = 0;
      currentChapter = ch.id;
      document.querySelectorAll('#toc [data-goto]').forEach((b) => b.classList.toggle('on', b.dataset.goto === ch.id));
      const focus = ch.dataset.focus ? ch.dataset.focus.split(',') : [];
      document.querySelectorAll('.ctl').forEach((c) => c.classList.toggle('focus', focus.includes(c.dataset.ctl)));
      $('#labChapter').textContent = `Chapter ${idx + 1}: ${ch.dataset.title}`;
      $('#tocCur').textContent = `${idx + 1}. ${ch.dataset.title}`;
      const pct = Math.round(((idx + 1) / chapters.length) * 100);
      $('#tocBar').style.width = `${pct}%`; $('#tocBtnBar').style.width = `${pct}%`;
      $('#tocProgress').textContent = `${idx + 1} of ${chapters.length}`;
      save();
      setTimeout(() => checkSamples(), 30);
    };
    course.addEventListener('click', (e) => {
      const b = e.target.closest('.ch-nav [data-goto]'); if (!b) return;
      e.stopPropagation(); showChapter(b.dataset.goto);
    });
    showChapter(chapters[0].id);

    // buttons inside the course
    course.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.setup !== undefined) applyFull(parsePreset(b.dataset.setup), true);
      else if (b.dataset.try !== undefined) applyTry(parsePreset(b.dataset.try));
      else if (b.dataset.action) runAction(b.dataset.action);
    });

    // show or hide the course column
    const KEY = 'cameraLab.ui';
    let ui = {};
    try { ui = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { /* ignore */ }
    if (ui.courseLeft === undefined) ui.courseLeft = false;      // reading on the right by default
    const applyUI = () => {
      $('.layout').classList.toggle('course-hidden', !!ui.hideCourse);
      $('.layout').classList.toggle('course-right', !ui.courseLeft);
      $('#toggleCourse').textContent = ui.hideCourse ? 'Show course' : 'Hide course';
      $('#swapSides').textContent = ui.courseLeft ? 'Course on right' : 'Course on left';
      setTimeout(() => { drawDiagram(); drawGuides(); }, 260);
    };
    $('#swapSides').addEventListener('click', () => {
      ui.courseLeft = !ui.courseLeft; applyUI();
      try { localStorage.setItem(KEY, JSON.stringify(ui)); } catch (e) { /* ignore */ }
    });
    $('#toggleCourse').addEventListener('click', () => {
      ui.hideCourse = !ui.hideCourse; applyUI();
      try { localStorage.setItem(KEY, JSON.stringify(ui)); } catch (e) { /* ignore */ }
    });
    applyUI();

    // lab tabs
    document.querySelectorAll('[data-tab-btn]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tabBtn)));
    showTab('settings');
    return (id) => { if (id) showChapter(id); };
  }

  /* ------------------------------------- autofocus: click a subject */

  let focusAnim = null;
  // Focus is animated in diopters (1 / distance) so infinity is just 0.
  function focusTo(d) {
    const af = $('#af');
    const dio = (x) => (isFinite(x) ? 1 / x : 0);
    const from = dio(S.focus), lim = mfd();
    const tooClose = d < lim;
    let keys;
    if (!tooClose) keys = [{ v: from }, { v: dio(d), dur: 650, overshoot: true }];
    else {
      // hunting: run to the limit, back off, try again, give up
      const L = 1 / lim;
      keys = [{ v: from }, { v: L, dur: 450 }, { v: L * 0.55, dur: 320 }, { v: L, dur: 320 }, { v: L * 0.75, dur: 260 }, { v: L, dur: 260 }];
    }
    if (focusAnim) cancelAnimationFrame(focusAnim.raf);
    af.classList.remove('lock', 'fail');
    const backOut = (t) => { const c = 1.6; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
    const ease = (t) => t * t * (3 - 2 * t);
    let seg = 1, segStart = performance.now();
    focusAnim = {};
    const step = () => {
      const k = keys[seg], t = clamp((performance.now() - segStart) / k.dur, 0, 1);
      const p = k.overshoot ? backOut(t) : ease(t);
      const v = Math.max(0, keys[seg - 1].v + (k.v - keys[seg - 1].v) * p);
      S.focus = v < 1e-4 ? Infinity : Math.max(lim, 1 / v);
      if (t >= 1) {
        seg++; segStart = performance.now();
        if (seg >= keys.length) {
          S.focus = tooClose ? lim : d;
          focusAnim = null; update();
          const badge = $('#badge');
          if (tooClose) {
            af.classList.add('fail');
            badge.textContent = `Can't focus: ${fmtD(d)} away, this lens focuses no closer than ${fmtD(lim)}`;
            badge.classList.add('show', 'warn');
            setTimeout(() => { af.classList.remove('show', 'fail'); badge.classList.remove('show', 'warn'); }, 2600);
          } else {
            af.classList.add('lock');
            setTimeout(() => af.classList.remove('show', 'lock'), 900);
          }
          return;
        }
      }
      update();
      focusAnim.raf = requestAnimationFrame(step);
    };
    focusAnim.raf = requestAnimationFrame(step);
  }
  function showAF(px, py) {
    const af = $('#af');
    if (!PHOTO_GEO || px < 0 || py < 0 || px > PHOTO_GEO.PW || py > PHOTO_GEO.PH) { af.classList.remove('show'); return; }
    const fx = S.flip ? PHOTO_GEO.PW - px : px, fy = S.flip ? PHOTO_GEO.PH - py : py;
    af.style.left = `${(fx / PHOTO_GEO.PW) * 100}%`; af.style.top = `${(fy / PHOTO_GEO.PH) * 100}%`;
    af.classList.remove('lock'); af.classList.add('show');
  }
  function focusOn(key) {
    const h = HITS.find((b) => b.key === key && b.x2 > 0 && b.x1 < PHOTO_GEO.PW && b.y2 > 0 && b.y1 < PHOTO_GEO.PH);
    if (h) showAF(clamp((h.x1 + h.x2) / 2, 20, PHOTO_GEO.PW - 20), clamp((h.y1 + h.y2) / 2, 20, PHOTO_GEO.PH - 20));
    else if (key === 'mtn' && PHOTO_GEO) showAF(PHOTO_GEO.PW / 2, PHOTO_GEO.cy - 0.03 * PHOTO_GEO.k);
    else $('#af').classList.remove('show');
    focusTo(OBJ[key].d);
  }
  function focusPhotoPoint(px, py) {
    showAF(px, py);
    const h = HITS.find((b) => px >= b.x1 && px <= b.x2 && py >= b.y1 && py <= b.y2);
    if (h) { focusTo(h.key === 'tree' ? h.Z : OBJ[h.key].d); return; }
    const G = PHOTO_GEO;
    if (py <= G.cy + 1) focusTo(Infinity);                         // sky and mountains
    else focusTo(clamp((CAM_H * G.k) / (py - G.cy), D_MIN, D_MAX)); // the ground at that spot
  }

  function setupPointer() {
    const dc = $('#diagram'), pc = $('#photo');
    const toScreen = (e) => { const r = dc.getBoundingClientRect(); return [((e.clientX - r.left) * DW) / r.width, ((e.clientY - r.top) * DH) / r.height]; };
    const toDiag = (e) => { const [sx, sy] = toScreen(e); return [(sx - view.tx) / view.scale, (sy - view.ty) / view.scale]; };
    // Which part of the lens is under the pointer: a zoom group (changes focal length) or the lens (focus).
    const hitLens = (G, x, y) => {
      if (Math.abs(y - G.cy) > G.gH + 14) return null;
      const LG = lensGroups(G), fx = G.lensX - LG.gf, rx = G.lensX + LG.gr;
      // the aperture blades: drag up or down to open or close
      if (Math.abs(x - G.lensX) < 7 && Math.abs(y - G.cy) >= G.aH - 5) return 'blades';
      if (isZoom()) {
        if (Math.abs(x - fx) < 11) return 'front';
        if (Math.abs(x - rx) < 11) return 'rear';
        if (Math.abs(x - G.lensX) < 8) return 'lens';
        return null;
      }
      return x > fx - 11 && x < rx + 11 ? 'lens' : null;
    };
    dc.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;     // plain scroll still scrolls the page
      e.preventDefault();
      const [sx, sy] = toScreen(e);
      zoomAt(sx, sy, Math.exp(-e.deltaY * 0.01));
    }, { passive: false });
    let drag = null;

    dc.addEventListener('pointerdown', (e) => {
      const [x, y] = toDiag(e), G = geometry(), key = hitObject(G, x, y);
      if (!key && hitFocusLine(G, x, y)) {
        if (focusAnim) { cancelAnimationFrame(focusAnim.raf); focusAnim = null; }
        drag = { el: dc, focusLine: true, offset: x - objX(G, S.focus) };
        focusLineActive = true; drawDiagram();
        dc.setPointerCapture(e.pointerId); e.preventDefault(); return;
      }
      const part = !key ? hitLens(G, x, y) : null;
      if (part) {
        if (focusAnim) { cancelAnimationFrame(focusAnim.raf); focusAnim = null; }
        drag = { el: dc, lensPart: part, x0: x, s0: zoomSpacing(S.f), offset: x - G.lensX };
        dc.setPointerCapture(e.pointerId); e.preventDefault(); return;
      }
      if (!key) {
        if (view.scale > 1.001) {
          const [sx, sy] = toScreen(e);
          drag = { el: dc, pan: true, sx0: sx, sy0: sy, tx0: view.tx, ty0: view.ty };
          dc.style.cursor = 'grabbing';
          dc.setPointerCapture(e.pointerId); e.preventDefault();
        }
        return;
      }
      drag = { el: dc, key, x0: e.clientX, y0: e.clientY, moved: false, offset: x - objX(G, OBJ[key].d), offY: y - (G.cy + OBJ[key].dy) };
      dc.setPointerCapture(e.pointerId); e.preventDefault();
    });
    dc.addEventListener('pointermove', (e) => {
      const [x, y] = toDiag(e), G = geometry();
      if (drag && drag.el === dc && drag.pan) {
        const [sx, sy] = toScreen(e);
        view.tx = drag.tx0 + (sx - drag.sx0); view.ty = drag.ty0 + (sy - drag.sy0);
        clampView(); drawDiagram(); return;
      }
      if (drag && drag.el === dc && drag.lensPart) {
        if (drag.lensPart === 'blades') {
          // blade edge position sets the opening: N = f / D
          const D = (2 * Math.max(1, Math.abs(y - G.cy))) / G.sc;
          const want = clamp(S.f / D, minN(S.f), 22);
          S.N = APERTURES.find((a) => a >= want - 0.01) || 22;
          clampAperture();
        } else if (drag.lensPart === 'front' || drag.lensPart === 'rear') {
          // moving a group changes the spacing, which changes the focal length
          const dx = x - drag.x0;
          const sp = clamp(drag.s0 + (drag.lensPart === 'rear' ? dx : -dx) / 1.1, zoomSpacing(ZOOM.max), zoomSpacing(ZOOM.min));
          S.f = clamp(Math.round((ZOOM.f1 * ZOOM.f2) / (ZOOM.f1 + ZOOM.f2 - sp)), ZOOM.min, ZOOM.max);
          clampAperture();
        } else {
          // moving the whole lens toward or away from the sensor focuses it
          const lensCenter = x - drag.offset;
          const dispV = (G.sensorX - lensCenter) / G.sc;
          const v = S.f + (dispV - S.f) / G.E;
          S.focus = v <= S.f + 1e-4 ? Infinity : Math.max(mfd(), (S.f * v) / (v - S.f) / 1000);
        }
        update(); return;
      }
      if (drag && drag.el === dc && drag.focusLine) {
        const fx = x - drag.offset;
        S.focus = fx <= G.objL + 2 ? Infinity : clamp(xToD(G, fx), mfd(), D_MAX);
        update(); return;
      }
      if (drag && drag.el === dc) {
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) drag.moved = true;
        if (drag.moved) {
          dc.classList.add('grabbing'); dc.style.cursor = 'grabbing';
          S.dy[drag.key] = Math.round(clamp(y - drag.offY - G.cy, DY_MIN, DY_MAX));
          if (drag.key === 'subj') S.subjD = clamp(xToD(G, x - drag.offset), SUBJ_MIN, SUBJ_MAX);
          if (drag.key === 'wall') S.wallD = clamp(xToD(G, x - drag.offset), WALL_MIN, WALL_MAX);
          update();
        }
      } else {
        const key = hitObject(G, x, y);
        const lp = !key && hitLens(G, x, y);
        dc.style.cursor = key ? 'grab' : lp === 'blades' ? 'ns-resize' : hitFocusLine(G, x, y) || lp ? 'ew-resize' : view.scale > 1.001 ? 'move' : '';
      }
    });

    pc.addEventListener('pointerdown', (e) => {
      drag = { el: pc, x0: e.clientX, y0: e.clientY, d0: S.subjD, sx0: S.subjX, moved: false };
      pc.setPointerCapture(e.pointerId); e.preventDefault();
    });
    pc.addEventListener('pointermove', (e) => {
      if (!drag || drag.el !== pc) return;
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5) drag.moved = true;
      if (!drag.moved) return;
      pc.classList.add('grabbing');
      const r = pc.getBoundingClientRect(), flip = S.flip ? -1 : 1;
      const dy = ((drag.y0 - e.clientY) / r.height) * flip;
      S.subjD = clamp(drag.d0 * Math.exp(dy * 3), SUBJ_MIN, SUBJ_MAX);
      if (PHOTO_GEO) {
        const dpx = ((e.clientX - drag.x0) * PHOTO_GEO.PW) / r.width * flip;
        S.subjX = clamp(drag.sx0 + (dpx / PHOTO_GEO.k) * S.subjD, -3, 3);
      }
      update();
    });

    const end = (e) => {
      if (!drag) return;
      const d = drag; drag = null;
      d.el.classList.remove('grabbing');
      if (d.focusLine) { focusLineActive = false; drawDiagram(); return; }
      if (d.pan || d.lensPart) { dc.style.cursor = ''; return; }
      if (d.moved || e.type === 'pointercancel') return;
      if (d.el === dc) focusOn(d.key);
      else {
        const r = pc.getBoundingClientRect();
        let px = ((e.clientX - r.left) * PHOTO_GEO.PW) / r.width, py = ((e.clientY - r.top) * PHOTO_GEO.PH) / r.height;
        if (S.flip) { px = PHOTO_GEO.PW - px; py = PHOTO_GEO.PH - py; }
        focusPhotoPoint(px, py);
      }
    };
    ['pointerup', 'pointercancel'].forEach((ev) => { dc.addEventListener(ev, end); pc.addEventListener(ev, end); });
  }

  /* ------------------------------------------- resizable split, floating panels */

  function setupLayoutTools() {
    const KEY = 'cameraLab.layout', layout = $('.layout'), lab = $('#lab');
    let st = { courseW: null, photo: { on: false }, tabs: { on: false } };
    try { st = Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* ignore */ }
    const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* ignore */ } };
    const desktop = () => window.innerWidth > 1100;
    const redraw = () => { drawDiagram(); drawGuides(); };

    // ---- separator between the lab and the course
    const applyWidth = () => {
      if (st.courseW) layout.style.setProperty('--courseW', `${st.courseW}px`);
      else layout.style.removeProperty('--courseW');
    };
    const clampW = (w) => clamp(w, 320, Math.max(320, layout.clientWidth - 440));
    const sp = $('#splitter');
    let dragW = null;
    sp.addEventListener('pointerdown', (e) => {
      if (!desktop()) return;
      dragW = { right: layout.classList.contains('course-right') };
      sp.setPointerCapture(e.pointerId); layout.classList.add('resizing'); e.preventDefault();
    });
    sp.addEventListener('pointermove', (e) => {
      if (!dragW) return;
      const r = layout.getBoundingClientRect();
      st.courseW = Math.round(clampW(dragW.right ? r.right - e.clientX : e.clientX - r.left));
      applyWidth(); drawDiagram();
    });
    const endW = () => { if (!dragW) return; dragW = null; layout.classList.remove('resizing'); persist(); redraw(); };
    sp.addEventListener('pointerup', endW); sp.addEventListener('pointercancel', endW);
    sp.addEventListener('dblclick', () => { st.courseW = null; applyWidth(); persist(); setTimeout(redraw, 50); });
    sp.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const cur = $('#course').getBoundingClientRect().width;
      const toward = layout.classList.contains('course-right') ? (e.key === 'ArrowLeft' ? 1 : -1) : (e.key === 'ArrowRight' ? 1 : -1);
      st.courseW = Math.round(clampW(cur + toward * 24)); applyWidth(); persist(); redraw(); e.preventDefault();
    });

    // ---- floating panels
    const panels = { photo: $('#photoPanel'), tabs: $('#tabsPanel') };
    const keepOnScreen = (p) => {
      p.x = clamp(p.x, 0, Math.max(0, window.innerWidth - 120));
      p.y = clamp(p.y, 0, Math.max(0, window.innerHeight - 60));
    };
    const applyFloat = () => {
      for (const name of Object.keys(panels)) {
        const el = panels[name], p = st[name], on = !!p.on && desktop();
        el.classList.toggle('floating', on);
        el.querySelector('[data-float]').textContent = on ? 'Dock panel' : 'Float panel';
        el.querySelector('[data-more]').classList.toggle('on', on);
        if (on) {
          keepOnScreen(p);
          Object.assign(el.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px` });
        } else {
          ['left', 'top', 'width', 'height'].forEach((k) => { el.style[k] = ''; });
        }
      }
      const pf = panels.photo.classList.contains('floating'), tf = panels.tabs.classList.contains('floating');
      lab.classList.toggle('photo-floating', pf && !tf);
      lab.classList.toggle('tabs-floating', tf && !pf);
      lab.classList.toggle('both-floating', pf && tf);
      setTimeout(redraw, 30);
    };
    // the ⋮ menus
    const closeMenus = () => document.querySelectorAll('.more-pop').forEach((m) => { m.hidden = true; });
    document.querySelectorAll('[data-more]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const pop = b.nextElementSibling, open = pop.hidden;
      closeMenus(); pop.hidden = !open;
    }));
    document.addEventListener('click', (e) => { if (!e.target.closest('.more-menu')) closeMenus(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
    document.querySelectorAll('[data-float]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation(); closeMenus();
      const name = b.dataset.float, p = st[name], el = panels[name];
      if (!p.on) {
        const r = el.getBoundingClientRect();
        const w = p.w || Math.round(Math.min(r.width, name === 'photo' ? 460 : 380));
        const h = p.h || Math.round(Math.min(window.innerHeight * 0.7, name === 'photo' ? 520 : 600));
        Object.assign(p, {
          w, h,
          x: p.x ?? (window.innerWidth - w - 24 - (name === 'tabs' ? 480 : 0)),
          y: p.y ?? (window.innerHeight - h - 24),
        });
      }
      p.on = !p.on; applyFloat(); persist();
    }));
    let drag = null, zTop = 60;
    document.querySelectorAll('[data-drag]').forEach((bar) => {
      const name = bar.dataset.drag, el = panels[name];
      el.addEventListener('pointerdown', () => { if (el.classList.contains('floating')) el.style.zIndex = String(++zTop); });
      bar.addEventListener('pointerdown', (e) => {
        if (!el.classList.contains('floating') || e.target.closest('button')) return;
        drag = { name, el, bar, dx: e.clientX - st[name].x, dy: e.clientY - st[name].y };
        bar.setPointerCapture(e.pointerId); bar.classList.add('dragging'); e.preventDefault();
      });
      bar.addEventListener('pointermove', (e) => {
        if (!drag || drag.bar !== bar) return;
        const p = st[name];
        p.x = e.clientX - drag.dx; p.y = e.clientY - drag.dy; keepOnScreen(p);
        el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
      });
      const end = () => { if (!drag || drag.bar !== bar) return; bar.classList.remove('dragging'); drag = null; persist(); };
      bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
    });
    // remember the size after the user resizes a floating panel from its corner
    if (window.ResizeObserver) {
      let t = null;
      const ro = new ResizeObserver(() => {
        clearTimeout(t);
        t = setTimeout(() => {
          for (const name of Object.keys(panels)) {
            const el = panels[name];
            if (!el.classList.contains('floating')) continue;
            st[name].w = Math.round(el.offsetWidth); st[name].h = Math.round(el.offsetHeight);
          }
          persist();
        }, 200);
      });
      Object.values(panels).forEach((el) => ro.observe(el));
    }
    window.addEventListener('resize', () => { applyFloat(); });
    applyWidth(); applyFloat();
  }

  /* ------------------------------------------- real-photo composition lessons */

  function setupPhotoLessons() {
    const src = (id) => `images/composition/${id}.jpg`;

    // annotated photos: show or hide the drawn guides
    document.querySelectorAll('.ph .tag').forEach((t) => { t.style.maxWidth = `${97 - parseFloat(t.style.left || 0)}%`; });
    document.querySelectorAll('.photo-ex .ph').forEach((ph) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'guide-btn'; b.textContent = 'Hide guides';
      b.addEventListener('click', () => { const clean = ph.classList.toggle('clean'); b.textContent = clean ? 'Show guides' : 'Hide guides'; });
      ph.appendChild(b);
    });

    // crop quizzes: three crops of one photo, pick the best
    const cropStyle = (el, W, H, l, t, w, h) => {
      Object.assign(el.style, {
        aspectRatio: `${(w * W) / (h * H)}`,
        backgroundSize: `${10000 / w}% ${10000 / h}%`,
        backgroundPosition: `${w >= 100 ? 0 : (l / (100 - w)) * 100}% ${h >= 100 ? 0 : (t / (100 - h)) * 100}%`,
      });
    };
    document.querySelectorAll('.crop-quiz').forEach((q) => {
      const url = src(q.dataset.img), img = new Image();
      img.onload = () => {
        q.querySelectorAll('.cq-opt').forEach((o) => {
          const th = o.querySelector('.cq-thumb'), [l, t, w, h] = o.dataset.crop.split(',').map(Number);
          th.style.backgroundImage = `url("${url}")`;
          cropStyle(th, img.naturalWidth, img.naturalHeight, l, t, w, h);
        });
      };
      img.src = url;
      const answer = +q.dataset.answer;
      q.querySelectorAll('.cq-opt').forEach((o, i) => o.addEventListener('click', () => {
        q.querySelectorAll('.cq-opt').forEach((x, j) => {
          x.classList.toggle('right', j === answer);
          x.classList.toggle('wrong', j === i && i !== answer);
          x.classList.toggle('picked', j === i);
        });
        q.querySelector('.cq-why').hidden = false;
      }));
    });

    // crop trainer
    const T = $('#trainer'); if (!T) return;
    const POI = {
      505: { subj: [0.605, 0.57], horizon: 0.665, good: [0.205, 0.265, 0.6] },
      853: { subj: [0.72, 0.73], horizon: 0.37, good: [0, 0, 1] },
      1005: { subj: [0.53, 0.42], gaze: 'right', good: [0.33, 0.22, 0.6] },
      447: { subj: [0.5, 0.5], horizon: 0.62, good: [0.3, 0.22, 0.6] },
    };
    const imgEl = $('#trImg'), box = $('#trCrop'), stage = T.querySelector('.tr-stage');
    let cur = '505', ratio = 1.5, A = 1.5, c = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    const hFor = (w) => (w * A) / ratio;
    const fit = () => {             // keep the crop inside the photo with the right shape
      c.w = clamp(c.w, 0.08, 1); c.h = hFor(c.w);
      if (c.h > 1) { c.h = 1; c.w = ratio / A; }
      c.x = clamp(c.x, 0, 1 - c.w); c.y = clamp(c.y, 0, 1 - c.h);
    };
    const render = () => {
      Object.assign(box.style, { left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` });
      feedback();
    };
    const feedback = () => {
      const p = POI[cur], out = [];
      const sx = (p.subj[0] - c.x) / c.w, sy = (p.subj[1] - c.y) / c.h;
      if (sx < 0.03 || sx > 0.97 || sy < 0.03 || sy > 0.97) out.push(['bad', 'The subject is cut off or outside the crop.']);
      else {
        const d = Math.min(...[[1 / 3, 1 / 3], [2 / 3, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 2 / 3]].map(([a, b]) => Math.hypot(sx - a, sy - b)));
        if (d < 0.09) out.push(['ok', 'Subject sits on a thirds crossing.']);
        else if (Math.abs(sx - 0.5) < 0.07 && Math.abs(sy - 0.5) < 0.1) out.push(['warn', 'Subject is centered: calm and formal. Try a third for more energy.']);
        else if (Math.min(Math.abs(sx - 1 / 3), Math.abs(sx - 2 / 3)) < 0.06) out.push(['ok', 'Subject sits on a vertical thirds line.']);
        else out.push(['warn', 'Move the subject closer to a thirds line or crossing.']);
        if (sx < 0.12 || sx > 0.88 || sy < 0.1 || sy > 0.9) out.push(['warn', 'The subject is very close to the edge. Give it a little breathing room.']);
      }
      if (p.horizon !== undefined) {
        const hy = (p.horizon - c.y) / c.h;
        if (hy > 0.02 && hy < 0.98) {
          if (Math.min(Math.abs(hy - 1 / 3), Math.abs(hy - 2 / 3)) < 0.06) out.push(['ok', `Horizon on the ${hy < 0.5 ? 'upper' : 'lower'} third line.`]);
          else if (Math.abs(hy - 0.5) < 0.07) out.push(['warn', 'Horizon cuts the frame in half. Move it to a third line.']);
          else out.push(['warn', 'Put the horizon on one of the third lines.']);
        } else out.push(['warn', 'The horizon is out of the crop, so the photo loses its sense of place.']);
      }
      if (p.gaze === 'right' && sx > 0.03 && sx < 0.97) {
        out.push(sx < 0.5 ? ['ok', 'Space in front of the face: she looks into the frame.'] : ['warn', 'She looks toward the edge. Leave room in the direction she looks.']);
      }
      if (c.w < 0.3) out.push(['warn', 'A very tight crop throws away a lot of pixels and quality.']);
      const good = out.filter((o) => o[0] === 'ok').length, total = out.length;
      $('#trFeedback').innerHTML = `<li class="score"><b>${good}/${total}</b> ${good === total ? 'Strong composition.' : 'Keep adjusting.'}</li>` +
        out.map(([k, t]) => `<li class="${k}"><i>${k === 'ok' ? '✓' : k === 'bad' ? '✕' : '!'}</i>${t}</li>`).join('');
    };
    const setImage = (id) => {
      cur = id;
      T.querySelectorAll('[data-tr-img]').forEach((b) => b.classList.toggle('on', b.dataset.trImg === id));
      imgEl.onload = () => { A = imgEl.naturalWidth / imgEl.naturalHeight; reset(); };
      imgEl.src = src(id);
    };
    const setRatio = (r) => {
      const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
      ratio = r;
      T.querySelectorAll('[data-tr-ratio]').forEach((b) => b.classList.toggle('on', Math.abs(+b.dataset.trRatio - r) < 0.01));
      c.h = hFor(c.w); if (c.h > 0.9) { c.h = 0.9; c.w = (c.h * ratio) / A; }
      c.x = cx - c.w / 2; c.y = cy - c.h / 2; fit(); render();
    };
    // start with the subject dead center, so there is something to improve
    const reset = () => {
      c.w = 0.62; c.h = hFor(c.w); if (c.h > 0.8) { c.h = 0.8; c.w = (0.8 * ratio) / A; }
      const [px, py] = POI[cur].subj; c.x = px - c.w / 2; c.y = py - c.h / 2; fit(); render();
    };
    T.querySelectorAll('[data-tr-img]').forEach((b) => b.addEventListener('click', () => setImage(b.dataset.trImg)));
    T.querySelectorAll('[data-tr-ratio]').forEach((b) => b.addEventListener('click', () => setRatio(+b.dataset.trRatio)));
    $('#trReset').addEventListener('click', reset);
    $('#trGood').addEventListener('click', () => {
      const [x, y, w] = POI[cur].good;
      ratio = 1.5; T.querySelectorAll('[data-tr-ratio]').forEach((b) => b.classList.toggle('on', b.dataset.trRatio === '1.5'));
      c = { x, y, w, h: hFor(w) }; fit(); render();
    });

    // drag to move, corners to resize (the opposite corner stays put)
    let drag = null;
    box.addEventListener('pointerdown', (e) => {
      const r = stage.getBoundingClientRect(), h = e.target.closest('.h');
      drag = { h: h ? [...h.classList].find((k) => k.length === 2) : null, px: e.clientX, py: e.clientY, c0: { ...c }, r };
      box.setPointerCapture(e.pointerId); e.preventDefault();
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.px) / drag.r.width, dy = (e.clientY - drag.py) / drag.r.height, c0 = drag.c0;
      if (!drag.h) { c.x = c0.x + dx; c.y = c0.y + dy; }
      else {
        const left = drag.h[1] === 'l', top = drag.h[0] === 't';
        const ax = left ? c0.x + c0.w : c0.x, ay = top ? c0.y + c0.h : c0.y;   // anchor corner
        let w = c0.w + (left ? -dx : dx);
        w = Math.min(w, left ? ax : 1 - ax, ((top ? ay : 1 - ay) * ratio) / A);
        w = Math.max(w, 0.08);
        c.w = w; c.h = hFor(w);
        c.x = left ? ax - w : ax; c.y = top ? ay - c.h : ay;
      }
      fit(); render();
    });
    const end = () => { drag = null; };
    box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
    setRatio(1.5);
    setImage('505');
  }

  /* ------------------------------------------------- real-world example gallery */

  function setupGallery() {
    const data = window.GALLERY || [], grid = $('#galGrid');
    if (!grid || !data.length) return;
    const CATS = { trees: 'Trees', mountains: 'Mountains', flowers: 'Flowers', cars: 'Cars', city: 'City', animals: 'Animals', people: 'People', water: 'Water', food: 'Food', night: 'Night' };
    const TECH = {
      thirds: 'Rule of thirds', leading: 'Leading lines', symmetry: 'Symmetry', framing: 'Framing', layering: 'Layering',
      negative: 'Negative space', pattern: 'Pattern', fill: 'Fill the frame', viewpoint: 'Viewpoint', shallow: 'Shallow depth of field',
      light: 'Light', color: 'Color contrast', contrast: 'Tonal contrast', motion: 'Motion', balance: 'Balance', scale: 'Scale',
      eyes: 'Sharp eyes', leadroom: 'Lead room',
    };
    let cat = 'all', tech = 'all', shown = [], cur = 0;
    const count = (k) => data.filter((d) => d.cat === k).length;
    $('#galCats').innerHTML = `<button data-gcat="all">All (${data.length})</button>` +
      Object.entries(CATS).map(([k, v]) => `<button data-gcat="${k}">${v} (${count(k)})</button>`).join('');
    const techs = Object.keys(TECH).filter((t) => data.some((d) => d.tech.includes(t)));
    $('#galTech').innerHTML = '<option value="all">All techniques</option>' + techs.map((t) => `<option value="${t}">${TECH[t]}</option>`).join('');
    const src = (d) => `images/gallery/${d.id}.jpg`;
    const draw = () => {
      shown = data.filter((d) => (cat === 'all' || d.cat === cat) && (tech === 'all' || d.tech.includes(tech)));
      document.querySelectorAll('[data-gcat]').forEach((b) => b.classList.toggle('on', b.dataset.gcat === cat));
      grid.innerHTML = shown.length ? shown.map((d, i) => `
        <button class="gal-card" data-gi="${i}" aria-label="${d.title}">
          <span class="gal-img"><img src="${src(d)}" alt="" loading="lazy"></span>
          <span class="gal-title">${d.title}</span>
          <span class="gal-tags">${d.tech.map((t) => `<i class="${t === tech ? 'hit' : ''}">${TECH[t]}</i>`).join('')}</span>
        </button>`).join('') : '<p class="gal-empty">No photos match. Try another subject or technique.</p>';
    };
    $('#galCats').addEventListener('click', (e) => { const b = e.target.closest('[data-gcat]'); if (b) { cat = b.dataset.gcat; draw(); } });
    $('#galTech').addEventListener('change', (e) => { tech = e.target.value; draw(); });
    draw();

    // lightbox
    const lb = $('#lightbox');
    const show = (i) => {
      cur = (i + shown.length) % shown.length;
      const d = shown[cur];
      $('#lbImg').src = src(d); $('#lbImg').alt = d.title;
      $('#lbTitle').textContent = d.title;
      $('#lbText').textContent = d.text;
      $('#lbTags').innerHTML = `<i class="cat">${CATS[d.cat]}</i>` + d.tech.map((t) => `<i>${TECH[t]}</i>`).join('');
      $('#lbCount').textContent = `${cur + 1} of ${shown.length}`;
      $('#lbCredit').textContent = `Photo: ${d.by} (Unsplash)`;
    };
    const open = (i) => { show(i); lb.hidden = false; document.body.classList.add('lb-open'); $('#lbClose').focus(); };
    const close = () => { lb.hidden = true; document.body.classList.remove('lb-open'); };
    grid.addEventListener('click', (e) => { const c = e.target.closest('[data-gi]'); if (c) open(+c.dataset.gi); });
    $('#lbClose').addEventListener('click', close);
    $('#lbPrev').addEventListener('click', () => show(cur - 1));
    $('#lbNext').addEventListener('click', () => show(cur + 1));
    lb.addEventListener('click', (e) => { if (e.target === lb) close(); });
    $('#lbThirds').addEventListener('change', (e) => $('#lbGrid').classList.toggle('hidden', !e.target.checked));
    document.addEventListener('keydown', (e) => {
      if (lb.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') show(cur - 1);
      else if (e.key === 'ArrowRight') show(cur + 1);
    });
  }

  /* ------------------------------------------------------------- full screen */

  function setupFullscreen() {
    const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
    const enter = (el) => (el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen && el.webkitRequestFullscreen());
    const exit = () => (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen && document.webkitExitFullscreen());
    const toggle = (el) => {
      try { if (fsEl() === el) exit(); else { if (fsEl()) exit(); enter(el); } } catch (e) { /* not allowed here */ }
    };
    const supported = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
    const btnApp = $('#fullscreenApp'), btnDia = $('#fullscreenDiagram');
    if (!supported) { btnApp.hidden = true; btnDia.hidden = true; document.querySelectorAll('[data-fullscreen]').forEach((b) => { b.hidden = true; }); return; }
    btnApp.addEventListener('click', () => toggle(document.documentElement));
    btnDia.addEventListener('click', () => toggle($('#diagramPanel')));
    document.querySelectorAll('[data-fullscreen]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.more-pop').forEach((m) => { m.hidden = true; });
      toggle($(b.dataset.fullscreen));
    }));
    const onChange = () => {
      const el = fsEl();
      btnApp.textContent = el === document.documentElement ? '⛶ Exit full screen' : '⛶ Full screen';
      btnDia.classList.toggle('on', el === $('#diagramPanel'));
      btnDia.title = el === $('#diagramPanel') ? 'Exit full screen (Esc)' : 'Show the simulator in full screen (Esc to exit)';
      document.querySelectorAll('[data-fullscreen]').forEach((b) => { b.textContent = el === $(b.dataset.fullscreen) ? 'Exit full screen' : 'Full screen'; });
      setTimeout(() => { drawDiagram(); drawGuides(); }, 80);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
  }

  if (window.ResizeObserver) new ResizeObserver(() => drawGuides()).observe($('#photo'));
  buildUI();
  setupPointer();
  const saved = load();
  if (saved) S = saved.st;
  clampAperture();
  update();
  const gotoChapter = setupCourse();
  setupLayoutTools();
  setupFullscreen();
  setupPhotoLessons();
  setupGallery();
  setupSamples();
  if (saved && saved.chapter) gotoChapter(saved.chapter);
  // index.html#play starts the light animation, #everywhere turns on "light goes everywhere"
  const hashOpts = location.hash.slice(1).split(',');
  if (hashOpts.includes('everywhere')) { S.everywhere = true; update(); }
  if (hashOpts.includes('zoom')) { S.lens = 'zoom'; S.f = clamp(S.f, ZOOM.min, ZOOM.max); clampAperture(); update(); }
  if (hashOpts.includes('play')) togglePhotons();
  if (hashOpts.includes('closeup')) $('#zoomLens').click();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { drawDiagram(); drawSpots(); });
})();
