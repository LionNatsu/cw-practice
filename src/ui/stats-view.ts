/** 统计视图：总体进度、逐字符错误率、课程记录、本地数据管理。 */

import type { App } from '../App.ts';
import { LESSONS } from '../core/lessons.ts';
import { EMPTY_PROGRESS } from '../core/settings.ts';
import { ALL_CHAR_TO_PATTERN } from '../core/morse.ts';
import { h, toast } from './dom.ts';

export class StatsView {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  render(root: HTMLElement): void {
    const p = this.app.progress;
    const charEntries = Object.entries(p.chars).filter(([, v]) => v.seen > 0);
    const totalSeen = charEntries.reduce((a, [, v]) => a + v.seen, 0);
    const totalWrong = charEntries.reduce((a, [, v]) => a + v.wrong, 0);
    const attempts = Object.values(p.lessons).reduce((a, v) => a + v.attempts, 0);

    root.appendChild(
      h(
        'div',
        { class: 'card' },
        h('h2', {}, '总览'),
        h(
          'div',
          { class: 'timing-row' },
          meter('累计练习', `${Math.round(p.totalMs / 60000)}`, '分钟'),
          meter('总按键数', String(p.totalPresses), '次'),
          meter('完成条目', String(attempts), '次结算'),
          meter('字符总正确率', totalSeen ? `${(((totalSeen - totalWrong) / totalSeen) * 100).toFixed(1)}%` : '--', `${totalSeen - totalWrong}/${totalSeen}`),
          meter('练过的字符', `${charEntries.length}`, `/ ${Object.keys(ALL_CHAR_TO_PATTERN).length}`),
        ),
      ),
    );

    // 逐字符表
    const rows = charEntries
      .map(([ch, v]) => ({ ch, ...v, rate: v.wrong / v.seen }))
      .sort((a, b) => b.rate - a.rate || b.seen - a.seen);

    const table = h('table', { class: 'grid' });
    table.appendChild(
      h(
        'thead',
        {},
        h('tr', {}, h('th', {}, '字符'), h('th', {}, '码形'), h('th', {}, '练习'), h('th', {}, '错误'), h('th', {}, '错误率'), h('th', {}, '评价')),
      ),
    );
    const tbody = h('tbody', {});
    for (const r of rows) {
      const verdict = r.rate === 0 ? ['稳', 'good'] : r.rate < 0.2 ? ['可以', 'good'] : r.rate < 0.4 ? ['要注意', 'warn'] : ['重点练', 'bad'];
      tbody.appendChild(
        h(
          'tr',
          {},
          h('td', { style: { fontSize: '16px', fontWeight: '700' } }, r.ch),
          h('td', { class: 'dim' }, ALL_CHAR_TO_PATTERN[r.ch] ?? '?'),
          h('td', { class: 'num' }, String(r.seen)),
          h('td', { class: 'num' }, String(r.wrong)),
          h('td', { class: 'num' }, `${(r.rate * 100).toFixed(0)}%`),
          h('td', { class: verdict[1] }, verdict[0]!),
        ),
      );
    }
    if (rows.length === 0) tbody.appendChild(h('tr', {}, h('td', { colspan: 6, class: 'dim' }, '还没有数据，先去练几条吧。')));
    table.appendChild(tbody);
    root.appendChild(h('div', { class: 'card' }, h('h2', {}, '逐字符错误率'), table));

    // 课程记录
    const ltable = h('table', { class: 'grid' });
    ltable.appendChild(
      h('thead', {}, h('tr', {}, h('th', {}, '课程'), h('th', {}, '次数'), h('th', {}, '最好成绩'), h('th', {}, '最近'))),
    );
    const lbody = h('tbody', {});
    for (const lesson of LESSONS) {
      const rec = p.lessons[lesson.id];
      if (!rec) continue;
      lbody.appendChild(
        h(
          'tr',
          {},
          h('td', {}, lesson.title),
          h('td', { class: 'num' }, String(rec.attempts)),
          h('td', { class: `num ${rec.bestAccuracy >= 0.9 ? 'good' : rec.bestAccuracy >= 0.75 ? 'warn' : 'bad'}` }, `${(rec.bestAccuracy * 100).toFixed(1)}%`),
          h('td', { class: 'dim' }, rec.lastAt ? new Date(rec.lastAt).toLocaleString() : '--'),
        ),
      );
    }
    if (!lbody.childElementCount) lbody.appendChild(h('tr', {}, h('td', { colspan: 4, class: 'dim' }, '还没有结算记录。')));
    ltable.appendChild(lbody);
    root.appendChild(h('div', { class: 'card' }, h('h2', {}, '课程记录'), ltable));

    // 数据管理
    root.appendChild(
      h(
        'div',
        { class: 'card' },
        h('h2', {}, '数据'),
        h(
          'p',
          { class: 'dim', style: { fontSize: '12px' } },
          '所有数据只存在这个浏览器里（localStorage），不上传任何服务器。',
        ),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn', onclick: () => this.exportJson() }, '导出 JSON'),
          h(
            'button',
            {
              class: 'btn danger',
              onclick: () => {
                if (!confirm('确定清空所有统计与进度？此操作不可撤销。')) return;
                this.app.saveProgress(structuredClone(EMPTY_PROGRESS));
                toast('已清空进度', 'warn');
                this.app.go('stats');
              },
            },
            '清空进度',
          ),
          h(
            'button',
            {
              class: 'btn danger',
              onclick: () => {
                if (!confirm('恢复默认设置？（统计不受影响）')) return;
                this.app.saveSettings({
                  callsign: 'BG1ABC',
                  wpm: 12,
                  speedLocked: false,
                  toneHz: 700,
                  volume: 0.35,
                  sidetone: true,
                  pauseUnits: 3.5,
                  tolerance: 0.5,
                });
                toast('已恢复默认设置', 'warn');
                this.app.go('settings');
              },
            },
            '恢复默认设置',
          ),
        ),
      ),
    );
  }

  private exportJson(): void {
    const data = JSON.stringify({ settings: this.app.settings, progress: this.app.progress }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `cw-practice-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

function meter(k: string, v: string, sub: string): HTMLElement {
  return h('div', { class: 'meter' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v, h('small', {}, sub)));
}
