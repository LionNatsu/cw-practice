/**
 * 说明页：只留必要的东西。
 *
 * 之前这页写成了说明书，把用户当新手从头解释一遍——那是多余的。
 * 现在只回答三个问题：怎么拍、想干别的怎么办、识别为什么有时会改口。
 */

import { h, patternMini } from './dom.ts';
import { COMMAND_INFO, type CommandId } from '../core/practice.ts';

export function renderHelp(root: HTMLElement): void {
  const key = (k: string) => h('kbd', {}, k);
  /** 一行过程信号：名字 + 码形 + 干什么用。 */
  const command = (id: CommandId) => {
    const info = COMMAND_INFO[id];
    return h(
      'div',
      { class: 'cmd' },
      h('b', {}, info.name),
      patternMini(info.pattern),
      h('span', { class: 'what' }, info.label),
    );
  };

  root.appendChild(
    h(
      'div',
      { class: 'page help' },
      h(
        'div',
        { class: 'card' },
        h('h2', {}, '拍发'),
        h(
          'p',
          {},
          '直键练习器在系统里就是一个鼠标左键，所以练习页中间那一大块就是手键：',
          '按住是按下，松开是抬起。进到练习页就能拍，没有“开始”这一步。',
        ),
        h('p', {}, '短促一按是点，按住约三倍时长是划。'),
        h(
          'div',
          { class: 'row', style: { gap: '24px', fontSize: '13px', color: 'var(--fg-dim)' } },
          h('span', {}, key('Esc'), ' 暂停 / 继续'),
        ),
      ),
      h(
        'div',
        { class: 'card' },
        h('h2', {}, '用手键操作'),
        h('p', {}, '底部这些动作都能直接拍出来，练习中途不用去摸鼠标：'),
        h('div', { class: 'cmd-list' }, command('prev'), command('next'), command('retry'), command('replay'), command('score')),
        h(
          'p',
          { class: 'dim', style: { fontSize: '12px' } },
          '目标字优先：课上正好在练 ? 时，拍出来就是目标字，不会当成命令。',
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
