/**
 * 入口：装配 App、路由与各视图。
 *
 * 注意：样式是在 index.html 里用 <link> 引入的，**不要**在这里 import './styles.css'。
 * 这样无论走 Vite 打包还是走 scripts/build.mjs 的零依赖构建，样式都能正常加载，
 * 而且源码也能被裸 Node 直接加载（便于无浏览器的冒烟测试）。
 */

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
              h('h2', {}, `使用说明 · 当前课程：${lessonById(a.lesson.id)?.title ?? a.lesson.title}`),
              h('p', { class: 'dim' }, '「练习」是主界面，其余为课程、统计、设置。'),
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
