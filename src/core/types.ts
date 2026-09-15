/**
 * 核心数据类型定义。
 *
 * 时间单位：全部用毫秒（ms）。
 * "unit" 指用户当前的点（dit）时长，即国际摩尔斯码里的 1 个单位时间。
 */

/** 一次按键（物理按下到抬起）。 */
export interface Press {
  /** 按下时刻（performance.now() 量纲）。 */
  down: number;
  /** 抬起时刻。 */
  up: number;
  /** 持续时间 ms（= up - down）。 */
  duration: number;
}

/** 按键被分类成的码元。 */
export type SymbolKind = 'dit' | 'dah';

/** 一次按键的分类结果。 */
export interface ClassifiedSymbol {
  /** 第几次按键（从 0 开始）。 */
  index: number;
  press: Press;
  kind: SymbolKind;
  /** 该按键与上一次按键抬起之间的静音时长 ms；第一次为 null。 */
  gapBefore: number | null;
  /** gapBefore 折算成多少个单位。 */
  gapUnits: number | null;
  /**
   * 该按键按 dit 假设的解释代价（越小越像 dit）。
   * 详情见 timing-model.ts。
   */
  costDit: number;
  /** 按 dah 假设的解释代价。 */
  costDah: number;
  /** 分类置信度 0..1（1 = 毫无悬念）。 */
  confidence: number;
}

/** 单位时长的统计模型（自适应）。 */
export interface TimingModelStats {
  /** 当前认为的 dit 时长（ms）。 */
  dit: number;
  /** 当前认为的 dah 时长（ms）。 */
  dah: number;
  /** dit 时长的相对标准差（变异系数），0.1~0.35 属于正常手键水平。 */
  cvDit: number;
  /** dah 时长的相对标准差。 */
  cvDah: number;
  /** 已观察到的 dit 个数。 */
  nDit: number;
  /** 已观察到的 dah 个数。 */
  nDah: number;
  /** 分类错误的估计概率（用于置信度与评分）。 */
  perSymbolError: number;
  /** 节奏稳定度 0..100（100 = 非常稳）。 */
  rhythmScore: number;
  /** 当前隐含速度 WPM。 */
  wpm: number;
}

/** 解码器给出的一个候选码字。 */
export interface Candidate {
  /** 码字（可能是字母、数字、标点或 $ 之类的自定义记号）。 */
  text: string;
  /** 对数似然代价，越小越可能。 */
  cost: number;
  /** 相对概率 0..1（同一时刻的候选之间归一化）。 */
  probability: number;
  /** 码元序列，如 "-.-."。 */
  pattern: string;
}

/** 已定稿（可以显示、不会再变化，除非回改）的一个字符。 */
export interface CommittedChar {
  /** 稳定 id，随提交顺序递增。 */
  id: number;
  /** 解码出的字符。 */
  text: string;
  /** 摩尔斯码形。 */
  pattern: string;
  /** 该字符的码元个数。 */
  symbolCount: number;
  /** 定稿时刻。 */
  at: number;
  /** 该字符内部各按键的置信度最小值。 */
  confidence: number;
  /** 是否与目标文本对齐后判断为正确（未对齐前为 null）。 */
  correct: boolean | null;
  /** 是否允许被后续证据改写（刚提交、证据不足时为 true）。 */
  revisable: boolean;
  /** 被改写过几次。 */
  revisions: number;
  /** 备选解释（次优候选），用于“是不是想发 X？”提示。 */
  alternatives: Candidate[];
}

/** 一次“回改”记录，用于把前面若干字符的正误修正掉。 */
export interface RevisionEvent {
  /** 被改写的字符 id。 */
  id: number;
  from: string;
  to: string;
  reason: string;
  at: number;
}

/** 目标文本中的一个字符及其练习元数据。 */
export interface TargetChar {
  /** 目标字符（大写）。 */
  ch: string;
  /** 这个字符应该发成什么。 */
  pattern: string;
  /** 该字符在课程中是否属于“新学”内容。 */
  isNew: boolean;
  /** 该字符所属词组的序号（用于分组显示）。 */
  groupIndex: number;
}

/** 课程里的一条练习条目。 */
export interface LessonItem {
  /** 练习内容，允许包含占位符如 {CALLSIGN}。 */
  text: string;
  /** 中文含义 / 提示。 */
  gloss?: string;
  /** 可选备注，例如“注意 R 与 K 的区别”。 */
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

/** 单次按键的评分结果。 */
export interface CharScore {
  /** 对应 committed char id；null 表示多打出来的字符。 */
  id: number | null;
  /** 目标字符；null 表示多打。 */
  target: string | null;
  /** 实际发出的字符；null 表示漏打。 */
  actual: string | null;
  /** 判定。 */
  verdict: 'correct' | 'wrong' | 'extra' | 'missing';
}

/** 一次完整练习的成绩。 */
export interface SessionScore {
  /** 字符总数（目标长度）。 */
  total: number;
  correct: number;
  wrong: number;
  extra: number;
  missing: number;
  /** 字符准确率 0..1 = correct / total。 */
  accuracy: number;
  /** 码元准确率 0..1（按码元级别估算）。 */
  symbolAccuracy: number;
  /** 按键总时长统计，用于诊断“太用力/太快”。 */
  timing: TimingModelStats;
  /** 逐字符判定。 */
  chars: CharScore[];
  /** 易错字符统计：目标字符 -> 错误次数。 */
  confusion: Array<{ target: string; actual: string | null; count: number }>;
  /** 用时 ms。 */
  elapsed: number;
  /** 有效按键数。 */
  pressCount: number;
}
