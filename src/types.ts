export type Sign = 1 | -1;

/**
 * 审计输入。点对时延/符号只取上三角 (i < j)：
 * delay[i][j] 表示从 i 指向 j 的有向整数时延（可为负整数，
 * 负值等价于反方向传递），j -> i 方向规范化为 -delay[i][j]。
 */
export interface ProblemInput {
  points: string[];
  channels: string[];
  pointDelays: number[][];
  channelDelays: number[][];
  pointSigns: Sign[][];
  channelSigns: Sign[][];
  tolerance: number;
}

/** 一份见证：安装点 i -> 通道 assignment[i]，该通道极性 polarities[i]（整体翻转已规范化：polarities[0] = +1） */
export interface Solution {
  assignment: number[];
  polarities: Sign[];
}

export interface SolveStats {
  nodes: number;
  elapsedMs: number;
}

export type SolveResult =
  | { kind: 'infeasible' }
  | { kind: 'unique'; cost: number; solution: Solution; stats: SolveStats }
  | { kind: 'multiple'; cost: number; solutions: [Solution, Solution]; stats: SolveStats };

export type Verdict = { kind: 'invalid'; errors: string[] } | SolveResult;

export const MIN_N = 4;
export const MAX_N = 14;
