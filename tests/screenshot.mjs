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
  const press = async (ms) => {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      windowsVirtualKeyCode: 32,
      nativeVirtualKeyCode: 32,
      code: 'Space',
      key: ' ',
      text: ' ',
    });
    await delay(ms);
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      windowsVirtualKeyCode: 32,
      nativeVirtualKeyCode: 32,
      code: 'Space',
      key: ' ',
    });
  };
  return {
    press,
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
  const isArmed = () => cdp.evaluate(`!!document.querySelector('.armed-indicator.on')`);
  const setArmed = async (want) => {
    if ((await isArmed()) === want) return true;
    await clickId('arm-toggle');
    return waitFor(want ? `document.querySelector('.armed-indicator.on')` : `document.querySelector('.armed-indicator.off')`);
  };

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

    // 1) 首次访问落在帮助页
    await shot('01-help');

    // 2) 练习页（未武装）
    await click(byText('.tab', '练习'));
    await delay(500);
    await shot('02-practice-idle');
    const tchars = await cdp.evaluate(`document.querySelectorAll('.tchar').length`);
    check(tchars > 0, `练习页渲染出 ${tchars} 个目标字符`);

    // 3) 武装
    await setArmed(true);
    check(await isArmed(), '开始拍发后指示灯变绿');
    await shot('03-armed');

    // 4) 真的拍当前条目（用 110ms 的点）
    const keyer = makeKeyer(cdp, 110);
    const target1 = await cdp.evaluate(`[...document.querySelectorAll('.tchar .ch')].map(e=>e.textContent).join('')`);
    console.log(`[screenshot] 第 1 条目标: ${JSON.stringify(target1)}`);
    await keyer.text(target1);
    await delay(800);
    await shot('04-keyed-correct');

    const style1 = await cdp.evaluate(`(() => {
      const cell = document.querySelector('.tchar.done.correct');
      if (!cell) return null;
      const ch = cell.querySelector('.ch');
      const dot = cell.querySelector('.dot, .dash');
      return {
        chColor: getComputedStyle(ch).color,
        dotBg: dot ? getComputedStyle(dot).backgroundColor : null,
        text: cell.innerText.replace(/\\n/g,' '),
      };
    })()`);
    console.log(`[screenshot] 判对的字符样式: ${JSON.stringify(style1)}`);
    check(!!style1, '出现“判对”的字符（.tchar.done.correct）');
    // 期望是绿色 rgb(85, 214, 139)
    check(style1?.chColor === 'rgb(85, 214, 139)', '判对字符的文字是绿色', style1?.chColor ?? '');
    check(style1?.dotBg === 'rgb(85, 214, 139)', '判对字符的点划是绿色', style1?.dotBg ?? '');

    const diag = await cdp.evaluate(
      `[...document.querySelectorAll('.dline')].slice(1).map(d => d.innerText.replace(/\\n/g,' ')).join(' ;; ')`,
    );
    check(diag.includes('ms'), `诊断面板有按键记录：${diag}`);

    const meters = await cdp.evaluate(
      `[...document.querySelectorAll('.meter')].map(m => m.innerText.replace(/\\n/g,' ')).join(' | ')`,
    );
    console.log(`[screenshot] 指标: ${meters}`);
    check(/量了 [1-9]/.test(meters), '点/划的样本数不再是 0', meters);

    // 5) 结算
    await click(byText('button', '看看成绩'));
    await delay(500);
    await shot('05-result');
    const resultText = await cdp.evaluate(`document.querySelector('.modal')?.innerText.replace(/\\n+/g,' | ') ?? ''`);
    check(resultText.length > 0, `结算弹窗有内容：${resultText.slice(0, 80)}`);
    await click(byText('.modal button', '关上'));
    await delay(200);

    // 6) 故意发错：目标第 1 条是 E，我们发 T，看红色判定
    await click(byText('button', '重拍这一条'));
    await delay(500);
    const armed2 = await setArmed(true);
    const indicatorDump = await cdp.evaluate(
      `[...document.querySelectorAll('.armed-indicator')].map(e => e.className).join(' ~ ')`,
    );
    const targetWrong = await cdp.evaluate(
      `[...document.querySelectorAll('.tchar .ch')].map(e=>e.textContent).join('')`,
    );
    console.log(
      `[screenshot] 重拍后：可拍发=${armed2} 指示灯类=${JSON.stringify(indicatorDump)} 目标=${JSON.stringify(targetWrong)}`,
    );
    check(armed2, '重拍一条之后仍能开始拍发');
    // 目标第一个字符是 E 就发 T，反之发 E —— 保证一定发错
    await keyer.char(targetWrong[0] === 'E' ? 'T' : 'E');
    await delay(900);
    const style2 = await cdp.evaluate(`(() => {
      const cell = document.querySelector('.tchar.done.wrong');
      if (!cell) return { found: false, cells: [...document.querySelectorAll('.tchar')].map(c=>c.className) };
      return { found: true, text: cell.innerText.replace(/\\n/g,' '), chColor: getComputedStyle(cell.querySelector('.ch')).color };
    })()`);
    console.log(`[screenshot] 判错的字符样式: ${JSON.stringify(style2)}`);
    check(style2.found === true, '故意发错时出现“判错”的字符（.tchar.done.wrong）');
    check(style2.chColor === 'rgb(255, 107, 107)', '判错字符的文字是红色', style2.chColor ?? '');
    await shot('06-keyed-wrong');

    // 7) 长报文：选第 9 课（短 QSO），拍几条看逐字判定
    await click(byText('.tab', '课程'));
    await delay(400);
    await shot('07-lessons');
    await click(byText('.lesson', '第 5 课'));
    await delay(800);
    await setArmed(true);
    const targetLong = await cdp.evaluate(`[...document.querySelectorAll('.tchar .ch')].map(e=>e.textContent).join('')`);
    console.log(`[screenshot] 长报文目标: ${JSON.stringify(targetLong)}`);
    // 只拍前 6 个字符，看看“已判对 + 待定”混合的样子
    await keyer.text(targetLong.slice(0, 6));
    await delay(1200);
    await shot('08-long-message');
    const longState = await cdp.evaluate(`JSON.stringify({
      correct: document.querySelectorAll('.tchar.done.correct').length,
      pending: document.querySelectorAll('.tchar.pending').length,
      copy: document.querySelector('.copyline')?.innerText ?? '',
      candidates: document.querySelector('.candidates')?.innerText ?? '',
    })`);
    console.log(`[screenshot] 长报文状态: ${longState}`);
    check(JSON.parse(longState).correct > 0, '长报文里有字符被判对');
    if (JSON.parse(longState).pending > 0) {
      const pendStyle = await cdp.evaluate(
        `getComputedStyle(document.querySelector('.tchar.pending .ch')).color`,
      );
      console.log(`[screenshot] 待定字符颜色: ${pendStyle}`);
    }

    // 8) 设置页（校准台）
    await click(byText('.tab', '设置'));
    await delay(400);
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
