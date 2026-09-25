# Solar System — Hand Controlled

A 3D solar system you steer with your hands through the webcam. Runs entirely
on your machine: no build step, no `npm install`, no framework.

## Run it

Double-click **`start.cmd`**, or from a terminal:

```
node serve.mjs
```

Then open <http://localhost:8080> and allow camera access.

> Opening `index.html` directly from the file system will **not** work — browsers
> only grant camera access on a secure origin, and `http://localhost` is the
> easiest one to get. That is all `serve.mjs` is for.

The first load fetches Three.js, the MediaPipe runtime and the hand model from a
CDN, so you need internet **once**. After that the browser cache covers it.

## Gestures

| Gesture | What it does |
| --- | --- |
| ✊ **Fist** | Grab and drag to orbit the camera |
| 🙌 **Two palms** | Spread apart to zoom in, together to zoom out (the only hand zoom) |
| ✊✊ **Two fists** | Hold ~0.6 s to reset the view — back out to the whole system and deselect |
| ☝️ **Point** | Hover a planet and hold ~0.7 s to select it |
| 🖐️ **Open palm** | Hold ~0.8 s to pause / resume the orbits |

Mouse works too, which is handy while tuning: drag to orbit, wheel to zoom,
click a planet to select, `Space` to pause, `Esc` to deselect, `D` to toggle the
gesture debug readout.

**If a gesture is not firing, press `D`.** It shows, per hand, which fingers the
classifier thinks are extended (bright = extended), the gesture it settled on, and whether a planet is under the cursor. That separates
"never recognised" from "recognised and ignored", which are different bugs.

The preview is mirrored, so moving your hand right moves the scene right.

## Layout

```
index.html        markup + import map (pins every CDN version)
serve.mjs         ~40-line static server, zero dependencies
css/style.css     all HUD styling
js/
  main.js         camera rig, HUD, picking, the frame loop
  scene.js        Three.js scene graph, orbits, rings, bloom
  planets.js      planet data — the only file to edit for content
  textures.js     procedural planet textures, drawn to canvas at load
  hands.js        webcam + MediaPipe detection + skeleton overlay
  gestures.js     landmarks → camera commands
```

## Things that are deliberately not to scale

The real solar system is almost entirely empty space; rendered honestly it is a
black screen with a few invisible specks. So:

- **Sizes** are compressed by `size = 0.9 · r^0.62` (r in Earth radii).
- **Orbits** are compressed by `orbit = 20 + AU^0.55 · 22`.
- **Sunlight** uses `decay = 0`, so Neptune is lit as brightly as Mercury.
- **Axial spin** is not tied to the orbital clock. At a speed where Neptune
  moves at all, real day-lengths would be an unreadable blur.

Orbital periods, eccentricities, inclinations, axial tilts and everything in the
info panel *are* real. Both curves live at the top of `js/planets.js` if you
want to change the compromise.

## Tuning

Feel is mostly in `js/gestures.js`:

| Constant | Effect |
| --- | --- |
| `SMOOTHING` | Higher = more responsive, more jitter |
| `DEAD_ZONE` | Raise if the camera drifts when your hand is still |
| `POINT_DWELL` / `PALM_HOLD` / `RESET_HOLD` | How long to hold before it fires |
| `POINT_SMOOTHING` | Lower = steadier cursor, more lag |
| `DWELL_TOLERANCE` | How far the cursor may drift and keep counting down |

After changing any of them, run the gesture tests:

```
node test/gestures.test.mjs
```

They feed synthetic 21-point hands into `GestureController` and assert what each
pose classifies as, that hold-to-fire gestures fire exactly once, and that the
two-hand poses do not bleed into each other. No browser and no waving required.

Speed and framing are at the top of `js/main.js` (`DAYS_PER_SECOND`,
`DEFAULT_DISTANCE`, `DAMPING`), and `PICK_RADIUS` controls how much slack the
selection has.

### Selecting things

Picking is **screen-space proximity**, not a raycast: it asks which body is
nearest the cursor in pixels, scored against each body's own apparent size.
A raycast reads like the obvious choice and then makes Mercury — half a unit
across, next to a 10-unit Sun — effectively unselectable. Hands are not that
precise, and neither are mice.

The dwell ring only charges while something is actually under the cursor, so a
ring that fills is a promise that letting it finish will do something.

From the browser console, `__solar` exposes the live scene for poking at:

```js
__solar.pickAt(0.5, 0.5)?.data.name   // what is at the centre of the screen
__solar.screenPos('Saturn')           // where Saturn is, in pixels
__solar.select(null)                  // reset the view
```

## If hand tracking does not start

- **Camera permission denied** — reload and allow it. Chrome remembers per-origin.
- **Another app holds the camera** — close Zoom/Teams/OBS and reload.
- **Nothing detected** — the model wants an evenly lit hand. Sit closer, get more
  light on your hand, and keep the whole hand inside the preview.
- **Very low frame rate** — the model falls back from GPU to CPU automatically;
  check the browser console for that warning.

The scene keeps running on mouse control either way.
