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
            '你的呼号（会出现在 CQ / DE 报文里）',
            h('input', {
              type: 'text',
              value: s.callsign,
              maxlength: '10',
              oninput: (e: Event) => this.app.saveSettings({ callsign: (e.target as HTMLInputElement).value.toUpperCase() }),
            }),
          ),
          num('起始速度 WPM', s.wpm, 4, 40, 1, (v) => this.app.saveSettings({ wpm: v }), '12 大约 = 每个点 100ms'),
          check('锁定速度（不让模型跟着你漂移）', s.speedLocked, (v) => this.app.saveSettings({ speedLocked: v }), '想严格练固定节奏时打开'),
        ),
        h(
          'p',
          { class: 'dim', style: { fontSize: '12px' } },
          '速度只作为起始先验：默认会自适应你的真实点长，所以手快手慢都不用改这里。',
          '锁定后模型不再漂移，只统计节奏稳定度——适合"我要练到 15 WPM"这种目标。',
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
          check('开启侧音', s.sidetone, (v) => this.app.saveSettings({ sidetone: v })),
          h(
            'button',
            {
              class: 'btn',
              onclick: async () => {
                await this.app.audio.resume();
                await this.app.audio.playText('PARIS', this.app.settings.wpm);
              },
            },
            '试听（PARIS）',
          ),
        ),
      ),
    );

    root.appendChild(
      h(
        'div',
        { class: 'card' },
        h('h2', {}, '输入方式'),
        h(
          'div',
          { class: 'row' },
          check('鼠标左键 = 直键（HID 直键练习器）', s.allowMouseLeft, (v) => this.app.saveSettings({ allowMouseLeft: v })),
          check('鼠标右键也能当直键', s.allowRightButton, (v) => this.app.saveSettings({ allowRightButton: v })),
          check('键盘（空格 / J / K / 回车）也能当直键', s.allowKeyboard, (v) => this.app.saveSettings({ allowKeyboard: v })),
        ),
        h(
          'div',
          { class: 'row', style: { marginTop: '10px' } },
          slider('停顿判定', s.pauseUnits, 2.5, 6, 0.1, (v) => this.app.saveSettings({ pauseUnits: v }), (v) => `${v.toFixed(1)} 个单位`),
          slider('新手宽容度', s.tolerance, 0, 1, 0.05, (v) => this.app.saveSettings({ tolerance: v }), (v) => `${(v * 100).toFixed(0)}%`),
          check('随机顺序练习本课条目', s.shuffle, (v) => this.app.saveSettings({ shuffle: v })),
        ),
        h(
          'p',
          { class: 'dim', style: { fontSize: '12px' } },
          '停顿判定：两次按键之间超过这么多个"单位"时间，就认为是一个新字符（标准是 3 个单位）。',
          '手慢的新手可以把这里调小一点（比如 3.0），发得干脆的人可以调大。',
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
        h('div', {}, '校准台：在这里连拍几十个点 / 划，看看识别是否稳定。'),
        h('div', {}, '这是只读的统计，不会记进课程成绩。'),
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
      this.statsEl.appendChild(meter('点长 dit', `${st.dit.toFixed(0)}ms`, `n=${st.nDit}`));
      this.statsEl.appendChild(meter('划长 dah', `${st.dah.toFixed(0)}ms`, `n=${st.nDah}`));
      this.statsEl.appendChild(meter('隐含速度', `${st.wpm.toFixed(1)} WPM`, ''));
      this.statsEl.appendChild(meter('节奏稳定度', `${st.rhythmScore}/100`, `σ=${(st.cvDit * 100).toFixed(0)}%`));
      this.statsEl.appendChild(meter('码元误判概率', `${(st.perSymbolError * 100).toFixed(1)}%`, '越低越稳'));
    };
    render();

    this.input = new KeyInput(pad, {
      allowMouseLeft: true,
      allowRightButton: true,
      allowKeyboard: true,
      onDown: () => this.app.audio.keyDown(),
      onUp: (edge) => {
        this.app.audio.keyUp();
        if (edge.ignored) {
          toast(`忽略了一次 ${Math.round(edge.duration)}ms 的按下：${edge.ignoreReason}`, 'warn');
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
        h('span', {}, '时长'),
        h('span', {}, '判定'),
        h('span', {}, '间隔'),
        h('span', {}, '置信'),
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
            h('span', {}, l.gap === null ? '—' : `${(l.gap / unit).toFixed(1)}u`),
            h('span', {}, `${(l.conf * 100).toFixed(0)}%`),
          ),
        );
      });
  }
}

function meter(k: string, v: string, sub: string): HTMLElement {
  return h('div', { class: 'meter' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v, h('small', {}, sub)));
}
