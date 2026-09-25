# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A 3D solar system controlled by hand gestures through the webcam. Browser-only,
runs locally, no build step, no npm dependencies. Three.js renders the scene,
MediaPipe `HandLandmarker` reads the hands. Both arrive from a CDN via an import
map in `index.html`.

## Commands

```bash
node serve.mjs             # serve on :8080  (or double-click start.cmd)
node serve.mjs 3000        # different port
node test/gestures.test.mjs   # the whole test suite (~25 checks, no browser)
```

There is no build, lint, or watch step. Edit a file and reload the page.

`package.json` has no dependencies — it exists only so Node treats `js/*.js` as
ES modules when `test/` imports them. Never add a bundler or a dependency
without being asked; "no install step" is a feature of this project.

### A local server is mandatory

`getUserMedia` only works on a secure origin. `file://` is not one, `localhost`
is. Opening `index.html` from disk gives a permanently black webcam panel. That
is the only reason `serve.mjs` exists.

The first page load fetches Three.js, the MediaPipe runtime and a ~7.8 MB hand
model from CDNs, so it needs internet once. Everything else is local and offline.

## Architecture

The data flow is a one-way pipeline, and the module boundaries follow it:

```
webcam frame
  -> hands.js      MediaPipe -> 21 landmarks/hand, + draws the skeleton overlay
  -> gestures.js   landmarks -> a gesture name -> per-frame camera deltas
  -> main.js       deltas -> spherical camera rig, HUD, picking, the frame loop
  -> scene.js      Three.js scene graph, orbits, rings, bloom
```

`scene.js` knows nothing about hands; it exposes a camera and a `bodies` array
that `main.js` drives. `gestures.js` knows nothing about Three.js or the DOM —
it takes landmarks plus `dt` and returns a plain object. That is what makes the
gesture layer testable in Node with no browser (see `test/`).

`planets.js` is pure data and is the only file to touch for content changes.
`textures.js` paints every planet surface into a 2D canvas at load time.

### Two coordinate spaces, and why

MediaPipe returns landmarks in **raw, unmirrored** image space. The video and
the overlay canvas are both CSS-mirrored (`transform: scaleX(-1)`), so:

- **Drawing** the skeleton uses raw coordinates — the CSS mirror lines them up
  for free. No math.
- **Control** mirrors `x -> 1 - x` (`gestures.js`, `mirror()`), so moving your
  hand right moves the scene right.

Mixing these up produces a demo where everything moves backwards. If a control
feels inverted, this is the first place to look.

## Decisions, and the reasoning behind them

These are the non-obvious choices. Most were made because the obvious
alternative was tried and was worse.

### Gesture control

**Deltas, never absolute positions.** Mapping hand position directly to camera
angle feels broken: lower your hand, raise it somewhere else, and the scene
snaps. Every gesture instead works on frame-to-frame deltas and re-anchors on a
gesture change, so the first frame of a gesture produces zero motion. This is
the single most important decision in the project.

**Three stacked layers of smoothing**, because hand tracking jitters by a pixel
or two even when you hold still:

| Layer | Where | Kills |
| --- | --- | --- |
| EMA on the driver point | `gestures.js` `SMOOTHING` | per-frame detection noise |
| Dead zone | `gestures.js` `DEAD_ZONE` | tremor while holding still |
| Camera chases a damped target | `main.js` `updateCamera()` | the rest, and adds weight |

Input never moves the camera directly — it moves `target`, and `current` eases
toward it. Setting `SMOOTHING` to 1 and `DEAD_ZONE` to 0 makes the same code
unusable; that is a quick way to feel why these exist.

**Classification is deliberately forgiving.** An earlier stricter version was
the cause of a "select does not work at all" bug:

- Pointing is `index && !middle`. Requiring the ring and pinky to be curled too
  reads fine and then never fires, because most people cannot fully curl them
  while pointing — and the fall-through was `NONE`, so no cursor appeared.
- The thumb is excluded from the finger count. Plenty of people hold a fist with
  the thumb out, and the thumb is the least reliably detected of the five.
- `PALM` needs three of four fingers, so one misread finger does not break it.
- The thumb is tested against the **pinky knuckle**, not the wrist, because it
  folds sideways across the palm rather than toward the wrist.

**2D distances only.** MediaPipe's `z` is a rough relative depth and is by far
the noisiest component; including it made curled fingers flicker as extended.

**Hold-to-fire for anything destructive.** Two fists reset the view, but one
fist already orbits — an instant trigger would fling the camera back whenever a
second hand drifted into frame. Same for palm-to-pause. Each fires exactly once
per hold and re-arms only after the pose is released; the badge fills left to
right as feedback.

