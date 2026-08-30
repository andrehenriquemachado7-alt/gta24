/* ============================================================
   QUINTAL 3D — DebugRig
   Wireframes VERMELHOS de todas as caixas de colisão,
   superficiesAndaveis e a AABB do jogador (2 draw calls).
   ============================================================ */
import * as THREE from "three";
import type { Physics } from "./physics";
import type { Player } from "./player";

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
    for (const [a, b] of e) {
      arr.push(...c[a], ...c[b]);
    }
  }

  private build() {
    const colArr: number[] = [];
    for (const c of this.physics.colliders) {
      const d = c.def;
      this.pushBoxEdges(colArr, d.minX, d.bottom, d.minZ, d.maxX, d.top, d.maxZ);
    }
    const colGeo = new THREE.BufferGeometry();
    colGeo.setAttribute("position", new THREE.Float32BufferAttribute(colArr, 3));
    this.group.add(new THREE.LineSegments(colGeo, new THREE.LineBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.9 })));

    const surArr: number[] = [];
    for (const s of this.physics.surfaces) {
      this.pushBoxEdges(surArr, s.minX, s.top - 0.04, s.minZ, s.maxX, s.top + 0.02, s.maxZ);
    }
    const surGeo = new THREE.BufferGeometry();
    surGeo.setAttribute("position", new THREE.Float32BufferAttribute(surArr, 3));
    this.group.add(new THREE.LineSegments(surGeo, new THREE.LineBasicMaterial({ color: 0xff7a1f, transparent: true, opacity: 0.9 })));

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Array(72).fill(0), 3));
    this.playerLines = new THREE.LineSegments(pGeo, new THREE.LineBasicMaterial({ color: 0xff3050 }));
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
    (this.playerLines.geometry.getAttribute("position") as THREE.BufferAttribute).set(arr);
    (this.playerLines.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }
}
