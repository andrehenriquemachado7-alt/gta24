import { useEffect, useRef, useState } from "react";
import { QuintalGame, PRICES, fmtBRL } from "./game";
import type { HudData } from "./game";

/* ---------------- ícones SVG ---------------- */
const VasoIcon = ({ s = 18 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
    <path d="M5 7h14l-2.2 13H7.2L5 7Z" fill="#c1663a" stroke="#7e3f20" strokeWidth="1.4" />
    <rect x="4" y="4.5" width="16" height="3.4" rx="0.8" fill="#d8794a" stroke="#7e3f20" strokeWidth="1.2" />
  </svg>
);
const TerraIcon = ({ s = 18 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
    <path d="M6 8c0-2 2-4 6-4s6 2 6 4l-1 12H7L6 8Z" fill="#5b4632" stroke="#2e2118" strokeWidth="1.4" />
    <circle cx="10" cy="12" r="1.1" fill="#3a2a1c" /><circle cx="14.5" cy="15" r="1.1" fill="#3a2a1c" /><circle cx="11" cy="17.5" r="1" fill="#3a2a1c" />
  </svg>
);
const SeedIcon = ({ s = 18 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
    <path d="M12 3c4 3 6 7 6 10a6 6 0 1 1-12 0c0-3 2-7 6-10Z" fill="#7bc950" stroke="#3f7d33" strokeWidth="1.4" />
    <path d="M12 7v10" stroke="#3f7d33" strokeWidth="1.4" />
  </svg>
);
const PackIcon = ({ s = 18 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
    <rect x="4.5" y="7" width="15" height="11" rx="1.6" fill="#7ef29a" stroke="#23854b" strokeWidth="1.4" />
    <path d="M4.5 11h15M9 7v11M15 7v11" stroke="#23854b" strokeWidth="1.2" />
  </svg>
);
const PlayIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5L7 4.5Z" /></svg>
);
const PauseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="5" height="16" rx="1" /><rect x="14" y="4" width="5" height="16" rx="1" /></svg>
);
const SoundIcon = ({ off }: { off: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" stroke="none" />
    {off ? <path d="M16 9l5 6M21 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />}
  </svg>
);
const JumpIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V6M6 12l6-6 6 6" />
  </svg>
);

/* ---------------- silhueta da favela (SVG) ---------------- */
const FavelaSkyline = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 1200 220" preserveAspectRatio="none" fill="currentColor">
    <path d="M0 220V150h40v-28h34v28h22v-48h42v20h26v-36h48v56h30v-76h44v30h24v-22h52v68h36v-40h30v-30h46v70h28v-52h40v26h30v-44h50v70h34v-34h42v-26h38v60h30v-80h46v44h32v-24h44v60h26v-38h48v18h30v-50h42v70h36v-30h40v-24h46v54h30v-72h44v40h34v-20h48v52h20v-36h44v56h40v-30h36v110H0Z" />
  </svg>
);

/* ---------------- joystick ---------------- */
function Joystick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const pid = useRef<number | null>(null);
  const R = 44;

  const track = (e: React.PointerEvent) => {
    const base = baseRef.current, knob = knobRef.current;
    if (!base || !knob) return;
    const r = base.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    onMove(dx / R, -dy / R);
  };
  const release = (e: React.PointerEvent) => {
    if (pid.current !== e.pointerId) return;
    pid.current = null;
    if (knobRef.current) knobRef.current.style.transform = "translate(0px, 0px)";
    onMove(0, 0);
  };

  return (
    <div
      ref={baseRef}
      className="joy-base relative h-32 w-32 rounded-full no-select"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => { pid.current = e.pointerId; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); track(e); }}
      onPointerMove={(e) => { if (pid.current === e.pointerId) track(e); }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div ref={knobRef} className="joy-knob h-14 w-14 rounded-full" style={{ transition: "transform 60ms linear" }} />
      </div>
    </div>
  );
}

