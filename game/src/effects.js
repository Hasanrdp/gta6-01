// Velmora Bay — cheap effects. One pooled THREE.Points cloud for impact
// bursts, a ring of fading skid-mark planes, and short-lived tracer
// lines for gunfire. No textures, no extra draw calls per burst.

import * as THREE from 'three';

const MAX_PARTICLES = 600;

/** A reusable particle pool drawn as one Points object. */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.colors = new Float32Array(MAX_PARTICLES * 3);
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.life = new Float32Array(MAX_PARTICLES);
    this.maxLife = new Float32Array(MAX_PARTICLES);
    this.cursor = 0;
    this.alive = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.55,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    // Skid marks: a pool of dark planes laid flat on the asphalt.
    this.skids = [];
    const skidGeo = new THREE.PlaneGeometry(0.5, 1.4);
    const skidMat = new THREE.MeshBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.55, depthWrite: false });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(skidGeo, skidMat.clone());
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      this.skids.push({ mesh: m, life: 0 });
    }
    this.skidCursor = 0;

    // Muzzle flash: one small light, fired for a few frames.
    this.flash = new THREE.PointLight(0xffc266, 0, 18, 1.6);
    scene.add(this.flash);
    this.flashTimer = 0;

    // Tracers: a pool of thin stretched boxes.
    this.tracers = [];
    const tracerGeo = new THREE.BoxGeometry(0.07, 0.07, 1);
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 });
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(tracerGeo, tracerMat.clone());
      m.visible = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
    this.tracerCursor = 0;
  }

  /** A burst of coloured sparks at a point. */
  burst(x, y, z, colorHex, count) {
    const r = ((colorHex >> 16) & 255) / 255;
    const g = ((colorHex >> 8) & 255) / 255;
    const b = (colorHex & 255) / 255;
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      this.positions[i * 3] = x;
      this.positions[i * 3 + 1] = y;
      this.positions[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 4 + 1;
      const sp = Math.random() * 5 + 2;
      this.vel[i * 3] = Math.cos(a) * sp;
      this.vel[i * 3 + 1] = up;
      this.vel[i * 3 + 2] = Math.sin(a) * sp;
      this.colors[i * 3] = r;
      this.colors[i * 3 + 1] = g;
      this.colors[i * 3 + 2] = b;
      this.life[i] = this.maxLife[i] = 0.5 + Math.random() * 0.5;
    }
    this.alive = MAX_PARTICLES;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  /** Lay a fading skid mark under a rear wheel. */
  skid(x, z, heading) {
    const s = this.skids[this.skidCursor];
    this.skidCursor = (this.skidCursor + 1) % this.skids.length;
    s.mesh.position.set(x, 0.06, z);
    s.mesh.rotation.z = -heading;
    s.mesh.material.opacity = 0.55;
    s.mesh.visible = true;
    s.life = 4;
  }

  /** A bright flash at the muzzle of the pistol. */
  muzzle(pos, dir) {
    this.flash.position.copy(pos).add(dir.clone().multiplyScalar(0.6));
    this.flash.intensity = 26;
    this.flashTimer = 0.06;
  }

  /** A fast tracer line along a shot. */
  tracer(start, dir, length) {
    const t = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % this.tracers.length;
    const mid = start.clone().add(dir.clone().multiplyScalar(length / 2));
    t.mesh.position.copy(mid);
    t.mesh.lookAt(start.clone().add(dir.clone().multiplyScalar(length)));
    t.mesh.scale.set(1, 1, length);
    t.mesh.material.opacity = 0.9;
    t.mesh.visible = true;
    t.life = 0.09;
  }

  update(dt) {
    // Particles: gravity pulls them down, life fades them out of view.
    let anyAlive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      anyAlive = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.positions[i * 3 + 1] = -100; // park dead particles underground
        continue;
      }
      this.vel[i * 3 + 1] -= 9.8 * dt;
      this.positions[i * 3] += this.vel[i * 3] * dt;
      this.positions[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.positions[i * 3 + 1] < 0.05) {
        this.positions[i * 3 + 1] = 0.05;
        this.vel[i * 3 + 1] *= -0.3;
      }
    }
    if (anyAlive) this.points.geometry.attributes.position.needsUpdate = true;

    for (const s of this.skids) {
      if (!s.mesh.visible) continue;
      s.life -= dt;
      if (s.life <= 0) s.mesh.visible = false;
      else s.mesh.material.opacity = 0.55 * (s.life / 4);
    }
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
      else t.mesh.material.opacity = t.life / 0.09;
    }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.flash.intensity = 0;
    }
  }
}
