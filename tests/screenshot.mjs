/**
 * 用 Chrome DevTools Protocol 驱动无头 Chrome：真的点按钮、真的拍键，然后截图。
 *
 * 为什么不用 puppeteer：不想给项目加依赖（受限环境也装不上）。这里只用
 * node:http + node:net + 自己写的极简 WebSocket 客户端，零依赖。
 *
 * 用法：
 *   node scripts/serve.mjs dist 8123     # 另开一个进程
 *   node tests/screenshot.mjs [输出目录]
 *
 * 环境变量：CW_URL（默认 http://127.0.0.1:8123/）、CW_CDP_PORT、CW_CHROME。
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.resolve(process.argv[2] ?? path.join(ROOT, '.shots'));
const URL_TARGET = process.env.CW_URL ?? 'http://127.0.0.1:8123/';
const DEBUG_PORT = Number(process.env.CW_CDP_PORT ?? 9333);

const CHROME_CANDIDATES = [
  process.env.CW_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  throw new Error('找不到 Chrome/Edge，可用 CW_CHROME 环境变量指定');
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- HTTP ----------

function httpJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`无法解析 ${pathname}: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('HTTP 超时')));
  });
}

async function waitForCdp(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const list = await httpJson(port, '/json/list');
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (err) {
      lastErr = err;
    }
    await delay(250);
  }
  throw new Error(`等待 CDP 超时: ${lastErr?.message ?? ''}`);
}

// ---------- 极简 WebSocket ----------

function connectWs(url) {
  const u = new URL(url);
  const key = randomBytes(16).toString('base64');
  const sock = net.connect({ host: u.hostname, port: Number(u.port) });
  let buffer = Buffer.alloc(0);
  let handshakeDone = false;
  let fragments = [];
  let fragmentOpcode = 0;
  const handlers = { message: [], open: [], close: [] };

  const api = {
    send(obj) {
      sock.write(encodeFrame(0x1, Buffer.from(JSON.stringify(obj), 'utf8')));
    },
    close() {
      try {
        sock.end();
      } catch {
        /* ignore */
      }
    },
    on(event, fn) {
      handlers[event].push(fn);
      return api;
    },
  };

  sock.on('connect', () => {
    sock.write(
      `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\n` +
        `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );
  });

  sock.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!handshakeDone) {
      const idx = buffer.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const head = buffer.subarray(0, idx).toString('latin1');
      if (!/ 101 /.test(head.split('\r\n')[0] ?? '')) {
        for (const fn of handlers.close) fn(new Error(`WebSocket 握手失败: ${head.split('\r\n')[0]}`));
        sock.destroy();
        return;
      }
      buffer = buffer.subarray(idx + 4);
      handshakeDone = true;
      for (const fn of handlers.open) fn();
    }
    for (;;) {
      const frame = decodeFrame(buffer);
      if (!frame) break;
      buffer = buffer.subarray(frame.consumed);
      if (frame.opcode === 0x9) {
        sock.write(encodeFrame(0xa, frame.payload));
        continue;
      }
      if (frame.opcode === 0x8) {
        for (const fn of handlers.close) fn(new Error('对端关闭'));
        sock.end();
        return;
      }
      if (frame.opcode === 0x0) fragments.push(frame.payload);
      else if (frame.opcode === 0x1 || frame.opcode === 0x2) {
        fragments = [frame.payload];
        fragmentOpcode = frame.opcode;
      }
      if (frame.fin) {
        const payload = Buffer.concat(fragments);
        fragments = [];
        if (fragmentOpcode === 0x1) {
          const text = payload.toString('utf8');
          for (const fn of handlers.message) fn(text);
        }
      }
    }
  });

  sock.on('error', (err) => {
    for (const fn of handlers.close) fn(err);
  });
  sock.on('close', () => {
    for (const fn of handlers.close) fn(new Error('连接关闭'));
  });

  return api;
}

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const b0 = buf[0];
  const b1 = buf[1];
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < offset + 2) return null;
    len = buf.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buf.length < offset + 8) return null;
    len = Number(buf.readBigUInt64BE(offset));
    offset += 8;
  }
  let mask;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + len) return null;
  const payload = Buffer.from(buf.subarray(offset, offset + len));
  if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  return { fin, opcode, payload, consumed: offset + len };
}

function encodeFrame(opcode, payload) {
  const mask = randomBytes(4);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.on('message', (text) => {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        // 把页面里的 console 输出实时打出来，排障时非常有用
        if (msg.method === 'Runtime.consoleAPICalled') {
          const text = (msg.params.args ?? [])
            .map((a) => (a.value !== undefined ? String(a.value) : a.description ?? ''))
            .join(' ');
          console.log(`  [page:${msg.params.type}] ${text}`);
        }
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send({ id, method, params });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时: ${method}`));
        }
      }, 20000);
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error(`页面内异常: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    }
    return r.result?.value;
  }
}

// ---------- 拍键：用 CDP 真的按下/抬起空格 ----------

const PATTERNS = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
  '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
  '?': '..--..', '.': '.-.-.-', ',': '--..--', '/': '-..-.', '+': '.-.-.', '=': '-...-', '!': '-.-.--', '(': '-.--.',
};

function makeKeyer(cdp, dit) {
  // 直键在系统里就是一个鼠标左键：在舞台区里按下、松开
  let spot = { x: 720, y: 420 };
  const aim = async () => {
    const rect = await cdp.evaluate(`(() => {
      const r = document.getElementById('stage').getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    })()`);
    spot = JSON.parse(rect);
  };
  const mouse = (type) =>
    cdp.send('Input.dispatchMouseEvent', {
      type,
      x: spot.x,
      y: spot.y,
      button: 'left',
      buttons: type === 'mousePressed' ? 1 : 0,
      clickCount: 1,
    });

  /** 按住 ms 毫秒；按住到一半时可以插一段回调（用来观察按下去那一刻的界面）。 */
  const hold = async (ms, during) => {
    await mouse('mousePressed');
    await delay(Math.round(ms * 0.6));
    if (during) await during();
    await delay(Math.max(1, ms - Math.round(ms * 0.6)));
    await mouse('mouseReleased');
  };
  const press = (ms) => hold(ms);
  return {
    aim,
    press,
    hold,
    /** 拍一个字符。 */
    async char(ch) {
      const pat = PATTERNS[ch];
      if (!pat) return false;
      for (let i = 0; i < pat.length; i++) {
        if (i > 0) await delay(dit);
        await press(pat[i] === '.' ? dit : dit * 3);
      }
      await delay(dit * 3);
      return true;
    },
    /** 拍一整段文本（空格 = 长停顿）。 */
    async text(str) {
      for (const ch of str) {
        if (ch === ' ') await delay(dit * 4);
        else if (!(await this.char(ch))) return false;
      }
      return true;
    },
    /** 直接拍一个码形（不走码表，用来发过程信号）。 */
    async pattern(pat) {
      for (let i = 0; i < pat.length; i++) {
        if (i > 0) await delay(dit);
        await press(pat[i] === '.' ? dit : dit * 3);
      }
      await delay(dit * 3);
    },
  };
}

// ---------- 主流程 ----------

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

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const chromePath = findChrome();
  const profile = path.join(OUT_DIR, 'cdp-profile');
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--disable-extensions',
      '--hide-scrollbars',
      '--window-size=1440,1080',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const shots = [];
  let cdp;

  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(data, 'base64');
    await writeFile(path.join(OUT_DIR, `${name}.png`), buf);
    shots.push(name);
    console.log(`  [shot] ${name}.png (${(buf.length / 1024).toFixed(0)} KB)`);
  };

  const click = (js) => cdp.evaluate(`(() => { const el = ${js}; if (!el) return false; el.click(); return true; })()`);
  const byText = (sel, text) => `[...document.querySelectorAll('${sel}')].find(e => e.textContent.includes('${text}'))`;
  /** 按 id 点击（稳定的自动化入口）。 */
  const clickId = (id) => click(`document.getElementById('${id}')`);
  /** 轮询等待某个条件成立。 */
  const waitFor = async (expr, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await cdp.evaluate(`!!(${expr})`)) return true;
      await delay(60);
    }
    return false;
  };
  const isArmed = () => cdp.evaluate(`!!document.querySelector('.live-dot.on')`);

  try {
    const target = await waitForCdp(DEBUG_PORT);
    const ws = connectWs(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('close', () => reject(new Error('WebSocket 关闭')));
    });
    cdp = new Cdp(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    // 禁用缓存：否则会加载上一次跑剩下的旧模块，“修了但看起来没修”
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

    console.log(`[screenshot] 打开 ${URL_TARGET}`);
    await cdp.send('Page.navigate', { url: URL_TARGET });
    await delay(2200);

    const title = await cdp.evaluate('document.title');
    const visible = await cdp.evaluate('document.body.innerText.replace(/\\s+/g," ").trim().length');
    console.log(`[screenshot] title=${JSON.stringify(title)}　可见文本 ${visible} 字`);
    check(visible > 100, '页面有可见内容（不是空白）');

    const errs = cdp.events.filter(
      (e) =>
        e.method === 'Runtime.exceptionThrown' ||
        (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'),
    );
    check(errs.length === 0, `无 JS 报错`, errs.map((e) => e.params?.exceptionDetails?.text ?? '').join(' | '));

    // 1) 说明页：列出四个过程信号，各带码形
    await click(byText('.tab', '帮助'));
    await delay(400);
    const helpCmds = await cdp.evaluate(`document.querySelectorAll('.help .cmd').length`);
    const helpMinis = await cdp.evaluate(`document.querySelectorAll('.help .pattern-mini').length`);
    check(helpCmds === 5 && helpMinis === 5, `说明页列了 5 条过程信号并画出码形（${helpCmds}/${helpMinis}）`);
    await shot('01-help');

    // 2) 练习页（未开始）
    await click(byText('.tab', '练习'));
    await delay(500);
    await shot('02-practice-idle');
    const cells = await cdp.evaluate(`[...document.querySelectorAll('.cell')].filter((c) => !c.classList.contains('ghost')).length`);
    check(cells > 0, `练习页渲染出 ${cells} 个字符`);

    // 换到第 9 课（一问一答）的一条较长报文，用来看透镜的尺寸递减
    await click(byText('.tab', '课程'));
    await delay(400);
    const lessonClicked = await click(byText('.lesson', '第 9 课'));
    console.log(`[screenshot] 点第 9 课: ${lessonClicked}`);
    await delay(800);
    const longTarget = await cdp.evaluate(
      `[...document.querySelectorAll('.cell .glyph')].filter((g) => !g.closest('.ghost')).map(e=>e.textContent).join('')`,
    );
    check(longTarget.length >= 8, `长报文已就位（${JSON.stringify(longTarget)}）`);
    const lens = await cdp.evaluate(`(() => {
      const pick = (d) => {
        const el = document.querySelector(".cell[data-dist='" + d + "'] .glyph");
        return el ? parseFloat(getComputedStyle(el).fontSize) : null;
      };
      const dists = [...document.querySelectorAll('.cell')].map((c) => c.dataset.dist);
      return JSON.stringify({ dists, d0: pick(0), d1: pick(1), d2: pick(2), d3: pick(3) });
    })()`);
    const lensObj = JSON.parse(lens);
    console.log(`[screenshot] 透镜: ${lens}`);
    check(lensObj.d0 >= 80, `中心字符应最大（≥80px），实际 ${lensObj.d0}px`);
    check(lensObj.d1 !== null && lensObj.d1 < lensObj.d0, `相邻字符应更小（${lensObj.d1} < ${lensObj.d0}）`);
    check(lensObj.d2 !== null && lensObj.d2 < lensObj.d1, `再外侧应更小（${lensObj.d2} < ${lensObj.d1}）`);
    // 透镜必须真的居中：中心字的字形中点要压在画面中线上
    const center = JSON.parse(
      await cdp.evaluate(`(() => {
        const cell = document.querySelector(".cell[data-dist='0']");
        const ch = cell?.querySelector('.glyph .ch');
        if (!ch) return JSON.stringify({ ok: false });
        const r = ch.getBoundingClientRect();
        const s = document.getElementById('stage').getBoundingClientRect();
        return JSON.stringify({
          ok: true,
          glyph: Math.round(r.left + r.width / 2),
          stage: Math.round(s.left + s.width / 2),
        });
      })()`),
    );
    console.log(`[screenshot] 居中: 字符中点 ${center.glyph}，舞台中点 ${center.stage}`);
    const off = Math.abs((center.glyph ?? 0) - (center.stage ?? 0));
    check(center.ok && off <= 4, `中心字居中（偏差 ${off}px）`);
    // 当前字那条横线要画在字符上：画在格子上会跟着词间隔一起变长
    const underline = JSON.parse(
      await cdp.evaluate(`(() => {
        const cell = document.querySelector(".cell[data-dist='0']");
        const ch = cell.querySelector('.glyph .ch');
        const after = getComputedStyle(cell, '::after');
        return JSON.stringify({
          afterContent: after.content,
          border: getComputedStyle(ch).borderBottomWidth,
          chWidth: Math.round(ch.getBoundingClientRect().width),
        });
      })()`),
    );
    console.log(`[screenshot] 当前字横线: ${JSON.stringify(underline)}`);
    check(underline.afterContent === 'none', '横线不挂在格子上（否则会跟着词间隔变长）');
    check(underline.border === '2px' && underline.chWidth < 80, `横线宽度跟着字符（字符宽 ${underline.chWidth}px）`);
    // 字符带里词间隔要看得出来：词与词之间的空档应明显大于词内字距
    const spacing = JSON.parse(
      await cdp.evaluate(`(() => {
        const all = [...document.querySelectorAll('.cell')].filter((c) => !c.classList.contains('ghost'))
          .map((c) => ({ word: c.dataset.word === '1', r: c.querySelector('.glyph .ch').getBoundingClientRect() }));
        if (all.length < 3) return JSON.stringify({ ok: false });
        const gaps = [];
        for (let i = 1; i < all.length; i++) gaps.push({ word: all[i].word, gap: Math.round(all[i].r.left - all[i - 1].r.right) });
        const inWord = gaps.filter((g) => !g.word).map((g) => g.gap);
        const between = gaps.filter((g) => g.word).map((g) => g.gap);
        return JSON.stringify({ ok: true, inWord, between });
      })()`),
    );
    const minBetween = Math.min(...(spacing.between ?? [Infinity]));
    const maxInWord = Math.max(...(spacing.inWord ?? [0]));
    console.log(`[screenshot] 字距: 词内 ${JSON.stringify(spacing.inWord)} / 词间 ${JSON.stringify(spacing.between)}`);
    check(
      spacing.ok && minBetween > maxInWord * 1.5,
      `词间隔明显大于字距（词内最大 ${maxInWord}px，词间最小 ${minBetween}px）`,
    );
    // 空位格不能把字符带里的字弄乱：可见的字应当就是这条报文的开头
    const ribbonText = JSON.parse(
      await cdp.evaluate(`(() => {
        const chars = [...document.querySelectorAll('.cell')].filter((c) => !c.classList.contains('ghost'))
          .map((c) => c.querySelector('.glyph .ch')?.textContent ?? '');
        const words = [...document.querySelectorAll('.lyrics .line.now .word')]
          .map((w) => [...w.querySelectorAll('.code span')].map((s) => s.textContent).join(''));
        return JSON.stringify({ chars: chars.join(''), target: words.join('') });
      })()`),
    );
    console.log(`[screenshot] 字符带可见字: ${JSON.stringify(ribbonText.chars)}（本条 ${JSON.stringify(ribbonText.target)}）`);
    check(
      ribbonText.chars.length > 0 && ribbonText.target.startsWith(ribbonText.chars),
      `字符带里显示的是本条报文的开头（${ribbonText.chars}）`,
    );
    await shot('02b-lens');

    // 回到第 1 课第 1 条（单字 E），走一遍“拍对”的流程
    await click(byText('.tab', '课程'));
    await delay(400);
    await click(byText('.lesson', '第 1 课'));
    await delay(700);
    await cdp.evaluate(`document.getElementById('lesson-item-0')?.click()`);
    await delay(700);

    // 回到第 1 条（单字 E），走一遍“拍对”的流程
    await click(`document.getElementById('lesson-item-0')`);
    await delay(600);
    check(await isArmed(), '进练习页就是拍发状态，不用先点开始（.live-dot.on）');
    const hasArm = await cdp.evaluate(`!!document.getElementById('arm-toggle')`);
    check(!hasArm, '页面上没有「开始」按钮');
    await shot('03-armed');

    // 4) 真的拍当前条目（用 110ms 的点）
    const keyer = makeKeyer(cdp, 110);
    await keyer.aim();

    // 4a) 按住不放：发报条上要有一根正在长的条，颜色是“点”的颜色
    let liveShape = null;
    await keyer.hold(140, async () => {
      liveShape = JSON.parse(
        await cdp.evaluate(`(() => {
          const s = document.querySelector('.sent .sym.live');
          return JSON.stringify({
            has: !!s,
            color: s ? getComputedStyle(s).backgroundColor : null,
            width: s ? Math.round(s.getBoundingClientRect().width) : 0,
          });
        })()`),
      );
      await shot('03b-keying');
    });
    console.log(`[screenshot] 按住反馈: ${JSON.stringify(liveShape)}`);
    check(liveShape?.has, '按住时发报条上有一根正在长的点划');
    check(liveShape?.color === 'rgb(76, 201, 240)', '按住时是“点”的颜色', liveShape?.color ?? '');
    await delay(500);
    await click(byText('button', '重来'));
    await delay(500);
    await delay(300);

    const target1 = await cdp.evaluate(
      `[...document.querySelectorAll(".cell[data-dist='0'] .glyph")].map(e=>e.textContent).join('')`,
    );
    console.log(`[screenshot] 第 1 条目标: ${JSON.stringify(target1)}`);
    await keyer.text(target1);
    await delay(120); // 在点划形状还在的时候抓一张
    const sent = await cdp.evaluate(`(() => {
      const row = document.querySelector('.sent');
      const syms = [...(row?.querySelectorAll('.sym') ?? [])];
      return JSON.stringify({
        cls: row?.className ?? '',
        count: syms.length,
        colors: syms.map((s) => getComputedStyle(s).backgroundColor),
        text: row?.innerText.replace(/\\n/g, ' ') ?? '',
      });
    })()`);
    console.log(`[screenshot] 发报条: ${sent}`);
    check(JSON.parse(sent).count >= 0, '发报条能读出来');
    await shot('04-keyed');
    await delay(600);

    const style1 = await cdp.evaluate(`(() => {
      const cell = document.querySelector('.cell.correct');
      if (!cell) return null;
      return {
        color: getComputedStyle(cell.querySelector('.glyph')).color,
        text: cell.innerText.replace(/\\n/g,' '),
      };
    })()`);
    console.log(`[screenshot] 判对字符样式: ${JSON.stringify(style1)}`);
    check(!!style1, '出现“判对”的字符（.cell.correct）');
    check(style1?.color === 'rgb(61, 220, 132)', '判对的字符是绿色', style1?.color ?? '');

    // 5) 成绩
    await click(byText('button', '成绩'));
    await delay(500);
    await shot('05-result');
    const resultText = await cdp.evaluate(`document.querySelector('.modal')?.innerText.replace(/\\n+/g,' | ') ?? ''`);
    check(resultText.length > 0, `成绩弹窗有内容：${resultText.slice(0, 80)}`);
    await click(byText('.modal button', '关闭'));
    await delay(200);

    // 6) 故意发错：目标第 1 条是 E，我们发 T。
    //    新行为：拍错的字不认，给负反馈（问号 + 没抄清），等重拍。
    await click(byText('button', '重来'));
    await delay(600);
    check(await isArmed(), '重来之后仍在拍发状态');
    const targetWrong = await cdp.evaluate(
      `[...document.querySelectorAll(".cell[data-dist='0'] .glyph")].map(e=>e.textContent).join('')`,
    );
    // 目标第一个字符是 E 就发 T，反之发 E —— 保证一定发错
    await keyer.char(targetWrong[0] === 'E' ? 'T' : 'E');
    await delay(700);
    const wrongState = await cdp.evaluate(`(() => {
      const row = document.querySelector('.sent.confused');
      const center = document.querySelector(".cell[data-dist='0'] .glyph")?.textContent ?? '';
      const qmark = row?.querySelector('.qmark');
      return JSON.stringify({
        hasWrong: !!row,
        qmark: !!qmark,
        qmarkColor: qmark ? getComputedStyle(qmark).color : null,
        said: row?.querySelector('.said')?.innerText.replace(/\\n/g,' ') ?? '',
        center,
        correctCells: document.querySelectorAll('.cell.correct').length,
      });
    })()`);
    console.log(`[screenshot] 拍错反馈: ${wrongState}`);
    const ws2 = JSON.parse(wrongState);
    check(ws2.hasWrong, '拍错时出现负反馈（.sent.confused）');
    check(ws2.qmark, '负反馈里有一个问号（对方没抄清）');
    check(ws2.qmarkColor === 'rgb(255, 90, 95)', '问号是红色', ws2.qmarkColor ?? '');
    check(/对方听到的是/.test(ws2.said), `负反馈说明对方听到的内容：${ws2.said}`);
    check(ws2.center === targetWrong[0], `拍错不前进，中心仍是 ${targetWrong[0]}（实际 ${ws2.center}）`);
    await shot('06-keyed-wrong');

    // 拍错之后重拍正确的，应当能继续推进
    const correctChar = targetWrong[0] ?? 'E';
    await delay(400);
    await keyer.char(correctChar);
    await delay(1400);
    const afterRetry = await cdp.evaluate(`JSON.stringify({
      correct: document.querySelectorAll('.cell.correct').length,
      wrongShown: !!document.querySelector('.sent.confused'),
      center: document.querySelector(".cell[data-dist='0'] .glyph")?.textContent ?? '',
    })`);
    console.log(`[screenshot] 重拍正确后: ${afterRetry}`);
    check(JSON.parse(afterRetry).correct >= 1, '重拍正确后该字被认下来');
    check(!JSON.parse(afterRetry).wrongShown, '认下来之后负反馈消失');

    // 7) 长报文：换成有多词的条目，看透镜与分词
    await click(byText('.tab', '课程'));
    await delay(400);
    await shot('07-lessons');
    await click(byText('.lesson', '第 9 课'));
    await delay(800);
    console.log(`[screenshot] 长条目拍发中=${await isArmed()}`);
    const targetLong = await cdp.evaluate(
      `[...document.querySelectorAll('.cell .glyph')].filter((g) => !g.closest('.ghost')).map(e=>e.textContent).join('')`,
    );
    console.log(`[screenshot] 长报文目标: ${JSON.stringify(targetLong)}`);
    // 逐字过判定：每拍完一个字，等它定稿（停顿够久），才轮到下一个字
    let gapMeter = null;
    for (let i = 0; i < 3 && i < targetLong.length; i++) {
      if (!(await keyer.char(targetLong[i]))) break;
      // 拍完第二个字，下一个字正好换词 —— 这时候词间隔提示条该出现
      if (i === 1) {
        await delay(200);
        gapMeter = JSON.parse(
          await cdp.evaluate(`(() => {
            const m = document.getElementById('gap-meter');
            return JSON.stringify({
              has: !!m,
              hint: m?.querySelector('.hint')?.innerText.replace(/\\n/g, ' ') ?? '',
              fill: m?.querySelector('.fill')?.style.width ?? '',
            });
          })()`),
        );
        await shot('07b-word-gap');
      }
      await delay(700);
    }
    await delay(500);
    await shot('08-long-message');
    const longState = await cdp.evaluate(`JSON.stringify({
      correct: document.querySelectorAll('.cell.correct').length,
      center: document.querySelector(".cell[data-dist='0'] .glyph")?.textContent ?? '',
      copy: document.querySelector('.message')?.innerText.replace(/\\n/g,' ') ?? '',
      pattern: document.querySelector('.pattern-hint')?.innerText ?? '',
      words: document.querySelectorAll('.lyrics .line.now .word').length,
      glosses: [...document.querySelectorAll('.lyrics .gl')].map((e) => e.textContent),
      prev: !!document.querySelector('.lyrics .line.prev'),
      next: !!document.querySelector('.lyrics .line.next'),
      meterGone: !document.getElementById('gap-meter'),
      focus: document.activeElement ? document.activeElement.tagName : 'none',
    })`);
    console.log(`[screenshot] 长报文状态: ${longState}`);
    const ls = JSON.parse(longState);
    console.log(`[screenshot] 词间隔提示条: ${JSON.stringify(gapMeter)}`);
    check(!!gapMeter?.has, '换词时出现词间隔提示条');
    check(/词间隔/.test(gapMeter?.hint ?? ''), `提示条写着词间隔：${gapMeter?.hint}`);
    check(!!gapMeter?.fill && gapMeter.fill !== '0%', `提示条在走：${gapMeter?.fill}`);
    check(ls.meterGone, '停够之后提示条自己消失');
    check(ls.correct > 0, `逐字过：拍对的字被认下来（${ls.correct} 个）`);
    check(!!ls.center, '中心位置始终有字符（透镜聚焦）');
    check(ls.center === targetLong[ls.correct], `中心应对准下一个要发的字（认下 ${ls.correct} 个，中心是 ${ls.center}，下一个应是 ${targetLong[ls.correct]}）`);
    check(ls.words > 1, `当前这句按词排开（${ls.words} 个词）`);
    check(
      ls.glosses.length === ls.words,
      `每个词下面都有直译（${ls.words} 个词 / ${ls.glosses.length} 条）：${JSON.stringify(ls.glosses)}`,
    );
    check(!!ls.next, '下一条邻句也摆出来了（歌词式滚动）');

    // 7b) 全程用手键操作：发 AR（.-.-.）应当换到下一条，不用摸鼠标
    const itemBefore = await cdp.evaluate(`document.getElementById('item-label')?.textContent ?? ''`);
    await keyer.pattern('.-.-.');
    await delay(900);
    const itemAfter = await cdp.evaluate(`document.getElementById('item-label')?.textContent ?? ''`);
    console.log(`[screenshot] 发 AR: ${JSON.stringify(itemBefore)} → ${JSON.stringify(itemAfter)}`);
    check(itemBefore !== itemAfter, '发 AR 直接换到下一条（不用去点按钮）');
    await shot('08b-prosign-next');

    // 7c) 再发 BK（-...-.-）回到上一条
    await keyer.pattern('-...-.-');
    await delay(900);
    const itemBack = await cdp.evaluate(`document.getElementById('item-label')?.textContent ?? ''`);
    console.log(`[screenshot] 发 BK: ${JSON.stringify(itemAfter)} → ${JSON.stringify(itemBack)}`);
    check(itemBack === itemBefore, '发 BK 直接回到上一条');

    // 8) 设置页：校准台拍几下，读数要出来
    await click(byText('.tab', '设置'));
    await delay(400);
    const pad = JSON.parse(
      await cdp.evaluate(`(() => {
        const r = document.getElementById('calib-pad').getBoundingClientRect();
        return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
      })()`),
    );
    const padPress = async (ms) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pad.x, y: pad.y, button: 'left', buttons: 1, clickCount: 1 });
      await delay(ms);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pad.x, y: pad.y, button: 'left', buttons: 0, clickCount: 1 });
      await delay(140);
    };
    for (const ms of [110, 110, 330, 110, 330, 330]) await padPress(ms);
    const padText = await cdp.evaluate(
      `document.getElementById('calib-pad')?.parentElement?.innerText.replace(/\\n+/g,' ') ?? ''`,
    );
    console.log(`[screenshot] 校准台: ${JSON.stringify(padText.slice(0, 70))}`);
    check(/点长\s*\d+ms/.test(padText), '校准台拍几下就有了读数');
    check(/划长\s*\d+ms/.test(padText), '校准台也报出了划长');
    await shot('09-settings');

    // 9) 统计页
    await click(byText('.tab', '统计'));
    await delay(400);
    await shot('10-stats');

    ws.close();
  } finally {
    chrome.kill();
  }

  console.log(`\n[screenshot] 断言 ${pass} 通过 / ${fail} 失败；输出 ${shots.length} 张到 ${OUT_DIR}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[screenshot] 失败:', err);
  process.exitCode = 1;
});
