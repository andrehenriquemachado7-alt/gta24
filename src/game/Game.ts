/* ============================================================
   QUINTAL 3D — Game (orquestrador)
   Renderer next-gen (PCFSoftShadowMap + ACES + sol 2048²),
   arquitetura pronta p/ EffectComposer (bloom via dynamic import),
   loop, input, partículas, radar e ponte de HUD.
   ============================================================ */
import * as THREE from "three";
import { Sfx } from "./audio";
import { Physics } from "./physics";
import { OrbitCam } from "./camera";
import { Player } from "./player";
import { Economy } from "./economy";
import { WorldGenerator } from "./world";
import { validateWorld } from "./validate";
import { DebugRig } from "./debug";
import { makeGlowTex } from "./textures";
import { PRICES, clamp, fmtBRL, BANDS, FARM, FEIRA_POS, RECEPT_POS } from "./constants";
import type { HudData, ScreenState, ToastInfo } from "./types";

export interface GameOptions {
  container: HTMLDivElement;
  minimap: HTMLCanvasElement;
  floatLayer: HTMLDivElement;
  onHud: (h: HudData) => void;
}

interface ParticleSys {
  points: THREE.Points;
  vel: Float32Array;
  life: number;
  max: number;
}

export class QuintalGame {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private physics = new Physics();
  private sfx = new Sfx();
  private world: WorldGenerator;
  private player: Player;
  private cam: OrbitCam;
  private economy: Economy;
  private debug: DebugRig;
  private glowTex = makeGlowTex();

  private screen: ScreenState = "start";
  private toastNow: ToastInfo | null = null;
  private toastId = 0;
  private hudTimer = 0;
  private raf = 0;
  private lastT = 0;
  private keys = new Set<string>();
  private joy = { x: 0, z: 0 };
  private dragging = false;
  private lastPX = 0;
  private lastPY = 0;
  private particles: ParticleSys[] = [];
  private raycaster = new THREE.Raycaster();
  private disposed = false;

  /* post-processing (dinâmico — não pesa o bundle se desligado) */
  private composer: { render(): void; setSize(w: number, h: number): void } | null = null;
  fx = false;

  private canvas: HTMLCanvasElement;
  private radarCanvas: HTMLCanvasElement;
  private floatLayer: HTMLDivElement;
  private onHud: (h: HudData) => void;
  private playTime = 0;

  constructor(opts: GameOptions) {
    this.onHud = opts.onHud;
    this.radarCanvas = opts.minimap;
    this.floatLayer = opts.floatLayer;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "game-canvas";
    opts.container.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(66, 1, 0.1, 900);
    this.scene.fog = new THREE.Fog(0x9a5a6a, 130, 430);

    this.buildLights();

    this.world = new WorldGenerator(this.scene, this.physics);
    this.world.build();
    validateWorld(this.physics, this.world);

    this.player = new Player(this.scene);
    this.player.onLand = () => this.sfx.land();
    this.cam = new OrbitCam(this.camera, this.physics);

    this.economy = new Economy(this.scene, this.physics, {
      sfx: this.sfx,
      burst: (p, c, n) => this.burst(p, c, n),
      toast: (t) => this.toast(t),
      float: (t) => this.spawnFloat(t),
      glowTex: this.glowTex,
      onWin: () => { this.screen = "win"; this.emitHud(true); },
    });

    this.debug = new DebugRig(this.scene, this.physics, this.player);
    this.debug.mount();

    this.bindEvents();
    this.resize();
    this.emitHud(true);
    this.raf = requestAnimationFrame(this.tick);
  }

