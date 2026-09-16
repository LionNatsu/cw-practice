/**
 * 课程内容。
 *
 * 两条原则（这是用户明确要求的）：
 *  - 不练随机字母，全是常用简语、真实格式的呼叫和完整通联，方便整体辨识；
 *  - 每条都写清中文意思，让人一开始就把“声音”和“意思”绑在一起。
 *
 * 文本里可以用 {CALLSIGN} 占位符，运行时替换成设置里的呼号。
 */

import type { Lesson, LessonItem } from './types.ts';

export type { Lesson };

/**
 * 课程里那位固定的“对方电台”。
 *
 * 用虚构的呼号，而不是拿使用者自己的呼号来回喊 —— 否则就成自言自语了。
 * 文本里写 {PARTNER}，运行时统一替换。
 */
export const PARTNER_CALLSIGN = 'BD7XYZ';

/** 把 {CALLSIGN} / {PARTNER} 换成实际呼号。 */
export function resolvePlaceholders(text: string, callsign: string): string {
  const cs = (callsign || 'BG1ABC').toUpperCase().replace(/\s+/g, '');
  return text.replaceAll('{CALLSIGN}', cs).replaceAll('{PARTNER}', PARTNER_CALLSIGN).toUpperCase();
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
      { text: 'ANT', words: ['天线'] },
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
      { text: 'SOS', note: '实际要连成“三个点、三个划、三个点”，中间不留空', words: ['求救'] },
      { text: 'MOM', gloss: 'MOM：妈妈' },
      { text: 'SIS', gloss: 'SIS' },
      { text: 'MISO', gloss: 'MISO' },
      { text: 'OM', words: ['老朋友'] },
      { text: 'XYL', words: ['妻子'] },
    ],
  },
  {
    id: 'l2-abbrev-basic',
    title: '第 4 课　常用简语（一）',
    level: 2,
    summary: '通联中一多半的内容由这些两三字母的简语构成，需要整体识别，不要逐字母拼接。',
    focus: ['K', 'R', 'D', 'G', 'U', 'H'],
    items: [
      { text: 'DE', words: ['这里是'] },
      { text: 'K', words: ['请回答'] },
      { text: 'KN', words: ['只请你回答'] },
      { text: 'R', words: ['收到'] },
      { text: 'FB', words: ['很好'] },
      { text: 'TU', words: ['谢谢'] },
      { text: 'GM', words: ['早上好'] },
      { text: 'GA', words: ['下午好'] },
      { text: 'GE', words: ['晚上好'] },
      { text: 'GN', words: ['晚安'] },
      { text: 'ES', words: ['和'] },
      { text: 'HR', words: ['这里'] },
      { text: 'UR', words: ['你的'] },
      { text: 'WX', words: ['天气'] },
      { text: 'RIG', words: ['电台'] },
      { text: 'ANT', words: ['天线'] },
      { text: 'PWR', words: ['功率'] },
      { text: 'CQ', words: ['呼叫'] },
      { text: 'DX', words: ['远地电台'] },
      { text: 'QSL', words: ['卡片'] },
    ],
  },
  {
    id: 'l2-abbrev-pro',
    title: '第 5 课　常用简语（二）',
    level: 2,
    summary: '本课为 Q 简语与通联客套话。先认清码形，再求速度。',
    focus: ['L', 'F', 'V', 'W', 'P', 'X', 'Y', 'Z'],
    items: [
      { text: 'TNX', words: ['谢谢'] },
      { text: 'PSE', words: ['请'] },
      { text: 'AGN', words: ['再来一遍'] },
      { text: 'QRS', words: ['请发慢些'] },
      { text: 'QRQ', words: ['请发快些'] },
      { text: 'QRZ', words: ['谁在呼我'] },
      { text: 'QTH', words: ['位置'] },
      { text: 'QSB', words: ['信号起伏'] },
      { text: 'QRN', words: ['天电噪声'] },
      { text: 'QRM', words: ['别的台在干扰'] },
      { text: 'QSY', words: ['换频率'] },
      { text: 'QRT', words: ['关机'] },
      { text: 'QRP', words: ['小功率'] },
      { text: 'QRO', words: ['大功率'] },
      { text: 'HW', words: ['怎么样'] },
      { text: 'CPI', words: ['抄到了'] },
      { text: 'FER', words: ['为了'] },
      { text: 'NR', words: ['号码'] },
      { text: 'ABT', words: ['关于'] },
      { text: 'HI', words: ['笑'] },
    ],
  },
  {
    id: 'l3-numbers',
    title: '第 6 课　数字与信号报告',
    level: 3,
    summary: '数字是报文的骨架，其中 599 出现频率最高，需要发得干净。',
    focus: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
    items: [
      { text: '5', words: ['数字 5'] },
      { text: '9', words: ['数字 9'] },
      { text: '59', words: ['信号报告'] },
      { text: '599', words: ['信号 599'] },
      { text: '579', words: ['信号报告'] },
      { text: '339', words: ['信号报告'] },
      { text: 'RST 579', words: ['信号报告', '读数'] },
      { text: 'RST 599', words: ['信号报告', '读数'] },
      { text: '5NN', words: ['信号 599'] },
      { text: '73', words: ['致敬'] },
      { text: '88', words: ['爱与吻'] },
      { text: '55', words: ['握手'] },
      { text: '2M', words: ['2 米'] },
      { text: '40M', words: ['40 米'] },
      { text: '20M', words: ['20 米'] },
    ],
  },
  {
    id: 'l3-callsign',
    title: '第 7 课　呼号与 CQ 呼叫',
    level: 3,
    summary: '呼号必须整体识别。本课练习 CQ CQ CQ DE <呼号> <呼号> K 这一固定格式。',
    focus: ['C', 'Q', 'D', 'E', 'K', 'P'],
    items: [
      { text: '{CALLSIGN}', words: ['我的呼号'] },
      { text: 'CQ {CALLSIGN}', words: ['呼叫', '我的呼号'] },
      { text: 'DE {CALLSIGN}', words: ['这里是', '我的呼号'] },
      { text: 'CQ CQ DE {CALLSIGN} K', words: ['呼叫', '呼叫', '这里是', '我的呼号', '请回答'] },
      { text: 'CQ CQ CQ DE {CALLSIGN} {CALLSIGN} K', words: ['呼叫', '呼叫', '呼叫', '这里是', '我的呼号', '我的呼号', '请回答'] },
      { text: '{PARTNER} DE {CALLSIGN} K', words: ['对方呼号', '这里是', '我的呼号', '请回答'] },
      { text: 'QSL?', words: ['要卡片吗'] },
      { text: 'QSL TU', words: ['卡片', '谢谢'] },
      { text: 'PSE QRS', words: ['请', '发慢些'] },
      { text: 'PSE AGN', words: ['请', '再来一遍'] },
      { text: 'QRZ?', words: ['谁在呼我'] },
      { text: 'QTH?', words: ['你在哪儿'] },
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
      { text: 'RR.', words: ['收到了'] },
      { text: 'RR,', words: ['收到了'] },
      { text: 'RR?', words: ['收到了吗'] },
      { text: 'R/', words: ['收到'] },
      {
        text: '{CALLSIGN} = QTH BEIJING = NAME LI',
        words: ['我的呼号', '分段', '位置', '北京', '分段', '名字', '李'],
      },
      { text: 'TNX FER QSO+', words: ['谢谢', '为了', '这次通联'] },
      { text: 'TU 73!', words: ['谢谢', '致敬'] },
      { text: '{CALLSIGN} DE {PARTNER}(', words: ['我的呼号', '这里是', '对方呼号（只请你回答）'] },
    ],
  },
  {
    id: 'l4-qso-short',
    title: '第 9 课　一问一答',
    level: 4,
    summary: '和 {PARTNER} 的一问一答。每条都是一次完整发送，发完再核对。',
    focus: ['C', 'Q', 'D', 'E', 'K', 'R', 'S', 'T'],
    items: [
      { text: 'CQ CQ DE {CALLSIGN} K', words: ['呼叫', '呼叫', '这里是', '我的呼号', '请回答'] },
      { text: '{CALLSIGN} DE {PARTNER} K', words: ['我的呼号', '这里是', '对方呼号', '请回答'] },
      { text: '{PARTNER} DE {CALLSIGN} GM OM ES TNX FER CALL', words: ['对方呼号', '这里是', '我的呼号', '早上好', '老朋友', '和', '谢谢', '为了', '呼叫'] },
      { text: 'UR RST 599 599 QTH BEIJING NAME LI HW?', words: ['你的', '信号报告', '读数', '读数', '位置', '北京', '名字', '李', '怎么样'] },
      { text: 'R R GM ES TNX UR RST 579 579 QTH SHANGHAI NAME WANG HW?', words: ['收到', '收到', '早上好', '和', '谢谢', '你的', '信号报告', '读数', '读数', '位置', '上海', '名字', '王', '怎么样'] },
      { text: 'TNX FER NICE QSO PSE QSL 73 ES GL', words: ['谢谢', '为了', '愉快的', '通联', '请', '寄卡片', '致敬', '和', '好运'] },
      { text: 'QSL TU 73 ES GL {CALLSIGN} DE {PARTNER} SK', words: ['卡片', '谢谢', '致敬', '和', '好运', '我的呼号', '这里是', '对方呼号', '通联结束'] },
      { text: 'QSL VIA BUREAU TNX 73', words: ['卡片', '经由', '卡片局', '谢谢', '致敬'] },
      { text: 'PSE QRS UR QSB AGN PSE', words: ['请', '发慢些', '你的', '信号起伏', '再来一遍', '请'] },
      { text: 'QRZ? DE {PARTNER}', words: ['谁在呼我', '这里是', '对方呼号'] },
    ],
  },
  {
    id: 'l4-qso-full',
    title: '第 10 课　完整通联',
    level: 4,
    summary: '和 {PARTNER} 完整走一遍真实通联。可以中途停顿，停顿会被判为字间隔，不影响判定。',
    focus: ['C', 'Q', 'D', 'E', 'K', 'R', 'T', 'N'],
    items: [
      {
        text: 'CQ CQ CQ DE {CALLSIGN} {CALLSIGN} K',
        words: ['呼叫', '呼叫', '呼叫', '这里是', '我的呼号', '我的呼号', '请回答'],
      },
      {
        text: '{CALLSIGN} DE {PARTNER} {PARTNER} K',
        words: ['我的呼号', '这里是', '对方呼号', '对方呼号', '请回答'],
      },
      {
        text: '{PARTNER} DE {CALLSIGN} GM OM TNX FER UR CALL UR RST 599 599 QTH BEIJING BEIJING NAME LI LI HW? {PARTNER} DE {CALLSIGN} K',
        words: [
          '对方呼号', '这里是', '我的呼号', '早上好', '老朋友', '谢谢', '为了', '你的', '呼叫',
          '你的', '信号报告', '读数', '读数', '位置', '北京', '北京',
          '名字', '李', '李', '怎么样', '对方呼号', '这里是', '我的呼号', '请回答',
        ],
      },
      {
        text: 'R {CALLSIGN} DE {PARTNER} GM OM LI TNX FER RPRT UR RST 579 579 QTH SHANGHAI SHANGHAI NAME WANG WANG HW? {CALLSIGN} DE {PARTNER} K',
        words: [
          '收到', '我的呼号', '这里是', '对方呼号', '早上好', '老朋友', '李', '谢谢', '为了', '报告',
          '你的', '信号报告', '读数', '读数', '位置', '上海', '上海',
          '名字', '王', '王', '怎么样', '我的呼号', '这里是', '对方呼号', '请回答',
        ],
      },
      {
        text: 'R R TNX WANG WX HR FINE RIG IC7300 PWR 100W ANT DIPOLE PSE QSL VIA BUREAU TNX FER NICE QSO ES HPE CU AGN 73 ES GL {PARTNER} DE {CALLSIGN} SK',
        words: [
          '收到', '收到', '谢谢', '王', '天气', '这里', '很好',
          '电台', 'IC7300', '功率', '100 瓦', '天线', '偶极天线',
          '请', '卡片', '经由', '卡片局', '谢谢', '为了', '愉快的', '通联', '和', '希望', '再见', '再',
          '致敬', '和', '好运', '对方呼号', '这里是', '我的呼号', '通联结束',
        ],
      },
      {
        text: 'R R QSL TU 73 ES GL HPE CU AGN {CALLSIGN} DE {PARTNER} SK',
        words: [
          '收到', '收到', '卡片', '谢谢', '致敬', '和', '好运',
          '希望', '再见', '再', '我的呼号', '这里是', '对方呼号', '通联结束',
        ],
      },
    ],
  },
  {
    id: 'l5-dx',
    title: '第 11 课　比赛与远征节奏',
    level: 5,
    summary: '和 {PARTNER} 的高节奏交换，能省的字全省。要求整体识别，手指干净利落。',
    focus: ['5', '9', 'N', 'T', 'U', 'K'],
    items: [
      { text: '{PARTNER} 5NN 5NN', words: ['对方呼号', '信号 599', '信号 599'] },
      { text: '{PARTNER} 5NN 001', words: ['对方呼号', '信号 599', '序号'] },
      { text: 'TU {CALLSIGN} QRZ', words: ['谢谢', '我的呼号', '谁在呼我'] },
      { text: '{CALLSIGN} TEST', words: ['我的呼号', '比赛呼叫'] },
      { text: 'CQ TEST {CALLSIGN} {CALLSIGN} TEST', words: ['呼叫', '比赛', '我的呼号', '我的呼号', '比赛'] },
      { text: 'QSL 5NN 5NN TU', words: ['卡片', '信号 599', '信号 599', '谢谢'] },
      { text: 'AGN? AGN?', words: ['再来一遍', '再来一遍'] },
      { text: 'NR? NR?', words: ['号码', '号码'] },
      { text: 'PSE UP 2', words: ['请', '往高', '2 kHz'] },
      { text: 'TU 73', words: ['谢谢', '致敬'] },
    ],
  },
];

/** 按 id 取一课。 */
export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

/** 把一课展开成实际要练的每一条（替换掉呼号占位符）。 */
export function expandLesson(lesson: Lesson, callsign: string): LessonItem[] {
  return lesson.items.map((it) => ({
    ...it,
    text: resolvePlaceholders(it.text, callsign),
    gloss: it.gloss ? resolvePlaceholders(it.gloss, callsign) : undefined,
  }));
}
