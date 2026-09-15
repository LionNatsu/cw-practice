/**
 * 课程内容。
 *
 * 两条原则（这是用户明确要求的）：
 *  - 不练随机字母，全是常用简语、真实格式的呼叫和完整通联，方便整体辨识；
 *  - 每条都写清中文意思，让人一开始就把“声音”和“意思”绑在一起。
 *
 * 文本里可以用 {CALLSIGN} 占位符，运行时替换成设置里的呼号。
 */

import type { Lesson } from './types.ts';

export type { Lesson };

/** 课程里拿来做“对方电台”的示例呼号。 */
export const DEMO_CALLS = ['BG1ABC', 'BH4XYZ', 'JA1XYZ', 'DL2ABC', 'W1AW', 'VR2ABC'] as const;

/** 把 {CALLSIGN} 换成实际呼号。 */
export function resolvePlaceholders(text: string, callsign: string): string {
  const cs = (callsign || 'BG1ABC').toUpperCase().replace(/\s+/g, '');
  return text.replaceAll('{CALLSIGN}', cs).toUpperCase();
}

export const LESSONS: readonly Lesson[] = [
  {
    id: 'l1-rhythm',
    title: '第 1 课　点与划（E / T）',
    level: 1,
    summary: 'E 是一个点，T 是一个划。本课只处理一件事：把两者的长短分开。',
    focus: ['E', 'T'],
    items: [
      { text: 'E', gloss: 'E：一个点', note: '短促，触到即松' },
      { text: 'T', gloss: 'T：一个划，长度是点的三倍', note: '按得久，而不是用力' },
      { text: 'TE', gloss: 'TE：划、点' },
      { text: 'ET', gloss: 'ET：点、划' },
      { text: 'TEE', gloss: 'TEE：划、点、点' },
      { text: 'TEET', gloss: 'TEET：点划混合' },
      { text: 'EEEE', gloss: 'EEEE：连续四个点，检查是否越拍越快' },
      { text: 'TTTT', gloss: 'TTTT：连续四个划，检查长短是否一致' },
    ],
  },
  {
    id: 'l1-an',
    title: '第 2 课　点划顺序（A / N）',
    level: 1,
    summary: 'A 是点划，N 是划点，顺序相反。这两个码可以直接检验点划是否分得开。',
    focus: ['A', 'N'],
    items: [
      { text: 'A', gloss: 'A：点、划' },
      { text: 'N', gloss: 'N：划、点' },
      { text: 'AN', gloss: 'AN：点划、划点，连续发' },
      { text: 'NA', gloss: 'NA：划点、点划' },
      { text: 'ANA', gloss: 'ANA：人名 Anna 的常见拼法' },
      { text: 'NAN', gloss: 'NAN' },
      { text: 'ETAN', gloss: 'ETAN：四个最基础的码连起来' },
      { text: 'TEN', gloss: 'TEN：十', note: '中间的 E 要短，别拖' },
      { text: 'NET', gloss: 'NET：网络' },
      { text: 'ANT', gloss: 'ANT：天线' },
    ],
  },
  {
    id: 'l1-imso',
    title: '第 3 课　同符号连发（I / M / S / O）',
    level: 1,
    summary: '两点、两划、三点、三划。连续发同一符号，最容易看出点是否越拍越长。',
    focus: ['I', 'M', 'S', 'O'],
    items: [
      { text: 'I', gloss: 'I：两个点' },
      { text: 'M', gloss: 'M：两个划' },
      { text: 'S', gloss: 'S：三个点' },
      { text: 'O', gloss: 'O：三个划' },
      { text: 'SOS', gloss: 'SOS：国际求救信号', note: '实际要连成“三个点、三个划、三个点”，中间不留空' },
      { text: 'MOM', gloss: 'MOM：妈妈' },
      { text: 'SIS', gloss: 'SIS' },
      { text: 'MISO', gloss: 'MISO' },
      { text: 'OM', gloss: 'OM：老伙计，对男火腿的称呼' },
      { text: 'XYL', gloss: 'XYL：太太，火腿圈的说法' },
    ],
  },
  {
    id: 'l2-abbrev-basic',
    title: '第 4 课　常用简语（一）',
    level: 2,
    summary: '通联中一多半的内容由这些两三字母的简语构成，需要整体识别，不要逐字母拼接。',
    focus: ['K', 'R', 'D', 'G', 'U', 'H'],
    items: [
      { text: 'DE', gloss: 'DE：我是……（后面跟上自己的呼号）' },
      { text: 'K', gloss: 'K：请讲（谁都可以回）' },
      { text: 'KN', gloss: 'KN：只请刚才那位回答' },
      { text: 'R', gloss: 'R：收到、没错' },
      { text: 'FB', gloss: 'FB：太好了' },
      { text: 'TU', gloss: 'TU：谢谢' },
      { text: 'GM', gloss: 'GM：早上好' },
      { text: 'GA', gloss: 'GA：下午好；也常当“请讲”' },
      { text: 'GE', gloss: 'GE：晚上好' },
      { text: 'GN', gloss: 'GN：晚安' },
      { text: 'ES', gloss: 'ES：和、跟' },
      { text: 'HR', gloss: 'HR：这里' },
      { text: 'UR', gloss: 'UR：你的；你' },
      { text: 'WX', gloss: 'WX：天气' },
      { text: 'RIG', gloss: 'RIG：设备' },
      { text: 'ANT', gloss: 'ANT：天线' },
      { text: 'PWR', gloss: 'PWR：功率' },
      { text: 'CQ', gloss: 'CQ：普遍呼叫，等待任何电台应答' },
      { text: 'DX', gloss: 'DX：远处、远地电台' },
      { text: 'QSL', gloss: 'QSL：确认；也指通联卡片' },
    ],
  },
  {
    id: 'l2-abbrev-pro',
    title: '第 5 课　常用简语（二）',
    level: 2,
    summary: '本课为 Q 简语与通联客套话。先认清码形，再求速度。',
    focus: ['L', 'F', 'V', 'W', 'P', 'X', 'Y', 'Z'],
    items: [
      { text: 'TNX', gloss: 'TNX：谢谢' },
      { text: 'PSE', gloss: 'PSE：请' },
      { text: 'AGN', gloss: 'AGN：再来一遍' },
      { text: 'QRS', gloss: 'QRS：请发慢一点' },
      { text: 'QRQ', gloss: 'QRQ：请发快一点' },
      { text: 'QRZ', gloss: 'QRZ：谁在叫我？' },
      { text: 'QTH', gloss: 'QTH：我在哪儿；也问对方在哪儿' },
      { text: 'QSB', gloss: 'QSB：信号在起伏' },
      { text: 'QRN', gloss: 'QRN：天电、静电噪声' },
      { text: 'QRM', gloss: 'QRM：别的台在干扰' },
      { text: 'QSY', gloss: 'QSY：换频率' },
      { text: 'QRT', gloss: 'QRT：收摊、关机' },
      { text: 'QRP', gloss: 'QRP：小功率' },
      { text: 'QRO', gloss: 'QRO：大功率' },
      { text: 'HW', gloss: 'HW：怎么样' },
      { text: 'CPI', gloss: 'CPI：抄到了、听清了' },
      { text: 'FER', gloss: 'FER：为了、因为' },
      { text: 'NR', gloss: 'NR：号码' },
      { text: 'ABT', gloss: 'ABT：关于' },
      { text: 'HI', gloss: 'HI：笑（相当于“哈哈”）' },
    ],
  },
  {
    id: 'l3-numbers',
    title: '第 6 课　数字与信号报告',
    level: 3,
    summary: '数字是报文的骨架，其中 599 出现频率最高，需要发得干净。',
    focus: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
    items: [
      { text: '5', gloss: '5：五个点' },
      { text: '9', gloss: '9：四个划一个点' },
      { text: '59', gloss: '59：信号报告。5 是听得清，9 是特别强' },
      { text: '599', gloss: '599：CW 里的满分报告' },
      { text: '579', gloss: '579：有点起伏，但很好' },
      { text: '339', gloss: '339：抄得吃力' },
      { text: 'RST 579', gloss: 'RST 579：可懂度、强度、音调，三项分别打分' },
      { text: 'RST 599', gloss: 'RST 599：三项都满分' },
      { text: '5NN', gloss: '5NN：599 的偷懒写法（N 就是 9）' },
      { text: '73', gloss: '73：最经典的问候，通联结束时用' },
      { text: '88', gloss: '88：爱你、亲亲，一般对女火腿说' },
      { text: '55', gloss: '55：祝你顺利' },
      { text: '2M', gloss: '2M：2 米波段' },
      { text: '40M', gloss: '40M：40 米波段，国内 CW 最热闹的地方' },
      { text: '20M', gloss: '20M：20 米波段，通远处首选' },
    ],
  },
  {
    id: 'l3-callsign',
    title: '第 7 课　呼号与 CQ 呼叫',
    level: 3,
    summary: '呼号必须整体识别。本课练习 CQ CQ CQ DE <呼号> <呼号> K 这一固定格式。',
    focus: ['C', 'Q', 'D', 'E', 'K', 'P'],
    items: [
      { text: '{CALLSIGN}', gloss: '你自己的呼号' },
      { text: 'CQ {CALLSIGN}', gloss: 'CQ 加上你的呼号' },
      { text: 'DE {CALLSIGN}', gloss: '我是 {CALLSIGN}' },
      { text: 'CQ CQ DE {CALLSIGN} K', gloss: '标准呼叫：CQ、我是谁、请讲' },
      { text: 'CQ CQ CQ DE {CALLSIGN} {CALLSIGN} K', gloss: '更完整的版本，呼号发两遍，方便对方抄' },
      { text: '{CALLSIGN} DE {CALLSIGN} K', gloss: '拿自己练一遍完整格式' },
      { text: 'QSL?', gloss: 'QSL?：能确认吗？' },
      { text: 'QSL TU', gloss: 'QSL TU：确认，谢谢' },
      { text: 'PSE QRS', gloss: 'PSE QRS：请发慢一点' },
      { text: 'PSE AGN', gloss: 'PSE AGN：请再来一遍' },
      { text: 'QRZ?', gloss: 'QRZ?：谁在叫我？' },
      { text: 'QTH?', gloss: 'QTH?：你在哪里？' },
    ],
  },
  {
    id: 'l3-punct',
    title: '第 8 课　标点与过程信号',
    level: 3,
    summary:
      '标点让报文成为完整句子。过程信号（prosign）要连着发、中间不留空。普通键盘没有对应按键，本站约定用四个符号代替。',
    focus: ['.', ',', '?', '/', '+', '=', '!', '('],
    items: [
      { text: 'RR.', gloss: '句号：点划点划点划' },
      { text: 'RR,', gloss: '逗号：划划点点划划' },
      { text: 'RR?', gloss: '问号：点点划划点点' },
      { text: 'R/', gloss: '斜杠：划点点划点' },
      { text: '599 599=', gloss: '= 发成“划点点点划”，也就是 BT，用来分段' },
      { text: 'TNX FER QSO+', gloss: '+ 发成“点划点划点”，也就是 AR，表示这一段发完了' },
      { text: 'TU 73!', gloss: '! 发成“划点划点划划”，也就是 SK，表示这次通联结束' },
      { text: '{CALLSIGN} DE {CALLSIGN}(', gloss: '( 发成“划点点划划”，也就是 KN，表示只请那一位回答' },
    ],
  },
  {
    id: 'l4-qso-short',
    title: '第 9 课　一问一答',
    level: 4,
    summary: '把前面学过内容串起来。每条都是一次完整发送，发完再核对。',
    focus: ['C', 'Q', 'D', 'E', 'K', 'R', 'S', 'T'],
    items: [
      { text: 'CQ CQ DE {CALLSIGN} K', gloss: '我喊：我是 {CALLSIGN}，请讲' },
      { text: '{CALLSIGN} DE BG1ABC K', gloss: 'BG1ABC 回我了' },
      { text: 'BG1ABC DE {CALLSIGN} = GM OM ES TNX FER CALL', gloss: '（= 是分段用的 BT）早上好老伙计，谢谢你叫我' },
      { text: 'UR RST 599 599 = QTH BEIJING = NAME LI = HW?', gloss: '你的信号 599 599，我在北京，我姓李，你呢？' },
      { text: 'R R = GM ES TNX = UR RST 579 579 = QTH SHANGHAI = NAME WANG = HW?', gloss: '收到收到，早上好，谢谢。你的信号 579，我在上海，我姓王，你呢？' },
      { text: 'TNX FER NICE QSO = PSE QSL = 73 ES GL', gloss: '聊得愉快，麻烦寄张卡片，73，祝顺利' },
      { text: 'QSL TU = 73 ES GL = {CALLSIGN} SK', gloss: '卡片的事说定了，谢谢。73，祝顺利，{CALLSIGN} 收摊' },
      { text: 'QSL VIA BUREAU = TNX = 73', gloss: '卡片走卡片局，谢谢，73' },
      { text: 'PSE QRS = UR QSB = AGN PSE', gloss: '请发慢些，信号有起伏，请重发' },
      { text: 'QRZ? DE {CALLSIGN}', gloss: '谁在叫我？我是 {CALLSIGN}' },
    ],
  },
  {
    id: 'l4-qso-full',
    title: '第 10 课　完整通联',
    level: 4,
    summary: '完整走一遍真实通联。可以中途停顿，停顿会被判为字间隔，不影响判定。',
    focus: ['C', 'Q', 'D', 'E', 'K', 'R', 'T', 'N'],
    items: [
      {
        text: 'CQ CQ CQ DE {CALLSIGN} {CALLSIGN} K',
        gloss: '① 我：喊 CQ，报上呼号，谁都能回',
      },
      {
        text: '{CALLSIGN} DE BG1ABC BG1ABC K',
        gloss: '② 对方：BG1ABC 回我了',
      },
      {
        text: 'BG1ABC DE {CALLSIGN} = GM OM = TNX FER UR CALL = UR RST 599 599 = QTH BEIJING BEIJING = NAME LI LI = HW? BG1ABC DE {CALLSIGN} K',
        gloss: '③ 我：问好，报信号 599，说我在北京、姓李，然后问他',
      },
      {
        text: 'R {CALLSIGN} DE BG1ABC = GM OM LI = TNX FER RPRT = UR RST 579 579 = QTH SHANGHAI SHANGHAI = NAME WANG WANG = HW? {CALLSIGN} DE BG1ABC K',
        gloss: '④ 对方：收到。信号 579，在上海，姓王，回问我的情况',
      },
      {
        text: 'R R = TNX WANG = WX HR FINE = RIG IC7300 PWR 100W = ANT DIPOLE = PSE QSL VIA BUREAU = TNX FER NICE QSO ES HPE CU AGN = 73 ES GL BG1ABC DE {CALLSIGN} SK',
        gloss: '⑤ 我：确认。谢谢王先生，天气不错；设备 IC-7300、100 瓦、偶极天线；卡片走卡片局；聊得愉快，期待下次，73，收摊',
      },
      {
        text: 'R R = QSL TU = 73 ES GL = HPE CU AGN = {CALLSIGN} DE BG1ABC SK',
        gloss: '⑥ 对方：都收到，谢谢。73，祝顺利，下次再见',
      },
    ],
  },
  {
    id: 'l5-dx',
    title: '第 11 课　比赛与远征节奏',
    level: 5,
    summary: '高节奏、极简交换，能省的字全省。要求整体识别，手指干净利落。',
    focus: ['5', '9', 'N', 'T', 'U', 'K'],
    items: [
      { text: '{CALLSIGN} 5NN 5NN', gloss: '比赛式的信号报告 599' },
      { text: '{CALLSIGN} 5NN 001', gloss: '呼号＋信号报告＋序号，比赛的固定交换' },
      { text: 'TU {CALLSIGN} QRZ', gloss: '谢谢，{CALLSIGN}，继续喊下一个' },
      { text: '{CALLSIGN} TEST', gloss: '比赛呼叫：{CALLSIGN} 在比赛' },
      { text: 'CQ TEST {CALLSIGN} {CALLSIGN} TEST', gloss: '标准比赛呼叫' },
      { text: 'QSL 5NN 5NN TU', gloss: '确认，599，谢谢' },
      { text: 'AGN? AGN?', gloss: '再说一遍？' },
      { text: 'NR? NR?', gloss: '序号是多少？' },
      { text: 'PSE UP 2', gloss: '请往上挪 2 kHz（异频呼叫）' },
      { text: 'TU 73', gloss: '谢谢，73' },
    ],
  },
];

/** 按 id 取一课。 */
export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

/** 把一课展开成实际要练的每一条（替换掉呼号占位符）。 */
export function expandLesson(
  lesson: Lesson,
  callsign: string,
): Array<{ text: string; gloss?: string; note?: string }> {
  return lesson.items.map((it) => ({
    text: resolvePlaceholders(it.text, callsign),
    gloss: it.gloss ? resolvePlaceholders(it.gloss, callsign) : undefined,
    note: it.note,
  }));
}

/** 所有课程里出现过的字符（用来判断哪些字你已经练过）。 */
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