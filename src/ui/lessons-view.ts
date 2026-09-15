/** 课程浏览视图：按难度列出全部课程，并展开当前课程的条目。 */

import type { App } from '../App.ts';
import { LESSONS, type Lesson } from '../core/lessons.ts';
import { ALL_CHAR_TO_PATTERN } from '../core/morse.ts';
import { h } from './dom.ts';

export class LessonsView {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  render(root: HTMLElement): void {
    root.appendChild(
      h(
        'div',
        { class: 'card' },
        h('h2', {}, '课程'),
        h(
          'p',
          { class: 'dim', style: { fontSize: '13px', lineHeight: '1.7', marginTop: 0 } },
          '全部内容都是有意义的词组、缩略语和真实风格的报文，不是随机字母。每一条都带中文含义，方便整体辨识。',
          '点击任意课程即可切换，下面会展开它的条目。',
        ),
      ),
    );

    const byLevel = new Map<number, Lesson[]>();
    for (const l of LESSONS) {
      const arr = byLevel.get(l.level) ?? [];
      arr.push(l);
      byLevel.set(l.level, arr);
    }

    const levelNames: Record<number, string> = {
      1: '入门 · 单字符节奏',
      2: '常用缩略语',
      3: '数字、呼号与标点',
      4: '完整 QSO 报文',
      5: 'DX / 竞赛节奏',
    };

    for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
      const grid = h('div', { class: 'lesson-list' });
      for (const lesson of byLevel.get(level)!) {
        grid.appendChild(
          h(
            'div',
            {
              class: `lesson${lesson.id === this.app.lesson.id ? ' active' : ''}`,
              onclick: () => {
                this.app.setLesson(lesson.id, 0);
                this.app.go('practice');
              },
            },
            h('div', { class: 'lvl' }, `LV ${lesson.level} · ${levelNames[lesson.level] ?? ''}`),
            h('h3', {}, lesson.title),
            h('p', {}, lesson.summary),
            h(
              'div',
              { class: 'focus' },
              ...lesson.focus.map((f) => h('span', {}, f)),
            ),
          ),
        );
      }
      root.appendChild(h('div', { class: 'card' }, h('h2', {}, levelNames[level] ?? `Level ${level}`), grid));
    }

    // 当前课程的条目清单
    const items = this.app.items;
    const list = h('div', { class: 'item-list' });
    items.forEach((it, i) => {
      list.appendChild(
        h(
          'div',
          {
            class: `item${i === this.app.itemIndex ? ' active' : ''}`,
            onclick: () => {
              this.app.itemIndex = i;
              this.app.saveSettings({ lastItemIndex: i });
              this.app.go('practice');
            },
          },
          h('span', { class: 'idx' }, String(i + 1)),
          h('span', { class: 'txt' }, it.text),
          h('span', { class: 'g' }, it.gloss ?? ''),
        ),
      );
    });

    root.appendChild(
      h(
        'div',
        { class: 'card' },
        h('h2', {}, `${this.app.lesson.title} · 条目`),
        list,
        h(
          'div',
          { class: 'row', style: { marginTop: '12px' } },
          h('button', { class: 'btn primary', onclick: () => this.app.go('practice') }, '开始练习这一条'),
          h('button', { class: 'btn', onclick: () => this.playAll() }, '连播本课全部条目（听）'),
        ),
      ),
    );

    // 码表速查
    const table = h('div', { class: 'heat' });
    for (const [ch, pat] of Object.entries(ALL_CHAR_TO_PATTERN)) {
      const stats = this.app.progress.chars[ch];
      const rate = stats && stats.seen > 0 ? stats.wrong / stats.seen : -1;
      const bg =
        rate < 0
          ? '#131c28'
          : rate === 0
            ? 'rgba(85,214,139,0.25)'
            : rate < 0.34
              ? 'rgba(255,209,102,0.25)'
              : 'rgba(255,107,107,0.3)';
      table.appendChild(
        h(
          'div',
          { class: 'cell', style: { background: bg }, title: `${ch} = ${pat}${stats ? `　练 ${stats.seen} 次，错 ${stats.wrong} 次` : ''}` },
          h('span', {}, ch),
          h('small', {}, pat),
        ),
      );
    }
    root.appendChild(h('div', { class: 'card' }, h('h2', {}, '码表速查（颜色 = 你的错误率）'), table));

    root.appendChild(
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn', onclick: () => { this.app.audio.stopPlayback(); } }, '停止播放'),
          h('span', { class: 'dim', style: { fontSize: '12px' } }, '连播时长按当前设置的速度（可在设置里改）。'),
        ),
      ),
    );
  }

  private playing = false;

  private async playAll(): Promise<void> {
    if (this.playing) {
      this.playing = false;
      this.app.audio.stopPlayback();
      return;
    }
    this.playing = true;
    const items = this.app.items;
    for (const it of items) {
      if (!this.playing) break;
      await this.app.audio.playText(it.text, this.app.settings.wpm);
      await delay(450);
    }
    this.playing = false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}
