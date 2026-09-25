// Turns raw hand landmarks into camera commands.
//
// Everything here works on *deltas* rather than absolute positions: a gesture
// grabs the scene where your hand currently is, so re-entering the frame never
// snaps the camera. x is mirrored on the way in, so moving your hand right
// moves things right on screen.

const PALM_POINTS = [0, 5, 9, 13, 17];

// Landmark indices, for readability below.
const WRIST = 0;
const THUMB_MCP = 2;
const THUMB_TIP = 4;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

const DEAD_ZONE = 0.0015;     // ignore sub-pixel tremor
const SMOOTHING = 0.4;        // EMA factor on hand position
const POINT_SMOOTHING = 0.22; // heavier: the pointing cursor is amplified on screen
const PALM_HOLD = 0.8;        // seconds to hold an open palm to pause
const RESET_HOLD = 0.6;       // seconds to hold two fists to reset the view
const POINT_DWELL = 0.7;      // seconds to hold a point to select
const DWELL_TOLERANCE = 0.09; // how far the cursor may drift and keep dwelling

const dist2d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Mirror x so the preview and the controls agree with the user's body. */
function mirror(landmarks) {
  return landmarks.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
}

function palmCenter(lm) {
  let x = 0;
  let y = 0;
  for (const i of PALM_POINTS) {
    x += lm[i].x;
    y += lm[i].y;
  }
  return { x: x / PALM_POINTS.length, y: y / PALM_POINTS.length };
}

/**
 * Classify one hand. Hand size (wrist to middle knuckle) normalises every
 * measurement, so the gestures work whether you are close to the camera or far.
 */
function classify(lm) {
  // 2D only. MediaPipe's z is a rough relative depth and is by far the noisiest
  // component; including it made curled fingers flicker as extended.
  const scale = Math.max(1e-4, dist2d(lm[WRIST], lm[MIDDLE_MCP]));

  // A finger is extended when its tip is further from the wrist than its
  // middle joint. Crude, but stable across hand orientations.
  const extended = (tip, pip) => dist2d(lm[tip], lm[WRIST]) > dist2d(lm[pip], lm[WRIST]) * 1.08;
  const index = extended(INDEX_TIP, INDEX_PIP);
  const middle = extended(MIDDLE_TIP, MIDDLE_PIP);
  const ring = extended(RING_TIP, RING_PIP);
  const pinky = extended(PINKY_TIP, PINKY_PIP);
  // The thumb folds sideways, so compare it against the pinky knuckle instead.
  const thumb = dist2d(lm[THUMB_TIP], lm[PINKY_MCP]) > dist2d(lm[THUMB_MCP], lm[PINKY_MCP]) * 1.12;

  // The thumb is excluded from the count on purpose: plenty of people hold a
  // fist with the thumb out, and its detection is the least reliable of the five.
  const fingers = [index, middle, ring, pinky].filter(Boolean).length;

  let gesture = 'NONE';
  // Pointing is judged on index-up / middle-down alone. Requiring the ring and
  // pinky to be curled too is the kind of rule that reads fine and then never
  // fires, because most people cannot fully curl them while pointing.
  if (index && !middle) gesture = 'POINT';
  else if (fingers === 0) gesture = 'FIST';
  // Three of four, so a single misread finger does not break an open palm.
  else if (fingers >= 3) gesture = 'PALM';

  return {
    gesture,
    fingers: { thumb, index, middle, ring, pinky },
    scale,
    palm: palmCenter(lm),
    indexTip: { x: lm[INDEX_TIP].x, y: lm[INDEX_TIP].y },
  };
}

export class GestureController {
  constructor() {
    this.smoothed = null;     // EMA of the driving point for the active gesture
    this.prev = null;         // previous frame's smoothed point
    this.activeGesture = 'NONE';
    this.twoHandAnchor = null;

    this.palmHeld = 0;
    this.palmFired = false;

    this.resetHeld = 0;
    this.resetFired = false;

    this.dwell = 0;
    this.dwellOrigin = null;
    this.dwellFired = false;

    // Set from main.js each frame: is a planet currently under the cursor?
    this.hasTarget = false;
  }

  /**
   * Tell the controller whether the pointing cursor is over something
   * selectable. The dwell only charges when it is, so the ring filling up is a
   * promise that letting it finish will actually do something.
   */
  setTarget(hasTarget) {
    this.hasTarget = hasTarget;
  }

  reset() {
    this.smoothed = null;
    this.prev = null;
    this.twoHandAnchor = null;
    this.palmHeld = 0;
    this.palmFired = false;
    this.dwell = 0;
    this.dwellOrigin = null;
    this.dwellFired = false;
    this._clearReset();
  }

  // Arming the reset again requires actually letting go of the two-fist pose,
  // so holding it does not fire over and over.
  _clearReset() {
    this.resetHeld = 0;
    this.resetFired = false;
  }

