/**
 * 自适应时序模型：从用户真实拍发的按键里估计“点”和“划”的时长。
 *
 * 为什么需要它：手键不是机器，同一个人的 dit 时长会随状态漂移；
 * 而且不同的人天生节奏不同（80ms 的点和 130ms 的点都很正常）。
 * 所以绝不写死“小于 X ms 就是点”，而是用在线估计出的分布去算似然。
 *
 * 统计假设：dit/dah 的时长近似对数正态分布（手键实测比较符合，
 * 而且天然保证时长为正）。分类时比较 log p(dur | dit) 与 log p(dur | dah)。
 */

import type { Press, ClassifiedSymbol, SymbolKind, TimingModelStats } from './types.ts';
import { clamp, robustStd } from './util.ts';

/** 默认起始速度 12 WPM（每个点 100ms）。 */
export const DEFAULT_WPM = 12;
/** 标准词 PARIS 的 dit 时长公式：WPM = 1200 / ditMs。 */
export const WPM_FACTOR = 1200;

/** dit 与 dah 的时长比，标准是 1:3。 */
export const DAH_RATIO = 3;

const MS_MIN = 12;
const MS_MAX = 900;

/** 对数正态分布的 sigma 下限/上限（相对标准差）。
 * 下限不能太小：USB HID 只有 8ms 上报粒度，点长几十毫秒时量化误差就很可观，
 * 模型若声称"比硬件还准"，会把正常拍发也算成低置信度。
 */
const SIGMA_MIN = 0.15;
const SIGMA_MAX = 0.45;

/** 自适应重估时使用最近这么多次按键。 */
const REFIT_WINDOW = 64;

/** 认为用户不需要“被打分”的最少码元数。 */
const MIN_SAMPLES_FOR_STATS = 6;

export function wpmFromDit(ditMs: number): number {
  return WPM_FACTOR / Math.max(ditMs, 1e-6);
}

export function ditFromWpm(wpm: number): number {
  return WPM_FACTOR / Math.max(wpm, 1e-6);
}

/** 对数正态的负对数似然（丢掉常数项，只保留可比较的部分）。 */
export function negLogLikelihood(duration: number, mu: number, sigma: number): number {
  if (duration <= 0 || mu <= 0) return Number.POSITIVE_INFINITY;
  const z = Math.log(duration / mu) / sigma;
  return 0.5 * z * z + Math.log(sigma);
}

/** 一次观测。 */
export interface Observation {
  duration: number;
  /** 上一次按键抬起到这次按下的静音时长；null 表示这是第一个码元。 */
  gapBefore: number | null;
}

export class TimingModel {
  /**
   * 当前 dit 估计（ms）。用很小的 EMA 权重随观察漂移，
   * 但如果用户明确指定了速度（锁定），则保持不动。
   */
  ditMs: number;
  /** 当前 dah 估计（ms）。 */
  dahMs: number;
  /** dit 观测集（滑动窗口，用于稳健统计）。 */
  private ditObs: number[] = [];
  private dahObs: number[] = [];
  /** 观测对数 log(dur / mu) 的滑动窗口，用来估 sigma。 */
  private ditLogs: number[] = [];
  private dahLogs: number[] = [];
  /** 最近一批按键的原始时长，用来自适应重估模型。 */
  private recent: number[] = [];
  private window = 40;
  /** 速度是否被用户锁定（锁定后 ditMs 不随观测漂移，但仍统计节奏）。 */
  speedLocked = false;
  /** 开始练习以来所有观测，用于统计报告。 */
  readonly allDits: number[] = [];
  readonly allDahs: number[] = [];

  constructor(wpm = DEFAULT_WPM, opts: { speedLocked?: boolean } = {}) {
    this.ditMs = ditFromWpm(wpm);
    this.dahMs = this.ditMs * DAH_RATIO;
    this.speedLocked = opts.speedLocked ?? false;
  }

