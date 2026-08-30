/* ============================================================
   QUINTAL 3D — texturas procedurais (CanvasTexture)
   Todas geradas em runtime, prontas p/ troca por assets externos
   no futuro (mesma interface de retorno).
   ============================================================ */
import * as THREE from "three";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return { c, x: c.getContext("2d")! };
}
function finish(c: HTMLCanvasElement, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  return tex;
}

/* parede de reboco com degradê vertical (escuro no pé, claro no topo)
   + grade de janelas emissivas (map + emissiveMap) */
export function makeWallTex() {
  const { c, x } = canvas(256, 256);
  const g = x.createLinearGradient(0, 256, 0, 0);
  g.addColorStop(0, "#6f6961");
  g.addColorStop(0.35, "#a8a093");
  g.addColorStop(1, "#d8d0c0");
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    x.fillStyle = `rgba(${Math.random() > 0.5 ? "40,34,28" : "255,250,235"},${0.03 + Math.random() * 0.06})`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  for (let i = 0; i < 8; i++) {
    x.fillStyle = `rgba(52,42,34,${0.05 + Math.random() * 0.1})`;
    x.fillRect(Math.random() * 256, 200 + Math.random() * 56, 20 + Math.random() * 60, 56);
  }
  // emissive: janelas acesas
  const { c: ce, x: xe } = canvas(256, 256);
  xe.fillStyle = "#000"; xe.fillRect(0, 0, 256, 256);
  for (let wy = 0; wy < 4; wy++) {
    for (let wx = 0; wx < 4; wx++) {
      if (Math.random() < 0.45) continue;
      xe.fillStyle = Math.random() < 0.75 ? "#ffd98c" : "#bfe3ff";
      xe.fillRect(wx * 64 + 20, wy * 64 + 18, 22, 26);
    }
  }
  return { map: finish(c, 2, 1), emissiveMap: finish(ce, 2, 1) };
}

/* tijolo à vista — o "em construção eterna" da favela */
export function makeBrickTex() {
  const { c, x } = canvas(128, 128);
  x.fillStyle = "#93502f"; x.fillRect(0, 0, 128, 128);
  const bw = 24, bh = 11;
  for (let r = 0; r < 12; r++) {
    const off = (r % 2) * (bw / 2);
    for (let col = -1; col < 7; col++) {
      const v = 0.78 + Math.random() * 0.36;
      x.fillStyle = `rgb(${Math.floor(154 * v)},${Math.floor(76 * v)},${Math.floor(48 * v)})`;
      x.fillRect(col * bw + off + 1, r * bh + 1, bw - 2, bh - 2);
    }
  }
  x.fillStyle = "rgba(206,186,160,0.9)";
  for (let r = 1; r < 12; r++) x.fillRect(0, r * bh - 1, 128, 2);
  for (let i = 0; i < 7; i++) {
    x.fillStyle = `rgba(30,20,14,${0.12 + Math.random() * 0.18})`;
    x.fillRect(Math.random() * 128, 128 - (8 + Math.random() * 26), 10 + Math.random() * 30, 30);
  }
  return finish(c, 2, 1);
}

/* asfalto gasto da rua */
export function makeAsphaltTex() {
  const { c, x } = canvas(256, 256);
  x.fillStyle = "#4a474f"; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3200; i++) {
    const v = 48 + Math.floor(Math.random() * 60);
    x.fillStyle = `rgb(${v},${v - 3},${v + 4})`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }
  for (let i = 0; i < 6; i++) {
    x.fillStyle = "rgba(30,28,34,0.5)";
    x.beginPath();
    x.ellipse(Math.random() * 256, Math.random() * 256, 14 + Math.random() * 26, 8 + Math.random() * 16, Math.random() * 3, 0, Math.PI * 2);
    x.fill();
  }
  x.strokeStyle = "rgba(20,18,24,0.7)"; x.lineWidth = 1.4;
  for (let i = 0; i < 5; i++) {
    x.beginPath();
    let px = Math.random() * 256, py = Math.random() * 256;
    x.moveTo(px, py);
    for (let s = 0; s < 6; s++) { px += (Math.random() - 0.5) * 60; py += (Math.random() - 0.5) * 60; x.lineTo(px, py); }
    x.stroke();
  }
  return finish(c, 10, 2);
}

/* chão do morro: terra com pedriscos e manchas */
export function makeGroundTex() {
  const { c, x } = canvas(256, 256);
  x.fillStyle = "#8a7a5e"; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    const v = Math.random();
    x.fillStyle = v < 0.5 ? `rgba(60,48,34,${0.06 + Math.random() * 0.12})` : `rgba(230,214,178,${0.05 + Math.random() * 0.1})`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2.4, 1 + Math.random() * 2.4);
  }
  for (let i = 0; i < 60; i++) {
    x.fillStyle = `rgba(120,108,90,${0.5 + Math.random() * 0.4})`;
    x.beginPath();
    x.arc(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2.6, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = "rgba(40,32,24,0.4)";
    x.beginPath();
    x.arc(Math.random() * 256 + 1, Math.random() * 256 + 1.4, 1 + Math.random() * 2.2, 0, Math.PI * 2);
    x.fill();
  }
  for (let i = 0; i < 14; i++) {
    x.fillStyle = `rgba(70,58,42,${0.1 + Math.random() * 0.14})`;
    x.beginPath();
    x.ellipse(Math.random() * 256, Math.random() * 256, 12 + Math.random() * 30, 8 + Math.random() * 20, Math.random() * 3, 0, Math.PI * 2);
    x.fill();
  }
  return finish(c, 26, 26);
}

