/* ============================================================
   QUINTAL 3D — motor completo do jogo (Three.js)
   Geração procedural do morro, física de colisão com sliding,
   economia de cultivo, radar em tempo real, partículas e SFX.
   ============================================================ */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/* ---------------- tipos públicos ---------------- */
export type ScreenState = "start" | "playing" | "paused" | "win";
export type ShopKind = "mercado" | "receptador" | null;

export interface HudData {
  screen: ScreenState;
  money: number;
  meta: number;
  inv: { vasos: number; terra: number; sementes: number; pacotes: number };
  prompt: { text: string; actionable: boolean } | null;
  toast: { id: number; text: string } | null;
  shop: ShopKind;
  muted: boolean;
  growing: number;
  ready: number;
  stats: { time: number; harvested: number; sold: number };
}

export const PRICES = {
  vaso: 50,
  terra: 30,
  semente: 80,
  venda: 300,
  meta: 2000,
  inicial: 200,
};

/* ---------------- utilidades ---------------- */
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const damp = (a: number, b: number, k: number, dt: number) =>
  THREE.MathUtils.lerp(a, b, 1 - Math.exp(-k * dt));

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fmtBRL = (v: number) =>
  "R$ " + v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

/* ---------------- áudio (WebAudio synth) ---------------- */
class Sfx {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  muted = false;

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.startWind();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  private tone(
    freq: number, dur: number, type: OscillatorType, vol: number,
    slideTo?: number, delay = 0
  ) {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  private noiseBurst(dur: number, vol: number, freq: number, delay = 0) {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
  }

  private startWind() {
    if (!this.ctx || !this.master) return;
    const n = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 320;
    const g = this.ctx.createGain(); g.gain.value = 0.02;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  jump() { this.tone(280, 0.16, "sine", 0.22, 520); }
  land() { this.noiseBurst(0.09, 0.14, 500); }
  step() { this.noiseBurst(0.045, 0.05, 900); }
  buyOk() { this.tone(660, 0.09, "triangle", 0.25); this.tone(990, 0.12, "triangle", 0.22, undefined, 0.07); }
  buyFail() { this.tone(130, 0.22, "sawtooth", 0.2, 90); }
  plant() { this.noiseBurst(0.16, 0.22, 700); this.tone(220, 0.14, "sine", 0.16, 160, 0.02); }
  harvest() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.14, "triangle", 0.22, undefined, i * 0.07)); }
  sell() {
    this.tone(988, 0.08, "square", 0.16); this.tone(1319, 0.1, "square", 0.16, undefined, 0.07);
    this.noiseBurst(0.08, 0.16, 3200, 0.02); this.noiseBurst(0.06, 0.12, 4200, 0.1);
  }
  uiOpen() { this.tone(440, 0.07, "triangle", 0.16, 620); }
  uiClose() { this.tone(520, 0.07, "triangle", 0.14, 340); }
  win() { [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.32, "triangle", 0.24, undefined, i * 0.13)); }
}

/* ---------------- estruturas de mundo ---------------- */
interface Surface { minX: number; maxX: number; minZ: number; maxZ: number; top: number; roof?: boolean; }
interface Collider { minX: number; maxX: number; minZ: number; maxZ: number; top: number; bottom: number; }
interface Zone { x: number; z: number; y: number; kind: "mercado" | "receptador"; }
interface Spot { x: number; z: number; y: number; }
interface Plant {
  group: THREE.Group; x: number; z: number; baseY: number;
  planted: number; stage: number;
  bar: THREE.Group | null; fill: THREE.Mesh | null; marker: THREE.Mesh | null;
  mats: THREE.MeshLambertMaterial[];
}

const STEP_TOL = 0.42;      // altura máxima de degrau automático
const MAX_CLIMB = 0.52;     // subida máxima de terreno por passo (rampas suaves)
const PLAYER_R = 0.34;      // raio de colisão
const PLAYER_H = 1.68;
const GRAV = 26;
const JUMP_V = 8.6;
const SPEED = 6.2;
const CAM_DIST = 5;
const RAMP_W = 1.9;         // meia-largura da rampa entre patamares (morro mais íngreme)
const GROW_T1 = 16;   // broto -> vegetativa
const GROW_T2 = 38;   // -> flora (colheita)

const BANDS = [
  { z0: 34, z1: 60, y: 0 },
  { z0: 10, z1: 34, y: 2.8 },
  { z0: -14, z1: 10, y: 5.6 },
  { z0: -38, z1: -14, y: 8.4 },
  { z0: -60, z1: -38, y: 11.2 },
];

const STAIRS = [
  { band: 0, xs: [-22, 26] },
  { band: 1, xs: [-38, 10] },
  { band: 2, xs: [-14, 34] },
  { band: 3, xs: [8, -32] },
];

const SPOTS: Spot[] = [
  { x: -52, z: 20, y: BANDS[1].y },
  { x: 52, z: 26, y: BANDS[1].y },
  { x: -50, z: -4, y: BANDS[2].y },
  { x: 48, z: -22, y: BANDS[3].y },
  { x: -46, z: -48, y: BANDS[4].y },
  { x: 30, z: -52, y: BANDS[4].y },
];

const HOUSE_COLORS = [
  "#e85d75", "#f2a541", "#f4d35e", "#7bc950", "#3fb8af",
  "#4d9de0", "#9b72cf", "#e15b9b", "#c86b52", "#59c3c3",
  "#d96fb0", "#8fbf4d",
];

/* ============================================================
   PARTÍCULAS (pool único em THREE.Points)
   ============================================================ */