  /**
   * @param {Array} rawHands hands from HandTracker (raw, unmirrored landmarks)
   * @param {number} dt seconds since last frame
   */
  update(rawHands, dt) {
    const out = {
      gesture: 'NONE',
      orbit: { dx: 0, dy: 0 },
      dolly: 0,
      cursor: null,
      select: false,
      togglePause: false,
      resetView: false,
      handCount: rawHands.length,
    };

    if (rawHands.length === 0) {
      this.activeGesture = 'NONE';
      this.reset();
      return out;
    }

    const hands = rawHands.map((h) => classify(mirror(h.landmarks)));

    // Exposed for the on-screen debug panel (press D). Set before every return
    // below, so the panel stays live in two-handed modes too.
    out.hands = hands.map((h) => ({ gesture: h.gesture, fingers: h.fingers }));

    const bothAre = (name) => hands.length === 2 && hands.every((h) => h.gesture === name);

    // --- two fists: reset the view ------------------------------------------
    // Held rather than instant: one fist already orbits, so a second hand
    // drifting into frame must not fling the camera back on its own.
    if (bothAre('FIST')) {
      if (this.activeGesture !== 'TWO_FIST') {
        this.activeGesture = 'TWO_FIST';
        this.resetHeld = 0;
        this.resetFired = false;
        this.prev = null;
      }
      this.resetHeld += dt;
      if (this.resetHeld >= RESET_HOLD && !this.resetFired) {
        this.resetFired = true;
        out.resetView = true;
      }
      out.gesture = 'TWO_FIST';
      out.holdProgress = Math.min(1, this.resetHeld / RESET_HOLD);
      return out;
    }

    this._clearReset();

    // --- two open palms: zoom ------------------------------------------------
    // Palms only. Fists are spoken for above, and requiring a deliberate shape
    // stops a stray hand from hijacking the single-hand controls.
    if (bothAre('PALM')) {
      const span = dist2d(hands[0].palm, hands[1].palm);
      if (this.activeGesture !== 'TWO_HAND') {
        this.activeGesture = 'TWO_HAND';
        this.twoHandAnchor = span;
        this.palmHeld = 0;
      }
      // Spreading the hands apart pulls the camera in.
      out.dolly = -(span - this.twoHandAnchor) * 250;
      this.twoHandAnchor = span;
      out.gesture = 'TWO_HAND';
      this.prev = null;
      return out;
    }

    // --- single hand ---------------------------------------------------------
    const hand = hands[0];
    const g = hand.gesture;
    out.gesture = g;

    // The point each gesture drags by.
    const driver = g === 'POINT' ? hand.indexTip : hand.palm;

    // Re-anchor on a gesture change, or whenever we have no history to diff
    // against (first frame, or coming back from the two-handed branch).
    if (g !== this.activeGesture || !this.smoothed || !this.prev) {
      this.activeGesture = g;
      this.smoothed = { ...driver };
      this.prev = { ...driver };
      if (g !== 'PALM') {
        this.palmHeld = 0;
        this.palmFired = false;
      }
      if (g !== 'POINT') {
        this.dwell = 0;
        this.dwellOrigin = null;
        this.dwellFired = false;
      }
    } else {
      // Pointing is smoothed harder: the cursor is amplified 1.7x on its way to
      // the screen, so it amplifies tremor by the same factor.
      const alpha = g === 'POINT' ? POINT_SMOOTHING : SMOOTHING;
      this.smoothed.x += (driver.x - this.smoothed.x) * alpha;
      this.smoothed.y += (driver.y - this.smoothed.y) * alpha;
    }

    let dx = this.smoothed.x - this.prev.x;
    let dy = this.smoothed.y - this.prev.y;
    if (Math.abs(dx) < DEAD_ZONE) dx = 0;
    if (Math.abs(dy) < DEAD_ZONE) dy = 0;
    this.prev = { ...this.smoothed };

    switch (g) {
      case 'FIST':
        // Grab and drag the sky.
        out.orbit.dx = dx * 5.0;
        out.orbit.dy = dy * 4.0;
        break;

      case 'POINT': {
        out.cursor = { x: this.smoothed.x, y: this.smoothed.y };
        if (!this.dwellOrigin) this.dwellOrigin = { ...this.smoothed };

        if (!this.hasTarget) {
          // Nothing under the cursor, so there is nothing to count down to.
          // Charging over empty space just trains people to distrust the ring.
          this.dwell = 0;
          this.dwellFired = false;
          this.dwellOrigin = { ...this.smoothed };
        } else if (dist2d(this.smoothed, this.dwellOrigin) > DWELL_TOLERANCE) {
          // Moved on to a different target: restart the countdown.
          this.dwellOrigin = { ...this.smoothed };
          this.dwell = 0;
          this.dwellFired = false;
        } else {
          this.dwell += dt;
          if (this.dwell >= POINT_DWELL && !this.dwellFired) {
            this.dwellFired = true;
            out.select = true;
          }
        }
        out.dwellProgress = Math.min(1, this.dwell / POINT_DWELL);
        break;
      }

      case 'PALM':
        this.palmHeld += dt;
        if (this.palmHeld >= PALM_HOLD && !this.palmFired) {
          this.palmFired = true;
          out.togglePause = true;
        }
        out.holdProgress = Math.min(1, this.palmHeld / PALM_HOLD);
        break;

      default:
        break;
    }

    return out;
  }
}
