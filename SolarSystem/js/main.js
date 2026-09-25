// Wires everything together: scene, hands, gestures, camera rig, HUD.
import * as THREE from 'three';
import { SolarSystem } from './scene.js';
import { HandTracker } from './hands.js';
import { GestureController } from './gestures.js';

const DAYS_PER_SECOND = 30;
// Far enough that Neptune's orbit (163 units) fits across the screen with
// margin. This is also where two-fist reset lands, so it has to show everything.
const DEFAULT_DISTANCE = 250;
const MIN_DISTANCE = 20;
const MAX_DISTANCE = 700;
const DAMPING = 0.12;

const el = {
  canvas: document.getElementById('scene'),
  labels: document.getElementById('labels'),
  video: document.getElementById('video'),
  overlay: document.getElementById('overlay'),
  cam: document.getElementById('cam'),
  camStatus: document.getElementById('cam-status'),
  badge: document.getElementById('gesture-badge'),
  info: document.getElementById('info'),
  infoName: document.getElementById('info-name'),
  infoRows: document.getElementById('info-rows'),
  infoFact: document.getElementById('info-fact'),
  infoClose: document.getElementById('info-close'),
  clockState: document.getElementById('clock-state'),
  clockSpeed: document.getElementById('clock-speed'),
  toast: document.getElementById('toast'),
  debug: document.getElementById('debug'),
};

const system = new SolarSystem(el.canvas);
const gestures = new GestureController();
const tracker = new HandTracker({
  video: el.video,
  overlay: el.overlay,
  status: el.camStatus,
  container: el.cam,
});

// ---------------------------------------------------------------- camera rig
// Spherical coordinates around a focus point. `target` is what input writes to;
// `current` chases it, which is what makes hand control feel smooth instead of
// twitchy.
const target = { azimuth: 0.7, polar: 1.15, distance: DEFAULT_DISTANCE };
const current = { ...target };
const focusTarget = new THREE.Vector3();
const focus = new THREE.Vector3();

let selected = null;
let paused = false;
let lastTime = performance.now();

function orbitBy(dx, dy) {
  target.azimuth -= dx;
  target.polar = THREE.MathUtils.clamp(target.polar + dy, 0.12, Math.PI - 0.12);
}

function dollyBy(amount) {
  target.distance = THREE.MathUtils.clamp(
    target.distance * (1 + amount * 0.01),
    MIN_DISTANCE,
    MAX_DISTANCE
  );
}

function updateCamera() {
  current.azimuth += (target.azimuth - current.azimuth) * DAMPING;
  current.polar += (target.polar - current.polar) * DAMPING;
  current.distance += (target.distance - current.distance) * DAMPING;
  focus.lerp(focusTarget, DAMPING);

  const sinP = Math.sin(current.polar);
  system.camera.position.set(
    focus.x + current.distance * sinP * Math.sin(current.azimuth),
    focus.y + current.distance * Math.cos(current.polar),
    focus.z + current.distance * sinP * Math.cos(current.azimuth)
  );
  system.camera.lookAt(focus);
}

// -------------------------------------------------------------------- labels
const labelEls = new Map();
for (const body of system.bodies) {
  const div = document.createElement('div');
  div.className = 'label';
  div.textContent = body.data.name;
  el.labels.appendChild(div);
  labelEls.set(body, div);
}

const cursorEl = document.createElement('div');
cursorEl.id = 'cursor';
cursorEl.className = 'hidden';
cursorEl.innerHTML = '<svg viewBox="0 0 44 44"><circle class="track" cx="22" cy="22" r="19"/><circle class="fill" cx="22" cy="22" r="19"/></svg><i></i>';
el.labels.appendChild(cursorEl);
const dwellRing = cursorEl.querySelector('.fill');
const RING_LENGTH = 2 * Math.PI * 19;
dwellRing.style.strokeDasharray = `${RING_LENGTH}`;

const projected = new THREE.Vector3();

function updateLabels() {
  for (const body of system.bodies) {
    const div = labelEls.get(body);
    system.worldPosition(body, projected);
    const worldY = projected.y + body.data.size * 1.5 + 2;
    projected.y = worldY;
    const camDistance = system.camera.position.distanceTo(projected);
    projected.project(system.camera);

    const visible = projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
    if (!visible) {
      div.style.display = 'none';
      continue;
    }

    div.style.display = '';
    div.style.left = `${(projected.x * 0.5 + 0.5) * window.innerWidth}px`;
    div.style.top = `${(-projected.y * 0.5 + 0.5) * window.innerHeight}px`;
    div.classList.toggle('near', camDistance < 160);
    div.classList.toggle('selected', selected === body);
  }
}

