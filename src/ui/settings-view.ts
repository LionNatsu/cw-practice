/** 设置页：呼号、速度、声音、输入方式，外加一个校准台（看自己的点划时长）。 */

import type { App } from '../App.ts';
import { readSpeed } from '../core/practice.ts';
import { KeyInput } from './input.ts';
import { clear, h, toast } from './dom.ts';

export class SettingsView {
  private app: App;
  private input: KeyInput | null = null;
  private statsEl!: HTMLElement;
  private durations: number[] = [];

  constructor(app: App) {
    this.app = app;
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
            '呼号（用于 CQ、DE 等报文）',
            h('input', {
              type: 'text',
              value: s.callsign,
              maxlength: '10',
              oninput: (e: Event) => this.app.saveSettings({ callsign: (e.target as HTMLInputElement).value.toUpperCase() }),
            }),
          ),
          num('起始速度 WPM', s.wpm, 4, 40, 1, (v) => this.app.saveSettings({ wpm: v }), '12 约合每点 100ms'),
        ),
        h(
          'p',
          { class: 'dim', style: { fontSize: '12px' } },
          '起始速度只用于第一下的判据，之后按你实际拍出的长短自行估计。',
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
          h(
            'button',
            {
              class: 'btn',
              onclick: async () => {
                await this.app.audio.resume();
                await this.app.audio.playText('PARIS', this.app.settings.wpm);
              },
            },
            '试听',
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
          check('鼠标左键（HID 直键练习器）', s.allowMouseLeft, (v) => this.app.saveSettings({ allowMouseLeft: v })),
          check('鼠标右键', s.allowRightButton, (v) => this.app.saveSettings({ allowRightButton: v })),
          check('键盘的空格 / J / K / 回车', s.allowKeyboard, (v) => this.app.saveSettings({ allowKeyboard: v })),
        ),
      ),
    );

    // 校准台：连拍若干下，看点长估计收敛到多少
    this.statsEl = h('div', { class: 'timing-row' });
    const pad = h(
      'div',
      { class: 'keypad armed', id: 'calib-pad' },
      h('div', { class: 'hint' }, h('div', {}, '在这里随便拍几下，看点划时长是多少。')),
    );
    root.appendChild(
      h(
        'div',
        { class: 'card' },
        h('h2', {}, '校准台'),
        pad,
        h('div', { style: { marginTop: '10px' } }, this.statsEl),
      ),
    );

    this.setupPad(pad);
  }

  dispose(): void {
    this.input?.dispose();
    this.app.audio.silence();
  }

  private setupPad(pad: HTMLElement): void {
    const render = () => {
      const speed = readSpeed(this.durations);
      clear(this.statsEl);
      if (!speed) {
        this.statsEl.appendChild(meter('点长', '--', `再拍 ${3 - this.durations.length} 下`));
        return;
      }
      this.statsEl.appendChild(meter('点长', `${speed.dit.toFixed(0)}ms`, `${speed.nDit} 下`));
      this.statsEl.appendChild(meter('划长', `${speed.dah.toFixed(0)}ms`, `${speed.nDah} 下`));
      this.statsEl.appendChild(meter('折合速度', `${(1200 / speed.dit).toFixed(1)} WPM`, ''));
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
          toast(`已忽略 ${Math.round(edge.duration)}ms 的一次按键：${edge.ignoreReason}`, 'warn');
          return;
        }
        this.durations.push(edge.duration);
        if (this.durations.length > 40) this.durations.shift();
        render();
      },
    });
  }
}

function meter(k: string, v: string, sub: string): HTMLElement {
  return h('div', { class: 'meter' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v, h('small', {}, sub)));
}
