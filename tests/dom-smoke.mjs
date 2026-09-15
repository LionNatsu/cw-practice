/**
 * 无浏览器的“冒烟测试”：给产物搭一个最小 DOM 桩，把整个应用真的跑起来。
 *
 * 为什么需要它：受限环境里 Chrome 起不来（需要 spawn 带管道的子进程），没法截图，
 * 而“打开页面一片空白”这类问题恰恰只有真跑一遍才能发现。这个脚本能验证：
 *   - 所有模块能加载（没有语法错误、没有写错的导入路径）
 *   - main.ts 的挂载与路由不抛异常
 *   - 练习视图真的渲染出了目标字符、手键区、指标、诊断面板
 *   - 真的拍一段 CQ 进去，抄收区、判定、成绩弹窗都能跟着动
 *
 * 用法：node tests/dom-smoke.mjs [dist|src]
 */

// ---------------- 最小 DOM ----------------

class TextNode {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = String(text);
    this.parentNode = null;
    this.children = [];
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
}

class Element {
  constructor(tagName) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = {
      _p: new Map(),
      setProperty(k, v) {
        this._p.set(k, v);
      },
      getPropertyValue(k) {
        return this._p.get(k) ?? '';
      },
    };
    this._classes = new Set();
    this._listeners = new Map();
    this._text = '';
    this.value = '';
    this.checked = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
  }
  get classList() {
    const self = this;
    return {
      add: (...c) => c.forEach((x) => x && self._classes.add(x)),
      remove: (...c) => c.forEach((x) => self._classes.delete(x)),
      toggle: (c, f) => {
        const want = f === undefined ? !self._classes.has(c) : f;
        if (want) self._classes.add(c);
        else self._classes.delete(c);
        return want;
      },
      contains: (c) => self._classes.has(c),
    };
  }
  get className() {
    return [...this._classes].join(' ');
  }
  set className(v) {
    this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get id() {
    return this.attributes.get('id') ?? '';
  }
  set id(v) {
    this.attributes.set('id', v);
  }
  setAttribute(k, v) {
    if (k === 'class') this.className = v;
    else this.attributes.set(k, String(v));
    if (k === 'value') this.value = String(v);
    if (k === 'checked') this.checked = true;
  }
  getAttribute(k) {
    return this.attributes.get(k) ?? null;
  }
  removeAttribute(k) {
    this.attributes.delete(k);
  }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.children.push(node);
    return node;
  }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) this.children.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  get childElementCount() {
    return this.children.filter((c) => c.nodeType === 1).length;
  }
  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.textContent ?? '').join('');
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v ?? '');
  }
  get innerHTML() {
    return this.textContent;
  }
  set innerHTML(v) {
    this.textContent = String(v ?? '');
  }
  get previousElementSibling() {
    if (!this.parentNode) return null;
    const sibs = this.parentNode.children;
    const i = sibs.indexOf(this);
    return i > 0 ? sibs[i - 1] : null;
  }
  addEventListener(type, fn) {
    const arr = this._listeners.get(type) ?? [];
    arr.push(fn);
    this._listeners.set(type, arr);
  }
  removeEventListener(type, fn) {
    const arr = this._listeners.get(type) ?? [];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  dispatchEvent(ev) {
    const type = typeof ev === 'string' ? ev : ev.type;
    for (const fn of [...(this._listeners.get(type) ?? [])]) {
      fn.call(this, typeof ev === 'string' ? { type, target: this, preventDefault() {} } : ev);
    }
    let p = this.parentNode;
    while (p) {
      for (const fn of [...(p._listeners.get(type) ?? [])]) fn.call(p, { type, target: this, preventDefault() {} });
      p = p.parentNode;
    }
    return true;
  }
  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault() {} });
  }
  matches(sel) {
    for (const one of String(sel).split(',').map((s) => s.trim())) {
      if (!one) continue;
      // 支持简单的复合选择器：.a.b / #id / tag / tag.a
      if (one.startsWith('.') && one.includes('.')) {
        const parts = one.split('.').filter(Boolean);
        if (parts.every((p) => this._classes.has(p))) return true;
        continue;
      }
      if (one.startsWith('.') && this._classes.has(one.slice(1))) return true;
      if (one.startsWith('#') && this.id === one.slice(1)) return true;
      if (/^[a-z]+$/i.test(one) && this.tagName === one.toUpperCase()) return true;
    }
    return false;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  closest(sel) {
    let n = this;
    while (n) {
      if (n.nodeType === 1 && n.matches(sel)) return n;
      n = n.parentNode;
    }
    return null;
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (c.nodeType === 1 && c.matches(sel)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  focus() {}
}

class Document extends Element {
  constructor() {
    super('#document');
    this.body = new Element('body');
    this.appendChild(this.body);
    this._winListeners = new Map();
  }
  createElement(tag) {
    return new Element(tag);
  }
  createTextNode(text) {
    return new TextNode(text);
  }
  getElementById(id) {
    return this.querySelector(`#${id}`);
  }
  addEventListener(type, fn) {
    // document/window 级的监听统一收在这里（应用主要用 window 级键盘事件）
    const arr = this._winListeners.get(type) ?? [];
    arr.push(fn);
    this._winListeners.set(type, arr);
  }
  removeEventListener(type, fn) {
    const arr = this._winListeners.get(type) ?? [];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  dispatchWindow(type, ev) {
    const full = { type, preventDefault() {}, stopPropagation() {}, ...ev };
    for (const fn of [...(this._winListeners.get(type) ?? [])]) fn(full);
  }
}

// ---------------- 全局桩 ----------------

const document = new Document();
const storage = new Map();
let rafSeq = 1;
const rafs = new Map();
const timeouts = new Map();
let now = 0;

const windowStub = {
  document,
  addEventListener: (t, fn) => document.addEventListener(t, fn),
  removeEventListener: (t, fn) => document.removeEventListener(t, fn),
  setTimeout: (fn, ms) => {
    const id = rafSeq++;
    timeouts.set(id, { fn, at: now + (ms ?? 0) });
    return id;
  },
  clearTimeout: (id) => timeouts.delete(id),
  setInterval: () => 0,
  clearInterval: () => {},
  requestAnimationFrame: (fn) => {
    const id = rafSeq++;
    rafs.set(id, fn);
    return id;
  },
  cancelAnimationFrame: (id) => rafs.delete(id),
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
  location: { href: 'http://localhost/' },
  innerWidth: 1280,
  innerHeight: 900,
  AudioContext: class {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = {};
    }
    createGain() {
      return { gain: audioParam(1), connect: (x) => x, disconnect() {} };
    }
    createOscillator() {
      return { type: 'sine', frequency: audioParam(700), connect: (x) => x, start() {}, stop() {} };
    }
    resume() {
      return Promise.resolve();
    }
  },
};

function audioParam(v) {
  return {
    value: v,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    cancelScheduledValues() {},
  };
}

globalThis.window = windowStub;
globalThis.document = document;
globalThis.localStorage = windowStub.localStorage;
globalThis.requestAnimationFrame = windowStub.requestAnimationFrame;
globalThis.cancelAnimationFrame = windowStub.cancelAnimationFrame;
globalThis.performance = { now: () => now };
globalThis.AudioContext = windowStub.AudioContext;
globalThis.HTMLElement = Element;
globalThis.Node = Element;
globalThis.Blob = class {
  constructor(parts) {
    this.parts = parts;
  }
};
globalThis.URL.createObjectURL = () => 'blob:stub';
globalThis.URL.revokeObjectURL = () => {};
globalThis.confirm = () => true;

/** 推进虚拟时间：跑 rAF 与到期的 setTimeout。 */
function advance(ms) {
  const target = now + ms;
  let guard = 0;
  while (now < target && guard++ < 20000) {
    now += 8;
    for (const [id, fn] of [...rafs]) {
      rafs.delete(id);
      try {
        fn(now);
      } catch (err) {
        reportThrow('rAF', err);
      }
    }
    for (const [id, t] of [...timeouts]) {
      if (t.at <= now) {
        timeouts.delete(id);
        try {
          t.fn();
        } catch (err) {
          reportThrow('setTimeout', err);
        }
      }
    }
  }
}

let thrown = 0;
function reportThrow(where, err) {
  thrown++;
  process.exitCode = 1;
  console.error(`  ✖ ${where} 回调抛错: ${err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err}`);
}

let pass = 0;
let fail = 0;
function check(ok, label, extra = '') {
  if (ok) {
    pass++;
    console.log(`  ✔ ${label}`);
  } else {
    fail++;
    process.exitCode = 1;
    console.log(`  ✖ ${label}${extra ? `　${extra}` : ''}`);
  }
}

/**
 * 从 index.html 里抽出元素标签与属性，照着搭出 DOM 骨架。
 * 这样冒烟测试用的就是真实的页面结构，而不是手写一份容易过期的副本。
 */
function buildDomFromHtml(html) {
  const body = document.body;
  const stack = [body];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)(\/?)>/g;
  let m;
  while ((m = re.exec(html))) {
    const [, closing, tag, rawAttrs, selfClose] = m;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (tag.toLowerCase() === 'script' || tag.toLowerCase() === 'link' || tag.toLowerCase() === 'meta') {
      continue;
    }
    const el = new Element(tag);
    const attrRe = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*"([^"]*)")?/g;
    let a;
    while ((a = attrRe.exec(rawAttrs ?? ''))) {
      const key = a[1];
      const val = a[2] ?? '';
      if (!key) continue;
      if (key === 'class') el.className = val;
      else if (key === 'id') el.id = val;
      else if (key.startsWith('data-')) el.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val;
      el.setAttribute(key, val);
    }
    stack[stack.length - 1].appendChild(el);
    if (!selfClose) stack.push(el);
  }
  return body;
}

