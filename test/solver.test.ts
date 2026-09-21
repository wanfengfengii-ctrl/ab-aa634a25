import { describe, it, expect } from 'vitest';
import { audit } from '../src/audit';
import { validateAndNormalize } from '../src/validate';
import { solve } from '../src/solver';
import type { AuditInput, CorrSign, NormalizedModel } from '../src/types';
import { exampleCrossedReversed, exampleInfeasible, exampleSymmetric } from '../src/sample';

/* ---------------- 暴力枚举参考实现 ---------------- */

function bruteForce(model: NormalizedModel) {
  const n = model.n;
  const perms: number[][] = [];
  const perm = (a: number[], k: number) => {
    if (k === a.length) {
      perms.push([...a]);
      return;
    }
    for (let i = k; i < a.length; i++) {
      [a[k], a[i]] = [a[i], a[k]];
      perm(a, k + 1);
      [a[k], a[i]] = [a[i], a[k]];
    }
  };
  perm(Array.from({ length: n }, (_, i) => i), 0);

  const pols: (1 | -1)[][] = [];
  const genPol = (p: (1 | -1)[]) => {
    if (p.length === n) {
      pols.push([...p]);
      return;
    }
    genPol([...p, 1]);
    genPol([...p, -1]);
  };
  genPol([1]); // 规范 p[0]=+1

  const sols: { mapping: number[]; polarity: CorrSign[]; cost: number }[] = [];
  for (const f of perms) {
    for (const p of pols) {
      let cost = 0;
      let feasible = true;
      for (const e of model.installEdges) {
        const c = f[e.u];
        const d = f[e.v];
        const x = Math.min(c, d);
        const y = Math.max(c, d);
        const ce = model.channelMatrix[x][y];
        if (!ce) {
          feasible = false;
          break;
        }
        const measured = c === x ? ce.delay : -ce.delay;
        if (Math.abs(measured - e.delay) > model.tolerance) {
          feasible = false;
          break;
        }
        if (e.sign * p[e.u] * p[e.v] !== ce.sign) {
          feasible = false;
          break;
        }
        cost += Math.abs(measured - e.delay);
      }
      if (feasible) sols.push({ mapping: [...f], polarity: [...p], cost });
    }
  }
  if (sols.length === 0) return { status: 'infeasible' as const, sols: [] };
  const minCost = Math.min(...sols.map((s) => s.cost));
  const optimal = sols
    .filter((s) => s.cost === minCost)
    .sort((a, b) => {
      for (let i = 0; i < n; i++) {
        const ka = model.channelNames[a.mapping[i]];
        const kb = model.channelNames[b.mapping[i]];
        if (ka !== kb) return ka < kb ? -1 : 1;
      }
      for (let i = 0; i < n; i++) {
        if (a.polarity[i] !== b.polarity[i]) return a.polarity[i] === 1 ? -1 : 1;
      }
      return 0;
    });
  return {
    status: optimal.length >= 2 ? ('multiple' as const) : ('unique' as const),
    sols: optimal.slice(0, 2),
    minCost,
    total: optimal.length,
  };
}

