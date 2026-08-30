/* ============================================================
   QUINTAL 3D — Physics (Agente 2)
   Colisão Box3 (Minkowski expandida pelo raio do jogador),
   superficiesAndaveis, raycaster descendente p/ o chão e
   sliding em X/Z. Sem pontas soltas: nada atravessa.
   ============================================================ */
import * as THREE from "three";
import { BANDS, PHYS, smoothstep } from "./constants";
import type { SurfaceDef } from "./types";

export interface ColliderDef {
  minX: number; maxX: number; minZ: number; maxZ: number; top: number; bottom: number;
}

export class Physics {
  /* obstáculos sólidos (paredes, muretas, postes...) — Box3 real */
  readonly colliders: { box: THREE.Box3; def: ColliderDef }[] = [];
  /* superficiesAndaveis: lajes, telhados, degraus, patamares */
  readonly surfaces: SurfaceDef[] = [];

  private flatRects: { x0: number; x1: number; z0: number; z1: number }[] = [];
  private flatCircles: { x: number; z: number; r: number }[] = [];

  private terrainProxy: THREE.Mesh | null = null;
  private proxyGroup = new THREE.Group();           // alvos do raycast de plantio
  private groundRay = new THREE.Raycaster();
  private rayOrigin = new THREE.Vector3();
  private readonly rayDown = new THREE.Vector3(0, -1, 0);
  private readonly tmpV = new THREE.Vector3();

  constructor() {
    this.groundRay.far = 220;
  }

  /* ---------------- registro de mundo ---------------- */

  addCollider(def: ColliderDef) {
    this.colliders.push({
      box: new THREE.Box3(
        new THREE.Vector3(def.minX, def.bottom, def.minZ),
        new THREE.Vector3(def.maxX, def.top, def.maxZ),
      ),
      def,
    });
  }
  /** alias nomeado pedido na spec — muretas e obstáculos sólidos */
  registrarObstaculo(def: ColliderDef) { this.addCollider(def); }

  addSurface(s: SurfaceDef) { this.surfaces.push(s); }
  /** alias nomeado da spec */
  get superficiesAndaveis() { return this.surfaces; }

  addFlatRect(x0: number, x1: number, z0: number, z1: number) {
    this.flatRects.push({ x0, x1, z0, z1 });
  }
  addFlatCircle(x: number, z: number, r: number) {
    this.flatCircles.push({ x, z, r });
  }

  /* proxies p/ raycast */
  setTerrainProxy(mesh: THREE.Mesh, name: string) {
    mesh.name = name;
    this.terrainProxy = mesh;
    this.proxyGroup.add(mesh);
  }
  addRaycastTarget(obj: THREE.Object3D) { this.proxyGroup.add(obj); }
  get raycastTargets() { return this.proxyGroup; }

  /* ---------------- terreno orgânico ---------------- */

  private n2(x: number, z: number) {
    return (
      Math.sin(x * 0.16) * Math.cos(z * 0.13) * 0.5 +
      Math.sin(x * 0.41 + 2.2) * Math.sin(z * 0.36 + 1.3) * 0.3 +
      Math.sin(x * 0.9 + 5.1) * Math.cos(z * 0.83 + 3.7) * 0.2
    );
  }
  flattenMask(x: number, z: number) {
    let m = 1;
    for (const r of this.flatRects) {
      const dx = Math.max(r.x0 - x, 0, x - r.x1);
      const dz = Math.max(r.z0 - z, 0, z - r.z1);
      m *= smoothstep(0, 2.2, Math.hypot(dx, dz));
    }
    for (const c of this.flatCircles) {
      m *= smoothstep(c.r * 0.55, c.r + 1.6, Math.hypot(x - c.x, z - c.z));
    }
    return m;
  }
  /** altura do morro: patamares + rampas suaves + ondulação orgânica */
  terrainH(x: number, z: number) {
    let y = 0;
    for (let i = 0; i < BANDS.length; i++) {
      const b = BANDS[i];
      if (z >= b.z0 && z <= b.z1) {
        const yPrev = i > 0 ? BANDS[i - 1].y : 0;
        // rampa suave nos 4,4 m inferiores de cada patamar
        y = z >= b.z1 - 4.4
          ? yPrev + (b.y - yPrev) * smoothstep(b.z1, b.z1 - 4.4, z)
          : b.y;
        break;
      }
    }
    if (z > BANDS[0].z1) y = 0; // fazenda / fundos: plano
    else if (z < BANDS[BANDS.length - 1].z0) y = BANDS[BANDS.length - 1].y; // topo
    y += this.n2(x, z) * 0.3 * this.flattenMask(x, z);
    return y;
  }