  /** 用目标速度重置（用于跟随自动键/标准音）。 */
  setSpeed(wpm: number, locked = this.speedLocked): void {
    this.ditMs = ditFromWpm(wpm);
    this.dahMs = this.ditMs * DAH_RATIO;
    this.speedLocked = locked;
    this.ditObs = [];
    this.dahObs = [];
    this.ditLogs = [];
    this.dahLogs = [];
    this.recent = [];
  }

  get sigmaDit(): number {
    const s = this.sigmaOf(this.ditLogs, this.ditObs.length);
    return s;
  }

  get sigmaDah(): number {
    const s = this.sigmaOf(this.dahLogs, this.dahObs.length);
    return s;
  }

  private sigmaOf(logs: readonly number[], n: number): number {
    if (n < 4) return 0.2;
    const absLogs = logs.map((v) => Math.abs(v));
    const robust = robustStd(absLogs) * 1.4;
    return clamp(Number.isFinite(robust) ? robust : 0.2, SIGMA_MIN, SIGMA_MAX);
  }

  /**
   * 用当前模型给一次按键打分（似然）。
   * 返回负对数似然，越小越像假设中的那种码元。
   */
  scoreDitSymbol(duration: number): number {
    return negLogLikelihood(duration, this.ditMs, this.sigmaDit);
  }

  scoreDahSymbol(duration: number): number {
    return negLogLikelihood(duration, this.dahMs, this.sigmaDah);
  }

  /** 只根据按键时长做一次快速分类（不含 gap 信息）。 */
  classifyByDuration(duration: number): {
    kind: SymbolKind;
    confidence: number;
    costDit: number;
    costDah: number;
  } {
    const costDit = this.scoreDitSymbol(duration);
    const costDah = this.scoreDahSymbol(duration);
    const kind: SymbolKind = costDit <= costDah ? 'dit' : 'dah';
    const confidence = likelihoodConfidence(costDit, costDah, this.separation);
    return { kind, confidence, costDit, costDah };
  }

  /**
   * 喂入新观测，更新模型。
   *
   * 关键点：先按“旧模型”分类（因为分类时你还不知道这次按键会教给模型什么），
   * 再按分类结果更新。这样避免了自我实现的偏差。
   */
  update(obs: Observation): void {
    const { duration } = obs;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const { kind } = this.classifyByDuration(duration);
    this.observe(kind, duration);
  }

  /** 把一次按键按已知码元类型计入统计（用于诊断面板/回放校准）。 */
  observe(kind: SymbolKind, duration: number): void {
    const d = clamp(duration, MS_MIN, MS_MAX);
    // 1) 先按当前分类把观测放进滑动窗口（用于统计与展示）
    if (kind === 'dit') this.allDits.push(d);
    else this.allDahs.push(d);
    // 2) 再按"最近这么多下按键"整体重估模型
    this.recent.push(d);
    if (this.recent.length > REFIT_WINDOW) this.recent.splice(0, this.recent.length - REFIT_WINDOW);
    this.refit();
  }

