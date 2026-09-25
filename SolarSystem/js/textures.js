// Procedural planet textures, painted into 2D canvases at load time.
// Generating them means the project ships zero image assets, and every planet
// looks identical on every run because the RNG is seeded.
import * as THREE from 'three';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixHex(a, b, t) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const m = (x, y) => Math.round(x + (y - x) * t);
  return `rgb(${m(r1, r2)},${m(g1, g2)},${m(b1, b2)})`;
}

// Smooth 1D value noise summed over a few octaves. Drives the cloud bands.
function noise1D(height, rnd, octaves = [[5, 1], [11, 0.5], [23, 0.25], [47, 0.13]]) {
  const tables = octaves.map(() => Array.from({ length: 256 }, () => rnd()));
  const out = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let v = 0;
    let amp = 0;
    octaves.forEach(([freq, a], oi) => {
      const table = tables[oi];
      const p = (y / height) * freq;
      const i0 = Math.floor(p) % table.length;
      const i1 = (i0 + 1) % table.length;
      const f = p - Math.floor(p);
      const smooth = f * f * (3 - 2 * f);
      v += (table[i0] * (1 - smooth) + table[i1] * smooth) * a;
      amp += a;
    });
    out[y] = v / amp;
  }
  return out;
}

// Darken the poles slightly so spheres do not read as flat decals.
function shadePoles(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0.45)');
  g.addColorStop(0.18, 'rgba(0,0,0,0)');
  g.addColorStop(0.82, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Cratered, blotchy surface: Mercury, Mars, the Moon. */
export function rockyTexture({ base, shades, craters = 150, seed = 1, w = 1024, h = 512 }) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);

  g.fillStyle = base;
  g.fillRect(0, 0, w, h);

  // Broad regional colour variation.
  for (let i = 0; i < 300; i++) {
    g.globalAlpha = 0.05 + rnd() * 0.1;
    g.fillStyle = shades[(rnd() * shades.length) | 0];
    g.beginPath();
    g.ellipse(rnd() * w, rnd() * h, 25 + rnd() * 150, 15 + rnd() * 90, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }

  // Craters: dark floor plus a bright rim on one side.
  for (let i = 0; i < craters; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = 2 + rnd() * 13;
    g.globalAlpha = 0.28;
    g.fillStyle = '#000000';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 0.22;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.3;
    g.beginPath();
    g.arc(x, y - r * 0.18, r * 0.94, 0, Math.PI * 2);
    g.stroke();
  }

  g.globalAlpha = 1;
  shadePoles(g, w, h);
  return toTexture(c);
}

/** Banded gas giant: Jupiter, Saturn, Uranus, Neptune. */
export function gasTexture({ palette, seed = 1, storms = [], w = 1024, h = 512 }) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);
  const rows = noise1D(h, rnd);

  for (let y = 0; y < h; y++) {
    const v = Math.min(0.999, Math.max(0, rows[y]));
    const scaled = v * (palette.length - 1);
    const i = Math.floor(scaled);
    const j = Math.min(palette.length - 1, i + 1);
    g.fillStyle = mixHex(palette[i], palette[j], scaled - i);
    g.fillRect(0, y, w, 1);
  }

  // Stretched swirls riding along the bands.
  for (let i = 0; i < 90; i++) {
    const y = Math.floor(rnd() * h);
    const v = Math.min(0.999, Math.max(0, rows[y]));
    const shifted = Math.min(palette.length - 1, Math.floor(v * palette.length) + 1);
    g.globalAlpha = 0.16 + rnd() * 0.2;
    g.fillStyle = palette[shifted];
    g.beginPath();
    g.ellipse(rnd() * w, y, 30 + rnd() * 140, 3 + rnd() * 9, 0, 0, Math.PI * 2);
    g.fill();
  }

  // Named storms, e.g. the Great Red Spot.
  for (const s of storms) {
    const cx = s.x * w;
    const cy = s.y * h;
    const rad = s.r * w;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0, s.color);
    grad.addColorStop(0.6, s.color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.85;
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(cx, cy, rad, rad * 0.55, 0, 0, Math.PI * 2);
    g.fill();
  }

  g.globalAlpha = 1;
  shadePoles(g, w, h);
  return toTexture(c);
}

