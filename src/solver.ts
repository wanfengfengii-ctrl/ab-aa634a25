import type { ProblemInput, Sign, Solution, SolveResult } from './types';
import { MAX_N, MIN_N } from './types';

/** 校验输入，返回问题列表（空数组表示合法）。 */
export function validateInput(input: ProblemInput): string[] {
  const errors: string[] = [];
  const n = input.points.length;

  if (n < MIN_N || n > MAX_N) {
    errors.push(`安装点数量须为 ${MIN_N}–${MAX_N}，当前为 ${n}`);
  }
  if (input.channels.length !== n) {
    errors.push(`通道数量（${input.channels.length}）须与安装点数量（${n}）相等`);
  }

  const checkNames = (names: string[], label: string) => {
    const seen = new Set<string>();
    names.forEach((name, idx) => {
      const trimmed = name.trim();
      if (!trimmed) {
        errors.push(`${label}第 ${idx + 1} 项名称为空`);
      } else if (seen.has(trimmed)) {
        errors.push(`${label}名称重复：「${trimmed}」`);
      }
      seen.add(trimmed);
    });
  };
  checkNames(input.points, '安装点');
  checkNames(input.channels, '通道');

  const checkMatrix = (
    mat: number[][],
    signs: Sign[][],
    names: string[],
    label: string,
  ) => {
    if (!Array.isArray(mat) || mat.length !== n || mat.some((row) => !Array.isArray(row) || row.length !== n)) {
      errors.push(`${label}时延矩阵维度应为 ${n}×${n}`);
      return;
    }
    if (!Array.isArray(signs) || signs.length !== n || signs.some((row) => !Array.isArray(row) || row.length !== n)) {
      errors.push(`${label}符号矩阵维度应为 ${n}×${n}`);
      return;
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const v = mat[i][j];
        if (typeof v !== 'number' || !Number.isInteger(v)) {
          errors.push(`${label}点对 ${names[i] ?? i}–${names[j] ?? j} 的时延须为整数（当前：${String(v)}）`);
        }
        const s = signs[i][j];
        if (s !== 1 && s !== -1) {
          errors.push(`${label}点对 ${names[i] ?? i}–${names[j] ?? j} 的相关符号须为 +1 或 -1`);
        }
      }
    }
  };
  checkMatrix(input.pointDelays, input.pointSigns, input.points, '安装点侧');
  checkMatrix(input.channelDelays, input.channelSigns, input.channels, '通道侧');

  if (typeof input.tolerance !== 'number' || !Number.isFinite(input.tolerance) || input.tolerance < 0) {
    errors.push('时延容差须为非负有限数');
  }

  return errors;
}

/**
 * 精确求解：在安装点 -> 通道的双射与通道极性（整体翻转规范化）上，
 * 以「全部无序点对时延绝对误差之和最小」为唯一目标做字典序分支定界。
 * 完整判定：无可行解 / 唯一最优 / 多解最优（多解时给出字典序最小的两份）。
 */
