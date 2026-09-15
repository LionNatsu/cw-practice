/**
 * 说明页：只留必要的东西。
 *
 * 之前这页写成了说明书，把用户当新手从头解释一遍——那是多余的。
 * 现在只回答两个问题：快捷键是什么、识别为什么有时会改口。
 */

import { h } from './dom.ts';

export function renderHelp(root: HTMLElement): void {
  const key = (k: string) => h('kbd', {}, k);

  root.appendChild(
    h(
      'div',
      { class: 'page' },
      h(
        'div',
        { class: 'card' },
        h('h2', {}, '按键'),
        h(
          'div',
          { class: 'row', style: { gap: '24px', fontSize: '13px', color: 'var(--fg-dim)' } },
          h('span', {}, key('空格'), ' / ', key('J'), ' / ', key('K'), ' / ', key('回车'), ' 拍键'),
          h('span', {}, key('Esc'), ' 开始或停止'),
          h('span', {}, key('R'), ' 重听示范'),
          h('span', {}, key('N'), ' 下一条'),
        ),
      ),
      h(
        'div',
        { class: 'card' },
        h('h2', {}, '识别'),
        h(
          'p',
          {},
          '程序不预设多少毫秒算点。它按你实际拍出的长短估计点长，再拿点长去判断每一下是点还是划，',
          '所以手快手慢都不用改设置。',
        ),
        h(
          'p',
          {},
          '判定在停顿发生时做：两个字之间停一下就是一个字。整个字读对了才收下，',
          '读错了不给过，原地重发，不会跳过去。',
        ),
        h('p', {}, '空格不用真的发。'),
      ),
      h(
        'div',
        { class: 'card' },
        h('h2', {}, '精度'),
        h(
          'p',
          {},
          '鼠标类 USB 设备每 8ms（全速）或 1ms（高速）上报一次，单次按键的时长误差约 ±8~16ms。',
          '12 WPM（点长约 100ms）时可以忽略；25 WPM 以上（点长约 48ms）开始明显。',
        ),
      ),
    ),
  );
}
