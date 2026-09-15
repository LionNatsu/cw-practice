/** 本地设置与进度持久化（localStorage）。 */

export interface AppSettings {
  /** 你的呼号，用于课程里的 CQ / DE 报文。 */
  callsign: string;
  /** 起始速度 WPM，只作为先验；实际速度跟着你的手走。 */
  wpm: number;
  /** 侧音频率 Hz。 */
  toneHz: number;
  /** 侧音音量 0..1。 */
  volume: number;
  /** 上次练习的课程 id。 */
  lastLessonId: string;
  /** 上次练习的条目下标。 */
  lastItemIndex: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  callsign: 'BG1ABC',
  wpm: 12,
  toneHz: 700,
  volume: 0.35,
  lastLessonId: 'l1-rhythm',
  lastItemIndex: 0,
};

const KEY = 'cw-practice/settings/v1';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式等情况下静默失败 */
  }
}

/** 统计：每个字符的练习次数与错误次数。 */
export interface ProgressState {
  /** 字符 → { seen, wrong } */
  chars: Record<string, { seen: number; wrong: number }>;
  /** 课程 → { attempts, bestAccuracy, lastAt } */
  lessons: Record<string, { attempts: number; bestAccuracy: number; lastAt: number }>;
  /** 总练习时长 ms。 */
  totalMs: number;
  /** 总按键数。 */
  totalPresses: number;
}

export const EMPTY_PROGRESS: ProgressState = { chars: {}, lessons: {}, totalMs: 0, totalPresses: 0 };

const PROGRESS_KEY = 'cw-practice/progress/v1';

export function loadProgress(): ProgressState {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return structuredClone(EMPTY_PROGRESS);
    return { ...structuredClone(EMPTY_PROGRESS), ...(JSON.parse(raw) as ProgressState) };
  } catch {
    return structuredClone(EMPTY_PROGRESS);
  }
}

export function saveProgress(p: ProgressState): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/** 把一次练习结果并进累计进度。 */
export function mergeScore(
  progress: ProgressState,
  lessonId: string,
  accuracy: number,
  elapsedMs: number,
  pressCount: number,
  perChar: Array<{ ch: string; correct: boolean }>,
): ProgressState {
  const next = structuredClone(progress);
  next.totalMs += elapsedMs;
  next.totalPresses += pressCount;
  const lesson = next.lessons[lessonId] ?? { attempts: 0, bestAccuracy: 0, lastAt: 0 };
  lesson.attempts += 1;
  lesson.bestAccuracy = Math.max(lesson.bestAccuracy, accuracy);
  lesson.lastAt = Date.now();
  next.lessons[lessonId] = lesson;
  for (const c of perChar) {
    const entry = next.chars[c.ch] ?? { seen: 0, wrong: 0 };
    entry.seen += 1;
    if (!c.correct) entry.wrong += 1;
    next.chars[c.ch] = entry;
  }
  return next;
}

/** 你已经练“熟”的字符（用于标记课程里的新字符）。 */
export function masteredChars(progress: ProgressState, minSeen = 6, maxErrorRate = 0.25): Set<string> {
  const out = new Set<string>();
  for (const [ch, s] of Object.entries(progress.chars)) {
    if (s.seen >= minSeen && s.wrong / s.seen <= maxErrorRate) out.add(ch);
  }
  return out;
}
