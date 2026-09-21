import type { ProblemInput, Sign } from './types';

const zeroMat = (n: number): number[][] => Array.from({ length: n }, () => new Array<number>(n).fill(0));
const oneSigns = (n: number): Sign[][] => Array.from({ length: n }, () => new Array<Sign>(n).fill(1 as Sign));

const names = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

/** 由真值（排列 perm 与逐点极性 eps）生成通道侧数据：Dc(perm i, perm j) = Dp(i,j)，Sc 同理乘上两端极性。 */
function fromTruth(
  n: number,
  pointDelays: number[][],
  pointSigns: Sign[][],
  perm: number[],
  eps: Sign[],
  tolerance: number,
): ProblemInput {
  // 规范化安装点侧矩阵：下三角填镜像（求解器只读上三角，此处仅为数据整洁）
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      pointDelays[j][i] = -pointDelays[i][j];
      pointSigns[j][i] = pointSigns[i][j];
    }
  }
  const channelDelays = zeroMat(n);
  const channelSigns = oneSigns(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      channelDelays[perm[i]][perm[j]] = pointDelays[i][j];
      channelDelays[perm[j]][perm[i]] = -pointDelays[i][j];
      const s = (pointSigns[i][j] * eps[i] * eps[j]) as Sign;
      channelSigns[perm[i]][perm[j]] = s;
      channelSigns[perm[j]][perm[i]] = s;
    }
  }
  return {
    points: names('P', n),
    channels: names('C', n),
    pointDelays,
    channelDelays,
    pointSigns,
    channelSigns,
    tolerance,
  };
}

/** 唯一最优示例（n=5）：全部时延两两不同，真值排列唯一，零噪声。 */
function buildUnique(): ProblemInput {
  const n = 5;
  const d = zeroMat(n);
  const vals = [12, 45, 78, 23, 56, 34, 89, 15, 67, 41];
  let k = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) d[i][j] = vals[k++];
  const s = oneSigns(n);
  const signVals: Sign[] = [1, -1, 1, -1, 1, -1, 1, -1, 1, -1];
  k = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) s[i][j] = signVals[k++];
  const perm = [2, 0, 4, 1, 3];
  const eps: Sign[] = [1, -1, 1, 1, -1];
  return fromTruth(n, d, s, perm, eps, 2);
}

/**
 * 多解最优示例（n=4，容差 0）：P3/P4 与 C3/C4 互为“孪生”
 * （对其余点时延完全一致、相互之间时延为 0），互换后误差与符号均不变，
 * 恰好产生两个最优解。
 */
function buildMultiple(): ProblemInput {
  const n = 4;
  const d = zeroMat(n);
  d[0][1] = 30;
  d[0][2] = 17;
  d[0][3] = 17;
  d[1][2] = 44;
  d[1][3] = 44;
  d[2][3] = 0;
  const s = oneSigns(n);
  const perm = [0, 1, 2, 3];
  const eps: Sign[] = [1, 1, 1, 1];
  return fromTruth(n, d, s, perm, eps, 0);
}

/** 无可行解示例（n=4）：通道侧时延全为 0，容差 2，任何映射都超限。 */
function buildInfeasible(): ProblemInput {
  const n = 4;
  const d = zeroMat(n);
  d[0][1] = 30;
  d[0][2] = 17;
  d[0][3] = 25;
  d[1][2] = 44;
  d[1][3] = 38;
  d[2][3] = 21;
  const s = oneSigns(n);
  const input = fromTruth(n, d, s, [0, 1, 2, 3], [1, 1, 1, 1], 2);
  input.channelDelays = zeroMat(n);
  return input;
}

/** 较大规模示例（n=8）：时延两两不同保证唯一最优，容差 1。 */
function buildLarge(): ProblemInput {
  const n = 8;
  const d = zeroMat(n);
  let v = 13;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { d[i][j] = v; v += 7; }
  const s = oneSigns(n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) s[i][j] = ((i * 3 + j) % 3 === 0 ? -1 : 1) as Sign;
  const perm = [3, 0, 5, 1, 7, 2, 6, 4];
  const eps: Sign[] = [1, -1, 1, -1, 1, 1, -1, 1];
  return fromTruth(n, d, s, perm, eps, 1);
}

export interface Sample {
  key: string;
  label: string;
  build: () => ProblemInput;
}

export const SAMPLES: Sample[] = [
  { key: 'unique', label: '示例：唯一最优 (n=5)', build: buildUnique },
  { key: 'multiple', label: '示例：多解最优 (n=4)', build: buildMultiple },
  { key: 'infeasible', label: '示例：无可行解 (n=4)', build: buildInfeasible },
  { key: 'large', label: '示例：较大规模唯一最优 (n=8)', build: buildLarge },
];

export function defaultInput(): ProblemInput {
  return buildUnique();
}