  /**
   * 用最近一批按键整体重估"点长 / 划长 / 手抖程度"。
   *
   * 为什么要整体重估，而不是只做单向的指数滑动平均：
   * 一旦某次分类把 150ms 的"点"误判成"划"，这个错误会被直接吸收进 dah 的估计，
   * 模型越跑越歪（实测会把点划合并到一起去）。
   *
   * 这里改成跑一次 2-means：
   *  - 初始化：用当前模型分类；若有一类为空（新手第一下往往是这种情况），
   *    就用这批观测的最小/最大值当两个中心，保证一定能分出来；
   *  - 迭代若干轮重新指派 + 重算中心；
   *  - 最后用两个簇的 log 偏差算 sigma。
   * 这样误差不会自我强化，点划本来就重叠时也能如实反映（sigma 变大、置信度降低）。
   */
  private refit(): void {
    const n = this.recent.length;
    if (n === 0) return;

    let cDit = this.ditMs;
    let cDah = this.dahMs;
    const durs = this.recent;
    const min = Math.min(...durs);
    const max = Math.max(...durs);

    let ditList: number[] = [];
    let dahList: number[] = [];
    for (let iter = 0; iter < 4; iter++) {
      ditList = [];
      dahList = [];
      const mid = Math.sqrt(cDit * cDah); // 在对数尺度上取中点分类
      for (const d of durs) {
        if (d <= mid) ditList.push(d);
        else dahList.push(d);
      }
      // 某一类为空：用极值兜底，保证两个簇都存在
      if (ditList.length === 0 || dahList.length === 0) {
        if (min === max) return; // 所有观测一模一样，没什么可学的
        cDit = min;
        cDah = max;
        continue;
      }
      const newDit = ditList.reduce((a, b) => a + b, 0) / ditList.length;
      const newDah = dahList.reduce((a, b) => a + b, 0) / dahList.length;
      const settled = Math.abs(newDit - cDit) < 0.5 && Math.abs(newDah - cDah) < 0.5;
      cDit = newDit;
      cDah = newDah;
      if (settled) break;
    }

    if (ditList.length === 0 || dahList.length === 0) return;
    ditList.sort((a, b) => a - b);
    dahList.sort((a, b) => a - b);
    if (!this.speedLocked) {
      this.ditMs = clamp(trimmedMean(ditList), MS_MIN, MS_MAX);
      this.dahMs = clamp(trimmedMean(dahList), MS_MIN, MS_MAX);
      if (this.dahMs < this.ditMs * 1.5) this.dahMs = this.ditMs * 1.5;
    }
    this.ditObs = ditList;
    this.dahObs = dahList;
    this.ditLogs = ditList.map((d) => Math.log(d / this.ditMs));
    this.dahLogs = dahList.map((d) => Math.log(d / this.dahMs));
  }

  /** 当前单位时长（用于判断 gap 是词内 / 字符间 / 词间）。 */
  get unitMs(): number {
    return this.ditMs;
  }

  /** 当前隐含速度。 */
  get wpm(): number {
    return wpmFromDit(this.ditMs);
  }

  /**
   * 「点」和「划」两个分布的可分性：|ln(dah/dit)| / sigma。
   * 越大越不容易混；小于约 1.6 时说明点划区间已经开始重叠。
   */
  get separation(): number {
    return Math.log(this.dahMs / this.ditMs) / Math.max(this.sigmaDit, this.sigmaDah);
  }

  /** 码元级误分类概率估计（用于置信度和“未来会被打错”的预期）。 */
  get perSymbolError(): number {
    const n = this.ditObs.length + this.dahObs.length;
    if (n < MIN_SAMPLES_FOR_STATS) return 0.05;
    const p = 1 / (1 + Math.exp(this.separation - 1.35));
    return clamp(p, 0.001, 0.4);
  }

  /** 节奏稳定度 0..100：由 dit 时长的变异系数换算。 */
  get rhythmScore(): number {
    const cv = this.sigmaDit;
    return clamp(Math.round(100 * (1 - (cv - 0.08) / 0.4)), 0, 100);
  }

  get stats(): TimingModelStats {
    return {
      dit: this.ditMs,
      dah: this.dahMs,
      cvDit: this.sigmaDit,
      cvDah: this.sigmaDah,
      nDit: this.ditObs.length,
      nDah: this.dahObs.length,
      perSymbolError: this.perSymbolError,
      rhythmScore: this.rhythmScore,
      wpm: this.wpm,
    };
  }

  /** 导出/导入，便于把“你的手速画像”存起来下次直接用。 */
  serialize(): { ditMs: number; dahMs: number; ditObs: number[]; dahObs: number[]; speedLocked: boolean } {
    return {
      ditMs: this.ditMs,
      dahMs: this.dahMs,
      ditObs: [...this.ditObs],
      dahObs: [...this.dahObs],
      speedLocked: this.speedLocked,
    };
  }

