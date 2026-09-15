/**
 * 入口：装配 App、路由与各视图。
 */

import './styles.css';
import { App, type Tab, type View } from './App.ts';
import { PracticeView } from './ui/practice-view.ts';
import { LessonsView } from './ui/lessons-view.ts';
import { StatsView } from './ui/stats-view.ts';
import { SettingsView } from './ui/settings-view.ts';
import { renderHelp } from './ui/help-view.ts';
import { h, qs } from './ui/dom.ts';
import { lessonById } from './core/lessons.ts';

const app = new App();
const viewRoot = qs('#view');
app.mount(viewRoot);

app.viewFactory = (tab: Tab, a: App): View => {
  switch (tab) {
    case 'practice':
      return new PracticeView(a);
    case 'lessons':
      return new LessonsView(a);
    case 'stats':
      return new StatsView(a);
    case 'settings':
      return new SettingsView(a);
    case 'help':
      return {
        render(root: HTMLElement): void {
          root.appendChild(
            h(
              'div',
              { class: 'card help' },
              h('h2', {}, `欢迎使用 · 当前课程：${lessonById(a.lesson.id)?.title ?? a.lesson.title}`),
              h(
                'p',
                { class: 'dim' },
                '左边「练习」是主界面；这里是完整的使用说明与算法说明，建议第一次用之前花两分钟读完。',
              ),
            ),
          );
          renderHelp(root);
        },
      };
  }
};

// 顶部 tab 切换
qs('#tabs').addEventListener('click', (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>('.tab');
  if (!btn) return;
  app.go((btn.dataset.tab as Tab) ?? 'practice');
});

document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => {
  b.classList.toggle('active', b.dataset.tab === app.tab);
});

app.go(app.tab);

// 首次使用引导
if (!localStorage.getItem('cw-practice/visited')) {
  localStorage.setItem('cw-practice/visited', '1');
  app.go('help');
}
