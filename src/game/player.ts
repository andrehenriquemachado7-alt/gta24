/* ============================================================
   QUINTAL 3D — Player (Agente 2 + Agente 3)
   Personagem em cápsulas, gravidade real (vel.y), estado noChao,
   coyote-time + jump-buffer (pulo instantâneo) e sliding X/Z.
   ============================================================ */
import * as THREE from "three";
import { PHYS } from "./constants";
import type { Physics } from "./physics";

export class Player {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3(-4, 0, 42);
  readonly vel = new THREE.Vector3();
  grounded = true;
  yaw = 0;

  private coyote = 0;
  private jumpBuf = 0;
  private moveX = 0;
  private moveZ = 0;
  private step = 0;
  private prevGrounded = true;
  private box = new THREE.Box3();

  private legL!: THREE.Mesh; private legR!: THREE.Mesh;
  private armL!: THREE.Mesh; private armR!: THREE.Mesh;
  private body!: THREE.Mesh;

  onLand: (() => void) | null = null;

  constructor(scene: THREE.Scene) {
    this.build();
    scene.add(this.group);
  }

  private build() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xc98a5b, roughness: 0.85 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x3f8f6a, roughness: 0.9 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x33415e, roughness: 0.95 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });

    const mkLimb = (r: number, len: number, mat: THREE.Material, px: number, py: number, isLeg: boolean) => {
      const g = new THREE.CapsuleGeometry(r, len, 4, 10);
      g.translate(0, -(len / 2) - r * 0.4, 0); // pivô na junta
      const m = new THREE.Mesh(g, mat);
      m.position.set(px, py, 0);
      m.castShadow = true;
      this.group.add(m);
      if (isLeg) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(r * 1.25, 8, 6), shoe);
        s.position.y = -(len + r * 0.9);
        s.scale.set(1, 0.6, 1.4);
        s.castShadow = true;
        m.add(s);
      }
      return m;
    };

    this.legL = mkLimb(0.085, 0.5, pants, -0.11, 0.92, true);
    this.legR = mkLimb(0.085, 0.5, pants, 0.11, 0.92, true);
    // quadril + tronco inteiriços
    const hip = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.1, 4, 10), pants);
    hip.position.y = 1.0; hip.castShadow = true; this.group.add(hip);
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.42, 4, 12), shirt);
    this.body.position.y = 1.32; this.body.castShadow = true; this.group.add(this.body);
    this.armL = mkLimb(0.06, 0.42, skin, -0.27, 1.52, false);
    this.armR = mkLimb(0.06, 0.42, skin, 0.27, 1.52, false);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), skin);
    neck.position.y = 1.66; this.group.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10), skin);
    head.position.y = 1.82; head.castShadow = true; this.group.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 1 }));
    hair.position.y = 1.84; this.group.add(hair);

    this.group.position.copy(this.pos);
  }

  setMove(x: number, z: number) { this.moveX = x; this.moveZ = z; }

  /** pulo instantâneo (Agente 3): buffer de 0,14 s + coyote de 0,12 s */
  pressJump() { this.jumpBuf = PHYS.JUMP_BUFFER; }

  reset() {
    this.pos.set(-4, 0, 42);
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.coyote = 0;
    this.jumpBuf = 0;
  }

  /** AABB p/ debug e sanidade */
  getBox3(out: THREE.Box3) {
    out.min.set(this.pos.x - PHYS.R, this.pos.y, this.pos.z - PHYS.R);
    out.max.set(this.pos.x + PHYS.R, this.pos.y + PHYS.H, this.pos.z + PHYS.R);
    return out;
  }

  update(dt: number, physics: Physics, camYaw: number) {
    /* ---------- entrada relativa à câmera ---------- */
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
    let wx = fx * this.moveZ + rx * this.moveX;
    let wz = fz * this.moveZ + rz * this.moveX;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }

    const baseGround = physics.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.3);

    /* ---------- horizontal: aceleração + sliding (Box3) ---------- */
    const targetVX = wx * PHYS.SPEED, targetVZ = wz * PHYS.SPEED;
    const accel = this.grounded ? 14 : 5;
    this.vel.x += (targetVX - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (targetVZ - this.vel.z) * Math.min(1, accel * dt);

    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    const slid = physics.slideMove(this.pos.x, this.pos.z, nx, nz, this.pos.y, baseGround);
    if (slid.x === this.pos.x && this.vel.x !== 0 && nx !== this.pos.x) this.vel.x = 0;
    if (slid.z === this.pos.z && this.vel.z !== 0 && nz !== this.pos.z) this.vel.z = 0;
    this.pos.x = slid.x;
    this.pos.z = slid.z;

    /* ---------- vertical: gravidade + jump-buffer + coyote ---------- */
    this.coyote = this.grounded ? PHYS.COYOTE : Math.max(0, this.coyote - dt);
    this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    if (this.jumpBuf > 0 && this.coyote > 0) {
      this.vel.y = PHYS.JUMP;
      this.jumpBuf = 0;
      this.coyote = 0;
      this.grounded = false;
    }
    this.vel.y -= PHYS.GRAV * dt;
    this.pos.y += this.vel.y * dt;

    /* ---------- chão: raycast descendente + superficiesAndaveis ---------- */
    const g = physics.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.35);
    this.prevGrounded = this.grounded;
    if (this.pos.y <= g) {
      this.pos.y = g;
      if (this.vel.y < -6 && !this.prevGrounded && this.onLand) this.onLand();
      this.vel.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    /* ---------- sanidade anti-queda (nunca sai do mundo) ---------- */
    this.pos.x = Math.max(-58, Math.min(58, this.pos.x));
    this.pos.z = Math.max(-58, Math.min(74, this.pos.z));
    if (this.pos.y < -8) { this.pos.y = 0; this.vel.y = 0; }

    /* ---------- visual ---------- */
    this.group.position.copy(this.pos);
    const moving = wl > 0.08 && this.grounded;
    if (moving) {
      this.step += wl * PHYS.SPEED * dt * 1.6;
      const targetYaw = Math.atan2(wx, wz);
      let dy = targetYaw - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += dy * Math.min(1, 12 * dt);
    }
    this.group.rotation.y = this.yaw;
    const sw = moving ? Math.sin(this.step * 6) * 0.62 : 0;
    const airTuck = !this.grounded ? 0.35 : 0;
    this.legL.rotation.x = sw - airTuck;
    this.legR.rotation.x = -sw + (this.grounded ? 0 : 0.5);
    this.armL.rotation.x = -sw * 0.75;
    this.armR.rotation.x = sw * 0.75;
    this.body.rotation.z = moving ? Math.sin(this.step * 12) * 0.03 : 0;
  }
}
