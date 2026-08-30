/* ============================================================
   QUINTAL 3D — WorldGenerator (Agente 1)
   Geração procedural: FAZENDA (polo legal) + rua + FAVELA (polo
   ilegal) com casas empilhadas, escadarias ancoradas nas paredes,
   lajes, fiação, NPCs com rota e terreno orgânico.
   Tudo mergeado em poucos draw calls (liso no mobile).
   ============================================================ */
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  BANDS, STAIRS, SPOTS, FARM, FEIRA_POS, RECEPT_POS,
  HOUSE_COLORS, GATE_COLS, WIN_COLS, PAINT, SIGN_DATA, mulberry32,
} from "./constants";
import * as TEX from "./textures";
import type { Physics } from "./physics";
import type { Spot, StairActual, NpcDef } from "./types";

export class WorldGenerator {
  stairActual: StairActual[] = [];
  spots: Spot[] = SPOTS;
  private npcs: NpcDef[] = [];
  private birds: { g: THREE.Group; wingL: THREE.Object3D; wingR: THREE.Object3D; a: number; r: number; h: number; sp: number }[] = [];
  private signRedraws: (() => void)[] = [];
  private rng = mulberry32(20240713);
  private glowTex: THREE.Texture;

  constructor(private scene: THREE.Scene, private physics: Physics) {
    this.glowTex = TEX.makeGlowTex();
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(() => this.signRedraws.forEach((r) => r())).catch(() => {});
    }
  }

  /* ============================================================ */
  build() {
    const rng = this.rng;
    const scene = this.scene;
    const physics = this.physics;

    /* ---------------- texturas / materiais PBR ---------------- */
    const wallTex = TEX.makeWallTex();
    const houseMat = new THREE.MeshStandardMaterial({
      vertexColors: true, map: wallTex.map,
      emissiveMap: wallTex.emissiveMap, emissive: 0xffc766, emissiveIntensity: 0.08,
      roughness: 0.92, metalness: 0.02,
    });
    const brickMat = new THREE.MeshStandardMaterial({ map: TEX.makeBrickTex(), roughness: 0.95, metalness: 0.02 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x6e4a3f, roughness: 0.9 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x9b958c, map: TEX.makeConcreteTex(), roughness: 0.95 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 1 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x241f28, roughness: 0.9 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x4a4e57, roughness: 0.5, metalness: 0.55 });
    const frameMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.2 });
    const paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x15131a });

    /* ---------------- helpers de geometria ---------------- */
    const houseGeos: THREE.BufferGeometry[] = [];
    const brickGeos: THREE.BufferGeometry[] = [];
    const roofGeos: THREE.BufferGeometry[] = [];
    const concreteGeos: THREE.BufferGeometry[] = [];
    const darkGeos: THREE.BufferGeometry[] = [];
    const metalGeos: THREE.BufferGeometry[] = [];
    const doorGeos: THREE.BufferGeometry[] = [];
    const frameGeos: THREE.BufferGeometry[] = [];
    const paintGeos: THREE.BufferGeometry[] = [];
    const wireGeos: THREE.BufferGeometry[] = [];
    const woodGeos: THREE.BufferGeometry[] = [];
    const greenGeos: THREE.BufferGeometry[] = [];

    const paintGeo = (g: THREE.BufferGeometry, hex: string) => {
      const c = new THREE.Color(hex);
      const cnt = g.attributes.position.count;
      const arr = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
      return g;
    };
    const pushGeo = (list: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, hex?: string) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y + h / 2, z);
      list.push(hex ? paintGeo(g, hex) : g);
    };
    const tubeGeo = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      const g = new THREE.CylinderGeometry(r, r, len, 6);
      g.translate(0, len / 2, 0);
      const m = new THREE.Matrix4().makeRotationFromQuaternion(
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
      );
      g.applyMatrix4(m);
      g.translate(a.x, a.y, a.z);
      return g;
    };
    const buildMerged = (geos: THREE.BufferGeometry[], mat: THREE.Material) => {
      if (!geos.length) return;
      const merged = mergeGeometries(geos, false);
      if (!merged) return;
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    };
    const addBox = (mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, shadows = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y + h / 2, z);
      m.castShadow = shadows;
      m.receiveShadow = true;
      scene.add(m);
      return m;
    };

    /* ================= CÉU, SOL E CARTÃO-POSTAL ================= */
    const skyGeo = new THREE.SphereGeometry(430, 24, 14);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color("#20275c") },
        mid: { value: new THREE.Color("#a3506f") },
        bot: { value: new THREE.Color("#f5a862") },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
        void main(){
          float h = normalize(vP).y;
          vec3 col = mix(bot, mid, smoothstep(-0.02, 0.22, h));
          col = mix(col, top, smoothstep(0.18, 0.62, h));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    scene.add(new THREE.Mesh(skyGeo, skyMat));

    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffdca0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    sun.position.set(60, 92, 330);
    sun.scale.setScalar(90);
    scene.add(sun);

    // mar da baía
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 330),
      new THREE.MeshStandardMaterial({ color: 0x2e4a6b, roughness: 0.32, metalness: 0.12 })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, -0.65, 240);
    scene.add(sea);
    const shallows = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 26),
      new THREE.MeshStandardMaterial({ color: 0x4a7a86, roughness: 0.4 })
    );
    shallows.rotation.x = -Math.PI / 2;
    shallows.position.set(0, -0.5, 86);
    scene.add(shallows);

    // Pão de Açúcar + Urca + bondinho
    const mtMat = new THREE.MeshStandardMaterial({ color: 0x3c2b55, roughness: 1 });
    const sugar = new THREE.Mesh(new THREE.SphereGeometry(30, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), mtMat);
    sugar.scale.set(1, 1.8, 1); sugar.position.set(-150, -2, 320); scene.add(sugar);
    const urca = new THREE.Mesh(new THREE.SphereGeometry(17, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), mtMat);
    urca.scale.set(1, 1.5, 1); urca.position.set(-92, -2, 305); scene.add(urca);
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-150, 50, 320), new THREE.Vector3(-92, 23, 305)]),
      new THREE.LineBasicMaterial({ color: 0x191428 })
    ));
    const cabinMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
    const cab1 = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.8, 2), cabinMat);
    cab1.position.set(-128, 39, 314); scene.add(cab1);
    const cab2 = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 1.8), cabinMat);
    cab2.position.set(-110, 30, 310); scene.add(cab2);
    // Corcovado + Cristo
    const corc = new THREE.Mesh(new THREE.ConeGeometry(24, 92, 8), mtMat);
    corc.position.set(160, -4, 295); scene.add(corc);
    const cristoMat = new THREE.MeshStandardMaterial({ color: 0xe9e5da, emissive: 0x9aa2b8, emissiveIntensity: 0.15, roughness: 0.8 });
    const bodyC = new THREE.Mesh(new THREE.BoxGeometry(1.6, 9, 1.6), cristoMat);
    bodyC.position.set(160, 92, 295); scene.add(bodyC);
    const armsC = new THREE.Mesh(new THREE.BoxGeometry(13, 1.4, 1.4), cristoMat);
    armsC.position.set(160, 94.5, 295); scene.add(armsC);
    const headC = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 8), cristoMat);
    headC.position.set(160, 97.4, 295); scene.add(headC);
    const s1 = new THREE.Mesh(new THREE.ConeGeometry(60, 55, 7), mtMat);
    s1.position.set(40, -4, 400); scene.add(s1);
    const s2 = new THREE.Mesh(new THREE.ConeGeometry(48, 40, 7), mtMat);
    s2.position.set(-240, -4, 380); scene.add(s2);

    // cidade na orla (janelas acesas)
    const cityGeos: THREE.BufferGeometry[] = [];
    const CITY_COLS = ["#8f8a94", "#a89e92", "#7c7680", "#97a0a8", "#b0a48e", "#6f6a76"];
    for (let cx = -80; cx <= 80; cx += 8.5) {
      pushGeo(cityGeos, 4 + rng() * 3.4, 3 + rng() * 9, 4 + rng() * 3.4, cx + (rng() - 0.5) * 3, -0.5, 84 + rng() * 26, CITY_COLS[Math.floor(rng() * CITY_COLS.length)]);
    }
    pushGeo(cityGeos, 5.5, 17, 5.5, -34, -0.5, 102, "#b3ac9e");
    pushGeo(cityGeos, 4.5, 21, 4.5, 18, -0.5, 108, "#9aa3ab");
    buildMerged(cityGeos, new THREE.MeshStandardMaterial({
      vertexColors: true, map: wallTex.map, emissiveMap: wallTex.emissiveMap,
      emissive: 0xffc766, emissiveIntensity: 0.4, roughness: 0.9,
    }));

    /* ================= RUA (divisor entre Fazenda e Favela) ================= */
    const road = addBox(
      new THREE.MeshStandardMaterial({ color: 0x9a949e, map: TEX.makeAsphaltTex(), roughness: 0.94 }),
      120, 0.06, 9, 0, 0, 42, false
    );
    road.name = "asfalto";
    physics.addRaycastTarget(road);
    physics.addFlatRect(-60, 60, 37.2, 46.8);
    pushGeo(concreteGeos, 120, 0.16, 0.34, 0, 0, 37.35);
    pushGeo(concreteGeos, 120, 0.16, 0.34, 0, 0, 46.65);

    /* ================= FAZENDA (polo legal) ================= */
    physics.addFlatRect(FARM.x0 - 2, FARM.x1 + 2, FARM.z0 - 2, FARM.z1 + 6);
    const farmGround = new THREE.Mesh(
      new THREE.PlaneGeometry(FARM.x1 - FARM.x0, FARM.z1 - FARM.z0),
      new THREE.MeshStandardMaterial({ map: TEX.makeFarmTex(), roughness: 1 })
    );
    farmGround.rotation.x = -Math.PI / 2;
    farmGround.position.set((FARM.x0 + FARM.x1) / 2, 0.035, (FARM.z0 + FARM.z1) / 2);
    farmGround.receiveShadow = true;
    farmGround.name = "fazenda";
    scene.add(farmGround);
    physics.addRaycastTarget(farmGround);

    // cerca de madeira no perímetro (vão de entrada na rua, x -14..-6)
    const GATE = { x0: -14, x1: -6 };
    const fenceSeg = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(2, Math.round(len / 2.6));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        pushGeo(woodGeos, 0.14, 1.15, 0.14, px, 0, pz, "#8a6a44");
      }
      for (const hy of [0.42, 0.92]) {
        const g = new THREE.BoxGeometry(len, 0.09, 0.06);
        g.rotateY(Math.atan2(bx - ax, bz - az) + Math.PI / 2);
        g.translate((ax + bx) / 2, hy, (az + bz) / 2);
        woodGeos.push(paintGeo(g, "#9c7a50"));
      }
      physics.addCollider({
        minX: Math.min(ax, bx) - 0.12, maxX: Math.max(ax, bx) + 0.12,
        minZ: Math.min(az, bz) - 0.12, maxZ: Math.max(az, bz) + 0.12,
        top: 1.15, bottom: -0.2,
      });
    };
    fenceSeg(FARM.x0, FARM.z0, GATE.x0, FARM.z0);
    fenceSeg(GATE.x1, FARM.z0, FARM.x1, FARM.z0);
    fenceSeg(FARM.x0, FARM.z0, FARM.x0, FARM.z1);
    fenceSeg(FARM.x1, FARM.z0, FARM.x1, FARM.z1);
    fenceSeg(FARM.x0, FARM.z1, FARM.x1, FARM.z1);

    // canteiros organizados (terra arada + mudas em fileiras)
    for (let bi2 = 0; bi2 < 6; bi2++) {
      const bx = -32 + (bi2 % 3) * 8.5, bz = 53 + Math.floor(bi2 / 3) * 7.5;
      pushGeo(woodGeos, 2.7, 0.32, 1.35, bx, 0, bz, "#7c5a36");
      pushGeo(darkGeos, 2.4, 0.3, 1.05, bx, 0.04, bz);
      for (let r = 0; r < 4; r++) {
        for (let cc = 0; cc < 3; cc++) {
          const g = new THREE.ConeGeometry(0.12, 0.3 + ((bi2 + r + cc) % 3) * 0.1, 5);
          g.translate(bx - 0.8 + cc * 0.8, 0.5 + ((bi2 + r) % 2) * 0.06, bz - 0.33 + r * 0.24);
          greenGeos.push(g);
        }
      }
    }

    // estufa (estrutura metálica + painéis translúcidos)
    {
      const gx = 22, gz = 63, gw = 8, gd = 6, gh = 3.1;
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        metalGeos.push(tubeGeo(new THREE.Vector3(gx + ox * gw / 2, 0, gz + oz * gd / 2), new THREE.Vector3(gx + ox * gw / 2, gh, gz + oz * gd / 2), 0.06));
      }
      for (const oz of [-gd / 2, 0, gd / 2]) {
        metalGeos.push(tubeGeo(new THREE.Vector3(gx - gw / 2, gh, gz + oz), new THREE.Vector3(gx + gw / 2, gh, gz + oz), 0.05));
      }
      const glass = new THREE.MeshStandardMaterial({ color: 0xdff2f5, transparent: true, opacity: 0.28, roughness: 0.15, metalness: 0, side: THREE.DoubleSide });
      const roofG = new THREE.Mesh(new THREE.BoxGeometry(gw, 0.05, gd), glass);
      roofG.position.set(gx, gh + 0.25, gz); roofG.rotation.z = 0.06; scene.add(roofG);
      for (const side of [-1, 1]) {
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), glass);
        pane.position.set(gx, gh / 2, gz + side * gd / 2);
        scene.add(pane);
      }
      for (let r = 0; r < 3; r++) {
        pushGeo(woodGeos, gw - 1, 0.3, 0.9, gx, 0, gz - 1.8 + r * 1.8, "#7c5a36");
        for (let cc = 0; cc < 6; cc++) {
          const g = new THREE.ConeGeometry(0.14, 0.42 + (cc % 3) * 0.12, 5);
          g.translate(gx - 2.6 + cc * 1.05, 0.55, gz - 1.8 + r * 1.8);
          greenGeos.push(g);
        }
      }
    }

    // barraca da FEIRA DO ZÉ (vende vasos e terra — polo legal)
    {
      const fx = FEIRA_POS.x, fz = FEIRA_POS.z;
      const tentMat = new THREE.MeshStandardMaterial({ map: TEX.makeTentTex("#c8452e", "#f2e3c8"), side: THREE.DoubleSide, roughness: 0.9 });
      for (const [ox, oz] of [[-1.9, -1.2], [1.9, -1.2], [-1.9, 1.2], [1.9, 1.2]] as const) {
        woodGeos.push(tubeGeo(new THREE.Vector3(fx + ox, 0, fz + oz), new THREE.Vector3(fx + ox, 2.5, fz + oz), 0.07));
      }
      const roofT = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.08, 3.2), tentMat);
      roofT.position.set(fx, 2.62, fz); roofT.rotation.z = 0.05; roofT.castShadow = true; scene.add(roofT);
      const counter = addBox(new THREE.MeshStandardMaterial({ color: 0x8a6a44, map: TEX.makeConcreteTex(), roughness: 0.9 }), 3.6, 1.0, 0.8, fx, 0, fz + 0.9);
      counter.name = "feira";
      physics.addCollider({ minX: fx - 1.8, maxX: fx + 1.8, minZ: fz + 0.5, maxZ: fz + 1.3, top: 1.0, bottom: -0.2 });
      // caixotes com frutas
      for (let i = 0; i < 3; i++) {
        pushGeo(woodGeos, 0.7, 0.5, 0.55, fx - 1.2 + i * 1.2, 1.0, fz + 0.9, "#a5824e");
        for (let f2 = 0; f2 < 4; f2++) {
          const fr = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5), new THREE.MeshStandardMaterial({ color: [0xe8452e, 0xf4d35e, 0x7bc950][i % 3], roughness: 0.6 }));
          fr.position.set(fx - 1.2 + i * 1.2 + (f2 % 2 ? 0.14 : -0.14), 1.32, fz + 0.9 + (f2 < 2 ? 0.1 : -0.1));
          fr.castShadow = true; scene.add(fr);
        }
      }
      const s = TEX.makeSign("FEIRA DO ZÉ", "#1d4a2c", "#f4d35e");
      this.signRedraws.push(s.redraw);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.74), new THREE.MeshBasicMaterial({ map: s.tex, transparent: true }));
      sign.position.set(fx, 2.2, fz - 1.16);
      scene.add(sign);
      physics.addFlatRect(fx - 4, fx + 4, fz - 3.5, fz + 2.5);
    }

    // árvores da fazenda
    for (const [tx, tz] of [[-34, 70], [34, 52], [36, 71], [-6, 71]] as const) {
      woodGeos.push(tubeGeo(new THREE.Vector3(tx, 0, tz), new THREE.Vector3(tx, 2.2, tz), 0.16));
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 7), new THREE.MeshStandardMaterial({ color: 0x5e8f4e, roughness: 1 }));
      crown.position.set(tx, 3.2, tz); crown.scale.set(1, 0.85, 1); crown.castShadow = true; scene.add(crown);
      physics.addCollider({ minX: tx - 0.25, maxX: tx + 0.25, minZ: tz - 0.25, maxZ: tz + 0.25, top: 2.2, bottom: -0.2 });
    }

    /* ================= FAVELA — casas empilhadas ================= */
    const lajeHouses: { x: number; z: number; w: number; d: number; top: number; y: number }[] = [];
    const placed: { x: number; z: number; w: number; d: number; y: number; hh: number; laje: boolean }[] = [];
    const anchors: THREE.Vector3[] = [];
    const signHouses: { x: number; z: number; w: number; d: number; y: number }[] = [];
    const muralHouses: { x: number; z: number; w: number; d: number; y: number; hh: number }[] = [];

    for (let bi = 0; bi < BANDS.length; bi++) {
      const b = BANDS[bi];
      const midZ = (b.z0 + b.z1) / 2;
      const rows = bi === 0 ? [35.2] : [b.z0 + 2.6, midZ, b.z1 - 2.6];
      const midCount = bi === 0 ? 2 : 6;
      const plots: { x: number; z: number }[] = [];
      for (const rz of rows) for (let px = -56; px <= 56; px += 4.9) plots.push({ x: px + (rng() - 0.5) * 1.1, z: rz + (rng() - 0.5) * 1.0 });
      for (let m = 0; m < midCount; m++) {
        plots.push({ x: -52 + rng() * 104, z: rows[Math.floor(rng() * rows.length)] + (rng() - 0.5) * 1.0 });
      }
      for (const p of plots) {
        if (bi === 0 && p.z > FARM.z0 - 1.5) continue; // fazenda livre
        const inStairPocket = STAIRS.some(
          (st) => st.band === bi && p.z > BANDS[bi].z0 + 0.6 && p.z < BANDS[bi].z0 + 8.4 &&
            st.xs.some((sx) => p.x > sx - 3.3 && p.x < sx + 5.0)
        );
        if (inStairPocket) continue;
        if (Math.abs(p.x - RECEPT_POS.x) < 7 && Math.abs(p.z - RECEPT_POS.z) < 7) continue;
        if (SPOTS.some((s) => Math.abs(p.x - s.x) < 4 && Math.abs(p.z - s.z) < 4)) continue;
        if (rng() < 0.07) continue;
        const w = 4.0 + rng() * 1.6;
        const d = 3.4 + rng() * 0.9;
        const h = 2.9 + rng() * 1.9;
        const isLaje = rng() < 0.34;
        const hh = isLaje ? 3.0 : h;
        const isBrick = rng() < 0.34;
        const col = HOUSE_COLORS[Math.floor(rng() * HOUSE_COLORS.length)];
        if (isBrick) pushGeo(brickGeos, w, hh, d, p.x, b.y, p.z);
        else pushGeo(houseGeos, w, hh, d, p.x, b.y, p.z, col);
        physics.addCollider({ minX: p.x - w / 2, maxX: p.x + w / 2, minZ: p.z - d / 2, maxZ: p.z + d / 2, top: b.y + hh, bottom: b.y - 0.2 });
        physics.addFlatRect(p.x - w / 2 - 1.2, p.x + w / 2 + 1.2, p.z - d / 2 - 1.2, p.z + d / 2 + 1.2);
        pushGeo(roofGeos, w + 0.3, 0.16, d + 0.3, p.x, b.y + hh, p.z);
        pushGeo(doorGeos, 0.85, 1.85, 0.07, p.x - w / 6, b.y, p.z + d / 2 - 0.02);
        if (rng() < 0.55) pushGeo(frameGeos, 1.45, 1.5, 0.08, p.x + w / 5, b.y, p.z + d / 2 - 0.01, GATE_COLS[Math.floor(rng() * GATE_COLS.length)]);
        pushGeo(frameGeos, 0.07, 0.74, 0.74, p.x + w / 2 - 0.01, b.y + 1.25 + rng() * 0.5, p.z + (rng() - 0.5) * d * 0.4, WIN_COLS[Math.floor(rng() * WIN_COLS.length)]);
        if (rng() < 0.42) pushGeo(frameGeos, 0.44, 0.3, 0.32, p.x - w / 2 + 0.02, b.y + 2.05, p.z + (rng() - 0.5) * d * 0.4, "#c9cdd4");
        if (rng() < 0.3) {
          pushGeo(doorGeos, 0.03, 0.9, 0.03, p.x + w / 4, b.y + hh + 0.16, p.z - d / 5);
          pushGeo(doorGeos, 0.5, 0.03, 0.03, p.x + w / 4, b.y + hh + 0.82, p.z - d / 5);
        }
        if (rng() < 0.5) anchors.push(new THREE.Vector3(p.x + (rng() < 0.5 ? -w / 2 : w / 2), b.y + hh + 0.25, p.z + (rng() - 0.5) * d));
        if (!isLaje && !isBrick && rng() < 0.16) signHouses.push({ x: p.x, z: p.z, w, d, y: b.y });
        else if (isBrick && rng() < 0.12) muralHouses.push({ x: p.x, z: p.z, w, d, y: b.y, hh });
        placed.push({ x: p.x, z: p.z, w, d, y: b.y, hh, laje: isLaje });
        // casa em cima de casa (sobrado, às vezes em balanço com pilotis)
        if (!isLaje && rng() < 0.42) {
          const w2 = w * (0.62 + rng() * 0.2), d2 = d * (0.66 + rng() * 0.2);
          const h2 = 2.5 + rng() * 1.1;
          const ox = (rng() - 0.5) * (w - w2) * 0.9;
          const oz = (rng() - 0.5) * (d - d2) * 0.9;
          const cant = rng() < 0.5 ? (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.55) : 0;
          const isBrick2 = rng() < 0.4;
          const col2 = HOUSE_COLORS[Math.floor(rng() * HOUSE_COLORS.length)];
          if (isBrick2) pushGeo(brickGeos, w2, h2, d2, p.x + ox + cant, b.y + hh, p.z + oz);
          else pushGeo(houseGeos, w2, h2, d2, p.x + ox + cant, b.y + hh, p.z + oz, col2);
          pushGeo(roofGeos, w2 + 0.24, 0.14, d2 + 0.24, p.x + ox + cant, b.y + hh + h2, p.z + oz);
          pushGeo(frameGeos, 0.07, 0.62, 0.62, p.x + ox + cant + w2 / 2 - 0.01, b.y + hh + 1.1, p.z + oz, WIN_COLS[Math.floor(rng() * WIN_COLS.length)]);
          if (rng() < 0.5) anchors.push(new THREE.Vector3(p.x + ox + cant, b.y + hh + h2 + 0.2, p.z + oz));
          if (cant !== 0) {
            const px2 = p.x + ox + cant + (cant > 0 ? w2 / 2 - 0.25 : -w2 / 2 + 0.25);
            for (const pz2 of [p.z + oz - d2 / 2 + 0.3, p.z + oz + d2 / 2 - 0.3]) {
              const pil = new THREE.CylinderGeometry(0.07, 0.07, hh, 6);
              pil.translate(px2, b.y + hh / 2, pz2);
              frameGeos.push(paintGeo(pil, "#9b938a"));
            }
          }
        }
      }
    }

    // pontes/passadorias por cima das vielas
    for (let i = 0; i < placed.length - 1; i++) {
      if (rng() > 0.1) continue;
      const a = placed[i];
      for (let j = i + 1; j < placed.length; j++) {
        const b2 = placed[j];
        if (Math.abs(a.y - b2.y) > 0.5) continue;
        const dz = Math.abs(a.z - b2.z);
        const dx = b2.x - a.x;
        if (dz < 2.4 && dx > a.w / 2 + 0.7 && dx < a.w / 2 + 3.6) {
          const gap = dx - a.w / 2 - b2.w / 2;
          if (gap < 0.6 || gap > 3.4) break;
          const cx = a.x + a.w / 2 + gap / 2, cz = (a.z + b2.z) / 2;
          const py = a.y + Math.min(a.hh, b2.hh) - 0.35;
          pushGeo(concreteGeos, gap + 0.5, 0.12, 0.85, cx, py, cz);
          pushGeo(frameGeos, gap + 0.5, 0.05, 0.05, cx, py + 0.55, cz - 0.4, "#5a5168");
          pushGeo(frameGeos, gap + 0.5, 0.05, 0.05, cx, py + 0.55, cz + 0.4, "#5a5168");
          break;
        }
      }
    }

    /* ================= ESCADARIAS ANCORADAS NAS CASAS (Agente 1) ================= */
    const N_STEPS = 10, RISE = 0.2, TREAD = 0.46, STAIR_W = 2.3;
    for (const st of STAIRS) {
      for (const sx of st.xs) {
        const yLow = BANDS[st.band].y;
        const yHigh = yLow + N_STEPS * RISE;
        const boundary = BANDS[st.band].z0;
        const run = N_STEPS * TREAD;
        // casa-âncora: parede lateral externa MAIS PRÓXIMA sem invadir os degraus
        let wallX = sx - STAIR_W / 2 - 0.3;
        for (const hs of placed) {
          if (Math.abs(hs.y - yLow) > 0.01) continue;
          if (hs.z < boundary + 0.6 || hs.z > boundary + 7.6) continue;
          const wx = hs.x + hs.w / 2;
          if (wx <= sx - 0.4 && wx > wallX) wallX = wx;
        }
        const x0 = wallX + 0.03; // colada na parede
        const xC = x0 + STAIR_W / 2;
        physics.addFlatRect(x0 - 0.4, x0 + STAIR_W + 1.1, boundary - run / 2 - 1.4, boundary + run / 2 + 1.8);
        // soleira ligando a viela ao primeiro degrau
        pushGeo(concreteGeos, STAIR_W, 0.1, 0.9, xC, yLow, boundary + run / 2 + 0.45);
        for (let k = 1; k <= N_STEPS; k++) {
          const zc = boundary + run / 2 - (k - 1) * TREAD - TREAD / 2;
          const top = yLow + k * RISE;
          pushGeo(k % 2 ? concreteGeos : darkGeos, STAIR_W, 0.09, TREAD, xC, top - 0.09, zc);
          pushGeo(darkGeos, STAIR_W, RISE, 0.05, xC, top - RISE, zc - TREAD / 2 + 0.025);
          pushGeo(paintGeos, STAIR_W - 0.12, 0.06, 0.09, xC, top - 0.06, zc - TREAD / 2 + 0.02, PAINT[(k + st.band) % PAINT.length]);
          physics.addSurface({ minX: x0, maxX: x0 + STAIR_W, minZ: zc - TREAD / 2, maxZ: zc + TREAD / 2, top });
        }
        // patamar de chegada nivelado com o piso superior
        physics.addSurface({ minX: x0, maxX: x0 + STAIR_W, minZ: boundary - run / 2 - 1.1, maxZ: boundary - run / 2, top: yHigh });
        pushGeo(concreteGeos, STAIR_W, 0.1, 1.1, xC, yHigh - 0.1, boundary - run / 2 - 0.55);
        // corrimão só no lado aberto (a casa faz o guarda-corpo do outro)
        const zBot = boundary + run / 2 + 0.2, zTop = boundary - run / 2 - 0.2;
        const wxr = x0 + STAIR_W + 0.05;
        metalGeos.push(tubeGeo(new THREE.Vector3(wxr, yLow + 0.8, zBot), new THREE.Vector3(wxr, yHigh + 0.8, zTop), 0.035));
        for (let p2 = 0; p2 <= 2; p2++) {
          const t2 = p2 / 2;
          const pz = zBot + (zTop - zBot) * t2;
          const py = yLow + (yHigh - yLow) * t2;
          metalGeos.push(tubeGeo(new THREE.Vector3(wxr, py, pz), new THREE.Vector3(wxr, py + 0.8, pz), 0.03));
        }
        this.stairActual.push({ x: xC, band: st.band });
      }
    }

    /* ================= LAJES (mocós) ================= */
    let lajeEscada = 0;
    for (const hs of placed.filter((p2) => p2.laje)) {
      const L = { x: hs.x, z: hs.z, w: hs.w, d: hs.d, top: hs.y + hs.hh, y: hs.y };
      lajeHouses.push(L);
      const temEscada = lajeEscada < 12;
      lajeEscada++;
      // muretas (obstáculos sólidos — anti-queda), com vão onde chega a escada
      const pH = 0.85;
      physics.registrarObstaculo({ minX: L.x - L.w / 2, maxX: L.x + L.w / 2, minZ: L.z - L.d / 2 - 0.08, maxZ: L.z - L.d / 2 + 0.08, top: L.top + pH, bottom: L.top - 0.1 });
      physics.registrarObstaculo({ minX: L.x - L.w / 2, maxX: L.x + L.w / 2, minZ: L.z + L.d / 2 - 0.08, maxZ: L.z + L.d / 2 + 0.08, top: L.top + pH, bottom: L.top - 0.1 });
      physics.registrarObstaculo({ minX: L.x - L.w / 2 - 0.08, maxX: L.x - L.w / 2 + 0.08, minZ: L.z - L.d / 2, maxZ: L.z + L.d / 2, top: L.top + pH, bottom: L.top - 0.1 });
      physics.registrarObstaculo({ minX: L.x + L.w / 2 - 0.08, maxX: L.x + L.w / 2 + 0.08, minZ: L.z - L.d / 2, maxZ: L.z + L.d / 2, top: L.top + pH, bottom: L.top - 0.1 });
      physics.addSurface({ minX: L.x - L.w / 2, maxX: L.x + L.w / 2, minZ: L.z - L.d / 2, maxZ: L.z + L.d / 2, top: L.top });
      const par = (w2: number, d2: number, x2: number, z2: number) => pushGeo(concreteGeos, w2, pH, d2, x2, L.top, z2);
      par(L.w + 0.16, 0.14, L.x, L.z - L.d / 2);
      par(L.w + 0.16, 0.14, L.x, L.z + L.d / 2);
      par(0.14, L.d + 0.16, L.x - L.w / 2, L.z);
      par(0.14, L.d + 0.16, L.x + L.w / 2, L.z);
      // caixa d'água azul
      if (rng() < 0.7) {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.8, 12), new THREE.MeshStandardMaterial({ color: 0x2f6fb3, roughness: 0.55 }));
        tank.position.set(L.x + L.w / 4, L.top + 0.4, L.z - L.d / 4);
        tank.castShadow = true; scene.add(tank);
        physics.addCollider({ minX: tank.position.x - 0.5, maxX: tank.position.x + 0.5, minZ: tank.position.z - 0.5, maxZ: tank.position.z + 0.5, top: L.top + 0.7, bottom: L.top });
      }
      // obra eterna: pilha de tijolos + ferragens
      if (lajeHouses.length % 3 === 0) {
        for (let rr = 0; rr < 3; rr++)
          for (let cc = 0; cc < 3 - rr; cc++)
            pushGeo(brickGeos, 0.36, 0.17, 0.22, L.x - L.w / 4 + cc * 0.38 + rr * 0.19, L.top + rr * 0.17, L.z + L.d / 5);
      }
      for (let rb = 0; rb < 4; rb++)
        pushGeo(frameGeos, 0.022, 0.5 + (rb % 3) * 0.25, 0.022, L.x + L.w / 3 + (rb % 2) * 0.16, L.top + 0.16, L.z - L.d / 3 + Math.floor(rb / 2) * 0.16, "#7a4a2e");
      // escada externa encostada na fachada
      if (temEscada) {
        const steps = Math.round((L.top - L.y) / 0.27);
        const sz = L.z + L.d / 2 - 0.18;
        for (let k = 1; k <= steps; k++) {
          pushGeo(concreteGeos, 1.1, 0.09, 0.4, L.x + L.w / 2 - 0.8, L.y + k * 0.27 - 0.09, sz - (k - 1) * 0.13);
          physics.addSurface({ minX: L.x + L.w / 2 - 1.35, maxX: L.x + L.w / 2 - 0.25, minZ: sz - (k - 1) * 0.13 - 0.2, maxZ: sz - (k - 1) * 0.13 + 0.2, top: L.y + k * 0.27 });
        }
      }
    }

    /* ================= MERGES PRINCIPAIS ================= */
    buildMerged(houseGeos, houseMat);
    buildMerged(brickGeos, brickMat);
    buildMerged(roofGeos, roofMat);
    buildMerged(concreteGeos, concrete);
    buildMerged(darkGeos, darkMat);
    buildMerged(doorGeos, doorMat);
    buildMerged(frameGeos, frameMat);
    buildMerged(paintGeos, paintMat);
    buildMerged(metalGeos, metalMat);
    buildMerged(wireGeos, wireMat);
    buildMerged(woodGeos, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    buildMerged(greenGeos, new THREE.MeshStandardMaterial({ color: 0x5e9a45, roughness: 1 }));

    /* ================= POSTES + FIAÇÃO ================= */
    const poleTops: THREE.Vector3[] = [];
    const poleZ = 37.3;
    for (const px of [-45, -15, 15, 45]) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.27, 0.3, 10), metalMat);
      base.position.set(px, 0.15, poleZ); base.castShadow = true; scene.add(base);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 3.4, 8), metalMat);
      pole.position.set(px, 2.0, poleZ); pole.castShadow = true; scene.add(pole);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.85, 6), metalMat);
      arm.position.set(px, 3.72, poleZ + 0.36); arm.rotation.x = Math.PI / 2 - 0.28; scene.add(arm);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.17, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0x3a3742, side: THREE.DoubleSide, roughness: 0.7 }));
      shade.position.set(px, 3.82, poleZ + 0.66); shade.castShadow = true; scene.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe0a0 }));
      bulb.position.set(px, 3.72, poleZ + 0.66); scene.add(bulb);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }));
      glow.position.copy(bulb.position); glow.scale.setScalar(2.0); scene.add(glow);
      poleTops.push(new THREE.Vector3(px, 3.95, poleZ));
      physics.addCollider({ minX: px - 0.16, maxX: px + 0.16, minZ: poleZ - 0.16, maxZ: poleZ + 0.16, top: 3.8, bottom: -0.2 });
    }
    for (let i = 0; i < poleTops.length - 1; i++) {
      const a = poleTops[i], b2 = poleTops[i + 1];
      for (const off of [-0.28, 0, 0.28]) {
        const mid = new THREE.Vector3().lerpVectors(a, b2, 0.5);
        mid.y -= 0.9; mid.z += off;
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(a.x, a.y - 0.05, a.z + off), mid, new THREE.Vector3(b2.x, b2.y - 0.05, b2.z + off)
        );
        wireGeos.push(new THREE.TubeGeometry(curve, 12, 0.016, 4, false));
      }
    }
    // gambiarras descendo pros telhados
    for (const an of anchors) {
      const nearPole = poleTops.reduce((p, c) => (Math.abs(c.x - an.x) < Math.abs(p.x - an.x) ? c : p), poleTops[0]);
      const mid = new THREE.Vector3().lerpVectors(nearPole, an, 0.5);
      mid.y -= 0.7;
      wireGeos.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(nearPole, mid, an), 10, 0.014, 4, false));
    }
    for (let i = 0; i < anchors.length - 1; i += 2) {
      const a = anchors[i], b2 = anchors[i + 1];
      if (a.distanceTo(b2) > 14) continue;
      const mid = new THREE.Vector3().lerpVectors(a, b2, 0.5);
      mid.y -= 0.8;
      wireGeos.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b2), 10, 0.013, 4, false));
    }
    buildMerged(wireGeos, wireMat);

    /* ================= LETREIROS + GRAFITES ================= */
    signHouses.slice(0, 6).forEach((hs, i) => {
      const [txt, bg, fg] = SIGN_DATA[i % SIGN_DATA.length];
      const s = TEX.makeSign(txt, bg, fg, 512, 104);
      this.signRedraws.push(s.redraw);
      const wS = Math.min(hs.w - 0.5, 3.6);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(wS, wS * 0.2), new THREE.MeshBasicMaterial({ map: s.tex, transparent: true }));
      sign.position.set(hs.x, hs.y + 2.35, hs.z + hs.d / 2 + 0.05);
      scene.add(sign);
    });
    muralHouses.slice(0, 4).forEach((hm) => {
      const mH = Math.min(hm.hh - 0.5, 2.3);
      const mural = new THREE.Mesh(new THREE.PlaneGeometry(hm.d - 0.5, mH), new THREE.MeshStandardMaterial({ map: TEX.makeGraffitiTex(), roughness: 0.9 }));
      mural.position.set(hm.x - hm.w / 2 - 0.06, hm.y + mH / 2 + 0.1, hm.z);
      mural.rotation.y = -Math.PI / 2;
      scene.add(mural);
    });

    /* ================= VARAIS DE CASA A CASA ================= */
    const clothCols = ["#e85d75", "#f4d35e", "#f2f2f2", "#4d9de0", "#7bc950"];
    let clothes = 0;
    for (let i = 0; i < placed.length - 1 && clothes < 10; i++) {
      const a = placed[i], b2 = placed[i + 1];
      if (Math.abs(a.y - b2.y) > 0.5) continue;
      const dx = b2.x - a.x, dz = Math.abs(b2.z - a.z);
      if (dz < 2.2 && dx > a.w / 2 + 1.5 && dx < a.w / 2 + 6.5) {
        clothes++;
        const yTop = a.y + Math.min(a.hh, b2.hh) - 0.4;
        const pA = new THREE.Vector3(a.x + a.w / 2, yTop, a.z);
        const pB = new THREE.Vector3(b2.x - b2.w / 2, yTop, b2.z);
        const mid = new THREE.Vector3().lerpVectors(pA, pB, 0.5);
        mid.y -= 0.5;
        wireGeos.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(pA, mid, pB), 10, 0.012, 4, false));
        for (let v = 1; v <= 3; v++) {
          const p = new THREE.QuadraticBezierCurve3(pA, mid, pB).getPoint(v / 4);
          const cloth = new THREE.Mesh(
            new THREE.PlaneGeometry(0.55, 0.75),
            new THREE.MeshStandardMaterial({ color: clothCols[(v + i) % clothCols.length], side: THREE.DoubleSide, roughness: 1 })
          );
          cloth.position.set(p.x, p.y - 0.4, p.z);
          cloth.rotation.y = rng() * Math.PI;
          cloth.castShadow = true;
          scene.add(cloth);
        }
      }
    }

    /* ================= ESCONDERIJO DO RECEPTADOR (polo ilegal) ================= */
    {
      const rx = RECEPT_POS.x, rz = RECEPT_POS.z, ry = BANDS[4].y;
      const mat = new THREE.MeshStandardMaterial({ color: 0x4a4038, map: wallTex.map, roughness: 0.95 });
      addBox(mat, 5.6, 3.2, 4.6, rx, ry, rz);
      physics.addCollider({ minX: rx - 2.8, maxX: rx + 2.8, minZ: rz - 2.3, maxZ: rz + 2.3, top: ry + 3.2, bottom: ry - 0.2 });
      physics.addFlatRect(rx - 4.6, rx + 4.6, rz - 4.6, rz + 3.6);
      addBox(roofMat, 5.9, 0.18, 4.9, rx, ry + 3.2, rz, false);
      const s = TEX.makeSign("RECEPTADOR", "#221114", "#ffb14d");
      this.signRedraws.push(s.redraw);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.05), new THREE.MeshBasicMaterial({ map: s.tex, transparent: true }));
      sign.position.set(rx, ry + 4, rz - 2);
      scene.add(sign);
      // lâmpada única e sombria
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff9a4d }));
      bulb.position.set(rx, ry + 2.9, rz - 2.4); scene.add(bulb);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xff8a3d, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 }));
      glow.position.copy(bulb.position); glow.scale.setScalar(2.4); scene.add(glow);
    }

    /* ================= PALMEIRAS / PEDRAS / MATO / POÇAS ================= */
    const palmTrunks: THREE.BufferGeometry[] = [];
    const palmLeaves: THREE.BufferGeometry[] = [];
    const mkPalm = (ppx: number, ppz: number, ph: number, lean: number) => {
      const py = physics.terrainH(ppx, ppz);
      const trunk = new THREE.CylinderGeometry(0.08, 0.17, ph, 6);
      trunk.translate(0, ph / 2, 0);
      trunk.rotateZ(lean);
      trunk.translate(ppx, py, ppz);
      palmTrunks.push(trunk);
      const tx = ppx + Math.sin(lean) * ph, ty = py + Math.cos(lean) * ph;
      for (let fr = 0; fr < 7; fr++) {
        const a2 = (fr / 7) * Math.PI * 2;
        const leaf = new THREE.PlaneGeometry(1.6, 0.34);
        leaf.translate(0.8, 0, 0);
        leaf.rotateZ(-0.42 - (fr % 2) * 0.14);
        leaf.rotateY(a2);
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
    buildMerged(palmTrunks, new THREE.MeshStandardMaterial({ color: 0x6e4a2e, roughness: 1 }));
    buildMerged(palmLeaves, new THREE.MeshStandardMaterial({ color: 0x3f8f3a, side: THREE.DoubleSide, roughness: 1 }));

    /* ---------- terreno orgânico (depois de todas as zonas planas) ---------- */
    this.buildTerrain(physics, scene);

    /* ---------- detalhes de chão ---------- */
    const nearHouse = (xx: number, zz: number) =>
      placed.some((hs) => Math.abs(xx - hs.x) < hs.w / 2 + 0.9 && Math.abs(zz - hs.z) < hs.d / 2 + 0.9);
    const inRoad = (zz: number) => Math.abs(zz - 42) < 6.2;
    const inFarm = (xx: number, zz: number) => xx > FARM.x0 && xx < FARM.x1 && zz > FARM.z0 && zz < FARM.z1;
    const nearStairX = (xx: number) => this.stairActual.some((s2) => Math.abs(xx - s2.x) < 2.6);

    const puddleGeos: THREE.BufferGeometry[] = [];
    const mkPuddle = (ppx: number, ppz: number, prx: number, prz: number, yy: number) => {
      const g = new THREE.CircleGeometry(1, 16);
      g.rotateX(-Math.PI / 2);
      g.scale(prx, 1, prz);
      g.translate(ppx, yy, ppz);
      puddleGeos.push(g);
    };
    mkPuddle(-26, 43.4, 2.4, 1.3, 0.075); mkPuddle(12, 40.6, 1.8, 1.0, 0.075);
    mkPuddle(38, 44.2, 2.8, 1.2, 0.075);
    mkPuddle(-4, 33.2, 1.6, 0.9, physics.terrainH(-4, 33.2) + 0.04);
    mkPuddle(22, 14.8, 1.4, 0.8, physics.terrainH(22, 14.8) + 0.04);
    mkPuddle(-30, -1.6, 1.7, 0.9, physics.terrainH(-30, -1.6) + 0.04);
    if (puddleGeos.length) {
      const pg = mergeGeometries(puddleGeos);
      if (pg) {
        const pm = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({
          color: 0x31485c, transparent: true, opacity: 0.82,
          emissive: 0x3a5164, emissiveIntensity: 0.18,
          roughness: 0.1, metalness: 0.3, depthWrite: false,
        }));
        pm.renderOrder = 2;
        scene.add(pm);
      }
    }

    const rockGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 90; i++) {
      const xx = -58 + rng() * 116, zz = -58 + rng() * 116;
      if (inRoad(zz) || inFarm(xx, zz) || nearHouse(xx, zz) || nearStairX(xx)) continue;
      const s2 = 0.12 + rng() * 0.4;
      const g = new THREE.DodecahedronGeometry(s2, 0);
      g.rotateX(rng() * Math.PI); g.rotateY(rng() * Math.PI);
      g.translate(xx, physics.terrainH(xx, zz) + s2 * 0.35, zz);
      rockGeos.push(g);
    }
    if (rockGeos.length) {
      const rgm = mergeGeometries(rockGeos);
      if (rgm) {
        const rm = new THREE.Mesh(rgm, new THREE.MeshStandardMaterial({ color: 0x8b7f6e, roughness: 1 }));
        rm.castShadow = true; rm.receiveShadow = true;
        scene.add(rm);
      }
    }

    const grassGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 130; i++) {
      const xx = -58 + rng() * 116, zz = -58 + rng() * 116;
      if (inRoad(zz) || inFarm(xx, zz) || nearHouse(xx, zz) || nearStairX(xx)) continue;
      const nv = Math.sin(xx * 0.3) * Math.cos(zz * 0.27) * 0.5 + Math.sin(xx * 0.71 + 2) * Math.sin(zz * 0.66 + 1) * 0.3;
      if (nv < 0.2) continue;
      const yy = physics.terrainH(xx, zz);
      for (let bl = 0; bl < 3; bl++) {
        const bh = 0.22 + rng() * 0.34;
        const g = new THREE.ConeGeometry(0.05 + rng() * 0.04, bh, 4);
        g.translate((rng() - 0.5) * 0.3, bh / 2, (rng() - 0.5) * 0.3);
        g.rotateZ((rng() - 0.5) * 0.3);
        g.translate(xx, yy, zz);
        grassGeos.push(g);
      }
    }
    if (grassGeos.length) {
      const ggm = mergeGeometries(grassGeos);
      if (ggm) {
        const gm = new THREE.Mesh(ggm, new THREE.MeshStandardMaterial({ color: 0x7d9a4e, roughness: 1 }));
        gm.castShadow = true;
        scene.add(gm);
      }
    }

    /* ---------- marcadores de mocó (anéis de spray) ---------- */
    for (const sp of SPOTS) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(3, 3),
        new THREE.MeshBasicMaterial({ map: TEX.makeSprayTex("#3ddc84"), transparent: true, opacity: 0.92, depthWrite: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(sp.x, sp.y + 0.06, sp.z);
      m.renderOrder = 1;
      m.name = "morro";
      scene.add(m);
      physics.addRaycastTarget(m);
      physics.addFlatCircle(sp.x, sp.z, 2.4);
    }

    /* ================= NPCs COM ROTAS REAIS ================= */
    this.buildNpcs(scene, physics);

    /* ================= PÁSSAROS ================= */
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group();
      const wingMat = new THREE.MeshBasicMaterial({ color: 0x22242e, side: THREE.DoubleSide });
      const wl = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.24), wingMat);
      const wr = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.24), wingMat);
      wl.position.x = -0.4; wr.position.x = 0.4;
      g.add(wl, wr);
      scene.add(g);
      this.birds.push({ g, wingL: wl, wingR: wr, a: rng() * 9, r: 26 + rng() * 22, h: 16 + rng() * 8, sp: 0.25 + rng() * 0.2 });
    }
  }

  /* ================= terreno orgânico ================= */
  private buildTerrain(physics: Physics, scene: THREE.Scene) {
    const W = 132, D = 158, SEG_X = 176, SEG_Z = 210;
    const geo = new THREE.PlaneGeometry(W, D, SEG_X, SEG_Z);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cA = new THREE.Color(), cB = new THREE.Color();
    const SHADES = ["#8f855e", "#8a6a4e", "#7d6a52", "#75604a", "#6e5946", "#665240", "#5e4b3c", "#574436"];
    const ROCK = new THREE.Color("#77706a");
    const GRASS = new THREE.Color("#6f8f4e");
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = physics.terrainH(x, z);
      pos.setY(i, y);
      const band = Math.min(SHADES.length - 1, Math.max(0, Math.floor((y + 0.5) / 1.6)));
      cA.set(SHADES[band]);
      // encosta íngreme -> rocha
      const slope = Math.abs(physics.terrainH(x + 1.2, z) - y) + Math.abs(physics.terrainH(x, z + 1.2) - y);
      cB.copy(ROCK);
      cA.lerp(cB, Math.min(1, Math.max(0, (slope - 0.5) * 1.4)));
      // manchas de vegetação
      const nv = Math.sin(x * 0.3) * Math.cos(z * 0.27) * 0.5 + Math.sin(x * 0.71 + 2) * Math.sin(z * 0.66 + 1) * 0.3;
      cB.copy(GRASS);
      cA.lerp(cB, Math.max(0, nv - 0.2) * 0.85);
      colors[i * 3] = cA.r; colors[i * 3 + 1] = cA.g; colors[i * 3 + 2] = cA.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, map: TEX.makeGroundTex(), roughness: 1, metalness: 0,
    }));
    mesh.receiveShadow = true;
    scene.add(mesh);
    physics.setTerrainProxy(mesh, "morro");

    // proxy invisível das superficiesAndaveis p/ raycast de plantio (normais corretas)
    const proxyMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
    const mkProxy = (defs: { minX: number; maxX: number; minZ: number; maxZ: number; top: number }[], name: string) => {
      const geos: THREE.BufferGeometry[] = [];
      for (const s of defs) {
        const g = new THREE.PlaneGeometry(s.maxX - s.minX, s.maxZ - s.minZ);
        g.rotateX(-Math.PI / 2);
        g.translate((s.minX + s.maxX) / 2, s.top + 0.02, (s.minZ + s.maxZ) / 2);
        geos.push(g);
      }
      const merged = mergeGeometries(geos, false);
      if (!merged) return;
      const m = new THREE.Mesh(merged, proxyMat);
      m.name = name;
      m.renderOrder = -1;
      scene.add(m);
      physics.addRaycastTarget(m);
    };
    const lajes = physics.surfaces.filter((s) => s.top >= 2.5);
    const steps = physics.surfaces.filter((s) => s.top < 2.5);
    mkProxy(lajes, "laje");
    mkProxy(steps, "morro");
  }

  /* ================= NPCs ================= */
  private buildNpcs(scene: THREE.Scene, physics: Physics) {
    const rng = this.rng;
    const skins = [0xc98a5b, 0x8a5a3b, 0xe0a878, 0x6e4326];
    const shirts = [0xe85d75, 0x4d9de0, 0xf4d35e, 0xf2f2f2, 0x7bc950, 0xc98a5a];
    const vielaZ = (bi: number): number => {
      if (bi === 0) return 39.8 + rng() * 3.4;
      const b = BANDS[bi];
      return b.z0 + (rng() < 0.5 ? 4.75 : 11.25);
    };
    const routes: { x: number; z: number; y: number }[][] = [];
    for (let i = 0; i < 4; i++) {
      const bi = 1 + Math.floor(rng() * 5);
      const vz = vielaZ(bi);
      routes.push([
        { x: -50 + rng() * 18, z: vz, y: BANDS[bi].y },
        { x: 32 + rng() * 18, z: vz, y: BANDS[bi].y },
      ]);
    }
    for (let i = 0; i < 6; i++) {
      const startBand = Math.floor(rng() * 4);
      const climbs = 1 + Math.floor(rng() * 2);
      let band = startBand;
      let x = -46 + rng() * 92;
      let vz = vielaZ(band);
      const pts: { x: number; z: number; y: number }[] = [{ x, z: vz, y: BANDS[band].y }];
      for (let c = 0; c < climbs; c++) {
        const stair = STAIRS[band];
        const sx = stair.xs[Math.floor(rng() * stair.xs.length)];
        pts.push({ x: sx, z: vz, y: BANDS[band].y });
        pts.push({ x: sx, z: BANDS[band].z0 + 2.2, y: BANDS[band].y });
        pts.push({ x: sx, z: BANDS[band].z0 - 2.4, y: BANDS[band + 1].y });
        band++;
        x = Math.max(-54, Math.min(54, sx + (rng() < 0.5 ? -1 : 1) * (12 + rng() * 26)));
        vz = vielaZ(band);
        pts.push({ x, z: vz, y: BANDS[band].y });
      }
      routes.push(pts);
    }
    // fazendeiro patrulhando os canteiros (rota fechada)
    routes.push([
      { x: -30, z: 51.5, y: 0 }, { x: -6, z: 51.5, y: 0 },
      { x: -6, z: 66, y: 0 }, { x: -30, z: 66, y: 0 },
    ]);
    // Zé da feira (fixo atrás do balcão)
    this.spawnNpcBody(scene, shirts, skins, 9, FEIRA_POS.x, FEIRA_POS.z + 1.9, 0, [
      { x: FEIRA_POS.x, z: FEIRA_POS.z + 1.9, y: 0 },
      { x: FEIRA_POS.x, z: FEIRA_POS.z + 1.9, y: 0 },
    ], true);
    for (let i = 0; i < 11; i++) {
      const route = routes[i % routes.length];
      this.spawnNpcBody(scene, shirts, skins, i, route[0].x, route[0].z, route[0].y, route, false);
    }
  }

  private spawnNpcBody(
    scene: THREE.Scene, shirts: number[], skins: number[], i: number,
    px: number, pz: number, py: number, route: { x: number; z: number; y: number }[], isZe: boolean
  ) {
    const rng = this.rng;
    const g = new THREE.Group();
    const shirtMat = new THREE.MeshStandardMaterial({ color: isZe ? 0xf2e3c8 : shirts[i % shirts.length], roughness: 0.9 });
    const skinMat = new THREE.MeshStandardMaterial({ color: skins[i % skins.length], roughness: 0.85 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x33415e, roughness: 0.95 });
    const mkLeg = (sx: number): THREE.Mesh => {
      const geo = new THREE.CapsuleGeometry(0.07, 0.34, 3, 8);
      geo.translate(0, -0.24, 0);
      const m = new THREE.Mesh(geo, pantsMat);
      m.position.set(sx, 0.58, 0); m.castShadow = true; g.add(m); return m;
    };
    const legL = mkLeg(-0.09), legR = mkLeg(0.09);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.34, 4, 10), shirtMat);
    body.position.y = 0.98; body.castShadow = true; g.add(body);
    const mkArm = (sx: number): THREE.Mesh => {
      const geo = new THREE.CapsuleGeometry(0.045, 0.26, 3, 8);
      geo.translate(0, -0.17, 0);
      const m = new THREE.Mesh(geo, skinMat);
      m.position.set(sx, 1.2, 0); g.add(m); return m;
    };
    const armL = mkArm(-0.22), armR = mkArm(0.22);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), skinMat);
    head.position.y = 1.46; head.castShadow = true; g.add(head);
    if (isZe) {
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.1, 10), new THREE.MeshStandardMaterial({ color: 0xc8a24e, roughness: 1 }));
      hat.position.y = 1.58; g.add(hat);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.02, 10), new THREE.MeshStandardMaterial({ color: 0xc8a24e, roughness: 1 }));
      brim.position.y = 1.54; g.add(brim);
      g.rotation.y = Math.PI;
    } else if (i % 3 === 0) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.07, 10), new THREE.MeshStandardMaterial({ color: 0xe8452e, roughness: 1 }));
      cap.position.y = 1.56; g.add(cap);
    }
    g.position.set(px, py, pz);
    scene.add(g);
    this.npcs.push({
      g, x: px, z: pz, y: py, sp: 1.0 + rng() * 0.9, ph: rng() * 9,
      rot: g.rotation.y, wi: 0, fwd: 1, step: rng() * 9, legL, legR, armL, armR, route,
    });
  }

  /* ================= update por frame ================= */
  update(dt: number, t: number) {
    const physics = this.physics;
    for (const n of this.npcs) {
      if (n.route.length < 2) continue;
      const wp = n.route[n.wi];
      const dx = wp.x - n.x, dz = wp.z - n.z;
      const dist = Math.hypot(dx, dz);
      const closed = Math.hypot(n.route[0].x - n.route[n.route.length - 1].x, n.route[0].z - n.route[n.route.length - 1].z) < 0.5;
      const advance = () => {
        if (closed) n.wi = (n.wi + 1) % n.route.length;
        else {
          let nw = n.wi + n.fwd;
          if (nw < 0 || nw >= n.route.length) {
            n.fwd *= -1;
            nw = Math.max(0, Math.min(n.route.length - 1, n.wi + n.fwd));
          }
          n.wi = nw;
        }
      };
      const moving = dist >= 0.45;
      if (!moving) advance();
      else {
        const nx = n.x + (dx / dist) * n.sp * dt;
        const nz = n.z + (dz / dist) * n.sp * dt;
        const baseG = physics.groundAt(n.x, n.z, n.y, 0.3);
        if (physics.collides(nx, nz, n.y, baseG)) {
          if (!physics.collides(nx, n.z, n.y, baseG)) n.x = nx;
          else if (!physics.collides(n.x, nz, n.y, baseG)) n.z = nz;
          else advance();
        } else { n.x = nx; n.z = nz; }
        n.step += n.sp * dt * 4.2;
        const targetYaw = Math.atan2(dx, dz);
        let dy = targetYaw - n.rot;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        n.rot += dy * Math.min(1, 8 * dt);
        n.g.rotation.y = n.rot;
      }
      const sw = moving ? Math.sin(n.step * 2.1 + n.ph) * 0.6 : 0;
      n.legL.rotation.x += (sw - n.legL.rotation.x) * Math.min(1, 12 * dt);
      n.legR.rotation.x += (-sw - n.legR.rotation.x) * Math.min(1, 12 * dt);
      n.armL.rotation.x += (-sw * 0.7 - n.armL.rotation.x) * Math.min(1, 12 * dt);
      n.armR.rotation.x += (sw * 0.7 - n.armR.rotation.x) * Math.min(1, 12 * dt);
      n.y = Math.max(physics.terrainH(n.x, n.z), physics.sampleGround(n.x, n.z, n.y, 0.3));
      n.g.position.set(n.x, n.y + (moving ? Math.abs(Math.sin(t * 6 + n.ph)) * 0.045 : 0), n.z);
    }
    for (const b of this.birds) {
      b.a += b.sp * dt;
      b.g.position.set(Math.cos(b.a) * b.r, 14 + b.h + Math.sin(b.a * 2) * 1.2, -10 + Math.sin(b.a) * b.r * 0.7);
      b.g.rotation.y = -b.a;
      const flap = Math.sin(t * 9 + b.a * 3) * 0.55;
      b.wingL.rotation.y = flap;
      b.wingR.rotation.y = -flap;
    }
  }
}
