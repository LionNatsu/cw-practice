/**
 * 把“解码出来的字符序列”与“目标文本”对齐。
 *
 * 用带回溯的编辑距离（Levenshtein），代价：
 *   替换 = 1，插入（多打了）= 0.9，删除（漏打了）= 1.1
 * 这样“多打一个字符”比“漏打一个字符”稍微宽容一点，符合新手实际表现。
 *
 * 注意：对齐是按「解码结果 vs 目标」做的，解码结果本身已经带置信度，
 * 所以低置信度的错字会被 UI 画成“疑似”，而不是直接判死。
 */

import type { CharScore, CommittedChar } from './types.ts';

export interface AlignmentOp {
  type: 'match' | 'substitute' | 'insert' | 'delete';
  /** 目标下标（delete/insert 时为对应的插入位置）。 */
  targetIndex: number;
  /** 解码结果下标。 */
  actualIndex: number;
  target: string | null;
  actual: string | null;
  cost: number;
}

export interface AlignmentResult {
  ops: AlignmentOp[];
  cost: number;
}

const COST_SUB = 1;
const COST_INS = 0.9;
const COST_DEL = 1.1;

export function align(target: string, actual: string): AlignmentResult {
  const n = target.length;
  const m = actual.length;
  const w = m + 1;
  const dp = new Float64Array((n + 1) * (w + 1));
  const at = (i: number, j: number) => i * w + j;

  for (let i = 0; i <= n; i++) dp[at(i, 0)] = i * COST_DEL;
  for (let j = 0; j <= m; j++) dp[at(0, j)] = j * COST_INS;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = target[i - 1] === actual[j - 1];
      const sub = dp[at(i - 1, j - 1)]! + (same ? 0 : COST_SUB);
      const del = dp[at(i - 1, j)]! + COST_DEL;
      const ins = dp[at(i, j - 1)]! + COST_INS;
      dp[at(i, j)] = Math.min(sub, del, ins);
    }
  }

  const ops: AlignmentOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const cur = dp[at(i, j)]!;
    if (i > 0 && j > 0) {
      const same = target[i - 1] === actual[j - 1];
      const sub = dp[at(i - 1, j - 1)]! + (same ? 0 : COST_SUB);
      if (Math.abs(cur - sub) < 1e-9) {
        ops.push({
          type: same ? 'match' : 'substitute',
          targetIndex: i - 1,
          actualIndex: j - 1,
          target: target[i - 1]!,
          actual: actual[j - 1]!,
          cost: same ? 0 : COST_SUB,
        });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && Math.abs(cur - (dp[at(i - 1, j)]! + COST_DEL)) < 1e-9) {
      ops.push({
        type: 'delete',
        targetIndex: i - 1,
        actualIndex: j,
        target: target[i - 1]!,
        actual: null,
        cost: COST_DEL,
      });
      i--;
      continue;
    }
    ops.push({
      type: 'insert',
      targetIndex: i,
      actualIndex: j - 1,
      target: null,
      actual: actual[j - 1]!,
      cost: COST_INS,
    });
    j--;
  }
  ops.reverse();
  return { ops, cost: dp[at(n, m)] ?? 0 };
}

/**
 * 把对齐结果转成逐字符判定。
 *
 * @param committed 已落账的字符（用于把判定挂回 UI 上的字符 id）
 * @param actualChars 实际参与对齐的字符序列（= 已落账 + 还没落账的尾部），
 *                    下标必须与 align() 里用的 actual 字符串一致。
 */
export function toCharScores(
  result: AlignmentResult,
  committed: readonly CommittedChar[],
  actualChars?: readonly string[],
): CharScore[] {
  const seq = actualChars ?? committed.map((c) => c.text);
  return result.ops.map((op) => {
    const id = op.actualIndex >= 0 && op.actualIndex < committed.length ? committed[op.actualIndex]!.id : null;
    const actual = op.actualIndex >= 0 && op.actualIndex < seq.length ? seq[op.actualIndex]! : op.actual;
    switch (op.type) {
      case 'match':
        return { id, target: op.target, actual, verdict: 'correct' as const };
      case 'substitute':
        return { id, target: op.target, actual, verdict: 'wrong' as const };
      case 'insert':
        return { id, target: null, actual, verdict: 'extra' as const };
      case 'delete':
        return { id: null, target: op.target, actual: null, verdict: 'missing' as const };
    }
  });
}

export interface AlignmentSummary {
  scores: CharScore[];
  /** 目标字符正确数。 */
  correct: number;
  wrong: number;
  extra: number;
  missing: number;
  /** 字符准确率。 */
  accuracy: number;
  /** 易错统计（按目标字符）。 */
  confusion: Array<{ target: string; actual: string | null; count: number }>;
}

export function summarize(scores: readonly CharScore[]): AlignmentSummary {
  let correct = 0;
  let wrong = 0;
  let extra = 0;
  let missing = 0;
  const map = new Map<string, { target: string; actual: string | null; count: number }>();
  for (const s of scores) {
    switch (s.verdict) {
      case 'correct':
        correct++;
        break;
      case 'wrong':
        wrong++;
        bump(map, s.target ?? '', s.actual);
        break;
      case 'extra':
        extra++;
        break;
      case 'missing':
        missing++;
        bump(map, s.target ?? '', null);
        break;
    }
  }
  const total = scores.filter((s) => s.verdict !== 'extra').length;
  return {
    scores: [...scores],
    correct,
    wrong,
    extra,
    missing,
    accuracy: total > 0 ? correct / total : 0,
    confusion: [...map.values()].sort((a, b) => b.count - a.count),
  };
}

function bump(
  map: Map<string, { target: string; actual: string | null; count: number }>,
  target: string,
  actual: string | null,
): void {
  const key = `${target}->${actual ?? '(漏)'}`;
  const cur = map.get(key);
  if (cur) cur.count++;
  else map.set(key, { target, actual, count: 1 });
}
