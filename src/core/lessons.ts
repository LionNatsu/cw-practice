/**
 * 练习课程内容。
 *
 * 设计原则（按用户要求）：
 * - 不练随机字母，全是有意义的词组、缩略语和真实风格的报文；
 * - 每条都带中文含义，便于“整体辨识”而不是逐字死记；
 * - 从单字符节奏（E/T、A/N）逐步走到完整 QSO。
 *
 * 文本里可以用 {CALLSIGN} 占位符，运行时会替换成设置里的呼号。
 */

import type { Lesson } from './types.ts';

export type { Lesson };

/** 常用呼号示例，用于课程里的对方台。 */
export const DEMO_CALLS = ['BG1ABC', 'BH4XYZ', 'JA1XYZ', 'DL2ABC', 'W1AW', 'VR2ABC'] as const;

/** 把占位符替换成实际呼号。 */
export function resolvePlaceholders(text: string, callsign: string): string {
  const cs = (callsign || 'BG1ABC').toUpperCase().replace(/\s+/g, '');
  return text.replaceAll('{CALLSIGN}', cs).toUpperCase();
}

export const LESSONS: readonly Lesson[] = [
  {
    id: 'l1-rhythm',
    title: '第 1 课　点与划的节奏（E / T）',
    level: 1,
    summary: '先用最简单的 E（一个点）和 T（一个划）建立“1 单位 / 3 单位”的手感。追求点划分明，不追求快。',
    focus: ['E', 'T'],
    items: [
      { text: 'E', gloss: 'E —— 一个点（1 单位）', note: '点要短促干脆' },
      { text: 'T', gloss: 'T —— 一个划（3 单位）', note: '划是点的 3 倍长，别用蛮力按住' },
      { text: 'TE', gloss: 'TE —— 练点划交替' },
      { text: 'ET', gloss: 'ET —— 反过来再来一遍' },
      { text: 'TEE', gloss: 'TEE ── 划+点+点' },
      { text: 'TEET', gloss: 'TEET ── 混合练习' },
      { text: 'EEEE', gloss: 'EEEE ── 连续四个点，听有没有越拍越快' },
      { text: 'TTTT', gloss: 'TTTT ── 连续四个划，听长短是否一致' },
    ],
  },
  {
    id: 'l1-an',
    title: '第 2 课　A / N（.− / −.）',
    level: 1,
    summary: 'A 和 N 是互为镜像的两个码，用来检验你是否真的点划分明。',
    focus: ['A', 'N'],
    items: [
      { text: 'A', gloss: 'A = .−' },
      { text: 'N', gloss: 'N = −.' },
      { text: 'AN', gloss: 'AN —— 点划 / 划点' },
      { text: 'NA', gloss: 'NA —— 反过来' },
      { text: 'ANA', gloss: 'ANA ── 常见于人名 Anna' },
      { text: 'NAN', gloss: 'NAN' },
      { text: 'ETAN', gloss: 'ETAN ── 四个最基础的码连起来' },
      { text: 'TEN', gloss: 'TEN（十）', note: 'T-E-N，注意 E 要短' },
      { text: 'NET', gloss: 'NET（网络）' },
      { text: 'ANT', gloss: 'ANT（天线）' },
    ],
  },
  {
    id: 'l1-imso',
    title: '第 3 课　I / M / S / O',
    level: 1,
    summary: '两个点、两个划，以及三个点、三个划。这组码最能暴露“点越拍越长”的毛病。',
    focus: ['I', 'M', 'S', 'O'],
    items: [
      { text: 'I', gloss: 'I = ..' },
      { text: 'M', gloss: 'M = −−' },
      { text: 'S', gloss: 'S = ...' },
      { text: 'O', gloss: 'O = −−−' },
      { text: 'SOS', gloss: 'SOS ── 国际求救信号', note: 'SOS 其实是连拍的 ...−−−...，没有字间隔' },
      { text: 'MOM', gloss: 'MOM（妈妈）' },
      { text: 'SIS', gloss: 'SIS' },
      { text: 'MISO', gloss: 'MISO' },
      { text: 'OM', gloss: 'OM ── 老伙计（Old Man，OM 是对男火腿的称呼）' },
      { text: 'XYL', gloss: 'XYL ── 妻子（火腿圈用语）' },
    ],
  },
  {
    id: 'l2-abbrev-basic',
    title: '第 4 课　最常用的两个字母缩略语',
    level: 2,
    summary: 'CW 通联里一半的话都是靠这些缩略语完成的。认整块，不要逐字拼。',
    focus: ['K', 'R', 'D', 'G', 'U', 'H'],
    items: [
      { text: 'DE', gloss: 'DE ── “这里是……”（报文开头声明呼号）' },
      { text: 'K', gloss: 'K ── 请回答（通用呼叫）' },
      { text: 'KN', gloss: 'KN ── 只请指定电台回答' },
      { text: 'R', gloss: 'R ── 收到 / 正确' },
      { text: 'FB', gloss: 'FB ── 非常好（Fine Business）' },
      { text: 'TU', gloss: 'TU ── 谢谢（Thank You）' },
      { text: 'GM', gloss: 'GM ── 早上好（Good Morning）' },
      { text: 'GA', gloss: 'GA ── 下午好 / 请回答（Good Afternoon / Go Ahead）' },
      { text: 'GE', gloss: 'GE ── 晚上好（Good Evening）' },
      { text: 'GN', gloss: 'GN ── 晚安（Good Night）' },
      { text: 'ES', gloss: 'ES ── 和（and）' },
      { text: 'HR', gloss: 'HR ── 这里（here）' },
      { text: 'UR', gloss: 'UR ── 你的 / 你是（your / you are）' },
      { text: 'WX', gloss: 'WX ── 天气（weather）' },
      { text: 'RIG', gloss: 'RIG ── 电台设备' },
      { text: 'ANT', gloss: 'ANT ── 天线' },
      { text: 'PWR', gloss: 'PWR ── 功率（power）' },
      { text: 'CQ', gloss: 'CQ ── 公开呼叫（喊话找人）' },
      { text: 'DX', gloss: 'DX ── 远距离电台' },
      { text: 'QSL', gloss: 'QSL ── 联络卡片 / 收到并确认' },
    ],
  },
  {
    id: 'l2-abbrev-pro',
    title: '第 5 课　进阶缩略语与礼貌用语',
    level: 2,
    summary: '这些是对方听完会点头的行话。先认形状，再求速度。',
    focus: ['L', 'F', 'V', 'W', 'P', 'X', 'Y', 'Z'],
    items: [
      { text: 'TNX', gloss: 'TNX ── 谢谢（Thanks）' },
      { text: 'PSE', gloss: 'PSE ── 请（Please）' },
      { text: 'AGN', gloss: 'AGN ── 请再来一遍（Again）' },
      { text: 'QRS', gloss: 'QRS ── 请拍慢一点' },
      { text: 'QRQ', gloss: 'QRQ ── 请拍快一点' },
      { text: 'QRZ', gloss: 'QRZ ── 谁在呼叫我？' },
      { text: 'QTH', gloss: 'QTH ── 我的位置 / 你在哪里' },
      { text: 'QSB', gloss: 'QSB ── 信号在衰落' },
      { text: 'QRN', gloss: 'QRN ── 天电 / 静电干扰' },
      { text: 'QRM', gloss: 'QRM ── 人为干扰' },
      { text: 'QSY', gloss: 'QSY ── 改变频率' },
      { text: 'QRT', gloss: 'QRT ── 停止发射 / 关机' },
      { text: 'QRP', gloss: 'QRP ── 小功率' },
      { text: 'QRO', gloss: 'QRO ── 大功率' },
      { text: 'ES', gloss: 'ES ── 和（and）' },
      { text: 'HW', gloss: 'HW ── 怎么样（How）' },
      { text: 'CPI', gloss: 'CPI ── 抄收（Copy）' },
      { text: 'FER', gloss: 'FER ── 为了（for）' },
      { text: 'NR', gloss: 'NR ── 号码（number）' },
      { text: 'ABT', gloss: 'ABT ── 关于（about）' },
      { text: 'HI', gloss: 'HI ── 笑（相当于 lol）' },
    ],
  },
  {
    id: 'l3-numbers',
    title: '第 6 课　数字与信号报告',
    level: 3,
    summary: '数字是报文的骨架：RST 599 是 CW 里最常出现的一组。',
    focus: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
    items: [
      { text: '5', gloss: '5 = .....' },
      { text: '9', gloss: '9 = ----.' },
      { text: '59', gloss: '59 ── 信号报告（5 = 可懂，9 = 极强）' },
      { text: '599', gloss: '599 ── CW 标准满分信号报告' },
      { text: '579', gloss: '579 ── 有点起伏但很好' },
      { text: '339', gloss: '339 ── 抄得吃力' },
      { text: 'RST 599', gloss: 'RST 599 ── 可懂度 / 强度 / 音调 全 5-9-9' },
      { text: 'RST 579', gloss: 'RST 579' },
      { text: '5NN', gloss: '5NN ── 599 的速记写法（N = 9）' },
      { text: '73', gloss: '73 ── 最美好的祝愿（通联结束语）' },
      { text: '88', gloss: '88 ── 爱与吻（对女火腿用）' },
      { text: '55', gloss: '55 ── 祝你顺利' },
      { text: '2M', gloss: '2M ── 2 米波段' },
      { text: '40M', gloss: '40M ── 40 米波段（中国最热闹的 CW 波段）' },
      { text: '20M', gloss: '20M ── 20 米波段（DX 首选）' },
    ],
  },
  {
    id: 'l3-callsign',
    title: '第 7 课　呼号与 CQ 呼叫',
    level: 3,
    summary: '呼号是最需要“整块辨识”的东西：CQ CQ CQ DE <你的呼号> <你的呼号> K。',
    focus: ['C', 'Q', 'D', 'E', 'K', 'P'],
    items: [
      { text: '{CALLSIGN}', gloss: '你的呼号' },
      { text: 'CQ {CALLSIGN}', gloss: 'CQ + 你的呼号' },
      { text: 'CQ CQ DE {CALLSIGN} K', gloss: '标准 CQ 呼叫：公开呼叫 + 这里是 + 呼号 + 请回答' },
      { text: 'CQ CQ CQ DE {CALLSIGN} {CALLSIGN} K', gloss: '更完整的 CQ，呼号发两遍' },
      { text: 'DE {CALLSIGN}', gloss: '“这里是 <呼号>”' },
      { text: '{CALLSIGN} DE {CALLSIGN} K', gloss: '自己和自己练一遍完整格式' },
      { text: 'QSL?', gloss: 'QSL? ── 能确认吗？' },
      { text: 'QSL TU', gloss: 'QSL, TU ── 能确认，谢谢' },
      { text: 'PSE QRS', gloss: 'PSE QRS ── 请拍慢一点' },
      { text: 'PSE AGN', gloss: 'PSE AGN ── 请再来一遍' },
      { text: 'QRZ?', gloss: 'QRZ? ── 谁在叫我？' },
      { text: 'QTH?', gloss: 'QTH? ── 你的位置在哪？' },
    ],
  },
  {
    id: 'l3-punct',
    title: '第 8 课　标点与过程信号',
    level: 3,
    summary: '标点让报文变成真正的句子。过程信号（prosign）本身不带间隔，是“一气呵成”的。QWERTY 上没有 prosign 键，这里约定用四组键盘符号代替。',
    focus: ['.', ',', '?', '/', '+', '=', '!', '('],
    items: [
      { text: 'RR.', gloss: '. = .-.-.-　句号' },
      { text: 'RR,', gloss: ', = --..--　逗号' },
      { text: 'RR?', gloss: '? = ..--..　问号' },
      { text: 'R/', gloss: '/ = -..-.　斜杠' },
      { text: '599 599=', gloss: '= 发 −...−，即 BT，用来分隔报文的段落' },
      { text: 'TNX FER QSO+', gloss: '+ 发 .-.-.，即 AR，表示“本段报文结束”' },
      { text: 'TU 73!', gloss: '! 发 -.-.--，即 SK，表示“结束联络”' },
      { text: '{CALLSIGN} DE {CALLSIGN}(', gloss: '( 发 -.--.，即 KN，表示“只请指定电台回答”' },
    ],
  },
  {
    id: 'l4-qso-short',
    title: '第 9 课　短 QSO（一问一答）',
    level: 4,
    summary: '把前面学过的全部串起来。每条都是一次完整发射，发完再对答案。',
    focus: ['C', 'Q', 'D', 'E', 'K', 'R', 'S', 'T'],
    items: [
      { text: 'CQ CQ DE {CALLSIGN} K', gloss: '我呼叫：这里是 {CALLSIGN}，请回答' },
      { text: '{CALLSIGN} DE BG1ABC K', gloss: 'BG1ABC 回答我' },
      { text: 'BG1ABC DE {CALLSIGN} = GM OM ES TNX FER CALL', gloss: '（= 即 BT 分隔）早上好老伙计，谢谢呼叫' },
      { text: 'UR RST 599 599 = QTH BEIJING = NAME LI = HW?', gloss: '你的信号 599 599，我在北京，我姓李，你呢？' },
      { text: 'R R = GM ES TNX = UR RST 579 579 = QTH SHANGHAI = NAME WANG = HW?', gloss: '收到收到，早上好谢谢，你的信号 579，我在上海，我姓王，你呢？' },
      { text: 'TNX FER NICE QSO = PSE QSL = 73 ES GL', gloss: '谢谢这次愉快的通联，请寄 QSL 卡，73 并祝好运' },
      { text: 'QSL TU = 73 ES GL = {CALLSIGN} SK', gloss: 'QSL 谢谢，73 祝好运，{CALLSIGN} 结束联络' },
      { text: 'QSL VIA BUREAU = TNX = 73', gloss: 'QSL 走卡片局，谢谢，73' },
      { text: 'PSE QRS = UR QSB = AGN PSE', gloss: '请慢点，你的信号在衰落，请再来一遍' },
      { text: 'QRZ? DE {CALLSIGN}', gloss: '谁在叫我？这里是 {CALLSIGN}' },
    ],
  },
  {
    id: 'l4-qso-full',
    title: '第 10 课　完整 QSO 实战',
    level: 4,
    summary: '一次真实的完整通联。长报文允许中途停顿（停顿超过 3 个单位会被当成字符间隔，不用担心）。',
    focus: ['C', 'Q', 'D', 'E', 'K', 'R', 'T', 'N'],
    items: [
      {
        text: 'CQ CQ CQ DE {CALLSIGN} {CALLSIGN} K',
        gloss: '① 我：公开呼叫，声明我的呼号，请任何台回答',
      },
      {
        text: '{CALLSIGN} DE BG1ABC BG1ABC K',
        gloss: '② 对方：BG1ABC 回答我',
      },
      {
        text: 'BG1ABC DE {CALLSIGN} = GM OM = TNX FER UR CALL = UR RST 599 599 = QTH BEIJING BEIJING = NAME LI LI = HW? BG1ABC DE {CALLSIGN} K',
        gloss: '③ 我：问候 + 信号报告 599 + 位置北京 + 姓李 + 反问你',
      },
      {
        text: 'R {CALLSIGN} DE BG1ABC = GM OM LI = TNX FER RPRT = UR RST 579 579 = QTH SHANGHAI SHANGHAI = NAME WANG WANG = HW? {CALLSIGN} DE BG1ABC K',
        gloss: '④ 对方：收到，信号 579，位置上海，姓王',
      },
      {
        text: 'R R = TNX WANG = WX HR FINE = RIG IC7300 PWR 100W = ANT DIPOLE = PSE QSL VIA BUREAU = TNX FER NICE QSO ES HPE CU AGN = 73 ES GL BG1ABC DE {CALLSIGN} SK',
        gloss: '⑤ 我：确认，谢谢王先生，天气不错，设备 IC-7300/100W/偶极天线，请走卡片局，73 祝好运，结束联络',
      },
      {
        text: 'R R = QSL TU = 73 ES GL = HPE CU AGN = {CALLSIGN} DE BG1ABC SK',
        gloss: '⑥ 对方：QSL 谢谢，73 祝好运，期待再次通联',
      },
    ],
  },
  {
    id: 'l5-dx',
    title: '第 11 课　DX 远征 / 竞赛风格',
    level: 5,
    summary: '高节奏、极简的交换方式。这里追求“听得整块、拍得干净”。',
    focus: ['5', '9', 'N', 'T', 'U', 'K'],
    items: [
      { text: '{CALLSIGN} 5NN 5NN', gloss: '竞赛式信号报告 599' },
      { text: '{CALLSIGN} 5NN 001', gloss: '呼号 + 信号报告 + 序号（竞赛交换）' },
      { text: 'TU {CALLSIGN} QRZ', gloss: '谢谢，{CALLSIGN}，继续呼叫下一个' },
      { text: '{CALLSIGN} TEST', gloss: '竞赛呼叫：{CALLSIGN} 比赛' },
      { text: 'CQ TEST {CALLSIGN} {CALLSIGN} TEST', gloss: '标准竞赛 CQ' },
      { text: 'QSL 5NN 5NN TU', gloss: '确认，599，谢谢' },
      { text: 'AGN? AGN?', gloss: '再说一遍？' },
      { text: 'NR? NR?', gloss: '序号是多少？' },
      { text: 'PSE UP 2', gloss: '请往上 2 kHz（异频操作）' },
      { text: 'TU 73', gloss: '谢谢，73' },
    ],
  },
];

/** 按 id 取课程。 */
export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

/** 把一课展开成“实际要练习的条目”，替换占位符。 */
export function expandLesson(lesson: Lesson, callsign: string): Array<{ text: string; gloss?: string; note?: string }> {
  return lesson.items.map((it) => ({
    text: resolvePlaceholders(it.text, callsign),
    gloss: it.gloss ? resolvePlaceholders(it.gloss, callsign) : undefined,
    note: it.note,
  }));
}

/** 全部课程里用到的字符（用于统计“你练过哪些字符”）。 */
export function allLessonChars(): Set<string> {
  const set = new Set<string>();
  for (const l of LESSONS) {
    for (const it of l.items) {
      for (const ch of resolvePlaceholders(it.text, 'BG1ABC')) {
        if (ch !== ' ') set.add(ch);
      }
    }
  }
  return set;
}
