/* ============================================================
   QUINTAL 3D — Economy (Agente 5)
   Dinheiro, inventário, lojas (Feira legal x Receptador ilegal),
   plantio com detecção de terreno e crescimento em 3 estágios
   com transição fluida (pop de escala + brilho).
   ============================================================ */
import * as THREE from "three";
import { PRICES, GROW_SECONDS, HARVEST_YIELD, ZONES, SPOTS } from "../core/constants";
import type { Physics } from "./physics";
import type { Inv, ShopId, StatsInfo, GroundKind, PromptInfo } from "../core/types";

interface Plant {
  group: THREE.Group;
  stage: number;          // 0 broto, 1 vegetativa, 2 flora, 3 colhível
  timer: number;
  popT: number;           // animação de transição de fase
  ground: GroundKind;
  spot: number;
  glow: THREE.Sprite;
}

export interface EconomyHooks {
  sfx: { buy(): void; sell(): void; plant(): void; harvest(): void; stageUp(): void; error(): void; win(): void; ui(): void };
  burst: (p: THREE.Vector3, color: number, n: number) => void;
  toast: (text: string) => void;
  float: (text: string) => void;
  glowTex: THREE.Texture;
  onWin: () => void;
}

const KIND_LABEL: Record<GroundKind, string> = {
  asfalto: "ASFALTO", fazenda: "TERRA DA FAZENDA", laje: "CONCRETO DA LAJE", morro: "TERRA DO MORRO",
};

export class Economy {
  money = PRICES.start;
  inv: Inv = { vasos: 0, terra: 0, sementes: 0, pacotes: 0 };
  stats = { plantadas: 0, harvested: 0, sold: 0 };
  shop: ShopId | null = null;
  private plants: Plant[] = [];
  private won = false;

  constructor(private scene: THREE.Scene, private physics: Physics, private hooks: EconomyHooks) {}

  get growing() { return this.plants.filter((p) => p.stage < 3).length; }
  get ready() { return this.plants.filter((p) => p.stage >= 3).length; }

  reset() {
    for (const p of this.plants) { this.scene.remove(p.group); this.scene.remove(p.glow); }
    this.plants = [];
    this.money = PRICES.start;
    this.inv = { vasos: 0, terra: 0, sementes: 0, pacotes: 0 };
    this.stats = { plantadas: 0, harvested: 0, sold: 0 };
    this.shop = null;
    this.won = false;
  }

  /* ---------------- zonas / prompts ---------------- */
  zoneAt(x: number, z: number) {
    return ZONES.find((zn) => Math.hypot(x - zn.x, z - zn.z) < zn.r) ?? null;
  }
  spotAt(x: number, z: number) {
    return SPOTS.findIndex((s) => Math.hypot(x - s.x, z - s.z) < 2.4);
  }
  harvestableAt(x: number, z: number) {
    return this.plants.find((p) => p.stage >= 3 && Math.hypot(p.group.position.x - x, p.group.position.z - z) < 1.6) ?? null;
  }

  getPrompt(x: number, z: number): PromptInfo | null {
    const zone = this.zoneAt(x, z);
    if (zone) {
      return zone.kind === "mercado"
        ? { text: "Feira do Zé — comprar vasos e terra (E)", actionable: true }
        : { text: "Esconderijo — sementes raras / vender pacotes (E)", actionable: true };
    }
    const h = this.harvestableAt(x, z);
    if (h) return { text: `Colher ${HARVEST_YIELD} pacotes na flora (E)`, actionable: true };
    const spot = this.spotAt(x, z);
    if (spot >= 0) {
      const ready = this.inv.vasos > 0 && this.inv.terra > 0 && this.inv.sementes > 0;
      return {
        text: ready
          ? "Mocó seguro — plantar vaso (E)"
          : `Mocó — falta: ${this.inv.vasos ? "" : "vaso "}${this.inv.terra ? "" : "terra "}${this.inv.sementes ? "" : "semente"}`,
        actionable: ready,
      };
    }
    return null;
  }

  /* ---------------- interação (tecla E / botão) ---------------- */
  tryInteract(playerPos: THREE.Vector3, ray: { origin: THREE.Vector3; dir: THREE.Vector3 }) {
    const zone = this.zoneAt(playerPos.x, playerPos.z);
    if (zone) { this.openShop(zone.kind); return; }
    const h = this.harvestableAt(playerPos.x, playerPos.z);
    if (h) { this.harvest(h); return; }
    if (this.spotAt(playerPos.x, playerPos.z) >= 0) { this.tryPlant(playerPos, ray); return; }
    this.hooks.toast("Nada pra fazer aqui — procure os pontos verdes");
  }

