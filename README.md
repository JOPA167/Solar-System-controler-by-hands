# 🪐 Solar System — Hand Controlled

A 3D solar system you steer with your **hands**, through the webcam. Runs
entirely in the browser, on your own machine: no build step, no `npm install`,
no framework — just Three.js for rendering and MediaPipe for hand tracking,
both loaded from a CDN.

![status](https://img.shields.io/badge/build-none-informational)
![deps](https://img.shields.io/badge/npm%20install-not%20needed-success)
![runtime](https://img.shields.io/badge/runtime-browser-blue)

---

## ✨ Features

- Fully 3D solar system (Sun + 8 planets, rings, moons, starfield, bloom).
- Real-time hand tracking via webcam — no gloves, no controllers.
- Five gestures to orbit, zoom, select a planet, pause time, and reset the view.
- Mouse/keyboard fallback always available.
- Realistic orbital periods, eccentricities, axial tilts, and per-planet facts
  in the info panel.
- Procedurally generated planet textures (no image assets to download or lose).
- Zero dependencies, zero build step — edit a file, reload the page.

---

## 🚀 Getting Started

### Requirements

- **Node.js** (only to run the tiny local server — no packages are installed).
- A webcam (optional — the app works fully with mouse/keyboard too).
- An internet connection **on first load** (to fetch Three.js, MediaPipe, and
  the hand-tracking model from a CDN — after that, the browser cache covers it).

### Run it

```bash
node serve.mjs
```

or just double-click **`start.cmd`** (Windows).

Then open **http://localhost:8080** and allow camera access when prompted.

> ⚠️ **Do not open `index.html` directly from disk.** Browsers only grant
> camera access on a secure origin, and `http://localhost` is the simplest one
> to get. That's the entire reason `serve.mjs` exists.

Run on a different port:

```bash
node serve.mjs 3000
```

---

## 🖐️ Gestures

| Gesture | What it does |
|---|---|
| ✊ **Fist** | Grab and drag to orbit the camera |
| 🙌 **Two open palms** | Spread apart to zoom in, bring together to zoom out |
| ✊✊ **Two fists** | Hold ~0.6 s to reset the view (zoom out, deselect) |
| ☝️ **Point** | Hover a planet and hold ~0.7 s to select it |
| 🖐️ **Open palm** | Hold ~0.8 s to pause / resume the orbits |

**Mouse & keyboard fallback** (always available, handy while tuning):

| Input | Action |
|---|---|
| Drag | Orbit the camera |
| Scroll wheel | Zoom |
| Click a planet | Select it |
| `Space` | Pause / resume |
| `Esc` | Deselect |
| `D` | Toggle the gesture debug readout |

The webcam preview is mirrored, so moving your hand right moves the scene
right — it matches what you see in the corner panel.

### If a gesture isn't firing

Press **`D`**. It shows, per hand, which fingers the classifier thinks are
extended (bright = extended), the gesture it settled on, and whether a planet
is currently under the cursor. This tells "never recognized" apart from
"recognized but ignored" — two very different bugs.

---

## 📁 Project Layout

```
index.html        Markup + import map (pins every CDN version)
serve.mjs          ~40-line static server, zero dependencies
start.cmd           Double-click launcher for Windows
css/
  style.css         All HUD styling
js/
  main.js           Camera rig, HUD, picking, the frame loop
  scene.js          Three.js scene graph — orbits, rings, bloom
  planets.js        Planet data — the only file to edit for content changes
  textures.js       Procedural planet textures, painted to canvas at load time
  hands.js          Webcam capture + MediaPipe hand detection + skeleton overlay
  gestures.js       Landmarks → camera commands (gesture classification)
test/
  gestures.test.mjs  ~25 checks for the gesture layer, no browser needed
```

---

## 🧠 How It Works

The data flow is a one-way pipeline, and the module boundaries follow it:

```
webcam frame
  → hands.js      MediaPipe → 21 landmarks per hand, draws the skeleton overlay
  → gestures.js   landmarks → gesture name → per-frame camera deltas
  → main.js       deltas → spherical camera rig, HUD, picking, the frame loop
  → scene.js      Three.js scene graph, orbits, rings, bloom
```

- `scene.js` knows nothing about hands — it just exposes a camera and a
  `bodies` array that `main.js` drives.
- `gestures.js` knows nothing about Three.js or the DOM — it takes landmarks
  plus `dt` and returns a plain object, which is what makes it testable in
  Node with no browser at all.
- `planets.js` is pure data — the only file you need to touch for content
  changes (adding a planet, tweaking facts, etc.).
- `textures.js` paints every planet surface into a 2D canvas at load time —
  no image files are shipped or downloaded.

### Selection: screen-space proximity, not a raycast

Picking asks "which body is nearest the cursor in pixels?", scored relative to
each body's own apparent on-screen size. A raycast ("did the ray hit the
sphere?") makes Mercury — half a unit across, beside a 10-unit Sun —
effectively unselectable; hands (and even mice) aren't that precise.

The dwell ring only charges while something real is under the cursor, so a
ring that fills is a promise that letting it finish will actually do
something.

### Debug handle

From the browser console, `window.__solar` exposes the live scene:

```js
__solar.pickAt(0.5, 0.5)?.data.name   // what is at the centre of the screen
__solar.screenPos('Saturn')           // where Saturn is, in pixels
__solar.select(null)                  // reset the view
```

---

## 🎨 Scale & Realism

The real solar system is almost entirely empty space — rendered honestly, it's
a black screen with a few invisible specks. So, deliberately:

| Aspect | Compromise |
|---|---|
| **Sizes** | `size = 0.9 · r^0.62` (r in Earth radii) |
| **Orbits** | `orbit = 20 + AU^0.55 · 22` |
| **Sunlight** | `decay = 0` — Neptune is lit as brightly as Mercury |
| **Axial spin** | Not tied to the orbital clock (real day-lengths would be an unreadable blur at a speed where Neptune visibly moves) |

Everything else — **orbital periods, eccentricities, inclinations, axial
tilts, and every fact in the info panel — is real.** Both compression curves
live at the top of `js/planets.js` if you want to change the trade-off.

---

## 🛠️ Tuning

Feel is mostly controlled in `js/gestures.js`:

| Constant | Effect |
|---|---|
| `SMOOTHING` | Higher = more responsive, more jitter |
| `DEAD_ZONE` | Raise if the camera drifts while your hand is still |
| `POINT_DWELL` / `PALM_HOLD` / `RESET_HOLD` | How long to hold a gesture before it fires |
| `POINT_SMOOTHING` | Lower = steadier cursor, more lag |
| `DWELL_TOLERANCE` | How far the cursor may drift and still keep counting down |

Speed and framing live at the top of `js/main.js`:

| Constant | Effect |
|---|---|
| `DAYS_PER_SECOND` | Simulation speed |
| `DEFAULT_DISTANCE` | Camera distance on load / after reset |
| `DAMPING` | How quickly the camera eases toward its target |
| `PICK_RADIUS` | Extra slack (in px) around a body for selection |

After changing any gesture constant, run the test suite:

```bash
node test/gestures.test.mjs
```

---

## ✅ Testing

`test/gestures.test.mjs` builds **synthetic 21-point hands in code** and
asserts:

- what each hand pose classifies as,
- that hold-to-fire gestures (pause, reset) fire exactly once per hold,
- that two-hand poses don't bleed into single-hand ones.

No browser, no webcam, no waving required — run it after touching any
threshold in `gestures.js`, since the main failure mode it catches is breaking
a neighboring gesture while tuning another one.

```bash
node test/gestures.test.mjs
```

---

## 🩺 Troubleshooting

| Problem | Fix |
|---|---|
| Camera permission denied | Reload and allow it — Chrome remembers this per-origin |
| Webcam panel stays black | Make sure you're on `http://localhost`, not `file://` |
| Another app is using the camera | Close Zoom/Teams/OBS/etc. and reload |
| Hand never detected | Get even lighting on your hand, sit closer, keep the whole hand inside the preview |
| Low frame rate | The model falls back from GPU to CPU automatically — check the console for the warning |

The scene always keeps running on mouse control, even if hand tracking never
starts.

---

## 📦 Tech Stack

- [Three.js](https://threejs.org/) `0.169.0` — rendering, scene graph, post-processing (bloom)
- [MediaPipe Tasks Vision](https://developers.google.com/mediapipe) `0.10.14` — hand landmark detection
- Vanilla JS (ES modules), Canvas 2D for procedural textures
- A ~40-line Node.js static file server — no framework, no bundler

Both third-party libraries are loaded via an **import map** in `index.html`
with **pinned versions** — keep them pinned when updating.

---

## 📄 License

Add your preferred license here (e.g. MIT) — none is currently specified.
