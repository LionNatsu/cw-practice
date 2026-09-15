/**
 * 一个最小的 HTML 渲染助手。
 * 不引入框架，纯前端、零依赖，方便直接丢到 GitHub Pages。
 */

export type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v as object);
      else if (k === 'dataset' && typeof v === 'object') {
        for (const [dk, dv] of Object.entries(v as Record<string, unknown>)) {
          if (dv !== null && dv !== undefined) el.dataset[dk] = String(dv);
        }
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'html') {
        el.innerHTML = String(v);
      } else if (v === true) {
        el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function qs<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`找不到元素: ${sel}`);
  return el;
}

/** 把码形渲染成点划块。 */
export function morseBlocks(pattern: string): HTMLElement {
  const wrap = h('span', { class: 'pattern' });
  for (const c of pattern) {
    wrap.appendChild(h('i', { class: c === '.' ? 'dot' : 'dash' }, c === '.' ? '' : ''));
  }
  return wrap;
}

export function fmtPct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtMs(v: number): string {
  return Number.isFinite(v) ? `${Math.round(v)}ms` : '--';
}

/** 简易 toast。 */
export function toast(message: string, kind: 'info' | 'good' | 'warn' = 'info', ms = 2600): void {
  const root = document.getElementById('toasts');
  if (!root) return;
  const el = h('div', { class: `toast ${kind}` }, message);
  root.appendChild(el);
  window.setTimeout(() => {
    el.classList.add('out');
    window.setTimeout(() => el.remove(), 300);
  }, ms);
}
