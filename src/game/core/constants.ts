/* ============================================================
   QUINTAL 3D — constantes de mundo, economia e física
   ============================================================ */
import type { Spot, ZoneDef } from "./types";

/* ---------- RNG determinístico (mundo igual a cada load) ---------- */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const damp = (a: number, b: number, l: number, dt: number) => a + (b - a) * (1 - Math.exp(-l * dt));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const fmtBRL = (v: number) =>
  "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/* ---------- mapa: 7 patamares do morro (casa em cima de casa) ---------- */
export const BANDS = [
  { z0: 34, z1: 60, y: 0 },
  { z0: 18, z1: 34, y: 2.0 },
  { z0: 2, z1: 18, y: 4.0 },
  { z0: -14, z1: 2, y: 6.0 },
  { z0: -30, z1: -14, y: 8.0 },
  { z0: -46, z1: -30, y: 10.0 },
  { z0: -60, z1: -46, y: 12.0 },
];

/* eixos de escada por patamar (posição real é ancorada numa casa) */
export const STAIRS: { band: number; xs: number[] }[] = [
  { band: 0, xs: [-22, 26] },
  { band: 1, xs: [-40, 8] },
  { band: 2, xs: [30, -14] },
  { band: 3, xs: [-34, 16] },
  { band: 4, xs: [14, -26] },
  { band: 5, xs: [-8, 40] },
];

export const SPOTS: Spot[] = [
  { x: -52, z: 20, y: BANDS[1].y },
  { x: 52, z: 26, y: BANDS[1].y },
  { x: -50, z: -6, y: BANDS[2].y },
  { x: 48, z: -22, y: BANDS[4].y },
  { x: -46, z: -52, y: BANDS[6].y },
  { x: 30, z: -52, y: BANDS[6].y },
];

/* ---------- polos: Fazenda (legal) x Favela (ilegal) ---------- */
export const FARM = { x0: -40, x1: 40, z0: 48.5, z1: 75 };
export const FEIRA_POS = { x: -10, z: 57 };
export const RECEPT_POS = { x: 26, z: -27 };

export const ZONES: ZoneDef[] = [
  { x: FEIRA_POS.x, z: FEIRA_POS.z, r: 5.2, kind: "mercado", label: "Feira do Zé (Fazenda)" },
  { x: RECEPT_POS.x, z: RECEPT_POS.z, r: 5.0, kind: "receptador", label: "Esconderijo do Receptador" },
];

/* ---------- economia ---------- */
export const PRICES = {
  vaso: 25,
  terra: 15,
  semente: 60,
  venda: 110,
  meta: 2000,
  start: 120,
};
export const GROW_SECONDS = [40, 55, 70]; // broto -> vegetativa -> flora
export const HARVEST_YIELD = 2;

/* ---------- física ---------- */
export const PHYS = {
  R: 0.34,          // raio da cápsula do jogador
  H: 1.68,          // altura
  EYE: 1.5,
  GRAV: 26,
  JUMP: 9.8,
  SPEED: 6.2,
  STEP_TOL: 0.62,   // degraus "engolidos" sem pulo
  MAX_CLIMB: 1.15,  // rampa máxima andável
  COYOTE: 0.12,
  JUMP_BUFFER: 0.14,
};

/* ---------- câmera ---------- */
export const CAM = {
  DIST: 5.2,
  MIN_DIST: 1.7,
  HEIGHT: 1.5,
  PITCH_MIN: 0.04,
  PITCH_MAX: 1.25,
  SENS: 0.0055,
};

/* ---------- paleta desbotada de sol (favela real) ---------- */
export const HOUSE_COLORS = [
  "#c96f4a", "#d9905f", "#c8a24e", "#8f9e57", "#5e8f8b",
  "#7d8fb0", "#a67a92", "#bf7260", "#9aa08a", "#b3906b",
  "#c4837e", "#86a06b",
];
export const GATE_COLS = ["#2f7d5b", "#3b5fa0", "#a33d2f", "#545a66", "#7a5a24"];
export const WIN_COLS = ["#e85d75", "#4d9de0", "#f4d35e", "#3fb8af", "#c98a5a", "#f2f2f2"];
export const PAINT = ["#ffd23f", "#e85d75", "#3fb8af", "#4d9de0", "#7bc950", "#e8622f"];

export const SIGN_DATA: [string, string, string][] = [
  ["BAR DO BIGODE", "#173f2a", "#ffd23f"],
  ["SALÃO DA NEGA", "#471033", "#f2e3c8"],
  ["AÇAÍ DO MORRO", "#241a4a", "#7ef29a"],
  ["PADARIA PAO QUENTE", "#6e2410", "#f4d35e"],
  ["LAN HOUSE", "#0e2836", "#4d9de0"],
  ["DEPOSITAO 2 IRMAOS", "#3a3547", "#f2a541"],
];

export const MARKET_LABEL = "FEIRA DO ZÉ";
export const RECEPT_LABEL = "RECEPTADOR";
