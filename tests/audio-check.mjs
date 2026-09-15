/**
 * 音频冒烟测试：用 OfflineAudioContext 真跑一遍音频引擎，分析生成的波形。
 *
 * 为什么需要它：声音对不对没法靠截图看，而 Web Audio 的包络调度很容易写错
 * （例如整段变成一个长音）。这里把页面里的 AudioContext 换成离线渲染版，
 * 拿回真实采样，先做 5ms 窗口的峰值包络，再数“响了几段、每段多久”。
 *
 * 注意不能逐采样点判断有声/无声：正弦波每个周期都会穿过零点，
 * 那样会把一段连续音切成几百个 1ms 的假片段。
 *
 * 用法：node tests/audio-check.mjs [dist|src]
 * 前置：node scripts/serve.mjs dist 8123
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEBUG_PORT = Number(process.env.CW_CDP_PORT ?? 9334);
const which = process.argv[2] ?? 'dist';
const AUDIO_MODULE = which === 'src' ? '/src/core/audio.ts' : '/core/audio.js';
/** 目标地址：默认自己起一个静态服务器托管 dist/，也可以用 CW_URL 指向别处。 */
let URL_TARGET = process.env.CW_URL ?? '';

/**
 * 起一个只读的静态服务器托管构建产物。
 *
 * 为什么测试要自带服务器：CI 的干净机器上没有现成的服务器，
 * 之前就是因此导致 Chrome 打开页面失败（chrome-error://chromewebdata），
 * 整个部署被打断。
 */
