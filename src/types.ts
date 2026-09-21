/** 相关符号：+1 同相，-1 反相 */
export type CorrSign = 1 | -1;

/** 一条“无序点对”的有向观测：端点 a -> b 的时延，以及该点对的相关符号 */
export interface PairRecord {
  a: string;
  b: string;
  delay: number;
  sign: CorrSign;
}

/** 审计输入（页面编辑态 / 导入导出共用） */
export interface AuditInput {
  pointNames: string[];
  channelNames: string[];
  installPairs: PairRecord[];
  channelPairs: PairRecord[];
  tolerance: number;
}

/** 求解器内部使用的索引化点对 */
export interface IndexedPair {
  a: number;
  b: number;
  delay: number;
  sign: CorrSign;
}

export interface NormalizedModel {
  n: number;
  pointNames: string[];
  channelNames: string[];
  tolerance: number;
  /** installEdges[i] 安装点侧第 i 条边（u<v，delay 按 u->v 规范化） */
  installEdges: Edge[];
  /** 通道侧邻接矩阵，键为 x<y */
  channelMatrix: (Edge | null)[][];
  installAdj: number[][]; // 点 -> 关联的安装边编号
}

export interface Edge {
  u: number;
  v: number;
  /** u -> v 方向的时延 */
  delay: number;
  sign: CorrSign;
}

export interface PairWitnessRow {
  edgeIndex: number;
  pointU: string;
  pointV: string;
  channelU: string;
  channelV: string;
  expectedDelay: number;
  expectedSign: CorrSign;
  /** 按端点方向规范化后的实测时延（映射通道 f(u) -> f(v)） */
  measuredDelay: number;
  measuredSign: CorrSign;
  error: number;
  signConsistent: boolean;
}

export interface Witness {
  /** 安装点编号顺序 -> 通道下标 */
  mapping: number[];
  /** 每个安装点（= 其映射通道）的极性 */
  polarity: CorrSign[];
  cost: number;
  rows: PairWitnessRow[];
}

export type SolveStatus = 'infeasible' | 'unique' | 'multiple' | 'limit';

export interface SolveResult {
  status: SolveStatus;
  /** unique 时 1 份，multiple 时 2 份（字典序最小的两份） */
  witnesses: Witness[];
  optimalCost: number;
  nodesVisited: number;
  nodeLimit: number;
}

export interface AuditResult {
  verdict: 'invalid' | 'infeasible' | 'unique' | 'multiple' | 'limit';
  errors?: string[];
  solve?: SolveResult;
  model?: NormalizedModel;
}