**Pinch was removed on request.** Zoom is therefore two-palms-only from the
hands (the mouse wheel still works). If single-hand zoom is ever wanted back,
vertical drag inside the `FIST` case is the natural home for it.

### Picking

**Screen-space proximity, not a raycast** (`main.js`, `pickAt`). A raycast asks
"did the ray hit the sphere", which makes Mercury — half a unit across, beside a
10-unit Sun — effectively unselectable; hands are nowhere near that precise.
`pickAt` instead scores every body by pixel distance from the cursor, normalised
by that body's own apparent on-screen radius so the Sun cannot swallow its
neighbours, with a tiny depth term to break ties toward whatever is in front.
This replaced a set of invisible hit spheres, which are gone — do not
reintroduce them.

Consequence worth knowing: when two planets overlap on screen you get whichever
is nearer the cursor. That is correct, not a bug.

**The dwell only charges over a real target.** `main.js` calls
`gestures.setTarget()` every frame. A ring that fills is a promise that letting
it finish will do something.

**A dwell must never deselect.** `select(null)` resets the whole view, so a
countdown completing over empty space used to throw the camera back to the wide
shot — which reads as "selecting is broken", not "you missed".

### Scene and scale

The real solar system is almost entirely empty space; rendered honestly it is a
black screen with a few invisible specks. So, all in `planets.js`:

- Sizes: `0.9 * r^0.62` (r in Earth radii).
- Orbits: `20 + AU^0.55 * 22`.
- Sunlight uses `decay = 0`, so Neptune is lit as brightly as Mercury.
- Axial spin is **not** tied to the orbital clock. At a speed where Neptune moves
  at all, real day lengths would be an unreadable blur.

Orbital periods, eccentricities, inclinations, axial tilts and every value in
the info panel are real.

**The Sun's glow sprite must stay smaller than Mercury's orbit.** At `3.4x` the
Sun's radius it looks right; the first version was `7x` and completely erased
all four inner planets.

**`DEFAULT_DISTANCE` has to fit Neptune's orbit (163 units).** At 210 the
half-width was 176 units, so Uranus and Neptune kept falling off screen. 250
gives 209 and real margin. Two-fist reset lands here, so it must show everything.

**Textures are generated, never downloaded.** Seeded canvas painting means no
image assets to lose and an identical result on every run.

## Debugging

Press **`D`** in the page for the classifier readout: per hand, which fingers
read as extended, the gesture chosen, and whether a planet is under the cursor.
This separates "never recognised" from "recognised and ignored", which are
completely different bugs. Reach for this before changing thresholds.

`window.__solar` exposes the live scene:

```js
__solar.pickAt(0.5, 0.5)?.data.name   // what is at the centre of the screen
__solar.screenPos('Saturn')           // where Saturn is, in pixels
__solar.select(null)                  // reset the view
```

### Testing approach

`test/gestures.test.mjs` builds **synthetic 21-point hands in code** and asserts
what each pose classifies as, that hold-to-fire gestures fire exactly once, and
that the two-hand poses do not bleed into each other. No browser, no webcam, no
waving. Run it after touching any threshold in `gestures.js` — the failure mode
these catch is breaking a neighbouring gesture while tuning one.

For anything visual or DOM-level, drive headless Chrome over raw CDP (Node 24
has a global `WebSocket`, so this needs no dependencies): navigate, dispatch real
input events, then read the DOM or call `__solar` through `Runtime.evaluate`.
That is how the picking rewrite was verified — clicking all nine bodies plus a
40 px near miss. Do not add Puppeteer for this.

## Gotchas

- **`detectForVideo` throws if called twice for one frame timestamp.**
  `requestAnimationFrame` runs at 60 fps and the webcam delivers 30, so half the
  calls would be duplicates. `hands.js` guards on `video.currentTime`, which also
  halves the inference cost.
- **`videoWidth` is 0 until metadata arrives.** Sizing the overlay before then
  leaves it wrong for the whole session.
- **The GPU delegate is not always available.** `hands.js` catches and retries on
  CPU, logging a console warning.
- **Files use CRLF line endings.** Scripted search-and-replace against LF text
  fails silently. Normalise, and assert that the match succeeded.
- **The info panel captures mouse clicks** in the top-right. It does not affect
  hand control, which calls `pickAt` directly rather than going through DOM hit
  testing.
- CDN versions in the import map are pinned exactly. Keep them that way.
