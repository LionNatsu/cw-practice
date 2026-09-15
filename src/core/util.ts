/** 常用工具函数。 */

/** 数值夹取。 */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 线性插值。 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 中位数（会复制数组排序）。 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** 平均值。 */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * 稳健标准差（基于中位数绝对偏差 MAD）。
 * 比普通标准差抗离群点，适合手键这种偶尔抽一下的数据。
 */
export function robustStd(values: readonly number[]): number {
  if (values.length < 3) return Number.NaN;
  const med = median(values);
  const dev = values.map((v) => Math.abs(v - med));
  return 1.4826 * median(dev);
}

/** 格式化毫秒。 */
export function fmtMs(ms: number, digits = 0): string {
  if (!Number.isFinite(ms)) return '--';
  return ms.toFixed(digits);
}

/** 简单节流。 */
export function throttle<T extends (...args: never[]) => void>(fn: T, waitMs: number): T {
  let last = 0;
  let pending: number | null = null;
  let lastArgs: unknown[] = [];
  const run = () => {
    last = performance.now();
    pending = null;
    fn(...(lastArgs as never[]));
  };
  return ((...args: never[]) => {
    lastArgs = args;
    const now = performance.now();
    const remain = waitMs - (now - last);
    if (remain <= 0) {
      if (pending !== null) {
        clearTimeout(pending);
        pending = null;
      }
      run();
    } else if (pending === null) {
      pending = window.setTimeout(run, remain);
    }
  }) as T;
}