/** Oceans, continents, ice caps. */
export function earthTexture({ seed = 7, w = 1024, h = 512 } = {}) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);

  const ocean = g.createLinearGradient(0, 0, 0, h);
  ocean.addColorStop(0, '#0d2b52');
  ocean.addColorStop(0.5, '#124a86');
  ocean.addColorStop(1, '#0d2b52');
  g.fillStyle = ocean;
  g.fillRect(0, 0, w, h);

  // Landmasses built from overlapping blobs around a handful of seed points.
  const greens = ['#2f6b34', '#3d7a3a', '#5a7a3f', '#7d7245', '#8c6f4c'];
  for (let cluster = 0; cluster < 9; cluster++) {
    const cx = rnd() * w;
    const cy = h * (0.18 + rnd() * 0.64);
    const spread = 60 + rnd() * 150;
    for (let i = 0; i < 70; i++) {
      const x = cx + (rnd() - 0.5) * spread * 2.6;
      const y = cy + (rnd() - 0.5) * spread;
      g.globalAlpha = 0.85;
      g.fillStyle = greens[(rnd() * greens.length) | 0];
      g.beginPath();
      g.ellipse(x, y, 10 + rnd() * 42, 8 + rnd() * 30, rnd() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }

  g.globalAlpha = 1;
  const cap = (top) => {
    const y0 = top ? 0 : h;
    const y1 = top ? h * 0.14 : h * 0.86;
    const grad = g.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, 'rgba(238,246,255,0.95)');
    grad.addColorStop(1, 'rgba(238,246,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, top ? 0 : h * 0.86, w, h * 0.14);
  };
  cap(true);
  cap(false);

  return toTexture(c);
}

/** Transparent cloud shell that sits just above the Earth mesh. */
export function cloudTexture({ seed = 21, w = 1024, h = 512 } = {}) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);

  g.clearRect(0, 0, w, h);
  for (let band = 0; band < 5; band++) {
    const cy = h * (0.1 + band * 0.2 + (rnd() - 0.5) * 0.06);
    for (let i = 0; i < 130; i++) {
      g.globalAlpha = 0.05 + rnd() * 0.22;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.ellipse(rnd() * w, cy + (rnd() - 0.5) * h * 0.16, 20 + rnd() * 90, 6 + rnd() * 18, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  return toTexture(c);
}

/** Turbulent photosphere for the Sun. */
export function sunTexture({ seed = 3, w = 1024, h = 512 } = {}) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);

  g.fillStyle = '#ff9a2e';
  g.fillRect(0, 0, w, h);

  const tones = ['#ffd978', '#ffb14a', '#ff7b1c', '#ffe9b0', '#e8560f'];
  for (let i = 0; i < 1400; i++) {
    g.globalAlpha = 0.06 + rnd() * 0.16;
    g.fillStyle = tones[(rnd() * tones.length) | 0];
    g.beginPath();
    g.ellipse(rnd() * w, rnd() * h, 8 + rnd() * 60, 6 + rnd() * 34, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }

  for (let i = 0; i < 14; i++) {
    g.globalAlpha = 0.3;
    g.fillStyle = '#7a2a00';
    g.beginPath();
    g.ellipse(rnd() * w, h * (0.25 + rnd() * 0.5), 6 + rnd() * 16, 4 + rnd() * 9, 0, 0, Math.PI * 2);
    g.fill();
  }

  g.globalAlpha = 1;
  return toTexture(c);
}

/** Soft radial falloff used as the Sun additive glow sprite. */
export function glowTexture({ color = '255,190,90', size = 512 } = {}) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${color},0.95)`);
  grad.addColorStop(0.18, `rgba(${color},0.45)`);
  grad.addColorStop(0.45, `rgba(${color},0.12)`);
  grad.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return toTexture(c);
}

/** Saturn rings: a 1px-tall strip the ring geometry samples radially. */
export function ringTexture({ seed = 11, w = 1024 } = {}) {
  const c = makeCanvas(w, 1);
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);

  for (let x = 0; x < w; x++) {
    const t = x / w;
    // Cassini division: a hard gap about halfway out.
    const gap = t > 0.46 && t < 0.53 ? 0.05 : 1;
    const band = 0.55 + 0.45 * Math.sin(t * 90 + rnd() * 0.4);
    const edge = t < 0.06 || t > 0.97 ? 0.15 : 0.85;
    const alpha = Math.min(1, gap * band * edge);
    const shade = 190 + Math.floor(rnd() * 50);
    g.fillStyle = `rgba(${shade},${shade - 22},${shade - 60},${alpha})`;
    g.fillRect(x, 0, 1, 1);
  }

  const t = toTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}
