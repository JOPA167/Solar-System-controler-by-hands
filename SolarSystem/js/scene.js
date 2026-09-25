// Builds and drives the 3D solar system. Knows nothing about hands — it just
// exposes a camera rig that main.js pushes values into.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { SUN, PLANETS, INCLINATION } from './planets.js';
import {
  rockyTexture,
  gasTexture,
  earthTexture,
  cloudTexture,
  sunTexture,
  glowTexture,
  ringTexture,
} from './textures.js';

const DEG = Math.PI / 180;

// Radius on an ellipse of semi-major axis `a` and eccentricity `e`, at true
// anomaly `theta`. Keeps the orbits from being perfect circles.
function ellipseRadius(a, e, theta) {
  return (a * (1 - e * e)) / (1 + e * Math.cos(theta));
}

function buildTexture(spec) {
  switch (spec.kind) {
    case 'rocky':
      return rockyTexture(spec);
    case 'gas':
      return gasTexture(spec);
    case 'earth':
      return earthTexture();
    default:
      return null;
  }
}

export class SolarSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.bodies = [];
    this.elapsedDays = 0;

    this._initRenderer();
    this._initScene();
    this._buildStars();
    this._buildSun();
    this._buildPlanets();
    this._initComposer();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);

    // Sunlight. decay 0 keeps the outer planets as visible as the inner ones,
    // which is a deliberate lie in favour of being able to see Neptune at all.
    const sunLight = new THREE.PointLight(0xfff0d8, 2.6, 0, 0);
    this.scene.add(sunLight);
    this.scene.add(new THREE.AmbientLight(0x4a5a80, 0.28));
  }

  _buildStars() {
    const count = 7000;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      // Uniform points on a shell so the sky has no visible clumping.
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const r = 900 + Math.random() * 900;
      const s = Math.sqrt(1 - u * u);
      positions[i * 3] = r * s * Math.cos(phi);
      positions[i * 3 + 1] = r * u;
      positions[i * 3 + 2] = r * s * Math.sin(phi);

      // Cool blue-white through warm orange, mostly dim.
      color.setHSL(0.55 + Math.random() * 0.12 - 0.06, 0.45 * Math.random(), 0.55 + Math.random() * 0.45);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.stars = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 1.6, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.9 })
    );
    this.scene.add(this.stars);
  }

  _buildSun() {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(SUN.size, 64, 48),
      new THREE.MeshBasicMaterial({ map: sunTexture() })
    );
    mesh.userData.body = SUN;
    this.scene.add(mesh);

    // Additive shell + billboard glow: cheap, and reads as light rather than paint.
    const corona = new THREE.Mesh(
      new THREE.SphereGeometry(SUN.size * 1.14, 48, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffa94d,
        transparent: true,
        opacity: 0.16,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.scene.add(corona);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.6,
      })
    );
    // Deliberately kept smaller than Mercury's orbit — a bigger halo looks
    // great on its own and completely erases the four inner planets.
    glow.scale.setScalar(SUN.size * 3.4);
    this.scene.add(glow);

    this.sunMesh = mesh;
    this.bodies.push({ data: SUN, mesh, anchor: mesh, isSun: true });
  }

  _buildPlanets() {
    for (const p of PLANETS) {
      // Inclination tilts the whole orbital plane, including the orbit line.
      const plane = new THREE.Group();
      plane.rotation.x = (INCLINATION[p.name] ?? 0) * DEG;
      this.scene.add(plane);

      plane.add(this._orbitLine(p));

      // pivot carries the planet along its orbit; axis carries the spin+tilt.
      const pivot = new THREE.Group();
      plane.add(pivot);

      const axis = new THREE.Group();
      axis.rotation.z = p.tilt * DEG;
      pivot.add(axis);

      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(p.size, 48, 32),
        new THREE.MeshStandardMaterial({
          map: buildTexture(p.texture),
          roughness: p.texture.kind === 'gas' ? 0.95 : 0.85,
          metalness: 0.02,
        })
      );
      mesh.userData.body = p;
      axis.add(mesh);

      let clouds = null;
      if (p.texture.kind === 'earth') {
        clouds = new THREE.Mesh(
          new THREE.SphereGeometry(p.size * 1.015, 48, 32),
          new THREE.MeshStandardMaterial({
            map: cloudTexture(),
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
            roughness: 1,
          })
        );
        axis.add(clouds);
      }

      if (p.ring) this._addRing(p, p.ring.tiltWithPlanet ? axis : pivot, p.ring);

      const moons = (p.moons ?? []).map((m) => {
        const moonPivot = new THREE.Group();
        pivot.add(moonPivot);
        const moonMesh = new THREE.Mesh(
          new THREE.SphereGeometry(m.size, 24, 16),
          new THREE.MeshStandardMaterial({
            map: rockyTexture({ base: '#9a948c', shades: ['#7a736c', '#b5aea6'], craters: 120, seed: m.seed }),
            roughness: 0.95,
          })
        );
        moonMesh.position.x = m.orbit;
        moonPivot.add(moonMesh);
        return { data: m, pivot: moonPivot, angle: Math.random() * Math.PI * 2 };
      });

      this.bodies.push({
        data: p,
        mesh,
        clouds,
        pivot,
        anchor: pivot,
        moons,
        // Random start angles so the planets are not all lined up at t=0.
        angle: Math.random() * Math.PI * 2,
      });
    }
  }

  _orbitLine(p) {
    const points = [];
    const segments = 256;
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2;
      const r = ellipseRadius(p.orbit, p.eccentricity, t);
      points.push(new THREE.Vector3(Math.cos(t) * r, 0, Math.sin(t) * r));
    }
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x5f7ba8, transparent: true, opacity: 0.2 })
    );
  }

  _addRing(p, parent, spec) {
    const inner = p.size * spec.inner;
    const outer = p.size * spec.outer;
    const geo = new THREE.RingGeometry(inner, outer, 160, 1);

    // RingGeometry's default UVs are unusable for a radial strip, so remap u to
    // "how far out am I between inner and outer".
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const t = (v.length() - inner) / (outer - inner);
      uv.setXY(i, t, 0.5);
    }

    const ring = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        map: ringTexture(),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: spec.opacity ?? 0.9,
        depthWrite: false,
      })
    );
    ring.rotation.x = Math.PI / 2;
    if (!spec.tiltWithPlanet) ring.rotation.y = p.tilt * DEG;
    parent.add(ring);
  }

  _initComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Modest bloom — enough to make the Sun feel hot, not enough to wash out labels.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.65, 0.42);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  /** Advance the simulation by `days` of simulated time. */
  update(days, dt) {
    this.elapsedDays += days;

    for (const body of this.bodies) {
      if (body.isSun) {
        body.mesh.rotation.y += SUN.spin * dt;
        continue;
      }

      const p = body.data;
      body.angle += (days / p.periodDays) * Math.PI * 2;

      const r = ellipseRadius(p.orbit, p.eccentricity, body.angle);
      body.pivot.position.set(Math.cos(body.angle) * r, 0, Math.sin(body.angle) * r);

      // Axial spin is deliberately NOT tied to the orbital clock: at a speed
      // where Neptune moves at all, real day-lengths would be a blur.
      const spin = (24 / p.rotationHours) * 0.35;
      body.mesh.rotation.y += spin * dt;
      if (body.clouds) body.clouds.rotation.y += spin * 1.12 * dt;

      for (const moon of body.moons) {
        moon.angle += (days / moon.data.periodDays) * Math.PI * 2;
        moon.pivot.rotation.y = moon.angle;
      }
    }

    this.stars.rotation.y += dt * 0.0008;
  }

  render() {
    this.composer.render();
  }

  /** World-space position of a body, for HTML label placement and camera focus. */
  worldPosition(body, out = new THREE.Vector3()) {
    return body.anchor.getWorldPosition(out);
  }
}