export function solve(input: ProblemInput): SolveResult {
  const started = Date.now();
  const n = input.points.length;
  const tol = input.tolerance;

  // 规范化有向时延：D[i][j] 为 i -> j 的时延，D[j][i] = -D[i][j]
  const buildDirected = (mat: number[][]): number[][] => {
    const d: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        d[i][j] = mat[i][j];
        d[j][i] = -mat[i][j];
      }
    }
    return d;
  };
  const buildSigns = (mat: Sign[][]): Sign[][] => {
    const s: Sign[][] = Array.from({ length: n }, () => new Array<Sign>(n).fill(1 as Sign));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        s[i][j] = mat[i][j];
        s[j][i] = mat[i][j];
      }
    }
    return s;
  };
  const Dp = buildDirected(input.pointDelays);
  const Dc = buildDirected(input.channelDelays);
  const Sp = buildSigns(input.pointSigns);
  const Sc = buildSigns(input.channelSigns);

  // 下界预计算 1：每个通道行的有向时延排序表（用于“已分配-未分配”对的最近距离下界）
  const sortedRows: number[][] = [];
  for (let a = 0; a < n; a++) {
    const row: number[] = [];
    for (let b = 0; b < n; b++) if (b !== a) row.push(Dc[a][b]);
    row.sort((x, y) => x - y);
    sortedRows.push(row);
  }
  // 下界预计算 2：g[i][j] = 安装点对 (i,j) 与任意有序通道对的最小可能误差
  const g: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let m = Infinity;
      const v = Dp[i][j];
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          if (a === b) continue;
          const d = Math.abs(v - Dc[a][b]);
          if (d < m) m = d;
        }
      }
      g[i][j] = m;
    }
  }

  const nearest = (row: number[], v: number): number => {
    let lo = 0;
    let hi = row.length - 1;
    let m = Infinity;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const d = Math.abs(row[mid] - v);
      if (d < m) m = d;
      if (row[mid] < v) lo = mid + 1;
      else hi = mid - 1;
    }
    return m;
  };

  const assign: number[] = new Array<number>(n).fill(-1);
  const used: boolean[] = new Array<boolean>(n).fill(false);
  const pol: Sign[] = new Array<Sign>(n).fill(1);
  let best = Infinity;
  const optima: Solution[] = [];
  let nodes = 0;

  // 按安装点编号顺序、通道编号顺序做字典序 DFS，最优解按字典序依次产生
  const dfs = (k: number, cost: number): void => {
    nodes++;
    if (cost > best) return;
    if (cost === best && optima.length >= 2) return;
    if (k === n) {
      const sol: Solution = { assignment: assign.slice(), polarities: pol.slice() };
      if (cost < best) {
        best = cost;
        optima.length = 0;
        optima.push(sol);
      } else if (optima.length < 2) {
        optima.push(sol);
      }
      return;
    }

    // 下界：已分配-未分配对的最近距离 + 未分配-未分配对的全局最小误差
    let lb = cost;
    for (let i = 0; i < k; i++) {
      const row = sortedRows[assign[i]];
      for (let j = k; j < n; j++) lb += nearest(row, Dp[i][j]);
    }
    for (let j1 = k; j1 < n; j1++) {
      for (let j2 = j1 + 1; j2 < n; j2++) lb += g[j1][j2];
    }
    if (lb > best) return;
    if (lb === best && optima.length >= 2) return;

    for (let c = 0; c < n; c++) {
      if (used[c]) continue;
      let add = 0;
      let ok = true;
      let eps: Sign | 0 = 0;
      for (let i = 0; i < k; i++) {
        const ci = assign[i];
        const e = Math.abs(Dp[i][k] - Dc[ci][c]);
        if (e > tol) {
          ok = false;
          break;
        }
        add += e;
        // 符号约束：Sp[i][k] = Sc[ci][c] * pol[i] * pol[k]  =>  pol[k] = Sp * Sc * pol[i]
        const need = (Sp[i][k] * Sc[ci][c] * pol[i]) as Sign;
        if (eps === 0) eps = need;
        else if (eps !== need) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (k === 0) eps = 1; // 整体极性翻转规范化：首个安装点对应通道极性固定为 +
      const nc = cost + add;
      if (nc > best) continue;
      if (nc === best && optima.length >= 2) continue;
      assign[k] = c;
      used[c] = true;
      pol[k] = eps === 0 ? 1 : eps;
      dfs(k + 1, nc);
      used[c] = false;
      assign[k] = -1;
    }
  };
  dfs(0, 0);

  const stats = { nodes, elapsedMs: Date.now() - started };
  if (optima.length === 0) return { kind: 'infeasible' };
  if (optima.length === 1) return { kind: 'unique', cost: best, solution: optima[0], stats };
  return { kind: 'multiple', cost: best, solutions: [optima[0], optima[1]], stats };
}