  /* ---------------- luz: sol de alta resolução + fill frio ---------------- */
  private buildLights() {
    const sun = new THREE.DirectionalLight(0xffd9a8, 2.45);
    sun.position.set(-70, 95, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -95;
    sun.shadow.camera.right = 95;
    sun.shadow.camera.top = 95;
    sun.shadow.camera.bottom = -95;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 320;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
    this.scene.add(sun);
    this.scene.add(sun.target);
    sun.target.position.set(0, 0, 10);

    this.scene.add(new THREE.HemisphereLight(0x8f7ba8, 0x574436, 0.95));
    const fill = new THREE.DirectionalLight(0x6a7fb0, 0.5);
    fill.position.set(60, 40, -80);
    this.scene.add(fill);
    // rim quente de fim de tarde vindo do alto do morro: recorta silhuetas = profundidade
    const rim = new THREE.DirectionalLight(0xff9a5e, 0.42);
    rim.position.set(50, 30, -115);
    this.scene.add(rim);
  }

  /* ---------------- post-processing (Bloom pronto p/ o futuro) ---------------- */
  async enablePostFX() {
    if (this.composer) { this.fx = true; this.emitHud(true); return; }
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
        import("three/examples/jsm/postprocessing/EffectComposer.js"),
        import("three/examples/jsm/postprocessing/RenderPass.js"),
        import("three/examples/jsm/postprocessing/UnrealBloomPass.js"),
        import("three/examples/jsm/postprocessing/OutputPass.js"),
      ]);
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.7, 0.85));
      composer.addPass(new OutputPass());
      this.composer = composer;
      this.fx = true;
      this.toast("Bloom ativado (G p/ alternar)");
    } catch {
      this.toast("Pós-processamento indisponível aqui");
    }
    this.emitHud(true);
  }
  toggleFx() {
    if (!this.composer) { void this.enablePostFX(); return; }
    this.fx = !this.fx;
    this.toast(this.fx ? "Bloom ativado" : "Bloom desligado");
    this.emitHud(true);
  }

  /* ---------------- eventos ---------------- */
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat && this.screen === "playing") this.player.pressJump();
    }
    this.keys.add(e.code);
    switch (e.code) {
      case "KeyP": if (!e.repeat) this.togglePause(); break;
      case "KeyM": if (!e.repeat) { this.sfx.toggleMute(); this.emitHud(true); } break;
      case "KeyC":
      case "F3":
        if (!e.repeat) {
          if (e.code === "F3") e.preventDefault();
          this.debug.toggle();
          this.toast(this.debug.visible ? "DEBUG: colisores visíveis (C/F3 p/ sair)" : "DEBUG desligado");
          this.emitHud(true);
        }
        break;
      case "KeyG": if (!e.repeat) this.toggleFx(); break;
      case "KeyE": if (!e.repeat) this.handleAction(); break;
      case "Enter": if (!e.repeat && this.screen === "start") this.start(); break;
      case "Digit1":
        if (!e.repeat && this.screen === "playing" && this.economy.shop) {
          this.economy.buy(this.economy.shop === "mercado" ? "vaso" : "semente");
          this.emitHud(true);
        }
        break;
      case "Digit2":
        if (!e.repeat && this.screen === "playing" && this.economy.shop) {
          if (this.economy.shop === "mercado") this.economy.buy("terra");
          else this.economy.sellAll();
          this.emitHud(true);
        }
        break;
      case "Escape":
        if (!e.repeat) {
          if (this.economy.shop) this.economy.closeShop();
          else this.togglePause();
          this.emitHud(true);
        }
        break;
    }
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onResize = () => this.resize();
  private onBlur = () => { this.keys.clear(); };
  private onCtx = (e: Event) => e.preventDefault();

  private onPointerDown = (e: PointerEvent) => {
    this.dragging = true;
    this.lastPX = e.clientX;
    this.lastPY = e.clientY;
  };
  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.cam.drag(e.clientX - this.lastPX, e.clientY - this.lastPY);
    this.lastPX = e.clientX;
    this.lastPY = e.clientY;
  };
  private onPointerUp = () => { this.dragging = false; };

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
    this.composer?.setSize(w, h);
  }

  /* ---------------- API pública (HUD React) ---------------- */
  start() {
    this.sfx.unlock();
    this.screen = "playing";
    this.playTime = 0;
    this.player.reset();
    this.economy.reset();
    this.emitHud(true);
  }
  resume() { this.screen = "playing"; this.emitHud(true); }
  togglePause() {
    if (this.screen === "playing") this.screen = "paused";
    else if (this.screen === "paused") this.screen = "playing";
    this.emitHud(true);
  }
  restart() {
    this.player.reset();
    this.economy.reset();
    this.playTime = 0;
    this.screen = "playing";
    this.emitHud(true);
  }
  continueAfterWin() { this.screen = "playing"; this.emitHud(true); }
  setJoystick(x: number, z: number) { this.joy.x = x; this.joy.z = z; }
  pressJump() { if (this.screen === "playing") this.player.pressJump(); }
  pressAction() { this.handleAction(); }
  buyItem(id: string) { this.economy.buy(id); this.emitHud(true); }
  sellAll() { this.economy.sellAll(); this.emitHud(true); }
  sellPacotes() { this.sellAll(); }
  closeShop() { this.economy.closeShop(); this.emitHud(true); }
  toggleMute() { this.sfx.toggleMute(); this.emitHud(true); }
  toggleDebug() {
    this.debug.toggle();
    this.toast(this.debug.visible ? "DEBUG: colisores visíveis (C p/ sair)" : "DEBUG desligado");
    this.emitHud(true);
  }

  private handleAction() {
    if (this.screen !== "playing") return;
    if (this.economy.shop) return;
    this.cam.screenCenterRay(this.raycaster);
    this.economy.trackPlayer(this.player.pos.x, this.player.pos.z);
    this.economy.tryInteract(this.player.pos, { origin: this.raycaster.ray.origin, dir: this.raycaster.ray.direction });
    this.emitHud(true);
  }

  private toast(text: string) {
    this.toastNow = { text, id: ++this.toastId };
    this.emitHud(true);
  }

  /* ---------------- partículas ---------------- */
  private burst(p: THREE.Vector3, color: number, n: number) {
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      vel[i * 3] = (Math.random() - 0.5) * 4;
      vel[i * 3 + 1] = 2 + Math.random() * 4;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.12, transparent: true, opacity: 1 }));
    this.scene.add(points);
    this.particles.push({ points, vel, life: 0, max: 0.9 });
  }
  private updateParticles(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const ps = this.particles[i];
      ps.life += dt;
      if (ps.life >= ps.max) {
        this.scene.remove(ps.points);
        ps.points.geometry.dispose();
        (ps.points.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      const attr = ps.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let j = 0; j < attr.count; j++) {
        ps.vel[j * 3 + 1] -= 9 * dt;
        attr.setXYZ(j, attr.getX(j) + ps.vel[j * 3] * dt, attr.getY(j) + ps.vel[j * 3 + 1] * dt, attr.getZ(j) + ps.vel[j * 3 + 2] * dt);
      }
      attr.needsUpdate = true;
      (ps.points.material as THREE.PointsMaterial).opacity = 1 - ps.life / ps.max;
    }
  }

  /* ---------------- loop principal ---------------- */
  private tick = (tMs: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const t = tMs / 1000;
    const dt = clamp(t - (this.lastT || t - 0.016), 0.001, 0.05);
    this.lastT = t;

    const playing = this.screen === "playing";
    if (playing) {
      this.playTime += dt;
      // entrada
      let mx = this.joy.x, mz = this.joy.z;
      const kx = (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) - (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
      const kz = (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) - (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0);
      mx = clamp(mx + kx, -1, 1);
      mz = clamp(mz + kz, -1, 1);
      this.player.setMove(mx, mz);
      this.player.update(dt, this.physics, this.cam.yaw);
      this.economy.update(dt, t);
      this.world.update(dt, t);
    }
    this.cam.update(dt, this.player.pos);
    this.debug.update();
    this.updateParticles(playing ? dt : 0);

    // HUD (throttle 10 Hz)
    this.hudTimer += dt;
    if (this.hudTimer > 0.1) {
      this.hudTimer = 0;
      this.emitHud(false);
    }
    this.drawRadar();

    if (this.fx && this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  };

  /* ---------------- HUD ---------------- */
  private emitHud(force: boolean) {
    void force;
    const prompt = this.screen === "playing" ? this.economy.getPrompt(this.player.pos.x, this.player.pos.z) : null;
    const data: HudData = {
      screen: this.screen,
      money: this.economy.money,
      meta: PRICES.meta,
      inv: { ...this.economy.inv },
      prompt,
      toast: this.toastNow,
      shop: this.economy.shop,
      muted: this.sfx.muted,
      debug: this.debug.visible,
      fx: this.fx,
      growing: this.economy.growing,
      ready: this.economy.ready,
      stats: { ...this.economy.stats, time: Math.floor(this.playTime) },
    };
    this.onHud(data);
  }

  /* texto flutuante (+R$ / +pacotes) na camada HTML */
  private spawnFloat(text: string) {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText =
      "position:absolute;left:50%;top:38%;transform:translate(-50%,0);" +
      "font-family:\"Bebas Neue\",sans-serif;font-size:34px;letter-spacing:0.08em;" +
      "color:#3ddc84;text-shadow:0 2px 0 #101117, 0 0 18px rgba(61,220,132,0.5);pointer-events:none;z-index:5;";
    this.floatLayer.appendChild(el);
    el.animate(
      [
        { transform: "translate(-50%,0)", opacity: 1 },
        { transform: "translate(-50%,-70px)", opacity: 0 },
      ],
      { duration: 1200, easing: "cubic-bezier(0.2,0.7,0.3,1)" }
    ).onfinish = () => el.remove();
  }

  /* ---------------- radar ---------------- */
  private drawRadar() {
    const cv = this.radarCanvas;
    if (!cv || this.screen === "start") return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const S = cv.width;
    const scale = S / 150;
    const mx = (x: number) => S / 2 + x * scale;
    const mz = (z: number) => S / 2 - z * scale;

    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = "rgba(13,14,20,0.92)";
    ctx.fillRect(0, 0, S, S);

    // patamares do morro
    ctx.fillStyle = "rgba(122,110,140,0.16)";
    for (const b of BANDS) {
      ctx.fillRect(mx(-58), mz(b.z1), 116 * scale, (b.z1 - b.z0) * scale);
    }
    // fazenda
    ctx.fillStyle = "rgba(111,143,78,0.3)";
    ctx.fillRect(mx(FARM.x0), mz(FARM.z1), (FARM.x1 - FARM.x0) * scale, (FARM.z1 - FARM.z0) * scale);
    // rua
    ctx.fillStyle = "rgba(150,146,160,0.5)";
    ctx.fillRect(mx(-60), mz(46.5), 120 * scale, 9 * scale);
    // escadas reais
    ctx.fillStyle = "#8b8fa3";
    for (const st of this.world.stairActual) {
      ctx.fillRect(mx(st.x - 1.2), mz(BANDS[st.band].z0 - 2.4), 2.4 * scale, 4.8 * scale);
    }
    // mocós
    ctx.fillStyle = "#3ddc84";
    for (const sp of this.world.spots) {
      ctx.beginPath();
      ctx.arc(mx(sp.x), mz(sp.z), 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // feira (legal) e receptador (ilegal)
    ctx.fillStyle = "#7bc950";
    ctx.fillRect(mx(FEIRA_POS.x) - 3.4, mz(FEIRA_POS.z) - 3.4, 6.8, 6.8);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1;
    ctx.strokeRect(mx(FEIRA_POS.x) - 3.4, mz(FEIRA_POS.z) - 3.4, 6.8, 6.8);
    ctx.fillStyle = "#e8452e";
    ctx.fillRect(mx(RECEPT_POS.x) - 3.4, mz(RECEPT_POS.z) - 3.4, 6.8, 6.8);
    ctx.strokeRect(mx(RECEPT_POS.x) - 3.4, mz(RECEPT_POS.z) - 3.4, 6.8, 6.8);

    // jogador (triângulo orientado pela câmera)
    ctx.save();
    ctx.translate(mx(this.player.pos.x), mz(this.player.pos.z));
    ctx.rotate(-this.cam.yaw);
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.4, 5);
    ctx.lineTo(-4.4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("contextmenu", this.onCtx);
    this.canvas.remove();
    this.renderer.dispose();
  }
}

export { PRICES, fmtBRL };
