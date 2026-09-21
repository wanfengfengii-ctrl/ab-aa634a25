import type { AuditInput, CorrSign, IndexedPair, NormalizedModel, Edge } from './types';

const MIN_N = 4;
const MAX_N = 14;
const MAX_ABS_DELAY = 1_000_000_000;

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

function isSign(v: unknown): v is CorrSign {
  return v === 1 || v === -1;
}

/**
 * 完整校验输入，返回归一化模型或逐条形错误。
 * 校验通过后点对端点全部存在、无自环、每个无序点对至多一条、时延为安全整数。
 */
export function validateAndNormalize(input: unknown): { model: NormalizedModel } | { errors: string[] } {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null) {
    return { errors: ['输入必须是 JSON 对象'] };
  }
  const obj = input as Record<string, unknown>;

  const pointNames = normalizeNames(obj.pointNames, '安装点', errors);
  const channelNames = normalizeNames(obj.channelNames, '采集通道', errors);

  if (pointNames && channelNames) {
    if (pointNames.length < MIN_N || pointNames.length > MAX_N) {
      errors.push(`安装点数量必须在 ${MIN_N} 至 ${MAX_N} 之间，当前 ${pointNames.length} 个`);
    }
    if (channelNames.length < MIN_N || channelNames.length > MAX_N) {
      errors.push(`采集通道数量必须在 ${MIN_N} 至 ${MAX_N} 之间，当前 ${channelNames.length} 个`);
    }
    if (pointNames.length !== channelNames.length) {
      errors.push(`安装点数量（${pointNames.length}）必须与采集通道数量（${channelNames.length}）相等`);
    }
  }

  let tolerance = 0;
  if (!isInt(obj.tolerance) || (obj.tolerance as number) < 0) {
    errors.push('时延容差必须是非负整数');
  } else {
    tolerance = obj.tolerance as number;
  }

  const installPairs = normalizePairs(obj.installPairs, pointNames, '安装点侧', errors);
  const channelPairs = normalizePairs(obj.channelPairs, channelNames, '通道侧', errors);

  if (errors.length > 0 || !pointNames || !channelNames || !installPairs || !channelPairs) {
    return { errors };
  }

  const n = pointNames.length;
  const model: NormalizedModel = {
    n,
    pointNames,
    channelNames,
    tolerance,
    installEdges: toEdges(installPairs, '安装点侧', errors),
    channelMatrix: toMatrix(channelPairs, n, '通道侧', errors),
    installAdj: [],
  };
  model.installAdj = Array.from({ length: n }, () => []);
  model.installEdges.forEach((e, i) => {
    model.installAdj[e.u].push(i);
    model.installAdj[e.v].push(i);
  });

  if (errors.length > 0) return { errors };
  return { model };
}

function normalizeNames(value: unknown, label: string, errors: string[]): string[] | null {
  if (!Array.isArray(value)) {
    errors.push(`${label}列表必须是数组`);
    return null;
  }
  const names: string[] = [];
  const seen = new Set<string>();
  value.forEach((raw, i) => {
    if (typeof raw !== 'string') {
      errors.push(`${label}第 ${i + 1} 项必须是字符串编号`);
      return;
    }
    const name = raw.trim();
    if (name === '') {
      errors.push(`${label}编号不得为空（第 ${i + 1} 项）`);
    } else if (seen.has(name)) {
      errors.push(`${label}编号重复：${name}`);
    } else {
      seen.add(name);
      names.push(name);
    }
  });
  return errors.length === 0 ? names : names;
}

function normalizePairs(
  value: unknown,
  names: string[] | null,
  label: string,
  errors: string[],
): IndexedPair[] | null {
  if (!Array.isArray(value)) {
    errors.push(`${label}点对必须是数组`);
    return null;
  }
  const indexOf = new Map<string, number>();
  names?.forEach((n, i) => indexOf.set(n, i));

  const pairs: IndexedPair[] = [];
  value.forEach((raw, i) => {
    const where = `${label}第 ${i + 1} 行`;
    if (typeof raw !== 'object' || raw === null) {
      errors.push(`${where}：必须是对象`);
      return;
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.a !== 'string' || typeof r.b !== 'string') {
      errors.push(`${where}：端点编号必须是字符串`);
      return;
    }
    const ia = indexOf.get(r.a.trim());
    const ib = indexOf.get(r.b.trim());
    if (ia === undefined || ib === undefined) {
      errors.push(`${where}：端点 ${r.a} / ${r.b} 不存在于编号列表`);
      return;
    }
    if (ia === ib) {
      errors.push(`${where}：点对两端不能相同（${r.a}）`);
      return;
    }
    if (!isInt(r.delay)) {
      errors.push(`${where}：时延必须是整数`);
      return;
    }
    if (Math.abs(r.delay as number) > MAX_ABS_DELAY) {
      errors.push(`${where}：时延绝对值不得超过 ${MAX_ABS_DELAY}`);
      return;
    }
    if (!isSign(r.sign)) {
      errors.push(`${where}：相关符号只能是 1 或 -1`);
      return;
    }
    pairs.push({ a: ia, b: ib, delay: r.delay as number, sign: r.sign as CorrSign });
  });
  return pairs;
}

/** 以 u<v 为键，把有向时延规范化为 u->v 方向；相关符号不随端点翻转而变号 */
function toEdges(pairs: IndexedPair[], label: string, errors: string[]): Edge[] {
  const seen = new Set<number>();
  const edges: Edge[] = [];
  for (const p of pairs) {
    const u = Math.min(p.a, p.b);
    const v = Math.max(p.a, p.b);
    const key = u * (MAX_N + 1) + v;
    if (seen.has(key)) {
      errors.push(`${label}存在重复无序点对：${u + 1} 与 ${v + 1}`);
      continue;
    }
    seen.add(key);
    // 存储方向为 a->b；规范化为 u->v，反向时延时取反，相关符号对调端点不变
    const delay = p.a === u ? p.delay : -p.delay;
    edges.push({ u, v, delay, sign: p.sign });
  }
  return edges.sort((e1, e2) => e1.u - e2.u || e1.v - e2.v);
}

function toMatrix(pairs: IndexedPair[], n: number, label: string, errors: string[]): (Edge | null)[][] {
  const mat: (Edge | null)[][] = Array.from({ length: n }, () => Array<Edge | null>(n).fill(null));
  const seen = new Set<number>();
  for (const p of pairs) {
    const u = Math.min(p.a, p.b);
    const v = Math.max(p.a, p.b);
    const key = u * (MAX_N + 1) + v;
    if (seen.has(key)) {
      errors.push(`${label}存在重复无序点对：${u + 1} 与 ${v + 1}`);
      continue;
    }
    seen.add(key);
    const delay = p.a === u ? p.delay : -p.delay;
    mat[u][v] = { u, v, delay, sign: p.sign };
  }
  return mat;
}

export function emptyInput(): AuditInput {
  return {
    pointNames: ['P1', 'P2', 'P3', 'P4'],
    channelNames: ['C1', 'C2', 'C3', 'C4'],
    installPairs: [],
    channelPairs: [],
    tolerance: 0,
  };
}
