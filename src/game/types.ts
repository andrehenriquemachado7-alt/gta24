/* ============================================================
   QUINTAL 3D — tipos compartilhados
   ============================================================ */

export type ScreenState = "start" | "playing" | "paused" | "win";
export type ShopId = "mercado" | "receptador";
export type GroundKind = "asfalto" | "fazenda" | "laje" | "morro";

export interface SurfaceDef {
  minX: number; maxX: number; minZ: number; maxZ: number; top: number;
}

export interface Spot { x: number; z: number; y: number }
export interface ZoneDef { x: number; z: number; r: number; kind: ShopId; label: string }

export interface Inv { vasos: number; terra: number; sementes: number; pacotes: number }

export interface PromptInfo { text: string; actionable: boolean }
export interface ToastInfo { text: string; id: number }
export interface StatsInfo { plantadas: number; harvested: number; sold: number; time: number }

export interface HudData {
  screen: ScreenState;
  money: number;
  meta: number;
  inv: Inv;
  prompt: PromptInfo | null;
  toast: ToastInfo | null;
  shop: ShopId | null;
  muted: boolean;
  debug: boolean;
  fx: boolean;
  growing: number;
  ready: number;
  stats: StatsInfo;
}

export interface StairActual { x: number; band: number }

export interface NpcDef {
  g: import("three").Group;
  x: number; z: number; y: number;
  sp: number; ph: number; rot: number; wi: number; fwd: number; step: number;
  legL: import("three").Mesh; legR: import("three").Mesh;
  armL: import("three").Mesh; armR: import("three").Mesh;
  route: { x: number; z: number; y: number }[];
}