class ParticleField {
  points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private base: Float32Array;
  private n = 360;
  private cursor = 0;

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(this.n * 3);
    this.col = new Float32Array(this.n * 3);
    this.vel = new Float32Array(this.n * 3);
    this.life = new Float32Array(this.n);
    this.base = new Float32Array(this.n * 3);
    for (let i = 0; i < this.n; i++) this.pos[i * 3 + 1] = -999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.16, vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  burst(p: THREE.Vector3, hex: number, count: number, power = 3.4, up = 2.6) {
    const c = new THREE.Color(hex);
    for (let k = 0; k < count; k++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.n;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const a = Math.random() * Math.PI * 2;
      const r = (0.3 + Math.random() * 0.7) * power;
      this.vel[i * 3] = Math.cos(a) * r;
      this.vel[i * 3 + 1] = Math.random() * up + 0.6;
      this.vel[i * 3 + 2] = Math.sin(a) * r;
      this.life[i] = 0.55 + Math.random() * 0.5;
      this.base[i * 3] = c.r; this.base[i * 3 + 1] = c.g; this.base[i * 3 + 2] = c.b;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 7.5 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = clamp(this.life[i] * 1.8, 0, 1);
      this.col[i * 3] = this.base[i * 3] * f;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * f;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * f;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -999;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

/* ============================================================
   JOGO
   ============================================================ */
export class QuintalGame {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;
  private minimap: HTMLCanvasElement;
  private floatLayer: HTMLElement;
  private onHud: (h: HudData) => void;

  private sfx = new Sfx();
  private particles: ParticleField;

  private surfaces: Surface[] = [];
  private colliders: Collider[] = [];
  private zones: Zone[] = [];
  private plants: Plant[] = [];
  private spotMeshes: THREE.Mesh[] = [];

  // zonas "achatadas" do terreno orgânico (casas, rua, escadas, pontos)
  private flatRects: { x0: number; x1: number; z0: number; z1: number }[] = [];
  private flatCircles: { x: number; z: number; r: number }[] = [];

  // jogador
  private player = new THREE.Group();
  private legL!: THREE.Mesh; private legR!: THREE.Mesh;
  private armL!: THREE.Mesh; private armR!: THREE.Mesh;
  private pPos = new THREE.Vector3(-4, 0, 42);
  private vel = new THREE.Vector3();
  private grounded = false;
  private coyote = 0;
  private jumpBuffer = 0;
  private faceYaw = 0;
  private walkPhase = 0;
  private stepTimer = 0;

  // câmera orbital
  private camYaw = 0;            // câmera atrás, jogador olhando morro acima (-z)
  private camPitch = 0.32;
  private camSmooth = new THREE.Vector3();
  private dragging = false;
  private lastPX = 0; private lastPY = 0;

  // input
  private keys = { f: false, b: false, l: false, r: false };
  private joy = { x: 0, y: 0 };

  // estado
  private screen: ScreenState = "start";
  private shop: ShopKind = null;
  private money = PRICES.inicial;
  private inv = { vasos: 0, terra: 0, sementes: 0, pacotes: 0 };
  private promptNow: { text: string; actionable: boolean } | null = null;
  private toastNow: { id: number; text: string } | null = null;
  private toastSeq = 0;
  private wonOnce = false;
  private simTime = 0;
  private harvested = 0;
  private sold = 0;
  private hudJson = "";
  private hudTimer = 0;

  // mundo vivo
  private npcs: { g: THREE.Group; x: number; z: number; y: number; dir: number; sp: number; ph: number; range: number }[] = [];
  private birds: { g: THREE.Group; wingL: THREE.Mesh; wingR: THREE.Mesh; a: number; r: number; h: number; sp: number }[] = [];
  private signRedraws: (() => void)[] = [];
  private raf = 0;
  private lastT = 0;
  private disposed = false;

  constructor(opts: {
    container: HTMLElement;
    minimap: HTMLCanvasElement;
    floatLayer: HTMLElement;
    onHud: (h: HudData) => void;
  }) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    opts.container.appendChild(this.canvas);
    this.minimap = opts.minimap;
    this.floatLayer = opts.floatLayer;
    this.onHud = opts.onHud;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    this.camera = new THREE.PerspectiveCamera(66, 1, 0.1, 900);
    this.scene.fog = new THREE.Fog(0xd98e63, 70, 430);

    this.particles = new ParticleField(this.scene);

    this.buildSky();
    this.buildLights();
    this.buildWorld();
    this.buildPlayer();

    this.bindEvents();
    this.resize();
    this.renderer.setAnimationLoop((t) => this.tick(t));
    this.emitHud(true);
  }

  /* ---------------- mundo ---------------- */

  private buildSky() {
    const skyGeo = new THREE.SphereGeometry(450, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        cTop: { value: new THREE.Color("#20275c") },
        cMid: { value: new THREE.Color("#8a4a6b") },
        cBot: { value: new THREE.Color("#f5a862") },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cBot; varying vec3 vP;
        void main(){
          float h = normalize(vP).y;
          vec3 c = mix(cBot, cMid, smoothstep(-0.02, 0.24, h));
          c = mix(c, cTop, smoothstep(0.2, 0.72, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));

    // sol poente sobre o mar
    const sunC = document.createElement("canvas"); sunC.width = sunC.height = 128;
    const sc = sunC.getContext("2d")!;
    const grad = sc.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, "rgba(255,236,170,1)");
    grad.addColorStop(0.35, "rgba(255,190,110,0.85)");
    grad.addColorStop(1, "rgba(255,150,80,0)");
    sc.fillStyle = grad; sc.fillRect(0, 0, 128, 128);
    const sunTex = new THREE.CanvasTexture(sunC);
    const sun = new THREE.Mesh(
      new THREE.PlaneGeometry(90, 90),
      new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, fog: false, depthWrite: false })
    );
    sun.position.set(-50, 24, 380);
    this.scene.add(sun);

    // mar da baía de Guanabara (raso perto da orla, fundo longe)
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(1200, 500),
      new THREE.MeshLambertMaterial({ color: 0x14617f })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, -1.4, 300);
    this.scene.add(sea);
    const shallow = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 60),
      new THREE.MeshLambertMaterial({ color: 0x1d7f96 })
    );
    shallow.rotation.x = -Math.PI / 2;
    shallow.position.set(0, -1.3, 78);
    this.scene.add(shallow);

    // ---- cartão-postal do Rio: Pão de Açúcar, Urca, bondinho, Corcovado e Cristo ----
    const mtMat = new THREE.MeshLambertMaterial({ color: 0x3c2b55 });
    const sugar = new THREE.Mesh(new THREE.SphereGeometry(30, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), mtMat);
    sugar.scale.set(1, 1.8, 1); sugar.position.set(-150, -2, 320); this.scene.add(sugar);
    const urca = new THREE.Mesh(new THREE.SphereGeometry(17, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), mtMat);
    urca.scale.set(1, 1.5, 1); urca.position.set(-92, -2, 305); this.scene.add(urca);
    // bondinho: cabo esticado + cabines penduradas
    this.scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-150, 50, 320), new THREE.Vector3(-92, 23, 305)]),
      new THREE.LineBasicMaterial({ color: 0x191428 })
    ));
    const cabinMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
    const cab1 = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.8, 2), cabinMat);
    cab1.position.set(-128, 39, 314); this.scene.add(cab1);
    const cab2 = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 1.8), cabinMat);
    cab2.position.set(-110, 30, 310); this.scene.add(cab2);
    // Corcovado com o Cristo Redentor de braços abertos
    const corc = new THREE.Mesh(new THREE.ConeGeometry(24, 92, 8), mtMat);
    corc.position.set(160, -4, 295); this.scene.add(corc);
    const cristoMat = new THREE.MeshLambertMaterial({ color: 0xe9e5da, emissive: 0x9aa2b8, emissiveIntensity: 0.55 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 9, 1.6), cristoMat);
    body.position.set(160, 92, 295); this.scene.add(body);
    const arms = new THREE.Mesh(new THREE.BoxGeometry(13, 1.4, 1.4), cristoMat);
    arms.position.set(160, 94.5, 295); this.scene.add(arms);
    const headC = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 8), cristoMat);
    headC.position.set(160, 97.4, 295); this.scene.add(headC);
    // serras ao fundo da baía
    const s1 = new THREE.Mesh(new THREE.ConeGeometry(60, 55, 7), mtMat);
    s1.position.set(40, -4, 400); this.scene.add(s1);
    const s2 = new THREE.Mesh(new THREE.ConeGeometry(48, 40, 7), mtMat);
    s2.position.set(-240, -4, 380); this.scene.add(s2);
  }

  private buildLights() {
    const hemi = new THREE.HemisphereLight(0xffd9b0, 0x4a3428, 1.0);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffb46b, 1.4);
    dir.position.set(55, 80, 95);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -85; dir.shadow.camera.right = 85;
    dir.shadow.camera.top = 85; dir.shadow.camera.bottom = -85;
    dir.shadow.camera.near = 10; dir.shadow.camera.far = 300;
    dir.shadow.bias = -0.0005;
    dir.shadow.normalBias = 0.025; // sombras suaves sem "acne" nas paredes
    this.scene.add(dir);
    this.scene.add(dir.target);
    // preenchimento frio e suave do lado oposto — visual cartoon coeso
    const fill = new THREE.DirectionalLight(0x8fa3d0, 0.32);
    fill.position.set(-60, 40, -70);
    this.scene.add(fill);
  }

  private texWall(): { map: THREE.CanvasTexture; emissiveMap: THREE.CanvasTexture } {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const x = c.getContext("2d")!;
    x.fillStyle = "#efe7d6"; x.fillRect(0, 0, 128, 128);
    x.fillStyle = "rgba(0,0,0,0.06)";
    for (let i = 0; i < 14; i++) x.fillRect(Math.random() * 128, Math.random() * 128, 10 + Math.random() * 26, 3);
    const e = document.createElement("canvas"); e.width = e.height = 128;
    const ex = e.getContext("2d")!;
    ex.fillStyle = "#000000"; ex.fillRect(0, 0, 128, 128);
    for (let r = 0; r < 3; r++) {
      for (let col = 0; col < 3; col++) {
        const wx = 14 + col * 38, wy = 18 + r * 34;
        x.fillStyle = "#33303f"; x.fillRect(wx, wy, 22, 18);
        x.fillStyle = "#57506a"; x.fillRect(wx, wy, 22, 3);
        if (Math.random() < 0.55) {
          x.fillStyle = "#ffd98a"; x.fillRect(wx + 2, wy + 2, 18, 14);
          ex.fillStyle = "#ffbf66"; ex.fillRect(wx + 2, wy + 2, 18, 14);
        } else {
          x.fillStyle = "#232131"; x.fillRect(wx + 2, wy + 2, 18, 14);
        }
      }
    }
    // dégradê vertical estilo cartoon: base mais escura, topo mais claro
    const grad = x.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, "rgba(255,248,230,0.22)");
    grad.addColorStop(0.5, "rgba(255,255,255,0)");
    grad.addColorStop(1, "rgba(43,27,18,0.38)");
    x.fillStyle = grad; x.fillRect(0, 0, 128, 128);

    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    const emissiveMap = new THREE.CanvasTexture(e);
    emissiveMap.colorSpace = THREE.SRGBColorSpace;
    return { map, emissiveMap };
  }

  /* tijolo à vista — o visual "em construção eterna" da favela */
  private texBrick(): THREE.CanvasTexture {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const x = c.getContext("2d")!;
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
    // infiltração no pé do muro
    for (let i = 0; i < 7; i++) {
      x.fillStyle = `rgba(30,20,14,${0.12 + Math.random() * 0.18})`;
      x.fillRect(Math.random() * 128, 128 - (8 + Math.random() * 26), 10 + Math.random() * 30, 30);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /* mural de grafite procedural para os becos */
  private texGraffiti(): THREE.CanvasTexture {
    const c = document.createElement("canvas"); c.width = 256; c.height = 128;
    const x = c.getContext("2d")!;
    x.fillStyle = "#8f4a2c"; x.fillRect(0, 0, 256, 128);
    const cols = ["#ffd23f", "#e85d75", "#3fb8af", "#4d9de0", "#7bc950", "#ff4fd8", "#f2f2f2"];
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
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private makeSign(text: string, bg: string, fg: string, w = 512, h = 128): { tex: THREE.CanvasTexture; redraw: () => void } {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const draw = () => {
      const x = c.getContext("2d")!;
      x.clearRect(0, 0, w, h);
      x.fillStyle = bg; x.fillRect(0, 0, w, h);
      x.strokeStyle = fg; x.lineWidth = 8; x.strokeRect(8, 8, w - 16, h - 16);
      x.font = `400 ${Math.floor(h * 0.58)}px "Bebas Neue", "Arial Narrow", sans-serif`;
      x.textAlign = "center"; x.textBaseline = "middle";
      x.shadowColor = fg; x.shadowBlur = 22;
      x.fillStyle = fg;
      x.fillText(text, w / 2, h / 2 + h * 0.04);
      x.shadowBlur = 0;
    };
    draw();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { tex, redraw: () => { draw(); tex.needsUpdate = true; } };
  }

  private addSurface(s: Surface) { this.surfaces.push(s); }
  private addCollider(c: Collider) { this.colliders.push(c); }

  private box(
    w: number, h: number, d: number, mat: THREE.Material,
    x: number, yBottom: number, z: number, shadow = true
  ): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, yBottom + h / 2, z);
    if (shadow) { m.castShadow = true; m.receiveShadow = true; }
    this.scene.add(m);
    return m;
  }

  private buildWorld() {
    const rng = mulberry32(20260207);
    const wallTex = this.texWall();
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x5a5168 });
    const concrete = new THREE.MeshLambertMaterial({ color: 0x8d8578 });
    const concreteDark = new THREE.MeshLambertMaterial({ color: 0x6f685e });

    /* listas para merge (poucos draw calls -> roda liso no celular) */
    const houseGeos: THREE.BufferGeometry[] = [];
    const roofGeos: THREE.BufferGeometry[] = [];
    const concreteGeos: THREE.BufferGeometry[] = [];
    const darkGeos: THREE.BufferGeometry[] = [];
    const metalGeos: THREE.BufferGeometry[] = [];
    const brickGeos: THREE.BufferGeometry[] = [];   // casas de tijolo aparente
    const doorGeos: THREE.BufferGeometry[] = [];    // portas/antenas escuras
    const frameGeos: THREE.BufferGeometry[] = [];   // portões, esquadrias, AC, ferragens
    const paintGeos: THREE.BufferGeometry[] = [];   // faixas pintadas dos degraus
    const wireGeos: THREE.BufferGeometry[] = [];    // emaranhado de fios
    // coleta para a fiação, letreiros e murais
    const anchors: THREE.Vector3[] = [];
    const signHouses: { x: number; z: number; w: number; d: number; y: number }[] = [];
    const muralHouses: { x: number; z: number; w: number; d: number; y: number; hh: number }[] = [];
    const brickMat = new THREE.MeshLambertMaterial({ map: this.texBrick() });
    const frameMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const doorMat = new THREE.MeshLambertMaterial({ color: 0x241f28 });
    const paintMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const PAINT = ["#ffd23f", "#e85d75", "#3fb8af", "#4d9de0", "#7bc950", "#ff4fd8"];
    const GATE_COLS = ["#2f7d5b", "#3b5fa0", "#a33d2f", "#545a66", "#7a5a24"];
    const WIN_COLS = ["#e85d75", "#4d9de0", "#f4d35e", "#3fb8af", "#9b72cf", "#f2f2f2"];
    // cilindro "cozido" entre dois pontos (corrimãos, postes, fios)
    const tubeGeo = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      const g = new THREE.CylinderGeometry(r, r, len, 6);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
      g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      return g;
    };
    const pushGeo = (
      list: THREE.BufferGeometry[], w: number, h: number, d: number,
      x: number, yBottom: number, z: number, color?: string
    ) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, yBottom + h / 2, z);
      if (color) {
        const c = new THREE.Color(color);
        const cnt = g.attributes.position.count;
        const arr = new Float32Array(cnt * 3);
        for (let i = 0; i < cnt; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
        g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
      }
      list.push(g);
    };

    /* --- terreno orgânico ---
       A encosta agora é uma colina contínua: patamares ligados por rampas
       suaves (sem degraus retos) com ondulação orgânica. A malha é
       construída no fim (depois de registrar as zonas planas). */
    // chão da rua principal (faixa de asfalto) — longe da rampa para não ter terra invadindo o asfalto
    const road = this.box(120, 0.06, 9, new THREE.MeshLambertMaterial({ color: 0x4a4650 }), 0, BANDS[0].y, 42, false);
    road.receiveShadow = true;
    this.addFlatRect(-60, 60, 37.2, 46.8);

    /* --- escadarias (estrutura vazada: degraus flutuantes + corrimão fino) --- */
    const N_STEPS = 10, RISE = 0.28, TREAD = 0.46, STAIR_W = 2.3;
    for (const st of STAIRS) {
      for (const gx of st.xs) {
        const yLow = BANDS[st.band].y;
        const boundary = BANDS[st.band].z0;
        const run = N_STEPS * TREAD;
        const yHigh = yLow + N_STEPS * RISE;
        for (let k = 1; k <= N_STEPS; k++) {
          const zc = boundary + run / 2 - (k - 1) * TREAD - TREAD / 2;
          const top = yLow + k * RISE;
          // degrau flutuante (lâmina fina, sem bloco maciço embaixo)
          pushGeo(k % 2 ? concreteGeos : darkGeos, STAIR_W, 0.09, TREAD, gx, top - 0.09, zc);
          // espelho curto na borda frontal para dar leitura de degrau
          pushGeo(darkGeos, STAIR_W, RISE, 0.05, gx, top - RISE, zc - TREAD / 2 + 0.025);
          // faixa pintada na borda (azulejo colorido de favela)
          pushGeo(paintGeos, STAIR_W - 0.12, 0.06, 0.09, gx, top - 0.06, zc - TREAD / 2 + 0.02, PAINT[(k + st.band) % PAINT.length]);
          this.addSurface({ minX: gx - STAIR_W / 2, maxX: gx + STAIR_W / 2, minZ: zc - TREAD / 2, maxZ: zc + TREAD / 2, top });
        }
        // corrimão fino inclinado + postes finos (sem parede maciça)
        const zBot = boundary + run / 2 + 0.2, zTop = boundary - run / 2 - 0.2;
        for (const side of [-1, 1]) {
          const wx = gx + side * (STAIR_W / 2 + 0.07);
          metalGeos.push(tubeGeo(new THREE.Vector3(wx, yLow + 0.8, zBot), new THREE.Vector3(wx, yHigh + 0.8, zTop), 0.035));
          for (let p = 0; p <= 2; p++) {
            const t = p / 2;
            const pz = zBot + (zTop - zBot) * t;
            const py = yLow + (yHigh - yLow) * t;
            metalGeos.push(tubeGeo(new THREE.Vector3(wx, py, pz), new THREE.Vector3(wx, py + 0.8, pz), 0.03));
          }
        }
      }
    }

    /* --- casas procedurais --- */
    const stairXs = STAIRS.flatMap((s) => s.xs);
    const reserved = [
      { x: -10, z: 47, r: 7 },   // mercadinho
      { x: 26, z: -27, r: 7 },   // receptador
    ];
    const lajeHouses: { x: number; z: number; w: number; d: number; top: number; y: number }[] = [];

    for (let bi = 0; bi < BANDS.length; bi++) {
      const b = BANDS[bi];
      const rows = [b.z0 + 4.6, b.z1 - 4.6];
      const midCount = bi === 0 ? 3 : 4;
      const plots: { x: number; z: number }[] = [];
      for (const rz of rows) for (let px = -54; px <= 54; px += 7.4) plots.push({ x: px + (rng() - 0.5) * 1.6, z: rz });
      for (let m = 0; m < midCount; m++) {
        plots.push({ x: -48 + rng() * 96, z: b.z0 + 9 + rng() * Math.max(2, b.z1 - b.z0 - 18) });
      }
      for (const p of plots) {
        if (stairXs.some((sx) => Math.abs(p.x - sx) < 3.6)) continue;
        if (reserved.some((r) => Math.abs(p.x - r.x) < r.r && Math.abs(p.z - r.z) < r.r)) continue;
        if (SPOTS.some((s) => Math.abs(p.x - s.x) < 4 && Math.abs(p.z - s.z) < 4)) continue;
        if (rng() < 0.16) continue; // beco vazio
        const w = 4.2 + rng() * 1.8;
        const d = 4.2 + rng() * 1.8;
        const h = 2.9 + rng() * 1.9;
        const isLaje = rng() < 0.34;
        const hh = isLaje ? 3.0 : h;
        const isBrick = rng() < 0.34; // ~1/3 das casas é tijolo aparente
        const col = HOUSE_COLORS[Math.floor(rng() * HOUSE_COLORS.length)];
        if (isBrick) pushGeo(brickGeos, w, hh, d, p.x, b.y, p.z);
        else pushGeo(houseGeos, w, hh, d, p.x, b.y, p.z, col);
        this.addCollider({ minX: p.x - w / 2, maxX: p.x + w / 2, minZ: p.z - d / 2, maxZ: p.z + d / 2, top: b.y + hh, bottom: b.y - 0.2 });
        this.addFlatRect(p.x - w / 2 - 1.2, p.x + w / 2 + 1.2, p.z - d / 2 - 1.2, p.z + d / 2 + 1.2);
        pushGeo(roofGeos, w + 0.3, 0.16, d + 0.3, p.x, b.y + hh, p.z);
        // --- fachada viva: porta escura, portão de metal, janela com esquadria, ar-condicionado, antena ---
        pushGeo(doorGeos, 0.85, 1.85, 0.07, p.x - w / 6, b.y, p.z + d / 2 - 0.02);
        if (rng() < 0.55) pushGeo(frameGeos, 1.45, 1.5, 0.08, p.x + w / 5, b.y, p.z + d / 2 - 0.01, GATE_COLS[Math.floor(rng() * GATE_COLS.length)]);
        pushGeo(frameGeos, 0.07, 0.74, 0.74, p.x + w / 2 - 0.01, b.y + 1.25 + rng() * 0.5, p.z + (rng() - 0.5) * d * 0.4, WIN_COLS[Math.floor(rng() * WIN_COLS.length)]);
        if (rng() < 0.42) pushGeo(frameGeos, 0.44, 0.3, 0.32, p.x - w / 2 + 0.02, b.y + 2.05, p.z + (rng() - 0.5) * d * 0.4, "#c9cdd4");
        if (rng() < 0.3) {
          pushGeo(doorGeos, 0.03, 0.9, 0.03, p.x + w / 4, b.y + hh + 0.16, p.z - d / 5);
          pushGeo(doorGeos, 0.5, 0.03, 0.03, p.x + w / 4, b.y + hh + 0.82, p.z - d / 5);
        }
        // pontos para o emaranhado de fios + candidatos a letreiro/mural
        if (rng() < 0.5) anchors.push(new THREE.Vector3(p.x + (rng() < 0.5 ? -w / 2 : w / 2), b.y + hh + 0.25, p.z + (rng() - 0.5) * d));
        if (!isLaje && !isBrick && rng() < 0.16) signHouses.push({ x: p.x, z: p.z, w, d, y: b.y });
        else if (isBrick && rng() < 0.12) muralHouses.push({ x: p.x, z: p.z, w, d, y: b.y, hh });
        if (isLaje) {
          lajeHouses.push({ x: p.x, z: p.z, w, d, top: b.y + hh, y: b.y });
        }
      }
    }

    /* --- lajes acessíveis (parapeitos + escada externa + superfície) --- */
    let lajeEscada = 0;
    for (const L of lajeHouses) {
      this.addSurface({ minX: L.x - L.w / 2 + 0.1, maxX: L.x + L.w / 2 - 0.1, minZ: L.z - L.d / 2 + 0.1, maxZ: L.z + L.d / 2 - 0.1, top: L.top, roof: true });
      const ph = 0.46;
      const temEscada = lajeEscada < 8;
      const gxL = L.x + L.w / 2 - 0.8; // posição da escada externa
      const edges: [number, number, number, number][] = [
        [L.x, L.z - L.d / 2 + 0.08, L.w, 0.16],
        [L.x - L.w / 2 + 0.08, L.z, 0.16, L.d],
        [L.x + L.w / 2 - 0.08, L.z, 0.16, L.d],
      ];
      if (temEscada) {
        // mureta frontal com vão para entrar da escada
        const zF = L.z + L.d / 2 - 0.08;
        const gapL = gxL - 0.68, gapR = gxL + 0.68;
        const leftW = gapL - (L.x - L.w / 2);
        const rightW = L.x + L.w / 2 - gapR;
        if (leftW > 0.25) edges.push([L.x - L.w / 2 + leftW / 2, zF, leftW, 0.16]);
        if (rightW > 0.25) edges.push([gapR + rightW / 2, zF, rightW, 0.16]);
      } else {
        edges.push([L.x, L.z + L.d / 2 - 0.08, L.w, 0.16]);
      }
      for (const [ex, ez, ew, ed] of edges) {
        pushGeo(roofGeos, ew, ph, ed, ex, L.top, ez);
        this.addCollider({ minX: ex - ew / 2, maxX: ex + ew / 2, minZ: ez - ed / 2, maxZ: ez + ed / 2, top: L.top + ph, bottom: L.top - 0.1 });
      }
      // caixa d'água em metade delas
      if (lajeEscada % 2 === 0) {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.7, 10), new THREE.MeshLambertMaterial({ color: 0x2f6db8 }));
        tank.position.set(L.x - L.w / 4, L.top + 0.35, L.z - L.d / 4);
        tank.castShadow = true;
        this.scene.add(tank);
        this.addCollider({ minX: tank.position.x - 0.5, maxX: tank.position.x + 0.5, minZ: tank.position.z - 0.5, maxZ: tank.position.z + 0.5, top: L.top + 0.7, bottom: L.top });
      }
      // laje em obra eterna: pilha de tijolos + ferragens espetadas
      if (lajeEscada % 3 === 0) {
        for (let rr = 0; rr < 3; rr++)
          for (let cc = 0; cc < 3 - rr; cc++)
            pushGeo(brickGeos, 0.36, 0.17, 0.22, L.x - L.w / 4 + cc * 0.38 + rr * 0.19, L.top + rr * 0.17, L.z + L.d / 5);
      }
      for (let rb = 0; rb < 4; rb++)
        pushGeo(frameGeos, 0.022, 0.5 + (rb % 3) * 0.25, 0.022, L.x + L.w / 3 + (rb % 2) * 0.16, L.top + 0.16, L.z - L.d / 3 + Math.floor(rb / 2) * 0.16, "#7a4a2e");
      // escada externa em algumas lajes
      if (lajeEscada < 8) {
        const steps = Math.round((L.top - L.y) / 0.27);
        const sz = L.z + L.d / 2 - 0.18;
        for (let k = 1; k <= steps; k++) {
          const zc = sz + (steps - k) * 0.4 + 0.2;
          const top = L.y + k * 0.27;
          pushGeo(darkGeos, 1.15, 0.07, 0.42, L.x + L.w / 2 - 0.8, top - 0.07, zc);
          this.addSurface({ minX: L.x + L.w / 2 - 1.35, maxX: L.x + L.w / 2 - 0.25, minZ: zc - 0.21, maxZ: zc + 0.21, top });
        }
      }
      lajeEscada++;
    }

    /* --- merge das geometrias estáticas --- */
    const buildMerged = (geos: THREE.BufferGeometry[], mat: THREE.Material) => {
      if (!geos.length) return;
      const geo = mergeGeometries(geos);
      if (!geo) return;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
    };
    const houseMat = new THREE.MeshLambertMaterial({
      vertexColors: true, map: wallTex.map,
      emissiveMap: wallTex.emissiveMap, emissive: 0xffc766, emissiveIntensity: 0.55,
    });
    buildMerged(houseGeos, houseMat);
    buildMerged(roofGeos, roofMat);
    buildMerged(concreteGeos, concrete);
    buildMerged(darkGeos, concreteDark);
    buildMerged(metalGeos, new THREE.MeshLambertMaterial({ color: 0x413d4a }));

    /* --- mercadinho --- */
    {
      const mx = -10, mz = 47, my = BANDS[0].y;
      const mat = new THREE.MeshLambertMaterial({ color: 0xf2e9d8, map: wallTex.map, emissiveMap: wallTex.emissiveMap, emissive: 0xffc766, emissiveIntensity: 0.55 });
      this.box(6.4, 3.4, 5, mat, mx, my, mz);
      this.addCollider({ minX: mx - 3.2, maxX: mx + 3.2, minZ: mz - 2.5, maxZ: mz + 2.5, top: my + 3.4, bottom: my - 0.2 });
      this.addFlatRect(mx - 5, mx + 5, mz - 5.5, mz + 4);
      this.box(6.7, 0.18, 5.3, roofMat, mx, my + 3.4, mz, false);
      // toldo listrado
      const awnC = document.createElement("canvas"); awnC.width = 128; awnC.height = 32;
      const ax = awnC.getContext("2d")!;
      for (let i = 0; i < 8; i++) { ax.fillStyle = i % 2 ? "#e84c3d" : "#f7efdd"; ax.fillRect(i * 16, 0, 16, 32); }
      const awnTex = new THREE.CanvasTexture(awnC); awnTex.colorSpace = THREE.SRGBColorSpace;
      const awn = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 1.7), new THREE.MeshLambertMaterial({ map: awnTex, side: THREE.DoubleSide }));
      awn.position.set(mx, my + 2.6, mz - 3.1); awn.rotation.x = -Math.PI / 2 + 0.42;
      awn.castShadow = true;
      this.scene.add(awn);
      // placa
      const s = this.makeSign("MERCADINHO DO ZÉ", "#173f2a", "#ffd23f");
      this.signRedraws.push(s.redraw);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.25), new THREE.MeshBasicMaterial({ map: s.tex, transparent: true }));
      sign.position.set(mx, my + 4.3, mz - 2.2);
      this.scene.add(sign);
      // bancas de fruta na frente
      const fruitCols = [0xf2a541, 0xe85d75, 0x7bc950];
      for (let i = 0; i < 3; i++) {
        this.box(1.1, 0.7, 0.7, new THREE.MeshLambertMaterial({ color: 0x8a5a33 }), mx - 2.2 + i * 2.2, my, mz - 3.7);
        this.addCollider({ minX: mx - 2.75 + i * 2.2, maxX: mx - 1.65 + i * 2.2, minZ: mz - 4.05, maxZ: mz - 3.35, top: my + 0.7, bottom: my });
        for (let f = 0; f < 4; f++) {
          const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.11, 7, 6), new THREE.MeshLambertMaterial({ color: fruitCols[i] }));
          fruit.position.set(mx - 2.5 + i * 2.2 + (f % 2) * 0.55, my + 0.8, mz - 3.85 + Math.floor(f / 2) * 0.3);
          this.scene.add(fruit);
        }
      }
      this.zones.push({ x: mx, z: mz - 4.9, y: my, kind: "mercado" });
      // marker no chão
      this.addGroundMarker(mx, mz - 4.9, my, 0x3ddc84);
    }

    /* --- esconderijo do receptador --- */
    {
      const rx = 26, rz = -27, ry = BANDS[3].y;
      const mat = new THREE.MeshLambertMaterial({ color: 0x3a3547, map: wallTex.map, emissiveMap: wallTex.emissiveMap, emissive: 0x8f5bd0, emissiveIntensity: 0.3 });
      this.box(5.6, 3.2, 4.6, mat, rx, ry, rz);
      this.addCollider({ minX: rx - 2.8, maxX: rx + 2.8, minZ: rz - 2.3, maxZ: rz + 2.3, top: ry + 3.2, bottom: ry - 0.2 });
      this.box(5.9, 0.18, 4.9, roofMat, rx, ry + 3.2, rz, false);
      const s = this.makeSign("RECEPTADOR", "#1a0f22", "#ff4fd8");
      this.signRedraws.push(s.redraw);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.05), new THREE.MeshBasicMaterial({ map: s.tex, transparent: true }));
      sign.position.set(rx, ry + 4, rz - 2);
      this.scene.add(sign);
      // pilha de caixotes e barril
      const crateMat = new THREE.MeshLambertMaterial({ color: 0x9a6b35 });
      this.box(0.9, 0.9, 0.9, crateMat, rx + 2, ry, rz - 3);
      this.box(0.8, 0.8, 0.8, crateMat, rx + 2.9, ry, rz - 2.5);
      this.box(0.7, 0.7, 0.7, crateMat, rx + 2.4, ry + 0.9, rz - 2.8);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.95, 10), new THREE.MeshLambertMaterial({ color: 0x3f7fbf }));
      barrel.position.set(rx - 2.4, ry + 0.48, rz - 2.9); barrel.castShadow = true;
      this.scene.add(barrel);
      this.addCollider({ minX: rx + 1.4, maxX: rx + 3.4, minZ: rz - 3.6, maxZ: rz - 2, top: ry + 1.7, bottom: ry });
      this.zones.push({ x: rx, z: rz - 3.4, y: ry, kind: "receptador" });
      this.addGroundMarker(rx, rz - 3.4, ry, 0xff4fd8);
    }

    /* --- mocados (pontos de plantio no chão) --- */
    for (const s of SPOTS) {
      this.addGroundMarker(s.x, s.z, s.y, 0x3ddc84, 1.5);
      this.addFlatCircle(s.x, s.z, 2.4);
    }

    /* --- postes de luz na rua --- */
    const glowC = document.createElement("canvas"); glowC.width = glowC.height = 64;
    const gx = glowC.getContext("2d")!;
    const gg = gx.createRadialGradient(32, 32, 2, 32, 32, 30);
    gg.addColorStop(0, "rgba(255,220,140,0.9)");
    gg.addColorStop(1, "rgba(255,200,100,0)");
    gx.fillStyle = gg; gx.fillRect(0, 0, 64, 64);
    const glowTex = new THREE.CanvasTexture(glowC);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x33303a });
    const wireMat = new THREE.MeshLambertMaterial({ color: 0x1c1a20 });
    const poleTops: THREE.Vector3[] = [];
    const poleZ = 37.3; // calçada da rua (fora da rampa)
    for (const px of [-45, -15, 15, 45]) {
      const by = BANDS[0].y;
      // base larga do poste
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.27, 0.3, 10), poleMat);
      base.position.set(px, by + 0.15, poleZ); base.castShadow = true; this.scene.add(base);
      // haste cônica (grossa embaixo, fina em cima)
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 3.4, 8), poleMat);
      pole.position.set(px, by + 2.0, poleZ); pole.castShadow = true; this.scene.add(pole);
      // braço inclinado no topo segurando a luminária sobre a rua
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.85, 6), poleMat);
      arm.position.set(px, by + 3.72, poleZ + 0.36); arm.rotation.x = Math.PI / 2 - 0.28; this.scene.add(arm);
      // luminária: cúpula + lâmpada brilhante + halo
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.17, 10, 1, true), new THREE.MeshLambertMaterial({ color: 0x3a3742, side: THREE.DoubleSide }));
      shade.position.set(px, by + 3.82, poleZ + 0.66); shade.castShadow = true; this.scene.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe0a0 }));
      bulb.position.set(px, by + 3.72, poleZ + 0.66); this.scene.add(bulb);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.position.copy(bulb.position); glow.scale.setScalar(2.0); this.scene.add(glow);
      poleTops.push(new THREE.Vector3(px, by + 3.95, poleZ));
    }
    // emaranhado de fios — a assinatura visual da favela carioca
    const wire = (a: THREE.Vector3, b: THREE.Vector3, sag: number) => {
      const mid = a.clone().lerp(b, 0.5); mid.y -= sag;
      wireGeos.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 10, 0.018, 4));
    };
    // feixes paralelos entre postes, em alturas e barrigas diferentes
    for (let i = 0; i < poleTops.length - 1; i++) {
      for (let j = 0; j < 3; j++) {
        const a = poleTops[i].clone(); a.y -= j * 0.22; a.x += (j - 1) * 0.07;
        const b = poleTops[i + 1].clone(); b.y -= j * 0.18; b.x += (j - 1) * 0.07;
        wire(a, b, 0.45 + j * 0.38);
      }
    }
    // gambiarras: descidas dos postes para os telhados e travessias entre casas
    for (let i = 0; i < Math.min(anchors.length, 24); i++) {
      const a = anchors[i];
      const pole = poleTops[i % poleTops.length];
      const dPole = a.distanceTo(pole);
      if (dPole < 70) wire(pole, a, dPole * 0.06 + 0.5);
      const b = anchors[(i * 7 + 3) % anchors.length];
      if (b !== a && a.distanceTo(b) < 24) wire(a, b, a.distanceTo(b) * 0.09 + 0.4);
    }

    /* --- merge dos detalhes (tijolo, portas, portões, tinta, fios) --- */
    buildMerged(brickGeos, brickMat);
    buildMerged(doorGeos, doorMat);
    buildMerged(frameGeos, frameMat);
    buildMerged(paintGeos, paintMat);
    buildMerged(wireGeos, wireMat);

    /* --- letreiros pintados à mão nas fachadas --- */
    const SIGN_DATA: [string, string, string][] = [
      ["BAR DO BIGODE", "#173f2a", "#ffd23f"],
      ["SALÃO DA NEGA", "#471033", "#ff4fd8"],
      ["AÇAÍ DO MORRO", "#241a4a", "#7ef29a"],
      ["PADARIA PAO QUENTE", "#6e2410", "#f4d35e"],
      ["LAN HOUSE", "#0e2836", "#4d9de0"],
      ["DEPOSITAO 2 IRMAOS", "#3a3547", "#f2a541"],
    ];
    signHouses.slice(0, 6).forEach((hs, i) => {
      const [txt, bg, fg] = SIGN_DATA[i % SIGN_DATA.length];
      const s = this.makeSign(txt, bg, fg, 512, 104);
      this.signRedraws.push(s.redraw);
      const wS = Math.min(hs.w - 0.5, 3.6);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(wS, wS * 0.2), new THREE.MeshBasicMaterial({ map: s.tex, transparent: true }));
      sign.position.set(hs.x, hs.y + 2.35, hs.z + hs.d / 2 + 0.05);
      this.scene.add(sign);
    });

    /* --- murais de grafite nos becos --- */
    muralHouses.slice(0, 4).forEach((hm) => {
      const mH = Math.min(hm.hh - 0.5, 2.3);
      const mural = new THREE.Mesh(new THREE.PlaneGeometry(hm.d - 0.5, mH), new THREE.MeshLambertMaterial({ map: this.texGraffiti() }));
      mural.position.set(hm.x - hm.w / 2 - 0.06, hm.y + mH / 2 + 0.1, hm.z);
      mural.rotation.y = -Math.PI / 2;
      this.scene.add(mural);
    });

    /* --- palmeiras nas bordas do morro --- */
    const palmTrunks: THREE.BufferGeometry[] = [];
    const palmLeaves: THREE.BufferGeometry[] = [];
    const mkPalm = (ppx: number, ppz: number, ph: number, lean: number) => {
      const py = this.terrainH(ppx, ppz);
      const trunk = new THREE.CylinderGeometry(0.08, 0.17, ph, 6);
      trunk.translate(0, ph / 2, 0);
      trunk.rotateZ(lean);
      trunk.translate(ppx, py, ppz);
      palmTrunks.push(trunk);
      const tx = ppx + Math.sin(lean) * ph, ty = py + Math.cos(lean) * ph;
      for (let fr = 0; fr < 7; fr++) {
        const a = (fr / 7) * Math.PI * 2;
        const leaf = new THREE.PlaneGeometry(1.6, 0.34);
        leaf.translate(0.8, 0, 0);
        leaf.rotateZ(-0.42 - (fr % 2) * 0.14);
        leaf.rotateY(a);
        leaf.translate(tx, ty, ppz);
        palmLeaves.push(leaf);
      }
      const coco = new THREE.SphereGeometry(0.13, 6, 5);
      coco.translate(tx, ty - 0.18, ppz);
      palmTrunks.push(coco);
    };
    for (const [ppx, ppz, ph, ln] of [
      [-56, -50, 5.2, 0.12], [55, -47, 4.4, -0.16], [-57, 3, 5.6, 0.1],
      [56, -6, 4.8, -0.1], [-52, 25, 4.2, 0.14], [50, 15, 5.0, -0.12],
    ] as [number, number, number, number][]) mkPalm(ppx, ppz, ph, ln);
    buildMerged(palmTrunks, new THREE.MeshLambertMaterial({ color: 0x6e4a2e }));
    buildMerged(palmLeaves, new THREE.MeshLambertMaterial({ color: 0x3f8f3a, side: THREE.DoubleSide }));

    /* --- cidade aos pés do morro, na beira da baía --- */
    const cityGeos: THREE.BufferGeometry[] = [];
    const CITY_COLS = ["#8f8a94", "#a89e92", "#7c7680", "#97a0a8", "#b0a48e", "#6f6a76"];
    for (let cx = -80; cx <= 80; cx += 8.5) {
      pushGeo(cityGeos, 4 + rng() * 3.4, 3 + rng() * 9, 4 + rng() * 3.4, cx + (rng() - 0.5) * 3, -0.5, 68 + rng() * 26, CITY_COLS[Math.floor(rng() * CITY_COLS.length)]);
    }
    pushGeo(cityGeos, 5.5, 17, 5.5, -34, -0.5, 86, "#b3ac9e");
    pushGeo(cityGeos, 4.5, 21, 4.5, 18, -0.5, 92, "#9aa3ab");
    buildMerged(cityGeos, new THREE.MeshLambertMaterial({
      vertexColors: true, map: wallTex.map, emissiveMap: wallTex.emissiveMap,
      emissive: 0xffc766, emissiveIntensity: 0.7,
    }));

    /* --- varais com roupas --- */
    const clothCols = [0xe85d75, 0xf4d35e, 0x4d9de0, 0xf2f2f2, 0x7bc950, 0xe15b9b];
    for (let v = 0; v < 6; v++) {
      const b = BANDS[Math.floor(rng() * BANDS.length)];
      const x1 = -40 + rng() * 80, z1 = b.z0 + 3 + rng() * (b.z1 - b.z0 - 6);
      const x2 = x1 + 5 + rng() * 3, z2 = z1 + (rng() - 0.5) * 2;
      const y = b.y + 2.6;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pts.push(new THREE.Vector3(
          x1 + (x2 - x1) * t, y - Math.sin(t * Math.PI) * 0.5, z1 + (z2 - z1) * t
        ));
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xd8d2c2 })
      );
      this.scene.add(line);
      for (let i = 1; i < 6; i++) {
        const p = pts[Math.min(pts.length - 1, Math.floor(i * 1.6))];
        const cloth = new THREE.Mesh(
          new THREE.PlaneGeometry(0.55, 0.75),
          new THREE.MeshLambertMaterial({ color: clothCols[(v + i) % clothCols.length], side: THREE.DoubleSide })
        );
        cloth.position.set(p.x, p.y - 0.4, p.z);
        cloth.rotation.y = rng() * Math.PI;
        cloth.castShadow = true;
        this.scene.add(cloth);
      }
    }

    /* --- NPCs (moradores) --- */
    const skins = [0xc98a5b, 0x8a5a3b, 0xe0a878, 0x6e4326];
    const shirts = [0xe85d75, 0x4d9de0, 0xf4d35e, 0xf2f2f2, 0x7bc950];
    for (let i = 0; i < 6; i++) {
      const b = BANDS[i % 4];
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.85, 8), new THREE.MeshLambertMaterial({ color: shirts[i % shirts.length] }));
      body.position.y = 0.78; body.castShadow = true; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 8), new THREE.MeshLambertMaterial({ color: skins[i % skins.length] }));
      head.position.y = 1.38; head.castShadow = true; g.add(head);
      const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.42, 8), new THREE.MeshLambertMaterial({ color: 0x33415e }));
      legs.position.y = 0.21; g.add(legs);
      const x0 = -30 + rng() * 60;
      g.position.set(x0, b.y, (b.z0 + b.z1) / 2 + (rng() - 0.5) * 3);
      this.scene.add(g);
      this.npcs.push({ g, x: x0, z: g.position.z, y: b.y, dir: rng() < 0.5 ? -1 : 1, sp: 0.9 + rng() * 0.8, ph: rng() * 9, range: 12 + rng() * 16 });
    }

    /* --- pássaros --- */
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const wingMat = new THREE.MeshBasicMaterial({ color: 0x22242e, side: THREE.DoubleSide });
      const wl = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.24), wingMat);
      const wr = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.24), wingMat);
      wl.position.x = -0.4; wr.position.x = 0.4;
      g.add(wl); g.add(wr);
      g.position.set(0, 26 + i * 3, -10);
      this.scene.add(g);
      this.birds.push({ g, wingL: wl, wingR: wr, a: (i / 4) * Math.PI * 2, r: 24 + i * 6, h: 24 + i * 3.5, sp: 0.25 + i * 0.06 });
    }

    // terreno orgânico por último (usa as zonas planas registradas acima)
    this.buildTerrain();

    // redesenha placas quando a fonte display carregar
    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (this.disposed) return;
        this.signRedraws.forEach((r) => r());
      });
    }
  }

  /* ---------------- terreno orgânico (malha) ---------------- */

  private buildTerrain() {
    const SIZE = 132, SEG = 148;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const cLow = new THREE.Color("#cfa06e");  // areia/terra clara (baixada)
    const cMid = new THREE.Color("#b18154");  // terra média
    const cSteep = new THREE.Color("#7c6046"); // encosta íngreme / rocha
    const cGrass = new THREE.Color("#8fa75c"); // vegetação rala
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.terrainH(x, z);
      pos.setY(i, h);
      const hx = this.terrainH(x + 0.7, z) - h;
      const hz = this.terrainH(x, z + 0.7) - h;
      const slope = Math.hypot(hx, hz) / 0.7;
      tmp.copy(cLow).lerp(cMid, THREE.MathUtils.smoothstep(h, 0, 12));
      tmp.lerp(cSteep, THREE.MathUtils.smoothstep(slope, 0.28, 0.95) * 0.85);
      const g = THREE.MathUtils.smoothstep(this.n2(x * 1.9, z * 1.9), 0.45, 1.3);
      tmp.lerp(cGrass, g * 0.3 * (1 - THREE.MathUtils.smoothstep(slope, 0.2, 0.6)));
      const v = 0.93 + 0.14 * Math.abs(this.n2(x * 3.7, z * 3.1));
      colors[i * 3] = tmp.r * v; colors[i * 3 + 1] = tmp.g * v; colors[i * 3 + 2] = tmp.b * v;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    // base de terra sob a malha (esconde a parte de baixo da colina)
    const base = new THREE.Mesh(new THREE.BoxGeometry(175, 9, 175), new THREE.MeshLambertMaterial({ color: 0x57452f }));
    base.position.set(0, -7, 0);
    base.receiveShadow = true;
    this.scene.add(base);
  }

  private addGroundMarker(x: number, z: number, y: number, color: number, radius = 1.1) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.62, radius, 26),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y + 0.03, z);
    this.scene.add(m);
    this.spotMeshes.push(m);
  }

  /* ---------------- jogador ---------------- */

  private buildPlayer() {
    const skin = new THREE.MeshLambertMaterial({ color: 0xd99a6c });
    const shirt = new THREE.MeshLambertMaterial({ color: 0xf2efe4 });
    const pants = new THREE.MeshLambertMaterial({ color: 0x2c3e6b });
    const shoeM = new THREE.MeshLambertMaterial({ color: 0x26242c });
    const capMat = new THREE.MeshLambertMaterial({ color: 0xe8452e });

    // membro em cápsula com pivô na junta — corpo arredondado, sem blocos
    const limb = (r: number, len: number, mat: THREE.Material): THREE.Mesh => {
      const g = new THREE.CapsuleGeometry(r, len, 4, 12);
      g.translate(0, -(len / 2 + r), 0); // junta (topo) na origem, membro pende
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      return m;
    };
    const ball = (r: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat);
      m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
    };

    // pernas (pivô no quadril) + tênis
    this.legL = limb(0.11, 0.58, pants); this.legL.position.set(-0.13, 0.92, 0); this.player.add(this.legL);
    this.legR = limb(0.11, 0.58, pants); this.legR.position.set(0.13, 0.92, 0); this.player.add(this.legR);
    ball(0.1, shoeM, 0, -0.66, 0.06, this.legL);
    ball(0.1, shoeM, 0, -0.66, 0.06, this.legR);

    // quadril + tronco: cápsulas que se fundem num corpo inteiriço
    const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.12, 4, 12), pants);
    pelvis.position.y = 0.95; pelvis.castShadow = true; this.player.add(pelvis);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, 0.42, 4, 12), shirt);
    torso.position.y = 1.19; torso.castShadow = true; this.player.add(torso);

    // ombros + braços (pivô no ombro) + mãos
    ball(0.1, shirt, -0.27, 1.42, 0, this.player);
    ball(0.1, shirt, 0.27, 1.42, 0, this.player);
    this.armL = limb(0.075, 0.4, shirt); this.armL.position.set(-0.3, 1.42, 0); this.player.add(this.armL);
    this.armR = limb(0.075, 0.4, shirt); this.armR.position.set(0.3, 1.42, 0); this.player.add(this.armR);
    ball(0.07, skin, 0, -0.5, 0, this.armL);
    ball(0.07, skin, 0, -0.5, 0, this.armR);

    // pescoço + cabeça + boné
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.1, 10), skin);
    neck.position.y = 1.5; this.player.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), skin);
    head.position.y = 1.64; head.scale.set(1, 1.06, 1); head.castShadow = true; this.player.add(head);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.09, 14), capMat);
    cap.position.y = 1.77; cap.castShadow = true; this.player.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.2), capMat);
    brim.position.set(0, 1.74, 0.2); this.player.add(brim);

    this.player.position.copy(this.pPos);
    this.scene.add(this.player);

    const target = this.pPos.clone().add(new THREE.Vector3(0, 1.5, 0));
    this.camSmooth.copy(target).add(new THREE.Vector3(Math.sin(this.camYaw), Math.sin(this.camPitch), Math.cos(this.camYaw)).multiplyScalar(CAM_DIST));
    this.camera.position.copy(this.camSmooth);
    this.camera.lookAt(target);
  }

  /* ---------------- input ---------------- */

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Space") { e.preventDefault(); if (!e.repeat) this.pressJump(); return; }
    switch (e.code) {
      case "KeyW": case "ArrowUp": this.keys.f = true; break;
      case "KeyS": case "ArrowDown": this.keys.b = true; break;
      case "KeyA": case "ArrowLeft": this.keys.l = true; break;
      case "KeyD": case "ArrowRight": this.keys.r = true; break;
      case "KeyE": case "Enter": if (!e.repeat) this.pressAction(); break;
      case "KeyP": if (!e.repeat) this.togglePause(); break;
      case "KeyM": if (!e.repeat) this.toggleMute(); break;
      case "Escape":
        if (!e.repeat) {
          if (this.shop) this.closeShop();
          else this.togglePause();
        }
        break;
      case "Digit1": if (this.shop) this.buyItem(this.shop === "mercado" ? "vaso" : "semente"); break;
      case "Digit2": if (this.shop) this.buyItem(this.shop === "mercado" ? "terra" : "sell"); break;
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    switch (e.code) {
      case "KeyW": case "ArrowUp": this.keys.f = false; break;
      case "KeyS": case "ArrowDown": this.keys.b = false; break;
      case "KeyA": case "ArrowLeft": this.keys.l = false; break;
      case "KeyD": case "ArrowRight": this.keys.r = false; break;
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.screen !== "playing") return;
    this.dragging = true;
    this.lastPX = e.clientX; this.lastPY = e.clientY;
    this.canvas.setPointerCapture(e.pointerId);
  };
  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging || this.screen !== "playing") return;
    const dx = e.clientX - this.lastPX, dy = e.clientY - this.lastPY;
    this.lastPX = e.clientX; this.lastPY = e.clientY;
    this.camYaw -= dx * 0.0052;
    this.camPitch = clamp(this.camPitch + dy * 0.0042, -0.3, 1.05);
  };
  private onPointerUp = (e: PointerEvent) => {
    this.dragging = false;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  };
  private onResize = () => this.resize();
  private onBlur = () => { if (this.screen === "playing") this.pause(); };
  private onCtx = (e: Event) => e.preventDefault();

  private bindEvents() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("blur", this.onBlur);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("contextmenu", this.onCtx);
  }

  private resize() {
    const host = this.canvas.parentElement;
    const w = (host ? host.clientWidth : 0) || this.canvas.clientWidth || window.innerWidth;
    const h = (host ? host.clientHeight : 0) || this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------- API pública (HUD React) ---------------- */

  start() {
    this.sfx.ensure();
    this.screen = "playing";
    this.emitHud(true);
  }
  pause() { if (this.screen === "playing") { this.screen = "paused"; this.emitHud(true); } }
  resume() { this.sfx.ensure(); if (this.screen === "paused") { this.screen = "playing"; this.emitHud(true); } }
  togglePause() { if (this.screen === "playing") this.pause(); else if (this.screen === "paused") this.resume(); }
  continueAfterWin() { this.screen = "playing"; this.emitHud(true); }

  restart() {
    for (const p of this.plants) {
      this.scene.remove(p.group);
      p.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    this.plants = [];
    this.money = PRICES.inicial;
    this.inv = { vasos: 0, terra: 0, sementes: 0, pacotes: 0 };
    this.simTime = 0; this.harvested = 0; this.sold = 0;
    this.wonOnce = false; this.shop = null;
    this.pPos.set(-4, 0, 42); this.vel.set(0, 0, 0);
    this.player.position.copy(this.pPos);
    this.camYaw = 0; this.camPitch = 0.32;
    this.screen = "playing";
    this.toast("Bora de novo! Morro te espera.");
    this.emitHud(true);
  }

  setJoystick(x: number, y: number) { this.joy.x = x; this.joy.y = y; }
  pressJump() {
    if (this.screen !== "playing") return;
    this.jumpBuffer = 0.14;
  }
  pressAction() {
    if (this.screen !== "playing" || this.shop) return;
    this.doAction();
  }
  toggleMute() {
    this.sfx.setMuted(!this.sfx.muted);
    this.emitHud(true);
  }
  closeShop() { this.shop = null; this.sfx.uiClose(); this.emitHud(true); }

  buyItem(item: "vaso" | "terra" | "semente" | "sell") {
    if (!this.shop) return;
    if (item === "sell") { this.sellPacotes(); return; }
    const price = PRICES[item];
    if (this.money < price) {
      this.sfx.buyFail();
      this.toast("Dinheiro insuficiente!");
      return;
    }
    this.money -= price;
    if (item === "vaso") this.inv.vasos++;
    if (item === "terra") this.inv.terra++;
    if (item === "semente") this.inv.sementes++;
    this.sfx.buyOk();
    const at = this.pPos.clone(); at.y += 1;
    this.particles.burst(at, 0xffd23f, 14, 2.2, 2);
    this.floatText(`-${fmtBRL(price)}`, at, true);
    this.emitHud(true);
  }

  sellPacotes() {
    if (this.inv.pacotes <= 0) { this.sfx.buyFail(); this.toast("Sem pacotes pra vender!"); return; }
    const total = this.inv.pacotes * PRICES.venda;
    this.sold += this.inv.pacotes;
    this.money += total;
    this.inv.pacotes = 0;
    this.sfx.sell();
    const at = this.pPos.clone(); at.y += 1.4;
    this.particles.burst(at, 0x3ddc84, 34, 3.6, 3.4);
    this.floatText(`+${fmtBRL(total)}`, at, false);
    this.checkWin();
    this.emitHud(true);
  }

  private checkWin() {
    if (!this.wonOnce && this.money >= PRICES.meta) {
      this.wonOnce = true;
      this.screen = "win";
      this.sfx.win();
      this.emitHud(true);
    }
  }

  private toast(text: string) {
    this.toastSeq++;
    this.toastNow = { id: this.toastSeq, text };
    this.emitHud(true);
  }

  /* ---------------- ações / interação ---------------- */

  private nearestPlant(): { p: Plant; d: number } | null {
    let best: Plant | null = null, bd = 2.1;
    for (const p of this.plants) {
      const d = Math.hypot(p.x - this.pPos.x, p.z - this.pPos.z);
      if (d < bd && Math.abs(p.baseY - this.pPos.y) < 1.6) { best = p; bd = d; }
    }
    return best ? { p: best, d: bd } : null;
  }

  private groundUnder(): Surface | null {
    let best: Surface | null = null, bt = -Infinity;
    for (const s of this.surfaces) {
      if (this.pPos.x >= s.minX && this.pPos.x <= s.maxX && this.pPos.z >= s.minZ && this.pPos.z <= s.maxZ) {
        if (s.top <= this.pPos.y + STEP_TOL && s.top > bt) { best = s; bt = s.top; }
      }
    }
    return best;
  }

  private atPlantSpot(): boolean {
    const g = this.groundUnder();
    if (g?.roof) return true;
    for (const s of SPOTS) {
      if (Math.abs(s.y - this.pPos.y) < 1 && Math.hypot(s.x - this.pPos.x, s.z - this.pPos.z) < 1.9) return true;
    }
    return false;
  }

  private doAction() {
    // 1) colher
    const np = this.nearestPlant();
    if (np && np.p.stage >= 3) { this.harvestPlant(np.p); return; }
    // 2) lojas
    for (const zn of this.zones) {
      if (Math.hypot(zn.x - this.pPos.x, zn.z - this.pPos.z) < 2.7 && Math.abs(zn.y - this.pPos.y) < 1.8) {
        this.shop = zn.kind;
        this.sfx.uiOpen();
        this.emitHud(true);
        return;
      }
    }
    // 3) plantar
    if (this.atPlantSpot()) {
      if (this.inv.vasos > 0 && this.inv.terra > 0 && this.inv.sementes > 0) this.plantSeed();
      else { this.sfx.buyFail(); this.toast("Faltam insumos: vaso + terra + semente"); }
    }
  }

  private plantSeed() {
    const g = this.groundUnder();
    const y = g ? g.top : this.pPos.y;
    // evita plantar colado em outra planta
    for (const p of this.plants) if (Math.hypot(p.x - this.pPos.x, p.z - this.pPos.z) < 1.1) {
      this.toast("Já tem planta mocada aqui!"); return;
    }
    this.inv.vasos--; this.inv.terra--; this.inv.sementes--;
    const plant = this.createPlant(this.pPos.x, this.pPos.z, y);
    this.plants.push(plant);
    this.sfx.plant();
    const at = new THREE.Vector3(this.pPos.x, y + 0.6, this.pPos.z);
    this.particles.burst(at, 0x9a6b35, 16, 2, 2);
    this.toast(g?.roof ? "Planta mocada na laje!" : "Planta mocada no beco!");
    this.emitHud(true);
  }

  private harvestPlant(p: Plant) {
    this.scene.remove(p.group);
    p.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    this.plants = this.plants.filter((q) => q !== p);
    this.inv.pacotes++;
    this.harvested++;
    this.sfx.harvest();
    const at = new THREE.Vector3(p.x, p.baseY + 1, p.z);
    this.particles.burst(at, 0x7ef29a, 30, 3.2, 3);
    this.particles.burst(at, 0xffd23f, 10, 2.4, 2.4);
    this.floatText("+1 PACOTE", at, false);
    this.emitHud(true);
  }

  /* ---------------- plantas (visuais procedurais) ---------------- */

  private createPlant(x: number, z: number, y: number): Plant {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    this.scene.add(group);

    // barra de progresso flutuante
    const bar = new THREE.Group();
    const barBg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.76, 0.1),
      new THREE.MeshBasicMaterial({ color: 0x101117, transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide })
    );
    bar.add(barBg);
    const fillGeo = new THREE.PlaneGeometry(0.68, 0.055);
    fillGeo.translate(0.34, 0, 0);
    const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: 0x3ddc84, depthWrite: false, side: THREE.DoubleSide }));
    fill.position.x = -0.34;
    bar.add(fill);
    bar.position.y = 1.25;
    group.add(bar);

    const marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.14),
      new THREE.MeshBasicMaterial({ color: 0xffd23f })
    );
    marker.position.y = 1.7;
    marker.visible = false;
    group.add(marker);

    const plant: Plant = { group, x, z, baseY: y, planted: this.simTime, stage: 0, bar, fill, marker, mats: [] };
    this.buildPlantStage(plant, 1);
    return plant;
  }

  private buildPlantStage(p: Plant, stage: number) {
    // limpa vegetação antiga (mantém barra e marcador, que são filhos 0..2 do grupo)
    const keep = new Set<THREE.Object3D>([p.bar!, p.marker!]);
    for (const child of [...p.group.children]) {
      if (keep.has(child)) continue;
      p.group.remove(child);
      child.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    }
    p.mats = [];
    const potMat = new THREE.MeshLambertMaterial({ color: 0xc1663a });
    const dirtMat = new THREE.MeshLambertMaterial({ color: 0x3a2a1c });
    const stemMat = new THREE.MeshLambertMaterial({ color: 0x3f7d33 });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x4fae3f });
    const budMat = new THREE.MeshLambertMaterial({ color: 0xb6ff5c, emissive: 0x5aa82a, emissiveIntensity: 0.9 });
    p.mats.push(potMat, stemMat, leafMat, budMat);

    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.21, 0.32, 10), potMat);
    pot.position.y = 0.16; pot.castShadow = true; p.group.add(pot);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.06, 10), potMat);
    rim.position.y = 0.32; p.group.add(rim);
    const dirt = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 10), dirtMat);
    dirt.position.y = 0.32; p.group.add(dirt);

    const leafGeo = new THREE.ConeGeometry(0.11, 0.34, 5);
    leafGeo.translate(0, 0.17, 0);

    if (stage >= 1) {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.3, 6), stemMat);
      stem.position.y = 0.48; stem.castShadow = true; p.group.add(stem);
      for (const s of [-1, 1]) {
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        leaf.position.set(s * 0.03, 0.52, 0);
        leaf.rotation.z = s * 1.1; leaf.rotation.y = s * 0.6;
        leaf.scale.setScalar(0.8);
        p.group.add(leaf);
      }
    }
    if (stage >= 2) {
      const stem2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.5, 6), stemMat);
      stem2.position.y = 0.62; stem2.castShadow = true; p.group.add(stem2);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        leaf.position.set(Math.cos(a) * 0.05, 0.62 + (i % 3) * 0.16, Math.sin(a) * 0.05);
        leaf.rotation.z = Math.cos(a) * 1.2;
        leaf.rotation.x = -Math.sin(a) * 1.2;
        leaf.scale.setScalar(1.15);
        leaf.castShadow = true;
        p.group.add(leaf);
      }
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), leafMat);
      bush.position.y = 0.95; bush.scale.y = 1.25; bush.castShadow = true; p.group.add(bush);
    }
    if (stage >= 3) {
      for (const [bx, by, bz, s] of [
        [0, 1.12, 0, 0.26], [0.18, 0.9, 0.1, 0.18], [-0.17, 0.94, -0.08, 0.17], [0.05, 1.3, -0.05, 0.16],
      ] as const) {
        const b = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), leafMat);
        b.position.set(bx, by, bz); b.castShadow = true; p.group.add(b);
      }
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const bud = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), i % 2 ? budMat : new THREE.MeshLambertMaterial({ color: 0xff8a4f, emissive: 0xc25a1e, emissiveIntensity: 0.85 }));
        bud.position.set(Math.cos(a) * 0.2, 1.05 + (i % 3) * 0.13, Math.sin(a) * 0.2);
        p.group.add(bud);
      }
    }
    p.stage = stage;
  }

  private updatePlants(dt: number) {
    const t = this.simTime;
    for (const p of this.plants) {
      const age = t - p.planted;
      const stage = age >= GROW_T2 ? 3 : age >= GROW_T1 ? 2 : 1;
      if (stage !== p.stage) this.buildPlantStage(p, stage);
      const ready = stage >= 3;
      if (p.bar) p.bar.visible = !ready;
      if (p.fill && !ready) {
        const pct = clamp(age / GROW_T2, 0, 1);
        p.fill.scale.x = Math.max(0.001, pct);
      }
      if (p.marker) {
        p.marker.visible = ready;
        if (ready) {
          p.marker.position.y = 1.75 + Math.sin(t * 3.2 + p.x) * 0.1;
          p.marker.rotation.y += dt * 2.4;
        }
      }
      if (p.bar) p.bar.quaternion.copy(this.camera.quaternion);
      // pulsa o brilho na flora
      if (ready && p.mats[3]) {
        p.mats[3].emissiveIntensity = 0.75 + Math.sin(t * 4 + p.z) * 0.35;
      }
    }
  }

  /* ---------------- terreno orgânico (colina suave) ---------------- */

  private addFlatRect(x0: number, x1: number, z0: number, z1: number) {
    this.flatRects.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
  }
  private addFlatCircle(x: number, z: number, r: number) { this.flatCircles.push({ x, z, r }); }

  // ruído suave (soma de senos) — ondulações orgânicas da encosta
  private n2(x: number, z: number): number {
    return (
      Math.sin(x * 0.31 + 1.7) * Math.sin(z * 0.27 + 0.5) +
      0.5 * Math.sin(x * 0.83 - 2.1) * Math.sin(z * 0.91 + 3.4) +
      0.25 * Math.sin(x * 1.7 + 4.2) * Math.sin(z * 1.9 - 1.3)
    );
  }

  // 0 perto de áreas construídas (plano), 1 longe (ruído cheio)
  private flattenMask(x: number, z: number): number {
    let d = 1e9;
    for (const r of this.flatRects) {
      const dx = Math.max(r.x0 - x, 0, x - r.x1);
      const dz = Math.max(r.z0 - z, 0, z - r.z1);
      const dd = Math.hypot(dx, dz);
      if (dd < d) d = dd;
      if (d === 0) return 0;
    }
    for (const c of this.flatCircles) {
      const dd = Math.max(0, Math.hypot(x - c.x, z - c.z) - c.r);
      if (dd < d) d = dd;
      if (d === 0) return 0;
    }
    return THREE.MathUtils.smoothstep(d, 0, 2.4);
  }

  // altura da colina: patamares ligados por rampas suaves + ondulação orgânica
  private terrainH(x: number, z: number): number {
    let y = BANDS[0].y;
    for (let i = 0; i < BANDS.length - 1; i++) {
      const zb = BANDS[i].z0, yHigh = BANDS[i + 1].y;
      if (z < zb - RAMP_W) y = yHigh;
      else if (z < zb + RAMP_W) {
        const t = (zb + RAMP_W - z) / (2 * RAMP_W);
        y += (yHigh - y) * THREE.MathUtils.smoothstep(t, 0, 1);
        break;
      }
    }
    const edge = Math.max(Math.max(0, Math.abs(x) - 58) / 4, Math.max(0, Math.abs(z) - 58) / 4);
    if (edge > 0) y -= edge * edge * 5;
    y += this.n2(x, z) * 0.3 * this.flattenMask(x, z);
    return y;
  }

  // chão combinado (terreno + superfícies planas) que sustenta o jogador
  private groundAt(x: number, z: number, y: number, tol: number): number {
    const t = this.terrainH(x, z);
    const best = t <= y + tol ? t : -Infinity;
    return Math.max(best, this.sampleGround(x, z, y, tol));
  }

  // rampa suave demais? (bloqueia paredões íngremes)
  private canWalk(x: number, z: number): boolean {
    return this.terrainH(x, z) <= this.pPos.y + MAX_CLIMB;
  }

  /* ---------------- física do jogador ---------------- */

  private sampleGround(x: number, z: number, y: number, tol: number): number {
    let best = -Infinity;
    for (const s of this.surfaces) {
      if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) {
        if (s.top <= y + tol && s.top > best) best = s.top;
      }
    }
    return best;
  }

  private collides(x: number, z: number, y: number): boolean {
    for (const c of this.colliders) {
      if (c.top <= y + STEP_TOL) continue;       // degrau baixo: sobe automaticamente
      if (c.bottom >= y + PLAYER_H - 0.1) continue; // passa por baixo (túnel)
      if (x + PLAYER_R > c.minX && x - PLAYER_R < c.maxX &&
          z + PLAYER_R > c.minZ && z - PLAYER_R < c.maxZ) return true;
    }
    return false;
  }

  private updatePlayer(dt: number) {
    // --- vetor de entrada ---
    let ix = (this.keys.r ? 1 : 0) - (this.keys.l ? 1 : 0) + this.joy.x;
    let iy = (this.keys.f ? 1 : 0) - (this.keys.b ? 1 : 0) + this.joy.y;
    const len = Math.hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }
    const hasInput = len > 0.08;

    const f = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    const r = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const tvx = (f.x * iy + r.x * ix) * SPEED;
    const tvz = (f.z * iy + r.z * ix) * SPEED;
    this.vel.x = damp(this.vel.x, tvx, 13, dt);
    this.vel.z = damp(this.vel.z, tvz, 13, dt);

    // --- movimento horizontal com sliding + limite de rampa (eixo por eixo) ---
    const nx = this.pPos.x + this.vel.x * dt;
    if (!this.collides(nx, this.pPos.z, this.pPos.y) && this.canWalk(nx, this.pPos.z)) this.pPos.x = nx;
    else this.vel.x = 0;
    const nz = this.pPos.z + this.vel.z * dt;
    if (!this.collides(this.pPos.x, nz, this.pPos.y) && this.canWalk(this.pPos.x, nz)) this.pPos.z = nz;
    else this.vel.z = 0;

    this.pPos.x = clamp(this.pPos.x, -59, 59);
    this.pPos.z = clamp(this.pPos.z, -59, 59);

    // --- gravidade + chão (terreno orgânico + superfícies planas) ---
    const groundTop = this.groundAt(this.pPos.x, this.pPos.z, this.pPos.y, STEP_TOL);
    const hadVel = this.vel.y;
    this.vel.y -= GRAV * dt;
    this.vel.y = Math.max(this.vel.y, -32);
    this.pPos.y += this.vel.y * dt;

    const wasGrounded = this.grounded;
    if (this.vel.y <= 0 && groundTop !== -Infinity && this.pPos.y <= groundTop) {
      this.pPos.y = groundTop;
      this.vel.y = 0;
      if (!wasGrounded && hadVel < -9) this.sfx.land();
      this.grounded = true;
      this.coyote = 0.12;
    } else {
      this.grounded = false;
      this.coyote -= dt;
    }

    // --- pulo com buffer (instantâneo) ---
    if (this.jumpBuffer > 0) {
      this.jumpBuffer -= dt;
      if (this.grounded || this.coyote > 0) {
        this.vel.y = JUMP_V;
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
        this.sfx.jump();
        this.particles.burst(new THREE.Vector3(this.pPos.x, this.pPos.y + 0.1, this.pPos.z), 0xd8cfae, 8, 1.6, 1.2);
      }
    }

    // caiu do morro -> respawn
    if (this.pPos.y < -10) {
      this.pPos.set(-4, 2, 42);
      this.vel.set(0, 0, 0);
      this.toast("Você caiu da laje! Respawn na rua.");
    }

    // --- mesh do jogador ---
    this.player.position.copy(this.pPos);
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (hSpeed > 0.6) {
      const targetYaw = Math.atan2(this.vel.x, this.vel.z);
      let dy = targetYaw - this.faceYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.faceYaw += dy * Math.min(1, 14 * dt);
      this.player.rotation.y = this.faceYaw;
      this.walkPhase += dt * (6 + hSpeed * 1.4);
      const sw = Math.sin(this.walkPhase) * 0.62;
      this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
      this.armL.rotation.x = -sw * 0.7; this.armR.rotation.x = sw * 0.7;
      this.stepTimer -= dt;
      if (this.grounded && this.stepTimer <= 0) { this.sfx.step(); this.stepTimer = 0.32; }
    } else {
      this.legL.rotation.x = damp(this.legL.rotation.x, 0, 12, dt);
      this.legR.rotation.x = damp(this.legR.rotation.x, 0, 12, dt);
      this.armL.rotation.x = damp(this.armL.rotation.x, 0, 12, dt);
      this.armR.rotation.x = damp(this.armR.rotation.x, 0, 12, dt);
    }

    // --- câmera orbital (3ª pessoa) ---
    const target = this.pPos.clone().add(new THREE.Vector3(0, 1.5, 0));
    const cp = Math.cos(this.camPitch);
    const desired = new THREE.Vector3(
      target.x + Math.sin(this.camYaw) * cp * CAM_DIST,
      target.y + Math.sin(this.camPitch) * CAM_DIST + 0.4,
      target.z + Math.cos(this.camYaw) * cp * CAM_DIST
    );
    const floorY = this.groundAt(desired.x, desired.z, 500, 0);
    if (floorY !== -Infinity) desired.y = Math.max(desired.y, floorY + 0.5);
    this.camSmooth.lerp(desired, 1 - Math.exp(-14 * dt));
    this.camera.position.copy(this.camSmooth);
    this.camera.lookAt(target);
  }

  /* ---------------- prompt contextual ---------------- */

  private updatePrompt() {
    let next: { text: string; actionable: boolean } | null = null;
    if (this.shop) next = null;
    else {
      const np = this.nearestPlant();
      if (np && np.p.stage >= 3) next = { text: "Colher planta", actionable: true };
      else {
        let zone: Zone | null = null;
        for (const zn of this.zones) {
          if (Math.hypot(zn.x - this.pPos.x, zn.z - this.pPos.z) < 2.7 && Math.abs(zn.y - this.pPos.y) < 1.8) { zone = zn; break; }
        }
        if (zone) next = { text: zone.kind === "mercado" ? "Abrir Mercadinho" : "Abrir Esconderijo", actionable: true };
        else if (np) {
          const pct = Math.round(clamp((this.simTime - np.p.planted) / GROW_T2, 0, 1) * 100);
          next = { text: `Crescendo... ${pct}%`, actionable: false };
        } else if (this.atPlantSpot()) {
          const ok = this.inv.vasos > 0 && this.inv.terra > 0 && this.inv.sementes > 0;
          next = ok
            ? { text: "Plantar no mocado", actionable: true }
            : { text: "Mocado — faltam insumos", actionable: false };
        }
      }
    }
    const a = this.promptNow, b = next;
    if ((a?.text ?? "") !== (b?.text ?? "") || (a?.actionable ?? false) !== (b?.actionable ?? false)) {
      this.promptNow = next;
      this.emitHud(true);
    }
  }

  /* ---------------- mundo vivo ---------------- */

  private updateWorld(dt: number, t: number) {
    for (const n of this.npcs) {
      n.x += n.dir * n.sp * dt;
      if (Math.abs(n.x) > n.range) { n.dir *= -1; }
      n.y = this.terrainH(n.x, n.z); // acompanha a encosta orgânica
      n.g.position.x = n.x;
      n.g.position.y = n.y + Math.abs(Math.sin(t * 6 + n.ph)) * 0.05;
      n.g.rotation.y = n.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    for (const b of this.birds) {
      b.a += b.sp * dt;
      b.g.position.set(Math.cos(b.a) * b.r, b.h + Math.sin(b.a * 2) * 2, -12 + Math.sin(b.a) * b.r * 0.6);
      const flap = Math.sin(t * 11 + b.r) * 0.7;
      b.wingL.rotation.y = flap; b.wingR.rotation.y = -flap;
    }
    for (let i = 0; i < this.spotMeshes.length; i++) {
      const m = this.spotMeshes[i];
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.5 + Math.sin(t * 2.6 + i) * 0.3;
      m.rotation.z += dt * 0.6;
    }
  }

  /* ---------------- HUD / float text ---------------- */

  private emitHud(force = false) {
    const data: HudData = {
      screen: this.screen,
      money: this.money,
      meta: PRICES.meta,
      inv: { ...this.inv },
      prompt: this.promptNow,
      toast: this.toastNow,
      shop: this.shop,
      muted: this.sfx.muted,
      growing: this.plants.filter((p) => p.stage < 3).length,
      ready: this.plants.filter((p) => p.stage >= 3).length,
      stats: { time: Math.floor(this.simTime), harvested: this.harvested, sold: this.sold },
    };
    const j = JSON.stringify(data);
    if (!force && j === this.hudJson) return;
    this.hudJson = j;
    this.onHud(data);
  }

  private floatText(text: string, worldPos: THREE.Vector3, bad: boolean) {
    const v = worldPos.clone().project(this.camera);
    if (v.z > 1) return;
    const x = (v.x * 0.5 + 0.5) * this.canvas.clientWidth;
    const y = (-v.y * 0.5 + 0.5) * this.canvas.clientHeight;
    const el = document.createElement("div");
    el.className = `float-money ${bad ? "float-bad text-rojo-500" : "text-grana-400"}`;
    el.style.cssText = `position:absolute;left:${x}px;top:${y}px;font-family:var(--font-display);font-size:26px;letter-spacing:0.06em;pointer-events:none;white-space:nowrap;`;
    el.textContent = text;
    this.floatLayer.appendChild(el);
    window.setTimeout(() => el.remove(), 1300);
  }

  /* ---------------- radar ---------------- */

  private drawMinimap() {
    const cv = this.minimap;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const S = cv.width;
    const scale = S / 124;
    const mx = (x: number) => (x + 62) * scale;
    const mz = (z: number) => (z + 62) * scale;

    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = "#0c0d12";
    ctx.fillRect(0, 0, S, S);

    // platôs (mais alto = mais claro)
    const shades = ["#232633", "#2a2e3d", "#333849", "#3c4257", "#464d66"];
    for (let i = 0; i < BANDS.length; i++) {
      const b = BANDS[i];
      ctx.fillStyle = shades[i];
      ctx.fillRect(mx(-60), mz(b.z0), 124 * scale, (b.z1 - b.z0) * scale);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.strokeRect(mx(-60), mz(b.z0), 124 * scale, (b.z1 - b.z0) * scale);
    }
    // escadas
    ctx.fillStyle = "#8b8fa3";
    for (const st of STAIRS) for (const gx of st.xs) {
      ctx.fillRect(mx(gx - 1.2), mz(BANDS[st.band].z0 - 2.4), 2.4 * scale, 4.8 * scale);
    }
    // mar (borda inferior)
    ctx.fillStyle = "#1d5a77";
    ctx.fillRect(0, mz(60), S, S - mz(60));

    // mocados
    ctx.fillStyle = "rgba(61,220,132,0.35)";
    for (const s of SPOTS) {
      ctx.beginPath();
      ctx.arc(mx(s.x), mz(s.z), 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // plantas
    const t = performance.now() / 1000;
    for (const p of this.plants) {
      ctx.fillStyle = p.stage >= 3
        ? `rgba(255,210,63,${0.6 + Math.sin(t * 5) * 0.4})`
        : "rgba(126,242,154,0.85)";
      ctx.beginPath();
      ctx.arc(mx(p.x), mz(p.z), p.stage >= 3 ? 3 : 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // lojas
    ctx.fillStyle = "#3ddc84";
    ctx.fillRect(mx(-10) - 3.4, mz(47) - 3.4, 6.8, 6.8);
    ctx.fillStyle = "#ff4fd8";
    ctx.fillRect(mx(26) - 3.4, mz(-27) - 3.4, 6.8, 6.8);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1;
    ctx.strokeRect(mx(-10) - 3.4, mz(47) - 3.4, 6.8, 6.8);
    ctx.strokeRect(mx(26) - 3.4, mz(-27) - 3.4, 6.8, 6.8);

    // jogador (triângulo orientado pela câmera)
    const px = mx(this.pPos.x), pz = mz(this.pPos.z);
    const fx = -Math.sin(this.camYaw), fz = -Math.cos(this.camYaw);
    const ang = Math.atan2(fx, -fz);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(ang);
    ctx.fillStyle = "#ffd23f";
    ctx.strokeStyle = "#101117";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.4, 5);
    ctx.lineTo(0, 2.6);
    ctx.lineTo(-4.4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "rgba(244,241,232,0.75)";
    ctx.font = "700 11px Rubik, sans-serif";
    ctx.fillText("N", 6, 14);
  }

  /* ---------------- loop ---------------- */

  private tick(tms: number) {
    if (this.disposed) return;
    const t = tms / 1000;
    const dt = clamp(t - this.lastT, 0.0001, 0.05);
    this.lastT = t;

    if (this.screen === "playing") {
      this.simTime += dt;
      this.updatePlayer(dt);
      this.updatePlants(dt);
      this.updatePrompt();
      this.hudTimer -= dt;
      if (this.hudTimer <= 0) { this.emitHud(); this.hudTimer = 0.1; }
    }
    this.updateWorld(dt, t);
    this.particles.update(dt);
    this.drawMinimap();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("contextmenu", this.onCtx);
    cancelAnimationFrame(this.raf);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    this.renderer.dispose();
    this.canvas.remove();
  }
}

export { fmtBRL };
