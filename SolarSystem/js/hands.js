// Webcam capture + MediaPipe hand landmark detection + the skeleton overlay.
// Landmarks come back in raw image space (NOT mirrored). The video element and
// this canvas are both CSS-mirrored, so drawing raw coordinates lines up on
// screen; gestures.js mirrors x itself for control purposes.
import { FilesetResolver, HandLandmarker } from 'tasks-vision';

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// MediaPipe's 21-point hand topology.
export const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],           // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],           // index
  [5, 9], [9, 10], [10, 11], [11, 12],      // middle
  [9, 13], [13, 14], [14, 15], [15, 16],    // ring
  [13, 17], [17, 18], [18, 19], [19, 20],   // pinky
  [0, 17],                                  // palm base
];

const TIPS = new Set([4, 8, 12, 16, 20]);
const HAND_COLORS = ['#6fd3ff', '#ffb46f'];

export class HandTracker {
  constructor({ video, overlay, status, container }) {
    this.video = video;
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.status = status;
    this.container = container;

    this.landmarker = null;
    this.hands = [];
    this.ready = false;
    this.lastVideoTime = -1;
  }

  async start() {
    this.status.textContent = 'requesting camera…';
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });

    this.video.srcObject = stream;
    // videoWidth is still 0 until metadata arrives, and the overlay would then
    // be sized wrong for the whole session.
    if (!this.video.videoWidth) {
      await new Promise((resolve) => this.video.addEventListener('loadedmetadata', resolve, { once: true }));
    }
    await this.video.play();

    // Match the overlay's backing store to the actual frame size.
    this.overlay.width = this.video.videoWidth || 640;
    this.overlay.height = this.video.videoHeight || 480;

    this.status.textContent = 'loading hand model…';
    const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);

    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    });

    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
    } catch (err) {
      // Some drivers and VMs cannot give WebGL to the inference graph.
      console.warn('GPU delegate unavailable, falling back to CPU', err);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
    }

    this.ready = true;
    this.status.classList.add('hidden');
  }

  /** Run detection for the current video frame. Returns an array of hands. */
  detect(nowMs) {
    if (!this.ready || this.video.readyState < 2) return this.hands;

    // detectForVideo throws if called twice for the same frame timestamp.
    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      const result = this.landmarker.detectForVideo(this.video, nowMs);
      this.hands = (result.landmarks ?? []).map((landmarks, i) => ({
        landmarks,
        handedness: result.handednesses?.[i]?.[0]?.categoryName ?? 'Unknown',
      }));
    }

    this.container.classList.toggle('tracking', this.hands.length > 0);
    return this.hands;
  }

  /** Draw the skeleton over the webcam preview. */
  draw() {
    const { ctx, overlay } = this;
    const w = overlay.width;
    const h = overlay.height;
    ctx.clearRect(0, 0, w, h);

    this.hands.forEach((hand, hi) => {
      const color = HAND_COLORS[hi % HAND_COLORS.length];
      const pts = hand.landmarks.map((p) => [p.x * w, p.y * h]);

      // Soft under-glow so the skeleton stays readable over a bright room.
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 9;
      this._strokeSkeleton(pts);

      ctx.globalAlpha = 1;
      ctx.lineWidth = 2.5;
      this._strokeSkeleton(pts);

      // Joints: fingertips get a bigger, brighter dot.
      for (let i = 0; i < pts.length; i++) {
        const isTip = TIPS.has(i);
        ctx.beginPath();
        ctx.arc(pts[i][0], pts[i][1], isTip ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = isTip ? '#ffffff' : color;
        ctx.fill();
        if (isTip) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    });

    ctx.globalAlpha = 1;
  }

  _strokeSkeleton(pts) {
    this.ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      this.ctx.moveTo(pts[a][0], pts[a][1]);
      this.ctx.lineTo(pts[b][0], pts[b][1]);
    }
    this.ctx.stroke();
  }

  fail(message) {
    this.status.classList.remove('hidden');
    this.status.textContent = message;
    this.container.classList.remove('tracking');
  }
}