// ---------------- 跑起来 ----------------

const which = process.argv[2] ?? 'dist';
const entry = which === 'src' ? '../src/main.ts' : '../dist/main.js';
const corePrefix = which === 'src' ? '../src/core/' : '../dist/core/';
console.log(`[smoke] 入口: ${entry}`);

const { readFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const htmlPath = fileURLToPath(new URL('../index.html', import.meta.url));
buildDomFromHtml(readFileSync(htmlPath, 'utf8'));

await import(entry);

advance(60);
check(document.querySelectorAll('.tab').length === 5, '顶部 5 个 tab 渲染出来了');
check(document.body.childElementCount > 0, 'body 有内容（不是空白页）');
check(document.querySelectorAll('#view').length === 1, '#view 容器存在');

// 切到练习页
const practiceTab = document.querySelectorAll('.tab').find((t) => t.dataset.tab === 'practice');
check(!!practiceTab, '找到“练习” tab');
practiceTab?.click();
advance(60);

const tchars = document.querySelectorAll('.tchar');
check(tchars.length > 0, `目标字符渲染出来了（${tchars.length} 个）`);
check(document.querySelectorAll('.keypad').length === 1, '手键区渲染出来了');
check(document.querySelectorAll('.meter').length >= 6, `实时指标渲染出来了（${document.querySelectorAll('.meter').length} 个）`);
check(document.querySelectorAll('.diag').length === 1, '诊断面板渲染出来了');
if (tchars.length > 0) {
  const first = tchars[0];
  check(first.textContent.length > 0, `第一个目标字符可见：${JSON.stringify(first.textContent)}`);
  check(first.querySelectorAll('.dot').length + first.querySelectorAll('.dash').length > 0, '目标字符上方有摩尔斯码点划');
}

// 这一课第一条应该是 E 或 T 之类的单字符

// 开始拍发（按 id 点，别靠按钮文案——文案会改，id 不会）
const armBtn = document.getElementById('arm-toggle');
check(!!armBtn, '找到「开始拍发」按钮（id=arm-toggle）');
armBtn?.click();
advance(20);
check(document.querySelectorAll('.armed-indicator.on').length === 1, '开始拍发后指示灯变绿（.armed-indicator.on）');

// 真的拍一段 CQ 进去（用 window 级键盘事件当直键）
const { ALL_CHAR_TO_PATTERN } = await import(`${corePrefix}morse.js`);
const { TimingModel } = await import(`${corePrefix}timing-model.js`);

/** 拍一个码字：点 100ms、划 300ms、码元间隔 100ms。返回拍完后的时间。 */
function keyChar(ch, dit) {
  const pattern = ALL_CHAR_TO_PATTERN[ch];
  if (!pattern) throw new Error(`没有码形: ${ch}`);
  let first = true;
  for (const sym of pattern) {
    if (!first) {
      now += dit; // 码元间隔
      advance(0);
    }
    first = false;
    const dur = sym === '.' ? dit : dit * 3;
    document.dispatchWindow('keydown', { code: 'Space', repeat: false });
    now += dur;
    document.dispatchWindow('keyup', { code: 'Space', repeat: false });
  }
  now += dit * 3; // 字符间隔
  advance(0);
}

// 目标文本的第一条（通常是单字符或多字符的短条目）
const targetText = tchars.map((c) => c.querySelector('.ch')?.textContent ?? '').join('');
console.log(`[smoke] 本条目标文本: ${JSON.stringify(targetText)}`);

const dit = 100;
now += 200;
for (const ch of targetText.slice(0, 3)) {
  if (!ALL_CHAR_TO_PATTERN[ch]) continue;
  keyChar(ch, dit);
}
advance(600); // 触发停顿定稿

const copyText = document.querySelectorAll('.copyline')[0]?.textContent ?? '';
check(copyText.length > 0, `抄收区有内容：${JSON.stringify(copyText.slice(0, 20))}`);
const correctCells = document.querySelectorAll('.tchar.correct').length;
// 注意：这里的 DOM 桩只支持简单选择器，所以用 .dline 而不是 ".diag .dline"
const diagRows = document.querySelectorAll('.dline').length;
check(diagRows >= 2, `诊断面板有表头 + 数据行（${diagRows} 行）`);
const pulseText = document.querySelectorAll('.pulse-dur')[0]?.textContent ?? '';
check(/\d+ms/.test(pulseText) && /把握/.test(pulseText), `脉冲显示时长与把握：${JSON.stringify(pulseText)}`);
check(correctCells > 0, `有字符被判对（${correctCells} 个 .tchar.correct）`);

// 指标在动
const meters = document.querySelectorAll('.meter').map((m) => m.textContent);
check(
  meters.some((m) => /\d/.test(m)),
  `指标有数值：${JSON.stringify(meters.slice(0, 4))}`,
);

// 结算
const settleBtn = document.querySelectorAll('button').find((b) => b.textContent.includes('看看成绩'));
check(!!settleBtn, '找到「看看成绩」按钮');
settleBtn?.click();
advance(50);
const modal = document.querySelectorAll('.modal')[0];
check(!!modal, '结算弹窗弹出来了');
if (modal) {
  check(/\d/.test(modal.textContent), `弹窗里有成绩：${JSON.stringify(modal.textContent.slice(0, 60))}`);
  const closeBtn = modal.querySelectorAll('button').find((b) => b.textContent.includes('关上'));
  closeBtn?.click();
  advance(20);
  check(document.querySelectorAll('.modal').length === 0, '弹窗能关闭');
}

// 其它 tab 都能渲染
for (const tab of ['lessons', 'stats', 'settings', 'help']) {
  const btn = document.querySelectorAll('.tab').find((t) => t.dataset.tab === tab);
  btn?.click();
  advance(40);
  check(document.querySelectorAll('#view')[0]?.childElementCount > 0, `切到 ${tab} 页有内容`);
}

console.log(`\n[smoke] 通过 ${pass} 项，失败 ${fail} 项，回调抛错 ${thrown} 次`);
if (fail > 0 || thrown > 0) process.exitCode = 1;