  /* ---------------- lojas ---------------- */
  openShop(id: ShopId) {
    this.shop = id;
    this.hooks.sfx.ui();
  }

  closeShop() { this.shop = null; }

  buy(itemId: string) {
    const price = itemId === "vaso" ? PRICES.vaso : itemId === "terra" ? PRICES.terra : PRICES.semente;
    if (this.money < price) { this.hooks.sfx.error(); this.hooks.toast("Grana curta, parceiro"); return; }
    this.money -= price;
    if (itemId === "vaso") this.inv.vasos++;
    else if (itemId === "terra") this.inv.terra++;
    else this.inv.sementes++;
    this.hooks.sfx.buy();
    this.hooks.float(`-${price}`);
  }

  sellAll() {
    if (!this.inv.pacotes) return;
    const total = this.inv.pacotes * PRICES.venda;
    this.money += total;
    this.stats.sold += this.inv.pacotes;
    this.inv.pacotes = 0;
    this.hooks.sfx.sell();
    this.hooks.float(`+R$ ${total}`);
    this.hooks.toast(`Vendido! +R$ ${total}`);
    this.checkWin();
  }

  private checkWin() {
    if (!this.won && this.money >= PRICES.meta) {
      this.won = true;
      this.hooks.sfx.win();
      this.hooks.onWin();
    }
  }