  /* ---------------- consultas de chão ---------------- */

  /** raycast descendente contra o proxy do terreno */
  rayGround(x: number, z: number): number {
    if (!this.terrainProxy) return -Infinity;
    this.groundRay.set(this.rayOrigin.set(x, 80, z), this.rayDown);
    const hits = this.groundRay.intersectObject(this.terrainProxy, false);
    return hits.length ? hits[0].point.y : -Infinity;
  }

  sampleGround(x: number, z: number, y: number, tol: number): number {
    let best = -Infinity;
    for (const s of this.surfaces) {
      if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) {
        if (s.top <= y + tol && s.top > best) best = s.top;
      }
    }
    return best;
  }

  /**
   * Chão combinado: terreno (função analítica — a malha É essa função, então o
   * resultado é idêntico ao raycast, mas O(1) por frame p/ jogador + NPCs) +
   * superficiesAndaveis. O Raycaster descendente segue em rayGround/plantRay
   * para as consultas cirúrgicas (plantio, proxies de superfície).
   */
  groundAt(x: number, z: number, y: number, tol: number): number {
    const t = this.terrainH(x, z);
    const best = t <= y + tol ? t : -Infinity;
    return Math.max(best, this.sampleGround(x, z, y, tol));
  }

  /** rampa andável? (paredões do terreno exigem escada) */
  canWalk(x: number, z: number, y: number): boolean {
    const h = this.terrainH(x, z);
    if (h > y + PHYS.MAX_CLIMB) {
      const s = this.sampleGround(x, z, y, 99);
      if (s < y - 0.2) return false;
    }
    return true;
  }

  /* ---------------- colisão horizontal ---------------- */

  /** ponto bloqueado (p/ anti-clip da câmera e sanity checks) */
  pointBlocked(p: THREE.Vector3): boolean {
    if (p.y < this.terrainH(p.x, p.z) + 0.15) return true;
    for (const c of this.colliders) {
      if (c.box.containsPoint(p)) return true;
    }
    return false;
  }

  /**
   * colisão círculo-vs-AABB (Minkowski): caixa expandida pelo raio.
   * Caixas "subíveis" (top <= baseGround + STEP_TOL) são ignoradas —
   * é isso que faz degraus e lajes deslizarem sem travar.
   */
  collides(x: number, z: number, feetY: number, baseGround: number): boolean {
    const r = PHYS.R;
    const cut = baseGround + PHYS.STEP_TOL;
    for (const c of this.colliders) {
      const d = c.def;
      if (d.top <= cut) continue;                    // degrau: sobe junto
      if (feetY + PHYS.H <= d.bottom + 0.02) continue; // passa por cima
      if (x > d.minX - r && x < d.maxX + r && z > d.minZ - r && z < d.maxZ + r) return true;
    }
    return false;
  }

  /** sliding eixo-a-eixo: nunca entra na parede, nunca trava em quina */
  slideMove(x: number, z: number, nx: number, nz: number, feetY: number, baseGround: number) {
    let ox = x, oz = z;
    if (!this.collides(nx, z, feetY, baseGround) && this.canWalk(nx, z, feetY)) ox = nx;
    if (!this.collides(ox, nz, feetY, baseGround) && this.canWalk(ox, nz, feetY)) oz = nz;
    return { x: ox, z: oz };
  }

  /** raycast de plantio: retorna ponto + normal + tipo de terreno */
  plantRay(origin: THREE.Vector3, dir: THREE.Vector3): { point: THREE.Vector3; normal: THREE.Vector3; kind: string } | null {
    this.groundRay.set(origin, dir.clone().normalize());
    this.groundRay.far = 40;
    const hits = this.groundRay.intersectObjects(this.proxyGroup.children, false);
    this.groundRay.far = 220;
    if (!hits.length) return null;
    const h = hits[0];
    const normal = h.face
      ? h.face.normal.clone().transformDirection(h.object.matrixWorld)
      : this.tmpV.set(0, 1, 0).clone();
    return { point: h.point.clone(), normal, kind: h.object.name || "morro" };
  }
}


