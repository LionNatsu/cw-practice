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
          '没有随机字母。内容为常用简语、信号报告、呼叫格式和完整通联，每条注明中文含义，便于把声音与意思一起记住。',
          '点任意一课即可切换，下方列出该课的每一条。',
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
      1: '基础：点与划',
      2: '常用简语',
      3: '数字、呼号与标点',
      4: '完整通联',
      5: '远距离与比赛',
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
            h('div', { class: 'lvl' }, `第 ${lesson.level} 级`),
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
      root.appendChild(h('div', { class: 'card' }, h('h2', {}, levelNames[level] ?? `第 ${level} 级`), grid));
    }

    // 当前这一课的每一条
    const items = this.app.items;
    const list = h('div', { class: 'item-list' });
    items.forEach((it, i) => {
      list.appendChild(
        h(
          'div',
          {
            class: `item${i === this.app.itemIndex ? ' active' : ''}`,
            id: `lesson-item-${i}`,
            onclick: () => {
              this.app.itemIndex = i;
              this.app.saveSettings({ lastItemIndex: i });
              this.app.go('practice');
            },
          },
          h('span', { class: 'idx' }, String(i + 1)),
          h('span', { class: 'txt' }, it.text),
          h('span', { class: 'g' }, it.gloss ?? (it.words ?? []).join(' ')),
        ),
      );
    });

    root.appendChild(
      h(
        'div',
        { class: 'card' },
        h('h2', {}, `${this.app.lesson.title}（共 ${items.length} 条）`),
        list,
        h(
          'div',
          { class: 'row', style: { marginTop: '12px' } },
          h('button', { class: 'btn primary', onclick: () => this.app.go('practice') }, '练习'),
          h('button', { class: 'btn', onclick: () => this.playAll() }, '连听本课'),
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
          {
            class: 'cell',
            style: { background: bg },
            title: `${ch}：${pat}${stats ? `　${stats.seen} 次，错 ${stats.wrong} 次` : '　未练'}`,
          },
          h('span', {}, ch),
          h('small', {}, pat),
        ),
      );
    }
    root.appendChild(
      h(
        'div',
        { class: 'card' },
        h('h2', {}, '码表'),
        table,
        h('p', { class: 'dim', style: { fontSize: '12px' } }, '底色为你的错误率：灰＝未练，绿＝全对，黄＝偶有错误，红＝错误较多。'),
      ),
    );

    root.appendChild(
      h(
        'div',
        { class: 'card' },
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn', onclick: () => { this.app.audio.stopPlayback(); } }, '停止播放'),
          h('span', { class: 'dim', style: { fontSize: '12px' } }, '按设置中的速度播放标准节奏。'),
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