  restore(data: ReturnType<TimingModel['serialize']>): void {
    this.ditMs = clamp(data.ditMs, MS_MIN, MS_MAX);
    this.dahMs = clamp(data.dahMs, MS_MIN, MS_MAX);
    this.ditObs = [...data.ditObs].slice(-this.window);
    this.dahObs = [...data.dahObs].slice(-this.window);
    this.ditLogs = this.ditObs.map((d) => Math.log(d / this.ditMs));
    this.dahLogs = this.dahObs.map((d) => Math.log(d / this.dahMs));
    this.speedLocked = data.speedLocked;
  }
}


/** 截尾平均（去掉最大的 10%，抗离群点）。 */
function trimmedMean(sorted: readonly number[]): number {
  if (sorted.length === 0) return Number.NaN;
  const keep = Math.max(1, Math.floor(sorted.length * 0.9));
  let sum = 0;
  for (let i = 0; i < keep; i++) sum += sorted[i]!;
  return sum / keep;
}


/**
 * 由两个负对数似然算分类置信度 0..1。
 *
 * 直觉定义：「这次按键更像点还是更像划」的分明程度，再乘上模型本身的分辨能力
 * （点划两个分布的重叠程度）。两种不确定来源取较悲观的那个：
 *   - 这次观测本身贴近两类的分界 → 不确定；
 *   - 用户的点和划本来就分不开 → 无论观测多"标准"都不该报高置信度。
 *
 * 返回 0.5 表示"完全说不准"，这比返回 0 更直观：UI 上 0.5 就是
 * "猜的，可能有错"。
 */
export function likelihoodConfidence(costDit: number, costDah: number, separation = 6): number {
  if (!Number.isFinite(costDit) || !Number.isFinite(costDah)) return 0.5;
  // 观测层面的分明程度
  const d = Math.max(0, Math.abs(costDit - costDah));
  const decided = 1 - Math.exp(-d / 2.0);
  // 模型层面的分辨能力（separation ≈ |ln(dah/dit)| / sigma）
  const separable = 1 - Math.exp(-Math.max(0, separation) / 3.0);
  return clamp(0.5 + 0.49 * Math.min(decided, separable), 0, 0.99);
}

/**
 * 给一串观测重新打分（离线复核用）。
 * 返回每个观测按给定模型的分类结果，便于 Viterbi 里反复调用。
 */
export function classifyObservation(
  model: TimingModel,
  duration: number,
): { costDit: number; costDah: number; kind: SymbolKind } {
  const costDit = model.scoreDitSymbol(duration);
  const costDah = model.scoreDahSymbol(duration);
  return { costDit, costDah, kind: costDit <= costDah ? 'dit' : 'dah' };
}

/** 由若干 Press 构造观测序列。 */
export function observationsFromPresses(presses: readonly Press[]): Observation[] {
  const out: Observation[] = [];
  for (let i = 0; i < presses.length; i++) {
    const p = presses[i]!;
    const prev = i > 0 ? presses[i - 1]! : null;
    out.push({ duration: p.duration, gapBefore: prev ? p.down - prev.up : null });
  }
  return out;
}

/** 把分类结果组装成 ClassifiedSymbol。 */
export function makeClassified(
  index: number,
  press: Press,
  gapBefore: number | null,
  model: TimingModel,
): ClassifiedSymbol {
  const costDit = model.scoreDitSymbol(press.duration);
  const costDah = model.scoreDahSymbol(press.duration);
  const kind: SymbolKind = costDit <= costDah ? 'dit' : 'dah';
  return {
    index,
    press,
    kind,
    gapBefore,
    gapUnits: gapBefore === null ? null : gapBefore / model.unitMs,
    costDit,
    costDah,
    confidence: likelihoodConfidence(costDit, costDah, model.separation),
  };
}
