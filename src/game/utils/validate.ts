/* ============================================================
   QUINTAL 3D — Validação automática do mundo (FASE 16)
   Roda no boot, loga no console:
     1. estruturas sobrepostas        4. escadas obstruídas
     2. corredores/vielas bloqueadas  5. estruturas fora do mapa
     3. spawn inválido
   ============================================================ */
import { BANDS } from "./constants";
import type { Physics } from "./physics";
import type { WorldGenerator } from "./world";

interface Issue { sev: "HIGH" | "MED" | "LOW"; msg: string; x: number; z: number; }

export function validateWorld(physics: Physics, world: WorldGenerator): number {
  const issues: Issue[] = [];
  const rects = world.placedRects;

  /* 1. sobreposição entre estruturas */
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (Math.abs(a.y - b.y) > 0.5) continue;
      const ox = (a.w + b.w) / 2 - Math.abs(a.x - b.x);
      const oz = (a.d + b.d) / 2 - Math.abs(a.z - b.z);
      if (ox > 0.05 && oz > 0.05) {
        issues.push({ sev: "HIGH", msg: `Building_#${String(i).padStart(3, "0")} overlaps Building_#${String(j).padStart(3, "0")} (${ox.toFixed(2)}×${oz.toFixed(2)} m)`, x: a.x, z: a.z });
      }
    }
  }

  /* 2. corredores de circulação bloqueados */
  const corridors: { z: number; y: number; label: string }[] = [
    { z: 42, y: 0, label: "Rua principal" },
    { z: 38.3, y: 0, label: "Calçada norte" },
    { z: 45.8, y: 0, label: "Calçada sul" },
    { z: 51.5, y: 0, label: "Caminho da fazenda" },
  ];
  for (let bi = 1; bi < BANDS.length; bi++) {
    const b = BANDS[bi];
    corridors.push({ z: b.z0 + 5.3, y: b.y, label: `Viela A · patamar ${bi}` });
    corridors.push({ z: b.z0 + 10.7, y: b.y, label: `Viela B · patamar ${bi}` });
  }
  for (const c of corridors) {
    let run = 0, worst = 0, worstX = 0;
    for (let x = -54; x <= 54; x += 1.2) {
      if (physics.collides(x, c.z, c.y + 0.1, c.y)) {
        run += 1.2;
        if (run > worst) { worst = run; worstX = x; }
      } else run = 0;
    }
    if (worst > 8) issues.push({ sev: "HIGH", msg: `${c.label} bloqueada por ${worst.toFixed(1)} m`, x: worstX, z: c.z });
    else if (worst > 4.5) issues.push({ sev: "MED", msg: `${c.label} estreita por ${worst.toFixed(1)} m`, x: worstX, z: c.z });
  }

  /* 3. spawn */
  if (physics.collides(-4, 42, 0.1, 0)) issues.push({ sev: "HIGH", msg: "Spawn dentro de collider", x: -4, z: 42 });

  /* 4. escadas: base e chegada livres */
  for (const s of world.stairActual) {
    const yLow = BANDS[s.band].y;
    const zBase = BANDS[s.band].z0 + 3.9;
    if (physics.collides(s.x, zBase, yLow + 0.1, yLow))
      issues.push({ sev: "MED", msg: `Base da escada obstruída (patamar ${s.band})`, x: s.x, z: zBase });
  }

  /* 5. limites do mapa */
  for (const r of rects) {
    if (Math.abs(r.x) > 58 || r.z > 60 || r.z < -60)
      issues.push({ sev: "LOW", msg: "Estrutura fora dos limites do mapa", x: r.x, z: r.z });
  }

  console.groupCollapsed(`[WORLD VALIDATION] ${issues.length} issue(s) · ${rects.length} estruturas auditadas`);
  for (const i of issues) console.warn(`${i.sev}: ${i.msg} @ X:${i.x.toFixed(1)} Z:${i.z.toFixed(1)}`);
  if (!issues.length) console.info("OK — sem sobreposições, corredores livres, spawn válido");
  console.groupEnd();
  return issues.length;
}