async function startStaticServer(dir) {
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const full = path.join(dir, rel);
      if (!full.startsWith(dir)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const info = await stat(full).catch(() => null);
      if (!info || !info.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`404 ${rel}`);
        return;
      }
      const body = await readFile(full);
      res.writeHead(200, {
        'content-type': MIME[path.extname(full).toLowerCase()] ?? 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { server, url: `http://127.0.0.1:${port}/` };
}

const CHROME = [
  process.env.CW_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
  .filter(Boolean)
  .find((p) => existsSync(p));
if (!CHROME) throw new Error('找不到 Chrome/Edge');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** 包络分析（注入页面执行）。 */
function analyzeSegments(data, sr, onLevel, offLevel) {
  const win = Math.max(1, Math.round(sr * 0.005));
  const env = [];
  for (let i = 0; i < data.length; i += win) {
    let peak = 0;
    for (let j = i; j < Math.min(i + win, data.length); j++) {
      const a = Math.abs(data[j]);
      if (a > peak) peak = a;
    }
    env.push(peak);
  }
  const segs = [];
  let inSeg = false;
  let start = 0;
  let peak = 0;
  for (let k = 0; k < env.length; k++) {
    const v = env[k];
    const t = (k * win) / sr;
    if (!inSeg && v >= onLevel) {
      inSeg = true;
      start = t;
      peak = v;
    } else if (inSeg) {
      if (v > peak) peak = v;
      if (v < offLevel) {
        inSeg = false;
        segs.push({ start: +start.toFixed(3), len: +(t - start).toFixed(3), peak: +peak.toFixed(3) });
      }
    }
  }
  if (inSeg) {
    segs.push({ start: +start.toFixed(3), len: +((env.length * win) / sr - start).toFixed(3), peak: +peak.toFixed(3) });
  }
  return segs;
}

// ---------- 极简 WebSocket / CDP ----------

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const b1 = buf[1];
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let offset = 2;
  if (len === 126) {
    len = buf.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    len = Number(buf.readBigUInt64BE(offset));
    offset += 8;
  }
  let mask;
  if (masked) {
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

function connectWs(url) {
  const u = new URL(url);
  const sock = net.connect({ host: u.hostname, port: Number(u.port) });
  let buffer = Buffer.alloc(0);
  let handshake = false;
  let frags = [];
  const handlers = { message: [], open: [], close: [] };
  const api = {
    send: (o) => sock.write(encodeFrame(0x1, Buffer.from(JSON.stringify(o), 'utf8'))),
    close: () => sock.end(),
    on: (e, fn) => (handlers[e].push(fn), api),
  };
  sock.on('connect', () =>
    sock.write(
      `GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    ),
  );
  sock.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!handshake) {
      const i = buffer.indexOf('\r\n\r\n');
      if (i < 0) return;
      buffer = buffer.subarray(i + 4);
      handshake = true;
      handlers.open.forEach((fn) => fn());
    }
    for (;;) {
      const f = decodeFrame(buffer);
      if (!f) break;
      buffer = buffer.subarray(f.consumed);
      if (f.opcode === 0x9) {
        sock.write(encodeFrame(0xa, f.payload));
        continue;
      }
      if (f.opcode === 0x8) {
        handlers.close.forEach((fn) => fn(new Error('对端关闭')));
        return;
      }
      if (f.opcode === 0) frags.push(f.payload);
      else if (f.opcode === 1 || f.opcode === 2) frags = [f.payload];
      if (f.fin && f.opcode !== 2) handlers.message.forEach((fn) => fn(Buffer.concat(frags).toString('utf8')));
    }
  });
  sock.on('error', (e) => handlers.close.forEach((fn) => fn(e)));
  return api;
}

function httpJson(port, pathname) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: pathname }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

async function waitForCdp(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await httpJson(port, '/json/list');
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* 重试 */
    }
    await delay(250);
  }
  throw new Error('等待 CDP 超时');
}

let msgId = 0;
const pending = new Map();
function makeCdp(ws) {
  ws.on('message', (text) => {
    const m = JSON.parse(text);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message));
      else resolve(m.result);
    }
  });
  return {
    send(method, params = {}) {
      const id = ++msgId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send({ id, method, params });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`超时 ${method}`));
          }
        }, 30000);
      });
    },
    async eval(expression, awaitPromise = false) {
      const r = await this.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise,
        userGesture: true,
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result?.value;
    },
  };
}

// ---------- 断言 ----------

let pass = 0;
let fail = 0;
const check = (ok, label, extra = '') => {
  if (ok) {
    pass++;
    console.log(`  ✔ ${label}`);
  } else {
    fail++;
    process.exitCode = 1;
    console.log(`  ✖ ${label}${extra ? `　${extra}` : ''}`);
  }
};

/** 在页面里用离线上下文播放一段文本，返回包络分析结果。 */
function playScript(text, wpm) {
  return `(async () => {
    const mod = await import('${AUDIO_MODULE}');
    const analyze = ${analyzeSegments.toString()};
    let offline = null;
    window.AudioContext = function () {
      const real = new OfflineAudioContext(1, 48000 * 8, 48000);
      offline = real;
      // OfflineAudioContext 没有 resume()，补一个空实现
      return new Proxy(real, {
        get(t, p) {
          if (p === 'resume' || p === 'suspend') return () => Promise.resolve();
          const v = t[p];
          return typeof v === 'function' ? v.bind(t) : v;
        },
        set(t, p, v) { t[p] = v; return true; }
      });
    };
    const audio = new mod.MorseAudio({ toneHz: 700, volume: 0.35 });
    await audio.resume();
    const reportedMs = await audio.playText(${JSON.stringify(text)}, ${wpm});
    const buf = await offline.startRendering();
    const segs = analyze(buf.getChannelData(0), buf.sampleRate, 0.05, 0.02);
    return JSON.stringify({ reportedMs, segments: segs });
  })()`;
}

async function main() {
  let staticServer = null;
  if (!URL_TARGET) {
    const served = await startStaticServer(path.join(ROOT, 'dist'));
    staticServer = served.server;
    URL_TARGET = served.url;
    console.log(`[audio] 已启动本地静态服务器：${URL_TARGET}`);
  }
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--autoplay-policy=no-user-gesture-required',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${path.join(ROOT, '.shots', 'audio-profile')}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  try {
    const target = await waitForCdp(DEBUG_PORT);
    const ws = connectWs(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.on('open', res);
      ws.on('close', rej);
    });
    const cdp = makeCdp(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Page.navigate', { url: URL_TARGET });
    await delay(2200);

    // 1) 真实上下文里的时长：E 应约 200ms（0.08s 预备 + 100ms 的点），
    //    PARIS 应约 4.4s。这里同时盯着单位换算 —— 曾经把毫秒长度当成秒传给
    //    包络函数，结果 100ms 的点被排成 100 秒，听起来就是一整段长音。
    const timeline = await cdp.eval(
      `(async () => {
        const mod = await import('${AUDIO_MODULE}');
        const audio = new mod.MorseAudio({ toneHz: 700, volume: 0.35 });
        await audio.resume();
        const msE = await audio.playText('E', 12);
        const msParis = await audio.playText('PARIS', 12);
        return JSON.stringify({ msE, msParis });
      })()`,
      true,
    );
    const tl = JSON.parse(timeline);
    console.log(`[audio] playText 报告时长：E=${tl.msE.toFixed(0)}ms，PARIS=${tl.msParis.toFixed(0)}ms`);
    check(tl.msE > 150 && tl.msE < 300, `E 应约 200ms（0.08s 预备 + 100ms 点），实际 ${tl.msE.toFixed(0)}ms`, timeline);
    check(
      tl.msParis > 3500 && tl.msParis < 5500,
      `PARIS 应约 4.4s（5 个字符共 14 个码元），实际 ${tl.msParis.toFixed(0)}ms`,
      timeline,
    );

    // 2) 单字符 E：离线渲染看波形，应只有一段约 100ms 的声音
    const one = JSON.parse(await cdp.eval(playScript('E', 12), true));
    console.log(
      `[audio] E @12WPM → 报告 ${one.reportedMs.toFixed(0)}ms；波形 ${one.segments.length} 段：` +
        one.segments.map((s) => `${(s.len * 1000).toFixed(0)}ms`).join(' / '),
    );
    check(one.segments.length === 1, `单个 E 应只响一次，实际 ${one.segments.length} 次`);
    if (one.segments.length === 1) {
      const len = one.segments[0].len * 1000;
      check(len > 60 && len < 160, `一个点应约 100ms，实际 ${len.toFixed(0)}ms`);
      check(one.segments[0].peak > 0.2, `音量应可闻（峰值 ${one.segments[0].peak}）`);
    }

    // 2) PARIS：P(.--) A(.-) R(.-.) I(..) S(...) 共 4+2+3+2+3 = 14 个码元，应出现 14 段声音
    const paris = JSON.parse(await cdp.eval(playScript('PARIS', 12), true));
    console.log(`[audio] PARIS @12WPM → 报告 ${paris.reportedMs.toFixed(0)}ms；波形段数 ${paris.segments.length}`);
    console.log(
      `        ${paris.segments.map((s) => `${(s.start * 1000).toFixed(0)}~${((s.start + s.len) * 1000).toFixed(0)}ms`).join('  ')}`,
    );
    check(paris.segments.length === 14, `PARIS 应响 14 次（14 个码元），实际 ${paris.segments.length}`);
    if (paris.segments.length > 1) {
      const gaps = paris.segments
        .slice(1)
        .map((s, i) => +(s.start - (paris.segments[i].start + paris.segments[i].len)).toFixed(3));
      const maxGap = Math.max(...gaps);
      console.log(`        段间隔: ${gaps.map((g) => (g * 1000).toFixed(0) + 'ms').join(' ')}`);
      check(maxGap > 0.05, `段与段之间应有静音（最大间隔 ${(maxGap * 1000).toFixed(0)}ms）`);
      const dit = paris.segments[0].len * 1000;
      const dah = Math.max(...paris.segments.map((s) => s.len)) * 1000;
      check(dah > dit * 2, `划应明显长于点（点 ${dit.toFixed(0)}ms，划 ${dah.toFixed(0)}ms）`);
    }

    ws.close();
  } finally {
    chrome.kill();
    staticServer?.close();
  }
  console.log(`\n[audio] 断言 ${pass} 通过 / ${fail} 失败`);
}

main().catch((e) => {
  console.error('[audio] 失败:', e);
  process.exitCode = 1;
});
