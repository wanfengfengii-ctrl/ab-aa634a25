import { describe, expect, it } from 'vitest';
import { solve, validateInput } from './solver';
import { SAMPLES, defaultInput } from './samples';
import { parseImport, toExport } from './jsonio';
import type { ProblemInput } from './types';

const byKey = (key: string) => {
  const s = SAMPLES.find((x) => x.key === key);
  if (!s) throw new Error(`missing sample ${key}`);
  return s.build();
};

describe('validateInput', () => {
  it('接受内置示例', () => {
    for (const s of SAMPLES) {
      expect(validateInput(s.build())).toEqual([]);
    }
  });

  it('拒绝数量越界与不等的通道数', () => {
    const base = defaultInput();
    expect(validateInput({ ...base, points: base.points.slice(0, 3), channels: base.channels.slice(0, 3) }).join()).toContain('4–14');
    expect(validateInput({ ...base, channels: base.channels.slice(0, 4) }).join()).toContain('相等');
  });

  it('拒绝重复与空名称', () => {
    const base = defaultInput();
    const dup = { ...base, points: base.points.map((p, i) => (i === 1 ? base.points[0] : p)) };
    expect(validateInput(dup).join()).toContain('重复');
    const empty = { ...base, channels: base.channels.map((c, i) => (i === 2 ? '  ' : c)) };
    expect(validateInput(empty).join()).toContain('为空');
  });

  it('拒绝非整数时延、非法符号与负容差', () => {
    const base = defaultInput();
    const badDelay: ProblemInput = structuredClone(base);
    badDelay.pointDelays[0][1] = 1.5;
    expect(validateInput(badDelay).join()).toContain('整数');
    const nanDelay: ProblemInput = structuredClone(base);
    nanDelay.channelDelays[2][3] = Number.NaN;
    expect(validateInput(nanDelay).join()).toContain('整数');
    const badTol = { ...base, tolerance: -1 };
    expect(validateInput(badTol).join()).toContain('容差');
  });
});

describe('solve', () => {
  it('唯一最优示例：还原真值映射与极性，总误差 0', () => {
    const r = solve(byKey('unique'));
    expect(r.kind).toBe('unique');
    if (r.kind !== 'unique') return;
    expect(r.cost).toBe(0);
    expect(r.solution.assignment).toEqual([2, 0, 4, 1, 3]);
    expect(r.solution.polarities).toEqual([1, -1, 1, 1, -1]);
  });

  it('多解最优示例：返回字典序最小的两份映射', () => {
    const r = solve(byKey('multiple'));
    expect(r.kind).toBe('multiple');
    if (r.kind !== 'multiple') return;
    expect(r.cost).toBe(0);
    expect(r.solutions[0].assignment).toEqual([0, 1, 2, 3]);
    expect(r.solutions[1].assignment).toEqual([0, 1, 3, 2]);
  });

  it('无可行解示例', () => {
    expect(solve(byKey('infeasible')).kind).toBe('infeasible');
  });

  it('较大规模示例：唯一最优', () => {
    const r = solve(byKey('large'));
    expect(r.kind).toBe('unique');
    if (r.kind !== 'unique') return;
    expect(r.solution.assignment).toEqual([3, 0, 5, 1, 7, 2, 6, 4]);
  });

  it('n=14 规模可解且还原真值', () => {
    const n = 14;
    const d = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    let v = 7;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { d[i][j] = v; v += 11; }
    const s = Array.from({ length: n }, () => new Array<1 | -1>(n).fill(1));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) s[i][j] = ((i + j * 2) % 3 === 0 ? -1 : 1) as 1 | -1;
    const perm = Array.from({ length: n }, (_, i) => (i * 5 + 2) % n);
    // 保证 perm 是双射：gcd(5,14)=1，成立
    const eps = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 1 : -1)) as Array<1 | -1>;
    eps[0] = 1;
    const cd = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const cs = Array.from({ length: n }, () => new Array<1 | -1>(n).fill(1));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        cd[perm[i]][perm[j]] = d[i][j];
        cd[perm[j]][perm[i]] = -d[i][j];
        const sv = (s[i][j] * eps[i] * eps[j]) as 1 | -1;
        cs[perm[i]][perm[j]] = sv;
        cs[perm[j]][perm[i]] = sv;
      }
    }
    const input: ProblemInput = {
      points: Array.from({ length: n }, (_, i) => `P${i + 1}`),
      channels: Array.from({ length: n }, (_, i) => `C${i + 1}`),
      pointDelays: d,
      channelDelays: cd,
      pointSigns: s,
      channelSigns: cs,
      tolerance: 0,
    };
    const r = solve(input);
    expect(r.kind).toBe('unique');
    if (r.kind !== 'unique') return;
    expect(r.solution.assignment).toEqual(perm);
    expect(r.solution.polarities).toEqual(eps);
  }, 20000);

  it('容差内噪声仍还原真值，且总误差为噪声和', () => {
    const base = byKey('unique');
    // 在通道侧加入 ±1 噪声（容差 2 内）
    base.channelDelays[0][1] += 1;
    base.channelDelays[1][0] -= 1;
    base.channelDelays[2][4] -= 1;
    base.channelDelays[4][2] += 1;
    const r = solve(base);
    expect(r.kind).toBe('unique');
    if (r.kind !== 'unique') return;
    expect(r.cost).toBe(2);
    expect(r.solution.assignment).toEqual([2, 0, 4, 1, 3]);
  });

  it('符号不一致导致无可行解', () => {
    const base = byKey('unique');
    // 翻转全部通道侧符号：任意映射下三角形符号积约束都不可能成立
    const n = base.channels.length;
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        base.channelSigns[a][b] = (base.channelSigns[a][b] * -1) as 1 | -1;
        base.channelSigns[b][a] = base.channelSigns[a][b];
      }
    }
    const r = solve(base);
    expect(r.kind).toBe('infeasible');
  });
});

describe('jsonio', () => {
  it('导出-导入往返一致', () => {
    const src = byKey('unique');
    const round = parseImport(JSON.parse(JSON.stringify(toExport(src))));
    expect(round.ok).toBe(true);
    if (!round.ok) return;
    expect(round.data).toEqual(src);
  });

  it('拒绝缺对/重对与越界', () => {
    const src = toExport(byKey('multiple'));
    const missing = { ...src, pointPairs: src.pointPairs.slice(1) };
    const r1 = parseImport(missing);
    expect(r1.ok).toBe(false);
    const dup = { ...src, pointPairs: [...src.pointPairs, src.pointPairs[0]] };
    const r2 = parseImport(dup);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toContain('重复');
    const oob = JSON.parse(JSON.stringify(src)) as typeof src;
    oob.channelPairs[0].j = 99;
    expect(parseImport(oob).ok).toBe(false);
  });
});
