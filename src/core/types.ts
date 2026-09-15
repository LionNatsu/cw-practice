/**
 * 核心数据类型。
 *
 * 时间单位一律毫秒。“单位”指用户当前的点长，也就是国际摩尔斯码里的 1 个单位时间。
 */

/** 一次按键被读成的码元。 */
export type SymbolKind = 'dit' | 'dah';

/** 目标文本中的一个字符及其练习元数据。 */
export interface TargetChar {
  /** 目标字符（大写）。 */
  ch: string;
  /** 这个字符该发成什么。 */
  pattern: string;
  /** 是否属于本课的生字。 */
  isNew: boolean;
  /** 所属词组的序号，用来分词显示。 */
  groupIndex: number;
}

/** 课程里的一条练习条目。 */
export interface LessonItem {
  /** 练习内容，可含占位符如 {CALLSIGN}。 */
  text: string;
  /** 中文含义。 */
  gloss?: string;
  /** 可选备注。 */
  note?: string;
}

/** 一课。 */
export interface Lesson {
  id: string;
  title: string;
  /** 难度分级，1 最易。 */
  level: 1 | 2 | 3 | 4 | 5;
  /** 一句话说明本课练什么。 */
  summary: string;
  /** 本课重点字符。 */
  focus: string[];
  items: LessonItem[];
}

/** 单个字的判定。 */
export interface CharScore {
  target: string | null;
  actual: string | null;
  verdict: 'correct' | 'missing';
  /** 这个位置拍错过几次（拍错之后重拍对了也算）。 */
  missed: number;
}

/** 一次练习的成绩。 */
export interface SessionScore {
  total: number;
  correct: number;
  /** 拍错的次数（同一个字拍错几次算几次）。 */
  wrong: number;
  missing: number;
  /** 字符准确率 0..1。 */
  accuracy: number;
  chars: CharScore[];
  elapsed: number;
  pressCount: number;
  timing: {
    /** 你的点长 ms。 */
    dit: number;
    /** 你的划长 ms。 */
    dah: number;
    wpm: number;
    /** 节奏稳定度 0..100。 */
    rhythm: number;
  };
}