// ---------------------------------------------------------------- info panel
function showInfo(body) {
  const d = body.data;
  el.infoName.textContent = d.name;
  el.infoRows.innerHTML = Object.entries(d.facts)
    .map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`)
    .join('');
  el.infoFact.textContent = d.fact;
  el.info.classList.remove('hidden');
}

function select(body) {
  selected = body;
  if (!body) {
    focusTarget.set(0, 0, 0);
    target.distance = DEFAULT_DISTANCE;
    el.info.classList.add('hidden');
    return;
  }
  showInfo(body);
  // Frame the body: close enough to see surface detail, far enough for context.
  target.distance = THREE.MathUtils.clamp(body.data.size * 9, 26, MAX_DISTANCE);
}

/**
 * Back to the wide shot of the whole system. Deliberately leaves the viewing
 * angle alone — spinning the camera back to a default azimuth on top of pulling
 * out is disorienting, and the angle is never what got you lost.
 * Add `target.polar = 1.15; target.azimuth = 0.7;` here for a full reset.
 */
function resetView() {
  select(null);
}

el.infoClose.addEventListener('click', () => select(null));

// ------------------------------------------------------------------- picking
// Screen-space proximity, not a raycast. A raycast asks "did the ray hit the
// sphere", which makes Mercury — 0.5 units across, sitting beside a 10-unit Sun
// — practically unselectable, and hands are nowhere near that precise. This
// instead asks "which body is nearest the cursor on screen", scored relative to
// each body's own apparent size so the Sun does not swallow its neighbours.
const PICK_RADIUS = 55; // px of slack around a body, whatever its size
const pickVec = new THREE.Vector3();

function pickAt(nx, ny) {
  const px = nx * window.innerWidth;
  const py = ny * window.innerHeight;
  // Pixels per world unit at one unit of depth, from the vertical FOV.
  const focal = window.innerHeight / (2 * Math.tan((system.camera.fov * Math.PI) / 360));

  let best = null;
  let bestScore = Infinity;

  for (const body of system.bodies) {
    system.worldPosition(body, pickVec);
    const camDistance = system.camera.position.distanceTo(pickVec);
    pickVec.project(system.camera);
    if (pickVec.z > 1) continue; // behind the camera

    const sx = (pickVec.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-pickVec.y * 0.5 + 0.5) * window.innerHeight;
    const d = Math.hypot(sx - px, sy - py);

    // Reach: the body's own on-screen radius, or the flat slack, whichever is
    // bigger. Normalising by it keeps a big Sun from beating a tiny planet the
    // cursor is sitting directly on top of.
    const apparent = (body.data.size / camDistance) * focal;
    const reach = Math.max(PICK_RADIUS, apparent * 1.15);
    if (d > reach) continue;

    // Tiny depth term, enough to break ties toward whichever is in front.
    const score = d / reach + camDistance * 1e-4;
    if (score < bestScore) {
      bestScore = score;
      best = body;
    }
  }

  return best;
}

// Hands do not comfortably reach the edges of the frame, so stretch the usable
// area outwards from the centre.
function handToScreen(cursor) {
  return {
    x: THREE.MathUtils.clamp((cursor.x - 0.5) * 1.7 + 0.5, 0, 1),
    y: THREE.MathUtils.clamp((cursor.y - 0.5) * 1.7 + 0.5, 0, 1),
  };
}

// ------------------------------------------------------------- mouse fallback
let dragging = false;
let dragMoved = 0;
let lastPointer = { x: 0, y: 0 };

el.canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  dragMoved = 0;
  lastPointer = { x: e.clientX, y: e.clientY };
  el.canvas.setPointerCapture(e.pointerId);
});

el.canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastPointer.x;
  const dy = e.clientY - lastPointer.y;
  dragMoved += Math.abs(dx) + Math.abs(dy);
  lastPointer = { x: e.clientX, y: e.clientY };
  orbitBy(dx * 0.005, dy * 0.005);
});

el.canvas.addEventListener('pointerup', (e) => {
  dragging = false;
  if (dragMoved < 5) {
    const body = pickAt(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
    select(body);
  }
});

el.canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  dollyBy(e.deltaY * 0.06);
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    setPaused(!paused);
  }
  if (e.code === 'Escape') select(null);
  if (e.code === 'KeyD') {
    debugOn = !debugOn;
    el.debug.classList.toggle('hidden', !debugOn);
  }
});

function setPaused(value) {
  paused = value;
  el.clockState.textContent = paused ? '⏸ paused' : '▶ running';
}

// ---------------------------------------------------------------- gesture HUD
const GESTURE_LABEL = {
  FIST: 'orbit',
  POINT: 'select',
  PALM: 'hold to pause',
  TWO_HAND: 'zoom',
  TWO_FIST: 'hold to reset',
};

// Press D to see exactly what the classifier thinks your hand is doing. When a
// gesture "does not work", this says whether it was never recognised or was
// recognised and ignored — which are completely different bugs.
let debugOn = false;

function updateDebug(control) {
  if (!debugOn) return;
  if (!control.hands?.length) {
    el.debug.textContent = 'no hands detected';
    return;
  }
  const flag = (name, on) => `<span class="${on ? 'on' : 'off'}">${on ? name : name.toLowerCase()}</span>`;
  el.debug.innerHTML = control.hands
    .map((h, i) => {
      const f = h.fingers;
      return [
        `hand ${i + 1}   <b>${h.gesture}</b>`,
        `  ${flag('T', f.thumb)} ${flag('I', f.index)} ${flag('M', f.middle)} ${flag('R', f.ring)} ${flag('P', f.pinky)}`,
      ].join('\n');
    })
    .concat([`combined  <b>${control.gesture}</b>`, `on target ${gestures.hasTarget ? 'yes' : 'no'}`])
    .join('\n');
}

function updateBadge(control) {
  const label = GESTURE_LABEL[control.gesture];
  el.badge.classList.toggle('on', Boolean(label));
  if (label) el.badge.textContent = label;
  // Fills the badge left to right while a hold-to-fire gesture charges up.
  el.badge.style.setProperty('--p', `${(control.holdProgress ?? 0) * 100}%`);
}

// --------------------------------------------------------------------- start
async function boot() {
  try {
    await tracker.start();
  } catch (err) {
    console.error(err);
    tracker.fail('camera unavailable');
    showToast(
      err?.name === 'NotAllowedError'
        ? 'Camera permission was denied. Reload and allow it to use hand control — mouse still works: drag to orbit, wheel to zoom, click a planet.'
        : 'Could not start the camera or the hand model. Check you are on <code>http://localhost</code> and online for the first load. Mouse control still works.'
    );
  }
  requestAnimationFrame(loop);
}

function showToast(html) {
  el.toast.innerHTML = `<b>Hand tracking is off</b>${html}`;
  el.toast.classList.remove('hidden');
  setTimeout(() => el.toast.classList.add('hidden'), 9000);
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (tracker.ready) {
    tracker.detect(now);
    tracker.draw();
  }

  const control = gestures.update(tracker.hands, dt);
  updateBadge(control);
  updateDebug(control);

  if (control.orbit.dx || control.orbit.dy) orbitBy(control.orbit.dx, control.orbit.dy);
  if (control.dolly) dollyBy(control.dolly);
  if (control.togglePause) setPaused(!paused);
  if (control.resetView) resetView();

  if (control.cursor) {
    const screen = handToScreen(control.cursor);
    const px = screen.x * window.innerWidth;
    const py = screen.y * window.innerHeight;
    cursorEl.classList.remove('hidden');
    cursorEl.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
    dwellRing.style.strokeDashoffset = `${RING_LENGTH * (1 - (control.dwellProgress ?? 0))}`;

    const hovered = pickAt(screen.x, screen.y);
    cursorEl.classList.toggle('over', Boolean(hovered));
    // Feeds the next frame's dwell: the ring only charges over a real target.
    gestures.setTarget(Boolean(hovered));
    // Never select(null) from a dwell. select(null) resets the whole view, so
    // a countdown finishing over empty space used to throw the camera back to
    // the wide shot — which reads as "selecting is broken", not "you missed".
    if (control.select && hovered) select(hovered);
  } else {
    gestures.setTarget(false);
    cursorEl.classList.add('hidden');
  }

  system.update(paused ? 0 : DAYS_PER_SECOND * dt, dt);

  // Keep the camera locked on a selected body as it travels along its orbit.
  if (selected) system.worldPosition(selected, focusTarget);

  updateCamera();
  updateLabels();
  system.render();

  el.clockSpeed.textContent = `${Math.floor(system.elapsedDays / 365.25)} yr elapsed`;
}

// Debug handle for the console and for automated tests. Cheap, and it turns
// "selecting feels wrong" into something you can actually query:
//   __solar.pickAt(0.5, 0.5)?.data.name
//   __solar.screenPos('Saturn')
window.__solar = {
  system,
  gestures,
  pickAt,
  select,
  target,
  current,
  screenPos(name) {
    const body = system.bodies.find((b) => b.data.name === name);
    if (!body) return null;
    system.worldPosition(body, pickVec);
    const camDistance = system.camera.position.distanceTo(pickVec);
    pickVec.project(system.camera);
    return {
      x: (pickVec.x * 0.5 + 0.5) * window.innerWidth,
      y: (-pickVec.y * 0.5 + 0.5) * window.innerHeight,
      camDistance,
    };
  },
};

setPaused(false);
boot();