/* ---------------- 随机模型生成（含真实接线 + 噪声 + 诱饵边） ---------------- */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomModel(seed: number, n: number, edgeProb: number, tol: number, decoy: boolean, disconnected = false) {
  const rnd = mulberry32(seed);
  const pointNames = Array.from({ length: n }, (_, i) => `P${i + 1}`);
  const channelNames = Array.from({ length: n }, (_, i) => `C${i + 1}`);
  const truth = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [truth[i], truth[j]] = [truth[j], truth[i]];
  }
  const pol: CorrSign[] = Array.from({ length: n }, () => (rnd() < 0.5 ? 1 : -1));
  pol[0] = 1;

  const installPairs: AuditInput['installPairs'] = [];
  const channelPairs: AuditInput['channelPairs'] = [];
  for (let u = 0; u < n; u++) {
    for (let v = u + 1; v < n; v++) {
      if (disconnected && u === 0 && v >= 2) continue; // 让 0 号点只连 1，可能产生自由分量
      if (rnd() > edgeProb) continue;
      const delay = Math.floor(rnd() * 40) - 20;
      const sign: CorrSign = rnd() < 0.5 ? 1 : -1;
      installPairs.push({ a: pointNames[u], b: pointNames[v], delay, sign });
      const noise = Math.floor(rnd() * (2 * tol + 1)) - tol;
      channelPairs.push({
        a: channelNames[truth[u]],
        b: channelNames[truth[v]],
        delay: delay + noise,
        sign: (sign * pol[u] * pol[v]) as CorrSign,
      });
    }
  }
  if (decoy) {
    // 增加与真实接线无关的诱饵通道边（随机值），检验求解器不会被迷惑
    const used = new Set(channelPairs.map((p) => [p.a, p.b].sort().join('|')));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const key = `C${i + 1}|C${j + 1}`;
        if (!used.has(key) && rnd() < 0.3) {
          channelPairs.push({
            a: `C${i + 1}`,
            b: `C${j + 1}`,
            delay: Math.floor(rnd() * 40) - 20,
            sign: rnd() < 0.5 ? 1 : -1,
          });
        }
      }
    }
  }
  return { pointNames, channelNames, installPairs, channelPairs, tolerance: tol } as AuditInput;
}

describe('求解器对拍（随机实例 × 暴力枚举）', () => {
  const cases: { n: number; p: number; tol: number; decoy: boolean; disc?: boolean }[] = [
    { n: 4, p: 1, tol: 0, decoy: false },
    { n: 4, p: 1, tol: 3, decoy: true },
    { n: 4, p: 0.7, tol: 2, decoy: true },
    { n: 5, p: 0.8, tol: 1, decoy: true },
    { n: 5, p: 0.5, tol: 5, decoy: false },
    { n: 6, p: 0.6, tol: 2, decoy: true },
    { n: 4, p: 0.9, tol: 0, decoy: false, disc: true },
  ];

  for (const cfg of cases) {
    for (let seed = 1; seed <= 12; seed++) {
      it(`n=${cfg.n} p=${cfg.p} tol=${cfg.tol} decoy=${cfg.decoy} disc=${!!cfg.disc} seed=${seed}`, () => {
        const input = randomModel(seed * 7919 + cfg.n * 131, cfg.n, cfg.p, cfg.tol, cfg.decoy, cfg.disc);
        const checked = validateAndNormalize(input);
        expect('errors' in checked).toBe(false);
        if ('errors' in checked) return;
        const expected = bruteForce(checked.model);
        const got = solve(checked.model);
        expect(got.status === 'infeasible' ? 'infeasible' : got.status === 'multiple' ? 'multiple' : 'unique').toBe(
          expected.status,
        );
        if (expected.status === 'infeasible') return;
        expect(got.optimalCost).toBe(expected.minCost);
        expect(got.witnesses.length).toBe(Math.min(2, expected.total));
        expected.sols.forEach((s, i) => {
          expect(got.witnesses[i].mapping).toEqual(s.mapping);
          expect(Array.from(got.witnesses[i].polarity)).toEqual(s.polarity);
          expect(got.witnesses[i].cost).toBe(s.cost);
        });
      }, 30000);
    }
  }
});

describe('内置示例', () => {
  it('交叉+反接示例：唯一最优，且恢复真实接线', () => {
    const res = audit(exampleCrossedReversed());
    expect(res.verdict).toBe('unique');
    const w = res.solve!.witnesses[0];
    const idx = Object.fromEntries(res.model!.channelNames.map((c, i) => [c, i]));
    expect(w.mapping.map((c) => res.model!.channelNames[c])).toEqual(['C1', 'C3', 'C2', 'C4']);
    void idx;
    expect(w.polarity).toEqual([1, 1, 1, -1]);
    expect(w.cost).toBe(0);
    for (const r of w.rows) {
      expect(r.error).toBe(0);
      expect(r.signConsistent).toBe(true);
    }
  });

  it('对称示例：多解最优，两份映射按通道名字典序', () => {
    const res = audit(exampleSymmetric());
    expect(res.verdict).toBe('multiple');
    const [w1, w2] = res.solve!.witnesses;
    expect(w1.mapping.map((c) => res.model!.channelNames[c])).toEqual(['C1', 'C2', 'C3', 'C4']);
    expect(w2.mapping.map((c) => res.model!.channelNames[c])).toEqual(['C1', 'C3', 'C2', 'C4']);
    expect(w1.polarity).toEqual([1, 1, 1, 1]);
    expect(w2.polarity).toEqual([1, 1, 1, 1]);
  });

  it('缺边示例：无可行解', () => {
    expect(audit(exampleInfeasible()).verdict).toBe('infeasible');
  });
});

