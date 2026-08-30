/* ============================================================
   QUINTAL 3D — Sfx (WebAudio, sem assets externos)
   ============================================================ */
export class Sfx {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  private blip(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq = 1200) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = freq; f.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  jump() { this.blip(240, 0.16, "square", 0.12, 240); }
  land() { this.noise(0.08, 0.1, 500); }
  step() { this.noise(0.03, 0.02, 900); }
  buy() { this.blip(660, 0.09, "triangle", 0.16); setTimeout(() => this.blip(990, 0.12, "triangle", 0.14), 80); }
  sell() { this.blip(520, 0.08, "triangle", 0.15); setTimeout(() => this.blip(780, 0.1, "triangle", 0.15), 70); setTimeout(() => this.blip(1040, 0.16, "triangle", 0.15), 150); }
  plant() { this.noise(0.14, 0.14, 420); this.blip(180, 0.18, "sine", 0.12, -60); }
  harvest() { this.blip(880, 0.1, "square", 0.1, 220); this.noise(0.1, 0.08, 1600); }
  stageUp() { this.blip(440, 0.14, "sine", 0.12, 220); setTimeout(() => this.blip(660, 0.18, "sine", 0.1, 120), 90); }
  error() { this.blip(140, 0.2, "sawtooth", 0.12, -40); }
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.3, "triangle", 0.16), i * 130)); }
  ui() { this.blip(500, 0.05, "triangle", 0.08); }
}