/* ---------------- tela inicial ---------------- */
function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="absolute inset-0 z-30 overflow-hidden bg-morro-950">
      {/* céu em camadas */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg,#20275c 0%,#5d3d6e 34%,#a3506f 55%,#e07b4f 72%,#f5a862 86%)" }} />
      <div className="absolute rounded-full" style={{ left: "16%", bottom: "26%", width: 130, height: 130, background: "radial-gradient(circle,#ffedb0 0%,#ffbe6e 55%,rgba(255,150,80,0) 72%)", filter: "blur(2px)" }} />
      <FavelaSkyline className="absolute bottom-0 left-0 h-56 w-full text-[#2b2140] opacity-80" />
      <FavelaSkyline className="absolute bottom-0 left-0 h-40 w-full text-[#191428]" />
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg,rgba(16,17,23,0.25) 0%,rgba(16,17,23,0) 30%,rgba(16,17,23,0.82) 92%)" }} />

      <div className="relative z-10 mx-auto flex h-full max-w-6xl flex-col justify-center gap-8 px-6 pb-24 pt-10 lg:flex-row lg:items-center lg:gap-14">
        <div className="max-w-xl">
          <div className="mb-3 inline-flex items-center gap-2 border border-sol-400/50 bg-morro-950/60 px-3 py-1 text-[11px] font-bold tracking-[0.28em] text-sol-400 btn-cut">
            <span className="blink-rec inline-block h-2 w-2 rounded-full bg-rojo-500" />
            SIMULADOR DE MORRO • LOW-POLY
          </div>
          <h1 className="title-in font-display text-[88px] leading-[0.86] text-laje-100 sm:text-[120px]" style={{ textShadow: "6px 6px 0 rgba(232,93,117,0.85), 12px 12px 0 rgba(16,17,23,0.9)" }}>
            QUINTAL<br /><span className="text-sol-400">3D</span>
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-laje-100/85">
            Um morro de <strong className="text-sol-400">casa em cima de casa</strong>: corte pelas{" "}
            <strong className="text-sol-400">vielas apertadas</strong>, suba as escadas em zigue-zague,
            moca o cultivo nas <strong className="text-grana-400">lajes com vista pro mar</strong> e transforme{" "}
            <strong className="text-sol-400">{fmtBRL(PRICES.meta)}</strong> em dinheiro vivo no esconderijo do receptador.
          </p>
          <button
            onClick={onStart}
            className="btn-cut group mt-7 inline-flex items-center gap-3 bg-sol-400 px-9 py-4 font-display text-3xl tracking-wider text-morro-950 transition-transform hover:scale-[1.04] hover:bg-sol-500 active:scale-95"
          >
            <PlayIcon /> COMEÇAR
          </button>
          <p className="mt-3 text-xs text-laje-100/55">Roda liso no PC e no celular — sem instalar nada.</p>
        </div>

        <div className="hud-panel w-full max-w-md px-6 py-5 lg:px-8">
          <h2 className="font-display text-2xl tracking-wide text-sol-400">COMO SE VIRA</h2>
          <ol className="mt-3 space-y-2.5 text-[13.5px] text-laje-100/90">
            {[
              ["1", "Compre vaso e terra na Feira do Zé (fazenda) e a semente no Esconderijo."],
              ["2", "Mocada a planta na laje ou no beco marcado em verde."],
              ["3", "Espere as 3 fases: broto, vegetativa e flora."],
              ["4", "Colha os pacotes e venda no Esconderijo do Receptador."],
            ].map(([n, t]) => (
              <li key={n} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center bg-sol-400 font-display text-base text-morro-950 btn-cut">{n}</span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-laje-100/10 pt-4 text-[12.5px]">
            <div>
              <p className="mb-1 font-bold tracking-widest text-grana-400">PC</p>
              <p className="text-laje-100/75">WASD mover · Espaço pular<br />E agir · arraste = câmera<br />P pausa · M som</p>
            </div>
            <div>
              <p className="mb-1 font-bold tracking-widest text-grana-400">CELULAR</p>
              <p className="text-laje-100/75">Joystick esquerdo mover<br />Botões pular / agir<br />Arraste a tela = câmera</p>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 z-10 w-full overflow-hidden border-t border-sol-400/25 bg-morro-950/85 py-2">
        <div className="ticker-track flex w-max gap-8 whitespace-nowrap font-display text-lg tracking-[0.18em] text-laje-100/60">
          {Array.from({ length: 2 }).map((_, k) => (
            <span key={k} className="flex gap-8">
              <span>FEIRA DO ZÉ NA FAZENDA</span><span className="text-sol-400">✦</span>
              <span>CASA EM CIMA DE CASA</span><span className="text-sol-400">✦</span>
              <span>LAJE COM VISTA PRO MAR</span><span className="text-sol-400">✦</span>
              <span>VIELA APERTADA</span><span className="text-sol-400">✦</span>
              <span>MOCADO SEGURO</span><span className="text-sol-400">✦</span>
              <span>RECEPTADOR PAGA BEM</span><span className="text-sol-400">✦</span>
              <span>QUINTAL 3D</span><span className="text-sol-400">✦</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- loja ---------------- */
function ShopPanel({ hud, game }: { hud: HudData; game: QuintalGame }) {
  const isMercado = hud.shop === "mercado";
  const rows = isMercado
    ? [
        { key: "vaso" as const, name: "Vaso de barro", price: PRICES.vaso, icon: <VasoIcon />, hint: "Onde a planta mora" },
        { key: "terra" as const, name: "Saco de terra", price: PRICES.terra, icon: <TerraIcon />, hint: "Adubada e pronta" },
      ]
    : [
        { key: "semente" as const, name: "Semente rara", price: PRICES.semente, icon: <SeedIcon />, hint: "Genética de primeira" },
      ];
  return (
    <div className="slide-up absolute right-3 top-1/2 z-20 w-[300px] -translate-y-1/2 sm:right-6">
      <div className="hud-panel px-5 py-4">
        <div className="flex items-center justify-between">
          <h3 className={`font-display text-2xl tracking-wide ${isMercado ? "text-sol-400" : "text-rojo-500"}`}>
            {isMercado ? "FEIRA DO ZÉ" : "ESCONDERIJO"}
          </h3>
          <button onClick={() => game.closeShop()} className="hud-chip px-2.5 py-1 text-xs font-bold text-laje-100/80 hover:text-laje-100">FECHAR</button>
        </div>
        <p className="mt-1 text-xs text-laje-100/55">{isMercado ? "“O que vai levar hoje, chefia?”" : "“Traz o pacote que eu pago na hora.”"}</p>

        <div className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <div key={r.key} className="hud-chip flex items-center gap-3 px-3 py-2">
              {r.icon}
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold leading-tight text-laje-100">{r.name}</p>
                <p className="text-[11px] text-laje-100/50">{r.hint}</p>
              </div>
              <button
                onClick={() => game.buyItem(r.key)}
                disabled={hud.money < r.price}
                className="btn-cut bg-grana-500 px-2.5 py-1.5 font-display text-base tracking-wide text-morro-950 transition hover:bg-grana-400 active:scale-95 disabled:cursor-not-allowed disabled:bg-morro-700 disabled:text-laje-100/40"
              >
                {fmtBRL(r.price)} <span className="text-[10px] opacity-70">[{i + 1}]</span>
              </button>
            </div>
          ))}

          {!isMercado && (
            <div className="hud-chip flex items-center gap-3 border-grana-400/40 px-3 py-2">
              <PackIcon />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold leading-tight text-laje-100">Vender pacotes</p>
                <p className="text-[11px] text-laje-100/50">{hud.inv.pacotes} na mochila · {fmtBRL(PRICES.venda)} cada</p>
              </div>
              <button
                onClick={() => game.sellPacotes()}
                disabled={hud.inv.pacotes === 0}
                className="btn-cut bg-sol-400 px-2.5 py-1.5 font-display text-base tracking-wide text-morro-950 transition hover:bg-sol-500 active:scale-95 disabled:cursor-not-allowed disabled:bg-morro-700 disabled:text-laje-100/40"
              >
                +{fmtBRL(hud.inv.pacotes * PRICES.venda)} <span className="text-[10px] opacity-70">[2]</span>
              </button>
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-laje-100/10 pt-3 text-[13px]">
          <span className="text-laje-100/55">Seu dinheiro</span>
          <span className="font-display text-xl text-grana-400">{fmtBRL(hud.money)}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- App ---------------- */
export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<QuintalGame | null>(null);
  const [hud, setHud] = useState<HudData | null>(null);
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    if (!mountRef.current || !minimapRef.current || !floatRef.current) return;
    const game = new QuintalGame({
      container: mountRef.current,
      minimap: minimapRef.current,
      floatLayer: floatRef.current,
      onHud: setHud,
    });
    gameRef.current = game;
    setIsTouch(window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window);
    return () => { game.dispose(); gameRef.current = null; };
  }, []);

  const g = gameRef.current;
  const playing = hud?.screen === "playing";
  const pct = hud ? Math.min(100, (hud.money / hud.meta) * 100) : 0;
  const mm = hud ? String(Math.floor(hud.stats.time / 60)).padStart(2, "0") : "00";
  const ss = hud ? String(hud.stats.time % 60).padStart(2, "0") : "00";

  return (
    <div className="relative h-full w-full overflow-hidden bg-morro-950 no-select">
      {/* canvas do jogo */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* textos flutuantes (+R$) */}
      <div ref={floatRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" />

      {/* radar (sempre montado — o motor desenha nele desde o boot) */}
      <div className="absolute right-3 top-3 z-20 flex flex-col items-end gap-2 sm:right-4 sm:top-4">
        <div className="hud-panel p-1.5">
          <p className="px-1 pb-1 text-right font-display text-sm tracking-[0.2em] text-laje-100/60">RADAR</p>
          <canvas ref={minimapRef} width={176} height={176} className="block w-36 sm:w-44" />
          <div className="flex justify-between px-1 pt-1 text-[9.5px] font-bold tracking-wider">
            <span className="text-grana-400">■ FEIRA</span>
            <span className="text-rojo-500">■ RECEPTADOR</span>
          </div>
        </div>
        {hud && hud.screen !== "start" && (
          <div className="flex gap-1.5">
            <button onClick={() => g?.togglePause()} className="hud-chip p-2 text-laje-100/80 hover:text-laje-100" aria-label="Pausar"><PauseIcon /></button>
            <button onClick={() => g?.toggleMute()} className="hud-chip p-2 text-laje-100/80 hover:text-laje-100" aria-label="Som"><SoundIcon off={hud.muted} /></button>
            <button
              onClick={() => g?.toggleDebug()}
              className={`hud-chip p-2 px-2.5 font-display text-base tracking-widest ${hud.debug ? "text-rojo-500 ring-1 ring-rojo-500/60" : "text-laje-100/80 hover:text-laje-100"}`}
              aria-label="Mostrar caixas de colisão"
            >
              DBG
            </button>
            <button
              onClick={() => g?.toggleFx()}
              className={`hud-chip p-2 px-2.5 font-display text-base tracking-widest ${hud.fx ? "text-sol-400 ring-1 ring-sol-400/60" : "text-laje-100/80 hover:text-laje-100"}`}
              aria-label="Pós-processamento (bloom)"
            >
              FX
            </button>
          </div>
        )}
      </div>

      {/* ============ HUD ============ */}
      {hud && hud.screen !== "start" && (
        <>
          {/* dinheiro + meta + inventário (topo esquerdo) */}
          <div className="absolute left-3 top-3 z-20 flex flex-col gap-2 sm:left-4 sm:top-4">
            <div className="hud-panel px-4 py-2.5">
              <p className="text-[10px] font-bold tracking-[0.24em] text-laje-100/45">GRANA</p>
              <p className="font-display text-4xl leading-none text-grana-400" style={{ textShadow: "0 0 18px rgba(61,220,132,0.35)" }}>
                {fmtBRL(hud.money)}
              </p>
              <div className="mt-2 h-2 w-44 bg-morro-800 sm:w-52">
                <div className="h-full transition-all duration-500" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#23c46d,#ffd23f)" }} />
              </div>
              <p className="mt-1 text-[10.5px] font-medium tracking-wide text-laje-100/50">
                META {fmtBRL(hud.meta)} · {mm}:{ss}
              </p>
            </div>
            <div className="flex gap-1.5">
              {([
                ["Vaso", hud.inv.vasos, <VasoIcon key="v" />],
                ["Terra", hud.inv.terra, <TerraIcon key="t" />],
                ["Semente", hud.inv.sementes, <SeedIcon key="s" />],
                ["Pacote", hud.inv.pacotes, <PackIcon key="p" />],
              ] as const).map(([label, n, icon]) => (
                <div key={label} className={`hud-chip flex items-center gap-1.5 px-2 py-1.5 text-xs font-bold ${n > 0 ? "text-laje-100" : "text-laje-100/35"}`}>
                  {icon}<span>{n}</span>
                </div>
              ))}
            </div>
            {(hud.growing > 0 || hud.ready > 0) && (
              <div className="hud-chip w-max px-2.5 py-1 text-[11px] font-bold tracking-wide text-laje-100/75">
                {hud.ready > 0 && <span className="text-sol-400">● {hud.ready} pronta{hud.ready > 1 ? "s" : ""} </span>}
                {hud.growing > 0 && <span className="text-grana-400">● {hud.growing} crescendo</span>}
              </div>
            )}
          </div>

          {/* prompt central */}
          {playing && hud.prompt && (
            <div className="pointer-events-none absolute bottom-28 left-1/2 z-20 -translate-x-1/2 sm:bottom-10">
              <div className={`prompt-pill flex items-center gap-2.5 px-5 py-2.5 ${hud.prompt.actionable ? "" : "opacity-70"}`}
                style={{ borderColor: hud.prompt.actionable ? undefined : "rgba(244,241,232,0.25)", boxShadow: hud.prompt.actionable ? undefined : "none" }}>
                {hud.prompt.actionable && (
                  <span className="btn-cut bg-sol-400 px-2 py-0.5 font-display text-lg leading-tight text-morro-950">{isTouch ? "TOQUE" : "E"}</span>
                )}
                <span className="text-[14px] font-bold tracking-wide text-laje-100">{hud.prompt.text}</span>
              </div>
            </div>
          )}

          {/* selo de modo debug (colisores visíveis) */}
          {hud.debug && (
            <div className="pointer-events-none absolute left-1/2 top-20 z-30 -translate-x-1/2 sm:top-24">
              <div className="hud-chip border-rojo-500/70 px-4 py-1.5 text-[11px] font-bold tracking-[0.22em] text-rojo-500" style={{ boxShadow: "0 0 18px rgba(255,93,93,0.35)" }}>
                DEBUG DE COLISÃO ATIVO — {isTouch ? "TOQUE EM DBG" : "C"} PARA SAIR
              </div>
            </div>
          )}

          {/* toast */}
          {hud.toast && (
            <div key={hud.toast.id} className="toast-anim pointer-events-none absolute bottom-44 left-1/2 z-30 sm:bottom-24">
              <div className="hud-chip border-sol-400/45 px-4 py-2 text-[13px] font-bold text-sol-400">{hud.toast.text}</div>
            </div>
          )}

          {/* dica de controles (desktop, some sozinho) */}
          {playing && !isTouch && !hud.shop && (
            <div className="pointer-events-none absolute bottom-3 left-3 z-10 hidden text-[11px] font-medium tracking-wide text-laje-100/40 md:block">
              WASD mover · ESPAÇO pular · E agir · arrastar gira a câmera · P pausa · C debug colisões
            </div>
          )}

          {/* controles touch */}
          {playing && isTouch && (
            <>
              <div className="absolute bottom-6 left-5 z-20">
                <Joystick onMove={(x, y) => g?.setJoystick(x, y)} />
              </div>
              <div className="absolute bottom-6 right-5 z-20 flex items-end gap-3">
                {hud.prompt?.actionable && (
                  <button
                    onPointerDown={(e) => { e.preventDefault(); g?.pressAction(); }}
                    className="action-btn flex h-20 w-20 flex-col items-center justify-center rounded-full font-display text-lg leading-none text-morro-950"
                  >
                    <span className="text-[10px] tracking-widest opacity-70">AÇÃO</span>
                    <span className="mt-0.5 max-w-[70px] text-center text-[13px]">{hud.prompt.text.split(" ")[0].toUpperCase()}</span>
                  </button>
                )}
                <button
                  onPointerDown={(e) => { e.preventDefault(); g?.pressJump(); }}
                  className="jump-btn flex h-28 w-28 flex-col items-center justify-center gap-0.5 rounded-full text-morro-950 transition-transform duration-75 active:scale-90"
                  aria-label="Pular"
                >
                  <JumpIcon />
                  <span className="font-display text-sm leading-none tracking-[0.22em]">PULAR</span>
                </button>
              </div>
            </>
          )}

          {/* loja */}
          {playing && hud.shop && g && <ShopPanel hud={hud} game={g} />}
        </>
      )}

      {/* ============ telas ============ */}
      {(!hud || hud.screen === "start") && <StartScreen onStart={() => g?.start()} />}

      {hud?.screen === "paused" && g && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-morro-950/78 backdrop-blur-[3px]">
          <div className="hud-panel slide-up mx-6 w-full max-w-sm px-8 py-7 text-center">
            <h2 className="font-display text-6xl tracking-wide text-sol-400" style={{ textShadow: "4px 4px 0 rgba(16,17,23,0.9)" }}>PAUSOU</h2>
            <p className="mt-1 text-[13px] text-laje-100/55">O morro espera, chefia.</p>
            <div className="mt-5 flex flex-col gap-2.5">
              <button onClick={() => g.resume()} className="btn-cut inline-flex items-center justify-center gap-2 bg-sol-400 px-6 py-3 font-display text-2xl tracking-wider text-morro-950 hover:bg-sol-500 active:scale-95">
                <PlayIcon /> CONTINUAR
              </button>
              <button onClick={() => g.restart()} className="btn-cut bg-morro-700 px-6 py-2.5 font-display text-xl tracking-wider text-laje-100 hover:bg-morro-800 active:scale-95">
                RECOMEÇAR
              </button>
              <button onClick={() => g.toggleMute()} className="mx-auto mt-1 inline-flex items-center gap-2 text-xs font-bold tracking-widest text-laje-100/60 hover:text-laje-100">
                <SoundIcon off={hud.muted} /> {hud.muted ? "SOM DESLIGADO" : "SOM LIGADO"}
              </button>
            </div>
          </div>
        </div>
      )}

      {hud?.screen === "win" && g && (
        <div className="absolute inset-0 z-30 flex items-center justify-center overflow-hidden bg-morro-950/85">
          <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 50% 38%, rgba(61,220,132,0.16), transparent 60%)" }} />
          <div className="slide-up relative mx-6 w-full max-w-lg px-8 py-8 text-center">
            <p className="font-bold tracking-[0.3em] text-grana-400">META BATIDA</p>
            <h2 className="mt-2 font-display text-7xl leading-[0.9] text-sol-400 sm:text-8xl" style={{ textShadow: "5px 5px 0 rgba(232,93,117,0.8), 10px 10px 0 rgba(16,17,23,0.9)" }}>
              PATRÃO<br />DO MORRO
            </h2>
            <p className="mx-auto mt-4 max-w-sm text-sm text-laje-100/75">
              Você juntou <strong className="text-grana-400">{fmtBRL(hud.money)}</strong> no esquema do quintal.
              O receptador já fala seu nome com respeito.
            </p>
            <div className="mx-auto mt-5 grid w-full max-w-sm grid-cols-3 gap-2">
              {([
                [`${mm}:${ss}`, "TEMPO"],
                [String(hud.stats.harvested), "COLHEITAS"],
                [String(hud.stats.sold), "VENDIDOS"],
              ] as const).map(([v, l]) => (
                <div key={l} className="hud-panel px-2 py-3">
                  <p className="font-display text-3xl text-laje-100">{v}</p>
                  <p className="mt-0.5 text-[10px] font-bold tracking-[0.2em] text-laje-100/45">{l}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button onClick={() => g.continueAfterWin()} className="btn-cut bg-grana-500 px-7 py-3 font-display text-2xl tracking-wider text-morro-950 hover:bg-grana-400 active:scale-95">
                MODO LIVRE
              </button>
              <button onClick={() => g.restart()} className="btn-cut bg-morro-700 px-7 py-3 font-display text-2xl tracking-wider text-laje-100 hover:bg-morro-800 active:scale-95">
                RECOMEÇAR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