describe('输入校验', () => {
  it('拒绝数量越界与数量不等', () => {
    const r = validateAndNormalize({ ...exampleCrossedReversed(), pointNames: ['A', 'B'] });
    expect('errors' in r).toBe(true);
  });

  it('拒绝重复编号、非整数时延、负容差、重复点对、自环、未知端点', () => {
    const base = exampleCrossedReversed();
    expect('errors' in validateAndNormalize({ ...base, channelNames: ['C1', 'C2', 'C3', 'C3'] })).toBe(true);
    expect('errors' in validateAndNormalize({ ...base, tolerance: -1 })).toBe(true);
    const dup = structuredClone(base);
    dup.installPairs.push({ ...dup.installPairs[0] });
    expect('errors' in validateAndNormalize(dup)).toBe(true);
    const self = structuredClone(base);
    self.installPairs[0].b = self.installPairs[0].a;
    expect('errors' in validateAndNormalize(self)).toBe(true);
    const unknown = structuredClone(base);
    unknown.channelPairs[0].a = 'CX';
    expect('errors' in validateAndNormalize(unknown)).toBe(true);
    const badDelay = structuredClone(base);
    badDelay.installPairs[0].delay = 1.5;
    expect('errors' in validateAndNormalize(badDelay)).toBe(true);
    const badSign = structuredClone(base);
    (badSign.installPairs[0] as { sign: number }).sign = 0;
    expect('errors' in validateAndNormalize(badSign)).toBe(true);
  });

  it('反向录入的时延按端点方向规范化（符号不随时延翻转）', () => {
    // 六条边时延取差距悬殊的唯一值，任何非恒等映射都会因误差 > 容差而不可行
    const installPairs: AuditInput['installPairs'] = [
      { a: 'P1', b: 'P2', delay: 10, sign: 1 },
      { a: 'P1', b: 'P3', delay: 100, sign: 1 },
      { a: 'P1', b: 'P4', delay: 200, sign: 1 },
      { a: 'P2', b: 'P3', delay: 300, sign: 1 },
      { a: 'P2', b: 'P4', delay: 400, sign: 1 },
      { a: 'P3', b: 'P4', delay: 500, sign: 1 },
    ];
    const input: AuditInput = {
      pointNames: ['P1', 'P2', 'P3', 'P4'],
      channelNames: ['C1', 'C2', 'C3', 'C4'],
      installPairs,
      // 通道 (P1,P2) 边反向录成 C2->C1 = +10，即 C1->C2 = -10，误差 20
      channelPairs: [
        { a: 'C2', b: 'C1', delay: 10, sign: 1 },
        { a: 'C1', b: 'C3', delay: 100, sign: 1 },
        { a: 'C1', b: 'C4', delay: 200, sign: 1 },
        { a: 'C2', b: 'C3', delay: 300, sign: 1 },
        { a: 'C2', b: 'C4', delay: 400, sign: 1 },
        { a: 'C3', b: 'C4', delay: 500, sign: 1 },
      ],
      tolerance: 20,
    };
    const res = audit(input);
    expect(res.verdict).toBe('unique');
    expect(res.solve!.optimalCost).toBe(20);
    const row = res.solve!.witnesses[0].rows.find((r) => r.pointU === 'P1' && r.pointV === 'P2')!;
    expect(row.measuredDelay).toBe(-10);
    expect(row.error).toBe(20);
  });

  it('n=14 上界规模可完整判定', () => {
    const input = randomModel(4242, 14, 1, 0, false);
    const res = audit(input);
    expect(['unique', 'multiple', 'infeasible']).toContain(res.verdict);
  }, 30000);
});
