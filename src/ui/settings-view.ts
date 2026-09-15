/** 设置视图：呼号、速度、音调、输入方式，以及一个校准台（实时看你的点划时长）。 */

import type { App } from '../App.ts';
import { TimingModel } from '../core/timing-model.ts';
import { KeyInput } from './input.ts';
import { clear, h, toast } from './dom.ts';

export class SettingsView {
  private app: App;
  private input: KeyInput | null = null;
  private model: TimingModel;
  private statsEl!: HTMLElement;
  private logEl!: HTMLElement;

  constructor(app: App) {
    this.app = app;
    this.model = new TimingModel(app.settings.wpm, { speedLocked: true });
  }

  render(root: HTMLElement): void {
    const s = this.app.settings;

    const num = (label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, hint = '') =>
      h(
        'label',
        { class: 'field' },
        `${label}${hint ? `（${hint}）` : ''}`,
        h('input', {
          type: 'number',
          value: String(value),
          min: String(min),
          max: String(max),
          step: String(step),
          oninput: (e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            if (Number.isFinite(v)) onChange(v);
          },
        }),
      );

    const slider = (
      label: string,
      value: number,
      min: number,
      max: number,
      step: number,
      onChange: (v: number) => void,
      fmt: (v: number) => string = (v) => String(v),
    ) =>
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'slider-label' }, `${label}：${fmt(value)}`),
        h('input', {
          type: 'range',
          value: String(value),
          min: String(min),
          max: String(max),
          step: String(step),
          oninput: (e: Event) => {
            const input = e.target as HTMLInputElement;
            const v = Number(input.value);
            const labelEl = input.previousElementSibling;
            if (labelEl) labelEl.textContent = `${label}：${fmt(v)}`;
            onChange(v);
          },
        }),
      );

    const check = (label: string, value: boolean, onChange: (v: boolean) => void, hint = '') =>
      h(
        'label',
        { class: 'inline' },
        h('input', {
          type: 'checkbox',
          checked: value,
          onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked),
        }),
        `${label}${hint ? `（${hint}）` : ''}`,
      );

    root.appendChild(
      h(
        'div',
        { class: 'card' },
        h('h2', {}, '呼号与速度'),
        h(
          'div',
          { class: 'row' },
          h(
            'label',
            { class: 'field' },
            '你的呼号（会用在 CQ、DE 这些呼号里）',
            h('input', {
              type: 'text',
              value: s.callsign,
              maxlength: '10',
              oninput: (e: Event) => this.app.saveSettings({ callsign: (e.target as HTMLInputElement).value.toUpperCase() }),
            }),
          ),
          num('起始速度 WPM', s.wpm, 4, 40, 1, (v) => this.app.saveSettings({ wpm: v }), '12 大约是每个点 100ms'),
          check('锁定速度', s.speedLocked, (v) => this.app.saveSettings({ speedLocked: v }), '想严格按固定节奏练时打开'),
        ),
        h(
          'p',
          { class: 'dim', style: { fontSize: '12px' } },
          '这个速度只是个起点：程序会自己摸清你的点有多长，所以手快手慢都不用改它。',
          '勾上“锁定速度”之后就不再跟着你变，只记录你的节奏稳不稳 —— 想练“稳定到 15 WPM”时用。',
        ),
      ),
    );

    root.appendChild(
      h(
        'div',
        { class: 'card' },
        h('h2', {}, '声音'),
        h(
          'div',
          { class: 'row' },
          num('侧音频率 Hz', s.toneHz, 300, 1200, 10, (v) => this.app.saveSettings({ toneHz: v })),
          num('音量 %', Math.round(s.volume * 100), 0, 100, 5, (v) => this.app.saveSettings({ volume: v / 100 })),
          check('按下时出声（侧音）', s.sidetone, (v) => this.app.saveSettings({ sidetone: v })),
          h(
            'button',
            {
              class: 'btn',
              onclick: async () => {
                await this.app.audio.resume();
                await this.app.audio.playText('PARIS', this.app.settings.wpm);
              },
            },
            '听一下（PARIS）',
          ),
        ),
      ),
    );

    root.appendChild(
      h(
        'div',
        { class: 'card' },
        h('h2', {}, '用什么当手键'),
        h(
          'div',
          { class: 'row' },
          check('鼠标左键（HID 直键练习器）', s.allowMouseLeft, (v) => this.app.saveSettings({ allowMouseLeft: v })),
          check('鼠标右键', s.allowRightButton, (v) => this.app.saveSettings({ allowRightButton: v })),
          check('键盘的空格 / J / K / 回车', s.allowKeyboard, (v) => this.app.saveSettings({ allowKeyboard: v })),
        ),
        h(
          'div',
          { class: 'row', style: { marginTop: '10px' } },
          slider('多久算一个字发完', s.pauseUnits, 2.5, 6, 0.1, (v) => this.app.saveSettings({ pauseUnits: v }), (v) => `${v.toFixed(1)} 个单位`),
          slider('对新手宽容一点', s.tolerance, 0, 1, 0.05, (v) => this.app.saveSettings({ tolerance: v }), (v) => `${(v * 100).toFixed(0)}%`),
          check('打乱本课的顺序', s.shuffle, (v) => this.app.saveSettings({ shuffle: v })),
        ),
        h(
          'p',
          { class: 'dim', style: { fontSize: '12px' } },
          '“多久算一个字发完”：两次按键之间静了这么长时间，就认为上一个字发完了（标准是 3 个单位）。',
          '发得慢的话可以调到 3.0 左右；发得干脆的可以调大一点。',
        ),
      ),
    );

    // 校准台
    this.statsEl = h('div', { class: 'timing-row' });
    this.logEl = h('div', { class: 'diag' });
    const pad = h(
      'div',
      { class: 'keypad armed', id: 'calib-pad' },
      h(
        'div',
        { class: 'hint' },
        h('div', {}, '在这里连拍几十下，看看程序把你的点划摸得准不准。'),
        h('div', {}, '只统计、不记成绩，放心乱拍。'),
      ),
    );
    root.appendChild(
      h(
        'div',
        { class: 'card' },
        h('h2', {}, '手键校准台'),
        pad,
        h('div', { style: { marginTop: '10px' } }, this.statsEl),
        h('div', { style: { marginTop: '10px' } }, this.logEl),
      ),
    );

    this.setupPad(pad);
  }

  dispose(): void {
    this.input?.dispose();
    this.app.audio.silence();
  }

  private setupPad(pad: HTMLElement): void {
    const log: Array<{ dur: number; kind: string; gap: number | null; conf: number }> = [];
    let lastUp: number | null = null;
    const render = () => {
      const st = this.model.stats;
      clear(this.statsEl);
      this.statsEl.appendChild(meter('点有多长', `${st.dit.toFixed(0)}ms`, `量了 ${st.nDit} 下`));
      this.statsEl.appendChild(meter('划有多长', `${st.dah.toFixed(0)}ms`, `量了 ${st.nDah} 下`));
      this.statsEl.appendChild(meter('换算成速度', `${st.wpm.toFixed(1)} WPM`, ''));
      this.statsEl.appendChild(meter('节奏稳不稳', `${st.rhythmScore}/100`, `忽长忽短 ${(st.cvDit * 100).toFixed(0)}%`));
      this.statsEl.appendChild(meter('可能听错的比例', `${(st.perSymbolError * 100).toFixed(1)}%`, '越低越稳'));
    };
    render();

    this.input = new KeyInput(pad, {
      debounceMs: 18,
      allowMouseLeft: true,
      allowRightButton: true,
      allowKeyboard: true,
      onDown: () => this.app.audio.keyDown(),
      onUp: (edge) => {
        this.app.audio.keyUp();
        if (edge.ignored) {
          toast(`${Math.round(edge.duration)}ms 这一下没算：${edge.ignoreReason}`, 'warn');
          return;
        }
        const gap = lastUp === null ? null : edge.down - lastUp;
        lastUp = edge.up;
        const cls = this.model.classifyByDuration(edge.duration);
        this.model.update({ duration: edge.duration, gapBefore: gap });
        log.push({ dur: edge.duration, kind: cls.kind, gap, conf: cls.confidence });
        if (log.length > 40) log.shift();
        render();
        this.renderLog(log);
      },
    });
    this.renderLog(log);
  }

  private renderLog(log: Array<{ dur: number; kind: string; gap: number | null; conf: number }>): void {
    const unit = this.model.unitMs;
    clear(this.logEl);
    this.logEl.appendChild(
      h(
        'div',
        { class: 'dline head' },
        h('span', {}, '#'),
        h('span', {}, '按下多久'),
        h('span', {}, '当成'),
        h('span', {}, '离上一下'),
        h('span', {}, '把握'),
      ),
    );
    log
      .slice()
      .reverse()
      .forEach((l, i) => {
        this.logEl.appendChild(
          h(
            'div',
            { class: 'dline' },
            h('span', {}, String(log.length - i)),
            h('span', {}, `${Math.round(l.dur)}ms`),
            h('span', { class: l.kind }, l.kind === 'dit' ? '点' : '划'),
            h('span', {}, l.gap === null ? '—' : `${(l.gap / unit).toFixed(1)} 个单位`),
            h('span', {}, `${(l.conf * 100).toFixed(0)}%`),
          ),
        );
      });
  }
}

function meter(k: string, v: string, sub: string): HTMLElement {
  return h('div', { class: 'meter' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v, h('small', {}, sub)));
}