  /* ---------------- plantio com raycaster + normal ---------------- */
  private tryPlant(playerPos: THREE.Vector3, ray: { origin: THREE.Vector3; dir: THREE.Vector3 }) {
    if (this.inv.vasos < 1 || this.inv.terra < 1 || this.inv.sementes < 1) {
      this.hooks.sfx.error();
      this.hooks.toast("Falta insumo: vaso + terra + semente");
      return;
    }
    const hit = this.physics.plantRay(ray.origin, ray.dir);
    const spot = this.spotAt(playerPos.x, playerPos.z);
    if (!hit || (spot >= 0 && Math.hypot(hit.point.x - SPOTS[spot].x, hit.point.z - SPOTS[spot].z) > 4.2)) {
      this.hooks.sfx.error();
      this.hooks.toast("Mira no chão do mocó (anel verde)");
      return;
    }
    const kind = (hit.kind === "laje" || hit.kind === "asfalto" || hit.kind === "fazenda" ? hit.kind : "morro") as GroundKind;
    this.inv.vasos--; this.inv.terra--; this.inv.sementes--;
    this.stats.plantadas++;
    const group = new THREE.Group();
    group.position.copy(hit.point);
    // alinha o vaso à normal da face — reto em qualquer superfície
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hit.normal.clone().normalize());
    this.buildPot(group);
    this.buildStage(group, 0);
    this.scene.add(group);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.hooks.glowTex, color: 0x7ef29a, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
    }));
    glow.position.copy(hit.point).add(new THREE.Vector3(0, 0.6, 0));
    glow.scale.setScalar(1.6);
    this.scene.add(glow);
    this.plants.push({ group, stage: 0, timer: 0, popT: 1, ground: kind, spot, glow });
    this.hooks.sfx.plant();
    this.hooks.burst(hit.point.clone().add(new THREE.Vector3(0, 0.3, 0)), 0x8a6a4e, 14);
    this.hooks.toast(`Plantado na ${KIND_LABEL[kind]} — mocado!`);
  }
  private lastPlayerX = 0;
  private lastPlayerZ = 0;
  trackPlayer(x: number, z: number) { this.lastPlayerX = x; this.lastPlayerZ = z; }

  private buildPot(g: THREE.Group) {
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.24, 0.42, 12),
      new THREE.MeshStandardMaterial({ color: 0xb5623a, roughness: 0.9 })
    );
    pot.position.y = 0.21;
    pot.castShadow = true;
    g.add(pot);
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.37, 0.35, 0.09, 12),
      new THREE.MeshStandardMaterial({ color: 0xc9744a, roughness: 0.9 })
    );
    rim.position.y = 0.42;
    g.add(rim);
    const soil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 0.05, 12),
      new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 })
    );
    soil.position.y = 0.43;
    g.add(soil);
  }

  /* estágios 100% procedurais e estilizados (low-poly) */
  private buildStage(g: THREE.Group, stage: number) {
    for (let i = g.children.length - 1; i >= 0; i--) {
      const ch = g.children[i];
      if ((ch as THREE.Mesh).isMesh && ch.userData.plantPart) g.remove(ch);
    }
    const add = (m: THREE.Object3D) => { m.userData.plantPart = true; g.add(m); };
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4d9a3f, roughness: 1, side: THREE.DoubleSide });
    const darkLeaf = new THREE.MeshStandardMaterial({ color: 0x3a7a30, roughness: 1, side: THREE.DoubleSide });
    if (stage === 0) {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.28, 5), leafMat);
      stem.position.y = 0.58; add(stem);
      for (const s of [-1, 1]) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 4), darkLeaf);
        leaf.position.set(s * 0.06, 0.7, 0);
        leaf.rotation.z = s * 0.9;
        add(leaf);
      }
    } else if (stage === 1) {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.62, 6), darkLeaf);
      stem.position.y = 0.75; add(stem);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 4), i % 2 ? leafMat : darkLeaf);
        leaf.position.set(Math.cos(a) * 0.14, 0.85 + (i % 3) * 0.12, Math.sin(a) * 0.14);
        leaf.rotation.z = Math.cos(a) * 1.1;
        leaf.rotation.x = -Math.sin(a) * 1.1;
        add(leaf);
      }
    } else {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.8, 6), darkLeaf);
      stem.position.y = 0.84; add(stem);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.5, 4), i % 2 ? leafMat : darkLeaf);
        leaf.position.set(Math.cos(a) * 0.2, 0.95 + (i % 3) * 0.16, Math.sin(a) * 0.2);
        leaf.rotation.z = Math.cos(a) * 1.15;
        leaf.rotation.x = -Math.sin(a) * 1.15;
        add(leaf);
      }
      if (stage >= 2) {
        const budMat = new THREE.MeshStandardMaterial({ color: 0x9adf5a, emissive: 0x5aa032, emissiveIntensity: 0.5, roughness: 0.6 });
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const bud = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), budMat);
          bud.position.set(Math.cos(a) * 0.18, 1.15 + (i % 3) * 0.14, Math.sin(a) * 0.18);
          add(bud);
        }
        const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), budMat);
        top.position.y = 1.5; add(top);
      }
    }
  }

  private harvest(p: Plant) {
    this.inv.pacotes += HARVEST_YIELD;
    this.stats.harvested += HARVEST_YIELD;
    this.hooks.float(`+${HARVEST_YIELD} pacotes`);
    this.hooks.sfx.harvest();
    this.hooks.burst(p.group.position.clone().add(new THREE.Vector3(0, 0.8, 0)), 0x7ef29a, 22);
    this.hooks.toast(`Colhido! +${HARVEST_YIELD} pacotes — leva pro Receptador`);
    this.scene.remove(p.glow);
    this.scene.remove(p.group);
    this.plants = this.plants.filter((q) => q !== p);
  }

  /* ---------------- crescimento + transição fluida ---------------- */
  update(dt: number, t: number) {
    for (const p of this.plants) {
      if (p.stage < 3) {
        p.timer += dt;
        if (p.timer >= GROW_SECONDS[p.stage]) {
          p.timer = 0;
          p.stage++;
          p.popT = 1;
          if (p.stage < 3) this.buildStage(p.group, p.stage);
          else {
            this.buildStage(p.group, 2);
            this.hooks.sfx.stageUp();
            this.hooks.toast("Flora pronta! Colhe no mocó (E)");
          }
          this.hooks.burst(p.group.position.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xf4d35e, 10);
          if (p.stage < 3) this.hooks.sfx.stageUp();
        }
      }
      // pop de escala + brilho na troca de fase
      if (p.popT > 0) {
        p.popT = Math.max(0, p.popT - dt * 2.4);
        const s = 1 + Math.sin(p.popT * Math.PI) * 0.22;
        p.group.scale.setScalar(s);
        (p.glow.material as THREE.SpriteMaterial).opacity = p.popT * 0.9;
      } else {
        p.group.scale.setScalar(1);
      }
      // sway leve no vento
      p.group.rotation.z = Math.sin(t * 1.6 + p.group.position.x) * 0.03;
      if (p.stage >= 3) {
        const m = p.glow.material as THREE.SpriteMaterial;
        m.opacity = 0.35 + Math.sin(t * 4) * 0.2;
        m.color.setHex(0x7ef29a);
      }
    }
  }
}
