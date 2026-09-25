// Feeds synthetic 21-point hands into GestureController and asserts the
// classification and the new two-fist reset behaviour.
import { GestureController } from '../js/gestures.js';

const P = (x, y) => ({ x, y, z: 0 });

/**
 * Build a hand centred at `cx`. Wrist at the bottom, fingers pointing up.
 * Each finger is either extended (tip far from wrist) or curled (tip near it).
 */
function hand({ cx = 0.5, thumb = false, index = false, middle = false, ring = false, pinky = false } = {}) {
  const lm = new Array(21);
  lm[0] = P(cx, 0.90);                       // wrist
  lm[9] = P(cx, 0.70);                       // middle MCP -> hand scale = 0.20
  lm[17] = P(cx + 0.10, 0.72);               // pinky MCP

  // Thumb: folds sideways, judged against the pinky knuckle.
  lm[1] = P(cx - 0.08, 0.85);
  lm[2] = P(cx - 0.10, 0.80);
  lm[3] = thumb ? P(cx - 0.15, 0.75) : P(cx - 0.02, 0.76);
  lm[4] = thumb ? P(cx - 0.20, 0.72) : P(cx, 0.74);

  const finger = (mcpI, pipI, dipI, tipI, x, out) => {
    lm[mcpI] = P(x, 0.70);
    lm[pipI] = P(x, 0.62);
    lm[dipI] = out ? P(x, 0.57) : P(x, 0.68);
    lm[tipI] = out ? P(x, 0.52) : P(x, 0.72);
  };
  finger(5, 6, 7, 8, cx - 0.06, index);
  finger(9, 10, 11, 12, cx, middle);
  finger(13, 14, 15, 16, cx + 0.05, ring);
  finger(17, 18, 19, 20, cx + 0.10, pinky);

  // finger() overwrote 9 and 17 with the extended/curled MCP row; that is fine,
  // both sit at the same place as the anchors set above.
  return { landmarks: lm, handedness: 'Right' };
}

const FIST = (cx) => hand({ cx });
const PALM = (cx) => hand({ cx, thumb: true, index: true, middle: true, ring: true, pinky: true });
const POINT = (cx) => hand({ cx, index: true });

let failures = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`}`);
}

const STEP = 1 / 30; // one frame at 30fps

// --- single-hand classification ------------------------------------------
{
  const g = new GestureController();
  g.update([FIST(0.5)], STEP);
  check('one fist -> FIST', g.update([FIST(0.5)], STEP).gesture, 'FIST');
}
{
  const g = new GestureController();
  g.update([PALM(0.5)], STEP);
  check('one open hand -> PALM', g.update([PALM(0.5)], STEP).gesture, 'PALM');
}
{
  const g = new GestureController();
  g.update([POINT(0.5)], STEP);
  check('index only -> POINT', g.update([POINT(0.5)], STEP).gesture, 'POINT');
}

// --- two fists reset -------------------------------------------------------
{
  const g = new GestureController();
  const frames = [];
  for (let i = 0; i < 40; i++) frames.push(g.update([FIST(0.35), FIST(0.65)], STEP));

  const fired = frames.filter((f) => f.resetView).length;
  const firstAt = frames.findIndex((f) => f.resetView);

  check('two fists report TWO_FIST', frames[5].gesture, 'TWO_FIST');
  check('two fists fire reset exactly once', fired, 1);
  check('reset waits ~0.6s (>=17 frames @30fps)', firstAt >= 17 && firstAt <= 19, true);
  check('two fists never zoom', frames.every((f) => f.dolly === 0), true);
  check('two fists never orbit', frames.every((f) => !f.orbit.dx && !f.orbit.dy), true);
  check('hold progress reaches 1', frames[30].holdProgress, 1);

  // Holding forever must not re-fire...
  for (let i = 0; i < 60; i++) g.update([FIST(0.35), FIST(0.65)], STEP);
  // ...but letting go and re-forming must arm it again.
  for (let i = 0; i < 5; i++) g.update([], STEP);
  const second = [];
  for (let i = 0; i < 40; i++) second.push(g.update([FIST(0.35), FIST(0.65)], STEP));
  check('re-forming two fists fires again', second.filter((f) => f.resetView).length, 1);
}

// --- two palms still zoom --------------------------------------------------
{
  const g = new GestureController();
  g.update([PALM(0.35), PALM(0.65)], STEP);
  check('two palms report TWO_HAND', g.update([PALM(0.35), PALM(0.65)], STEP).gesture, 'TWO_HAND');

  const spreading = g.update([PALM(0.25), PALM(0.75)], STEP);
  check('spreading palms zooms in (negative dolly)', spreading.dolly < 0, true);

  const closing = g.update([PALM(0.40), PALM(0.60)], STEP);
  check('closing palms zooms out (positive dolly)', closing.dolly > 0, true);
  check('two palms never fire reset', spreading.resetView || closing.resetView, false);
}

// --- one fist must still orbit --------------------------------------------
{
  const g = new GestureController();
  g.update([FIST(0.5)], STEP);
  g.update([FIST(0.5)], STEP);
  const moved = g.update([FIST(0.62)], STEP);
  check('single fist still orbits', Math.abs(moved.orbit.dx) > 0, true);
  check('single fist does not reset', moved.resetView, false);
}

// --- classification must be forgiving -------------------------------------
// These are the poses real hands actually make, not the textbook ones.
{
  const g = new GestureController();
  const sloppyPoint = hand({ index: true, pinky: true }); // pinky will not curl
  g.update([sloppyPoint], STEP);
  check('point with pinky out is still POINT', g.update([sloppyPoint], STEP).gesture, 'POINT');
}
{
  const g = new GestureController();
  const thumbOut = hand({ thumb: true }); // fist with the thumb alongside
  g.update([thumbOut], STEP);
  check('fist with thumb out is still FIST', g.update([thumbOut], STEP).gesture, 'FIST');
}
{
  const g = new GestureController();
  const sloppyPalm = hand({ thumb: true, index: true, middle: true, ring: true });
  g.update([sloppyPalm], STEP);
  check('open hand with one finger misread is still PALM', g.update([sloppyPalm], STEP).gesture, 'PALM');
}

// --- dwell only counts down over a real target -----------------------------
{
  const g = new GestureController();
  const frames = [];
  for (let i = 0; i < 40; i++) {
    g.setTarget(false);
    frames.push(g.update([POINT(0.5)], STEP));
  }
  check('dwell never fires over empty space', frames.some((f) => f.select), false);
  check('dwell ring stays empty off target', frames[30].dwellProgress, 0);
}
{
  const g = new GestureController();
  const frames = [];
  for (let i = 0; i < 40; i++) {
    g.setTarget(true);
    frames.push(g.update([POINT(0.5)], STEP));
  }
  check('dwell fires exactly once on target', frames.filter((f) => f.select).length, 1);
  check('dwell ring fills on target', frames[30].dwellProgress, 1);
}

// --- pinch was removed ----------------------------------------------------
// A thumb resting against the index finger used to be its own gesture. It must
// now fall through to whatever the fingers say, with no special case left.
{
  const g = new GestureController();
  const touching = POINT(0.5);
  // Move the thumb tip on top of the index tip.
  touching.landmarks = touching.landmarks.map((p, idx) => (idx === 4 ? { x: 0.44, y: 0.53, z: 0 } : p));
  g.update([touching], STEP);
  const got = g.update([touching], STEP);
  check('thumb touching index is just a POINT now', got.gesture, 'POINT');
  check('a touching thumb produces no zoom', got.dolly, 0);
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
