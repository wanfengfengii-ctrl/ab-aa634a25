import type { ProblemInput, Sign } from './types';
import { MAX_N, MIN_N } from './types';

/** 导入/导出的 JSON 格式：点对以 {i, j, delay, sign} 显式列出（i < j，每个无序点对恰好一次）。 */
export interface PairEntry {
  i: number;
  j: number;
  delay: number;
  sign: Sign;
}

export interface ExportData {
  points: string[];
  channels: string[];
  tolerance: number;
  pointPairs: PairEntry[];
  channelPairs: PairEntry[];
}

export function toExport(input: ProblemInput): ExportData {
  const n = input.points.length;
  const collect = (delays: number[][], signs: Sign[][]): PairEntry[] => {
    const out: PairEntry[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        out.push({ i, j, delay: delays[i][j], sign: signs[i][j] });
      }
    }
    return out;
  };
  return {
    points: input.points,
    channels: input.channels,
    tolerance: input.tolerance,
    pointPairs: collect(input.pointDelays, input.pointSigns),
    channelPairs: collect(input.channelDelays, input.channelSigns),
  };
}

type ParseResult = { ok: true; data: ProblemInput } | { ok: false; error: string };

export function parseImport(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'JSON 顶层须为对象' };
  const obj = raw as Record<string, unknown>;

  const readNames = (key: string): string[] | string => {
    const v = obj[key];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return `${key} 须为字符串数组`;
    return v as string[];
  };
  const points = readNames('points');
  if (typeof points === 'string') return { ok: false, error: points };
  const channels = readNames('channels');
  if (typeof channels === 'string') return { ok: false, error: channels };

  const n = points.length;
  if (n < MIN_N || n > MAX_N) return { ok: false, error: `points 数量须为 ${MIN_N}–${MAX_N}，当前 ${n}` };
  if (channels.length !== n) return { ok: false, error: `channels 数量（${channels.length}）须与 points 数量（${n}）相等` };

  const tolerance = obj.tolerance;
  if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0) {
    return { ok: false, error: 'tolerance 须为非负有限数' };
  }

  const readPairs = (key: string): { delays: number[][]; signs: Sign[][] } | string => {
    const v = obj[key];
    if (!Array.isArray(v)) return `${key} 须为数组`;
    const delays: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const signs: Sign[][] = Array.from({ length: n }, () => new Array<Sign>(n).fill(1 as Sign));
    const seen = new Set<string>();
    for (const item of v) {
      if (typeof item !== 'object' || item === null) return `${key} 含非对象条目`;
      const e = item as Record<string, unknown>;
      const { i, j, delay, sign } = e as { i: unknown; j: unknown; delay: unknown; sign: unknown };
      if (!Number.isInteger(i) || !Number.isInteger(j)) return `${key} 条目 i/j 须为整数`;
      const ii = i as number;
      const jj = j as number;
      if (ii < 0 || jj < 0 || ii >= n || jj >= n || ii === jj) return `${key} 条目下标越界或 i=j`;
      const a = Math.min(ii, jj);
      const b = Math.max(ii, jj);
      const id = `${a}-${b}`;
      if (seen.has(id)) return `${key} 点对 ${id} 重复`;
      seen.add(id);
      if (typeof delay !== 'number' || !Number.isInteger(delay)) return `${key} 点对 ${id} 的 delay 须为整数`;
      if (sign !== 1 && sign !== -1) return `${key} 点对 ${id} 的 sign 须为 +1 或 -1`;
      // 统一规范为 i<j 方向：若导入条目为 j->i，则取负；下三角填镜像
      delays[a][b] = ii < jj ? (delay as number) : -(delay as number);
      delays[b][a] = -delays[a][b];
      signs[a][b] = sign as Sign;
      signs[b][a] = sign as Sign;
    }
    const expected = (n * (n - 1)) / 2;
    if (seen.size !== expected) return `${key} 须恰好包含全部 ${expected} 个无序点对，当前 ${seen.size} 个`;
    return { delays, signs };
  };

  const p = readPairs('pointPairs');
  if (typeof p === 'string') return { ok: false, error: p };
  const c = readPairs('channelPairs');
  if (typeof c === 'string') return { ok: false, error: c };

  return {
    ok: true,
    data: {
      points,
      channels,
      tolerance,
      pointDelays: p.delays,
      pointSigns: p.signs,
      channelDelays: c.delays,
      channelSigns: c.signs,
    },
  };
}
