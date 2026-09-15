/**
 * 音频引擎：侧音（跟着你的手键响）+ 参考发送（用标准节奏播一遍）。
 *
 * 用 Web Audio 的振荡器做侧音，留出 4ms 的淡入淡出，避免“咔哒”声。
 * 参考发送用调度器一次性排好整个报文的包络，所以节奏是精确的、
 * 不受 JS 主线程抖动影响。
 */

import { ALL_CHAR_TO_PATTERN, patternDurationMs } from './morse.ts';

export interface AudioOptions {
  toneHz: number;
  volume: number;
}

export class MorseAudio {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private master: GainNode | null = null;
  private opts: AudioOptions = { toneHz: 700, volume: 0.35 };
  private active = false;

  constructor(opts: Partial<AudioOptions> = {}) {
    this.opts = { ...this.opts, ...opts };
  }

  setOptions(opts: Partial<AudioOptions>): void {
    this.opts = { ...this.opts, ...opts };
    if (this.osc) this.osc.frequency.value = this.opts.toneHz;
    if (this.master) this.master.gain.value = clamp01(this.opts.volume);
  }

  /** 必须先由用户手势触发（浏览器策略）。 */
  async resume(): Promise<void> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = clamp01(this.opts.volume);
      this.master.connect(this.ctx.destination);
      this.osc = this.ctx.createOscillator();
      this.osc.type = 'sine';
      this.osc.frequency.value = this.opts.toneHz;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      this.osc.connect(this.gain).connect(this.master);
      this.osc.start();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  get currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** 按下手键：起音。 */
  keyDown(): void {
    if (!this.ctx || !this.gain || !this.osc) return;
    const t = this.ctx.currentTime;
    this.osc.frequency.setValueAtTime(this.opts.toneHz, t);
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(0.0001, t);
    this.gain.gain.linearRampToValueAtTime(1, t + 0.004);
    this.active = true;
  }

  /** 抬起手键：收音。 */
  keyUp(): void {
    if (!this.ctx || !this.gain) return;
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(Math.max(this.gain.gain.value, 0.0001), t);
    this.gain.gain.linearRampToValueAtTime(0.0001, t + 0.004);
    this.active = false;
  }

  get isKeying(): boolean {
    return this.active;
  }

  /** 停掉所有声音。 */
  silence(): void {
    if (this.ctx && this.gain) {
      this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.gain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    }
    this.active = false;
  }

  /**
   * 负反馈：拍错一个字时给对方一个“没抄清”的短音。
   *
   * 两声下行的低音，和摩尔斯音明显不同（不是点也不是划），
   * 所以不会跟报文混淆。
   */
  async playBump(): Promise<void> {
    await this.resume();
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + 0.01;
    for (let i = 0; i < 2; i++) {
      const at = t0 + i * 0.16;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const g = ctx.createGain();
      g.gain.value = 0;
      osc.frequency.setValueAtTime(300, at);
      osc.frequency.exponentialRampToValueAtTime(150, at + 0.12);
      osc.connect(g).connect(this.master);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(0.5, at + 0.008);
      g.gain.linearRampToValueAtTime(0.0001, at + 0.13);
      osc.start(at);
      osc.stop(at + 0.16);
    }
  }

  /**
   * 参考发送一段文本（标准节奏），返回总时长 ms。
   * 播放途中调用 stopPlayback() 可以打断。
   *
   * 单位约定：内部一律用**秒**（Web Audio 的时间轴就是秒）。
   * 这里曾经踩过一个坑：把毫秒长度直接传给了包络函数，于是 100ms 的点
   * 被安排成 100 秒，听起来就是一整段长音。改动时务必保持单位一致。
   */
  async playText(text: string, wpm: number, opts: { toneHz?: number; onEnd?: () => void } = {}): Promise<number> {
    await this.resume();
    const ctx = this.ctx!;
    const dit = 1200 / Math.max(wpm, 1) / 1000; // 单位时长（秒）
    const tone = opts.toneHz ?? this.opts.toneHz;
    const start = ctx.currentTime + 0.08;

    // 参考发送走独立的 gain，避免和侧音抢同一条包络
    const playGain = ctx.createGain();
    playGain.gain.value = 0;
    const playOsc = ctx.createOscillator();
    playOsc.type = 'sine';
    playOsc.frequency.value = tone;
    playOsc.connect(playGain).connect(this.master!);

    let t = start;
    const words = text.trim().toUpperCase().split(/\s+/).filter(Boolean);
    for (let w = 0; w < words.length; w++) {
      const chars = [...words[w]!];
      for (let i = 0; i < chars.length; i++) {
        const pat = ALL_CHAR_TO_PATTERN[chars[i]!];
        if (!pat) continue;
        for (let s = 0; s < pat.length; s++) {
          const len = (pat[s] === '.' ? 1 : 3) * dit; // 秒
          scheduleTone(playGain.gain, t, len, TONE_RAMP);
          t += len + dit; // 码元间隔 1 单位
        }
        if (i < chars.length - 1) t += 2 * dit; // 字符间隔共 3 单位（1 单位已加）
      }
      if (w < words.length - 1) t += 4 * dit; // 词间隔共 7 单位
    }
    const total = (t - start) * 1000;
    playOsc.start(start);
    playOsc.stop(t + 0.05);
    this.playback = { osc: playOsc, gain: playGain };
    window.setTimeout(
      () => {
        this.playback = null;
        try {
          playGain.disconnect();
        } catch {
          /* ignore */
        }
        opts.onEnd?.();
      },
      Math.max(0, total) + 120,
    );
    return total;
  }

  private playback: { osc: OscillatorNode; gain: GainNode } | null = null;

  stopPlayback(): void {
    if (!this.ctx || !this.playback) return;
    const t = this.ctx.currentTime;
    this.playback.gain.gain.cancelScheduledValues(t);
    this.playback.gain.gain.setValueAtTime(0.0001, t);
    try {
      this.playback.osc.stop(t + 0.02);
    } catch {
      /* ignore */
    }
    this.playback = null;
  }

  get isPlaying(): boolean {
    return this.playback !== null;
  }

  /** 单个码字的时长（ms），用于 UI 预估。 */
  static patternMs(pattern: string, wpm: number): number {
    return patternDurationMs(pattern, 1200 / Math.max(wpm, 1));
  }
}

/** 侧音的淡入淡出时长（秒），避免起停时的“咔哒”声。 */
const TONE_RAMP = 0.006;

/** 给一个音排好包络：起、保持、落。时间单位一律是秒。 */
function scheduleTone(param: AudioParam, at: number, lenSec: number, ramp: number): void {
  const holdUntil = at + Math.max(ramp, lenSec - ramp);
  param.setValueAtTime(0.0001, at);
  param.linearRampToValueAtTime(1, at + ramp);
  param.setValueAtTime(1, holdUntil);
  param.linearRampToValueAtTime(0.0001, at + lenSec);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
