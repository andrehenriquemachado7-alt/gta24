/* ============================================================
   QUINTAL 3D — DebugRig (FASE 4)
   Wireframes de TODOS os colliders, cores por tipo:
     casa #ff2020 · mureta #ff3fd0 · cerca #ff9a1f ·
     objeto #ffe23f · caixa d'água #3fd9ff · estrutura #ff7a1f
   + superficiesAndaveis (laranja) + AABB do jogador.
   Teclas: C ou F3 · botão DBG no HUD. Desligado por padrão.
   ============================================================ */
import * as THREE from "three";
import type { Physics, ColliderType } from "./physics";
import type { Player } from "./player";

const TYPE_COLORS: Record<string, number> = {
  house: 0xff2020,
  wall: 0xff3fd0,
  fence: 0xff9a1f,
  prop: 0xffe23f,
  tank: 0x3fd9ff,
  structure: 0xff7a1f,
  default: 0xff2020,
};

export class DebugRig {
  readonly group = new THREE.Group();
  private built = false;
  private playerLines: THREE.LineSegments | null = null;
  private playerBox = new THREE.Box3();

  constructor(private scene: THREE.Scene, private physics: Physics, private player: Player) {}

  mount() {
    this.group.visible = false;
    this.scene.add(this.group);
  }

  private pushBoxEdges(arr: number[], minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) {
    const c: [number, number, number][] = [
      [minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ],
      [minX, maxY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ], [minX, maxY, maxZ],
    ];
    const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [a, b] of e) arr.push(...c[a], ...c[b]);
  }

  private build() {
    // colliders agrupados por tipo (1 draw call por cor)
    const byType = new Map<string, number[]>();
    for (const c of this.physics.colliders) {
      const key = (c.def.type as ColliderType) ?? "default";
      if (!byType.has(key)) byType.set(key, []);
      const d = c.def;
      this.pushBoxEdges(byType.get(key)!, d.minX, d.bottom, d.minZ, d.maxX, d.top, d.maxZ);
    }
    for (const [key, arr] of byType) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      this.group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({
        color: TYPE_COLORS[key] ?? TYPE_COLORS.default, transparent: true, opacity: 0.9,
      })));
    }

    // superficiesAndaveis (lajes, degraus, patamares)
    const surArr: number[] = [];
    for (const s of this.physics.surfaces) {
      this.pushBoxEdges(surArr, s.minX, s.top - 0.04, s.minZ, s.maxX, s.top + 0.02, s.maxZ);
    }
    const surGeo = new THREE.BufferGeometry();
    surGeo.setAttribute("position", new THREE.Float32BufferAttribute(surArr, 3));
    this.group.add(new THREE.LineSegments(surGeo, new THREE.LineBasicMaterial({ color: 0xffa63f, transparent: true, opacity: 0.95 })));

    // AABB do jogador (atualizada por frame)
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Array(72).fill(0), 3));
    this.playerLines = new THREE.LineSegments(pGeo, new THREE.LineBasicMaterial({ color: 0x7dff5a }));
    this.group.add(this.playerLines);

    this.built = true;
  }

  toggle(): boolean {
    if (!this.built) this.build();
    this.group.visible = !this.group.visible;
    return this.group.visible;
  }
  get visible() { return this.group.visible; }

  update() {
    if (!this.playerLines || !this.group.visible) return;
    this.player.getBox3(this.playerBox);
    const arr: number[] = [];
    this.pushBoxEdges(
      arr,
      this.playerBox.min.x, this.playerBox.min.y, this.playerBox.min.z,
      this.playerBox.max.x, this.playerBox.max.y, this.playerBox.max.z
    );
    const attr = this.playerLines.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.set(arr);
    attr.needsUpdate = true;
  }
}