/* terra arada da fazenda: sulcos em fileiras */
export function makeFarmTex() {
  const { c, x } = canvas(256, 256);
  x.fillStyle = "#6e4f33"; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3800; i++) {
    const v = Math.random();
    x.fillStyle = v < 0.5 ? `rgba(46,32,20,${0.08 + Math.random() * 0.14})` : `rgba(190,150,105,${0.05 + Math.random() * 0.1})`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  for (let r = 0; r < 8; r++) {
    const y = r * 32 + 8;
    x.fillStyle = "rgba(40,27,16,0.4)";
    x.fillRect(0, y, 256, 7);
    x.fillStyle = "rgba(150,112,72,0.5)";
    x.fillRect(0, y + 7, 256, 3);
  }
  return finish(c, 6, 3);
}

/* concreto manchado (escadas, lajes, guias) */
export function makeConcreteTex() {
  const { c, x } = canvas(128, 128);
  x.fillStyle = "#9b958c"; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1600; i++) {
    const v = 120 + Math.floor(Math.random() * 70);
    x.fillStyle = `rgba(${v},${v - 4},${v - 10},0.16)`;
    x.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
  }
  for (let i = 0; i < 7; i++) {
    x.fillStyle = `rgba(56,50,44,${0.12 + Math.random() * 0.16})`;
    x.beginPath();
    x.ellipse(Math.random() * 128, Math.random() * 128, 8 + Math.random() * 22, 5 + Math.random() * 12, Math.random() * 3, 0, Math.PI * 2);
    x.fill();
  }
  return finish(c, 2, 2);
}

/* grafite procedural p/ murais de beco */
export function makeGraffitiTex() {
  const { c, x } = canvas(256, 128);
  x.fillStyle = "#8f4a2c"; x.fillRect(0, 0, 256, 128);
  const cols = ["#ffd23f", "#e85d75", "#3fb8af", "#4d9de0", "#7bc950", "#ff8c42", "#f2f2f2"];
  for (let i = 0; i < 26; i++) {
    x.fillStyle = cols[Math.floor(Math.random() * cols.length)];
    x.globalAlpha = 0.22 + Math.random() * 0.5;
    x.beginPath();
    x.arc(Math.random() * 256, Math.random() * 128, 6 + Math.random() * 22, 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 1;
  const words = ["FÉ", "PAZ", "RIO 40°", "VIDA", "MORRO"];
  const word = words[Math.floor(Math.random() * words.length)];
  x.font = "900 56px \"Bebas Neue\", \"Arial Narrow\", sans-serif";
  x.textAlign = "center"; x.textBaseline = "middle";
  x.strokeStyle = "#101117"; x.lineWidth = 10;
  x.strokeText(word, 128, 64);
  x.fillStyle = cols[Math.floor(Math.random() * cols.length)];
  x.fillText(word, 128, 64);
  return finish(c);
}

/* letreiro pintado à mão (retorna redraw p/ quando a fonte carregar) */
export function makeSign(text: string, bg: string, fg: string, w = 512, h = 112) {
  const { c, x } = canvas(w, h);
  const tex = finish(c);
  const draw = () => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = bg;
    x.fillRect(6, 6, w - 12, h - 12);
    x.strokeStyle = fg; x.lineWidth = 5;
    x.strokeRect(14, 14, w - 28, h - 28);
    x.font = `900 ${Math.floor(h * 0.52)}px "Bebas Neue", "Arial Narrow", sans-serif`;
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillStyle = fg;
    x.fillText(text, w / 2, h / 2 + 4);
    tex.needsUpdate = true;
  };
  draw();
  return { tex, redraw: draw };
}

/* brilho suave (sprites, halos, FX de crescimento) */
export function makeGlowTex() {
  const { c, x } = canvas(64, 64);
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* marcador de mocó: anel de tinta spray no chão */
export function makeSprayTex(hex: string) {
  const { c, x } = canvas(128, 128);
  x.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 420; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 44 + (Math.random() - 0.5) * 14;
    x.fillStyle = hex;
    x.globalAlpha = 0.25 + Math.random() * 0.6;
    x.fillRect(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 1.6 + Math.random() * 2.2, 1.6 + Math.random() * 2.2);
  }
  x.globalAlpha = 0.5;
  x.fillStyle = hex;
  x.beginPath(); x.arc(64, 64, 5, 0, Math.PI * 2); x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* lona listrada da barraca da feira */
export function makeTentTex(a: string, b: string) {
  const { c, x } = canvas(128, 128);
  for (let i = 0; i < 8; i++) {
    x.fillStyle = i % 2 ? a : b;
    x.fillRect(i * 16, 0, 16, 128);
  }
  return finish(c, 2, 1);
}
