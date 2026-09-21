import type { AuditInput } from './types';

/** 示例一：四元阵，C2/C3 被交叉换插且 P4 反接，存在唯一最优布线 */
export function exampleCrossedReversed(): AuditInput {
  // 真实接线：P1->C1(+) P2->C3(+) P3->C2(+) P4->C4(-)
  // 安装侧（点 u->v 方向给出时延与符号），通道侧据此生成
  const installPairs = [
    { a: 'P1', b: 'P2', delay: 10, sign: 1 as const },
    { a: 'P1', b: 'P3', delay: 12, sign: -1 as const },
    { a: 'P1', b: 'P4', delay: 20, sign: 1 as const },
    { a: 'P2', b: 'P3', delay: 4, sign: 1 as const },
    { a: 'P2', b: 'P4', delay: 15, sign: -1 as const },
    { a: 'P3', b: 'P4', delay: 11, sign: 1 as const },
  ];
  const pointMap: Record<string, string> = { P1: 'C1', P2: 'C3', P3: 'C2', P4: 'C4' };
  const pol: Record<string, 1 | -1> = { P1: 1, P2: 1, P3: 1, P4: -1 };
  const channelPairs = installPairs.map(({ a, b, delay, sign }) => {
    // 通道侧记录方向仍是点对端点顺序 a->b（对应通道 pointMap[a]->pointMap[b]）
    // 时延：d' (f(a)->f(b)) = d(a->b)（映射只是换名）；相关符号 s' = s * p[a]*p[b]
    return {
      a: pointMap[a],
      b: pointMap[b],
      delay,
      sign: (sign * pol[a] * pol[b]) as 1 | -1,
    };
  });
  return {
    pointNames: ['P1', 'P2', 'P3', 'P4'],
    channelNames: ['C1', 'C2', 'C3', 'C4'],
    installPairs,
    channelPairs,
    tolerance: 2,
  };
}

/** 示例二：对称结构（对换 P2/P3 完全等价）→ 多解最优，用于核对字典序双见证 */
export function exampleSymmetric(): AuditInput {
  const installPairs = [
    { a: 'P1', b: 'P2', delay: 5, sign: 1 as const },
    { a: 'P1', b: 'P3', delay: 5, sign: 1 as const },
    { a: 'P1', b: 'P4', delay: 9, sign: 1 as const },
    { a: 'P2', b: 'P4', delay: 7, sign: -1 as const },
    { a: 'P3', b: 'P4', delay: 7, sign: -1 as const },
  ];
  const toChannel = (a: string, b: string, delay: number, sign: 1 | -1) => ({
    a: a.replace('P', 'C'),
    b: b.replace('P', 'C'),
    delay,
    sign,
  });
  return {
    pointNames: ['P1', 'P2', 'P3', 'P4'],
    channelNames: ['C1', 'C2', 'C3', 'C4'],
    installPairs,
    channelPairs: installPairs.map((p) => toChannel(p.a, p.b, p.delay, p.sign)),
    tolerance: 0,
  };
}

/** 示例三：缺一条关键观测且容差为 0 → 无可行解 */
export function exampleInfeasible(): AuditInput {
  const base = exampleCrossedReversed();
  return {
    ...base,
    tolerance: 0,
    // 通道侧删掉一条点对，任何双射都会缺边
    channelPairs: base.channelPairs.filter((p) => !(p.a === 'C2' && p.b === 'C3') && !(p.a === 'C3' && p.b === 'C2')),
  };
}
