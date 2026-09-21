import type {
  CorrSign,
  Edge,
  NormalizedModel,
  PairWitnessRow,
  SolveResult,
  Witness,
} from './types';

/**
 * 求解器
 * ------
 * 决策变量：
 *   f: 安装点 -> 采集通道 的双射（排列）
 *   p[u] ∈ {+1,-1}：安装点 u 所接通道的接线极性（正接 / 反接）
 *
 * 安装点侧无序点对 e=(u,v)（u<v）的时延已规范化为 u->v 方向的 d_e、相关符号 s_e；
 * 通道侧点对 (f(u),f(v)) 实测时延按 f(u)->f(v) 规范化为 d'，相关符号 s'。合法条件：
 *   1) 通道侧存在该无序点对；
 *   2) |d' - d_e| ≤ 容差；
 *   3) s_e · p[u] · p[v] = s'   （相关符号乘两端极性后一致）。
 * 唯一目标：min Σ_e |d' - d_e|（成本只取决于映射，与极性无关）。
 *
 * 极性结构：每个符号约束都是两端极性之积，整体翻转全部极性仍合法；
 * 仅凭成对相关符号无法确定绝对极性。规范代表固定 p[0]=+1；约束图不连通时
 * 其余连通分量仍有翻转自由，照样会产生多个字典序不同的最优解。
 *
 * 两阶段：
 *   阶段一：MRV + 二分匹配前向剪枝 + 全局误差下界的分支定界，求最优成本；
 *           极性一致性用增量奇偶并查集（ParityDSU）剪枝，不枚举极性。
 *   阶段二：按安装点编号顺序、通道名字典序枚举映射；叶节点对该映射生成
 *           字典序最小的规范极性向量，收满两份见证即停。
 */

const NODE_LIMIT = 8_000_000;
const TIME_LIMIT_MS = 20_000;

interface SearchCtx {
  model: NormalizedModel;
  n: number;
  /** 键 (u,v,c,d)（安装边 u<v） */
  pairExists: Uint8Array;
  chanDelay: Int32Array;
  chanSign: Int8Array;
  /** 每条安装边在任意通道对上的最小绝对误差（下界用），不可行为 0x7fffffff */
  edgeGlobalMin: Int32Array;
  /** pairBits[ei*n+c]：安装边 ei 在端点 u 接通道 c 时，v 可接的相容通道位掩码 */
  pairBits: Int32Array;
  nodes: number;
  deadline: number;
  limitReached: boolean;
}

function key4(n: number, u: number, v: number, c: number, d: number): number {
  return (((u * n + v) * n + c) * n + d);
}

export function buildSolver(model: NormalizedModel): SearchCtx {
  const n = model.n;
  const size = n * n * n * n;
  const pairExists = new Uint8Array(size);
  const chanDelay = new Int32Array(size);
  const chanSign = new Int8Array(size);

  for (const e of model.installEdges) {
    const { u, v, delay } = e;
    for (let c = 0; c < n; c++) {
      for (let d = 0; d < n; d++) {
        if (c === d) continue;
        const x = Math.min(c, d);
        const y = Math.max(c, d);
        const ce: Edge | null = model.channelMatrix[x][y];
        if (!ce) continue;
        // 通道边沿 x->y 存储；要求方向 c->d（c 对应 u，d 对应 v）
        const dNorm = c === x ? ce.delay : -ce.delay;
        if (Math.abs(dNorm - delay) <= model.tolerance) {
          const k = key4(n, u, v, c, d);
          pairExists[k] = 1;
          chanDelay[k] = dNorm;
          chanSign[k] = ce.sign;
        }
      }
    }
  }

  const edgeGlobalMin = new Int32Array(model.installEdges.length);
  for (let ei = 0; ei < model.installEdges.length; ei++) {
    const e = model.installEdges[ei];
    let mn = Infinity;
    for (let c = 0; c < n; c++) {
      for (let d = 0; d < n; d++) {
        if (c === d) continue;
        const k = key4(n, e.u, e.v, c, d);
        if (pairExists[k]) mn = Math.min(mn, Math.abs(chanDelay[k] - e.delay));
      }
    }
    edgeGlobalMin[ei] = mn === Infinity ? 0x7fffffff : mn;
  }

  const pairBits = new Int32Array(model.installEdges.length * n);
  for (let ei = 0; ei < model.installEdges.length; ei++) {
    const e = model.installEdges[ei];
    for (let c = 0; c < n; c++) {
      let mask = 0;
      for (let d = 0; d < n; d++) {
        if (d !== c && pairExists[key4(n, e.u, e.v, c, d)]) mask |= 1 << d;
      }
      pairBits[ei * n + c] = mask;
    }
  }

  return {
    model,
    n,
    pairExists,
    chanDelay,
    chanSign,
    edgeGlobalMin,
    pairBits,
    nodes: 0,
    deadline: Date.now() + TIME_LIMIT_MS,
    limitReached: false,
  };
}

/**
 * 增量奇偶并查集：find(u) = { root, sign } 满足 p[u] = sign · p[root]。
 * unite(u, v, want) 施加约束 p[u]·p[v] = want，矛盾返回 false。
 */
class ParityDSU {
  parent: Int32Array;
  rel: Int8Array; // p[x] / p[parent[x]]
  constructor(n: number) {
    this.parent = new Int32Array(n).fill(-1);
    this.rel = new Int8Array(n).fill(1);
  }
  clone(): ParityDSU {
    const d = new ParityDSU(0);
    d.parent = new Int32Array(this.parent);
    d.rel = new Int8Array(this.rel);
    return d;
  }
  find(x: number): { root: number; sign: number } {
    let s = 1;
    while (this.parent[x] >= 0) {
      s *= this.rel[x];
      x = this.parent[x];
    }
    return { root: x, sign: s };
  }
  unite(u: number, v: number, want: number): boolean {
    const ru = this.find(u);
    const rv = this.find(v);
    if (ru.root === rv.root) return ru.sign * rv.sign === want;
    this.parent[rv.root] = ru.root;
    // p[rv]/p[ru] = (p[u]/p[ru])·(p[v]/p[rv])·(p[u]·p[v])
    this.rel[rv.root] = ru.sign * rv.sign * want;
    return true;
  }
}

interface ProbeResult {
  delta: number;
  /** 约束生效后：p[u] = factor · p[root] */
  roots: number[];
  factors: number[];
}

/**
 * 试探把安装点 u 接到空闲通道 c：闭合安装边必须存在且时延达标，
 * 且相对各已连通分量根的奇偶因子必须自洽。不修改 DSU。
 */
function probeAssign(ctx: SearchCtx, u: number, c: number, f: Int32Array, dsu: ParityDSU): ProbeResult | null {
  const { model, pairExists, chanDelay, chanSign } = ctx;
  let delta = 0;
  const rootFactor = new Int8Array(ctx.n); // 0 未出现，±1 为因子
  const roots: number[] = [];
  const factors: number[] = [];
  for (const ei of model.installAdj[u]) {
    const e = model.installEdges[ei];
    const v = e.u === u ? e.v : e.u;
    if (f[v] < 0) continue;
    const k = key4(ctx.n, e.u, e.v, e.u === u ? c : f[e.u], e.v === u ? c : f[e.v]);
    if (!pairExists[k]) return null;
    delta += Math.abs(chanDelay[k] - e.delay);
    // p[u]·p[v] = e.sign·s'
    const rv = dsu.find(v);
    const factor = e.sign * chanSign[k] * rv.sign; // p[u] = factor·p[root]
    if (rootFactor[rv.root] === 0) {
      rootFactor[rv.root] = factor;
      roots.push(rv.root);
      factors.push(factor);
    } else if (rootFactor[rv.root] !== factor) {
      return null;
    }
  }
  return { delta, roots, factors };
}

/** 把 probe 结果落到 DSU 副本 */
function applyProbe(dsu: ParityDSU, u: number, probe: ProbeResult): ParityDSU {
  const next = dsu.clone();
  for (let i = 0; i < probe.roots.length; i++) {
    if (!next.unite(u, probe.roots[i], probe.factors[i])) {
      // probe 已保证同根自洽；跨根经 u 关联不产生额外冲突
      return dsu;
    }
  }
  return next;
}

/**
 * 弧相容 + 前向检查（位掩码）。
 * 初始域计入已闭合边的存在性/容差/奇偶与空闲通道；
 * 再对“两端均未分配”的安装边反复传播：dom[u] 中每个 c 必须在 dom[v] 内
 * 存在相容通道 d。返回域位掩码数组与增量代价矩阵。
 */
function acDomains(
  ctx: SearchCtx,
  f: Int32Array,
  used: Uint8Array,
  dsu: ParityDSU,
): { masks: Int32Array; cost: Float64Array } | null {
  const n = ctx.n;
  const masks = new Int32Array(n);
  const cost = new Float64Array(n * n).fill(Infinity);
  let freeMask = 0;
  for (let c = 0; c < n; c++) if (!used[c]) freeMask |= 1 << c;

  for (let u = 0; u < n; u++) {
    if (f[u] >= 0) continue;
    let mask = 0;
    for (let c = 0; c < n; c++) {
      if (used[c]) continue;
      const p = probeAssign(ctx, u, c, f, dsu);
      if (p) {
        mask |= 1 << c;
        cost[u * n + c] = p.delta;
      }
    }
    if (mask === 0) return null;
    masks[u] = mask;
  }

  // 沿未闭合安装边反复做弧相容传播，直到不动点
  let changed = true;
  while (changed) {
    changed = false;
    for (let ei = 0; ei < ctx.model.installEdges.length; ei++) {
      const e = ctx.model.installEdges[ei];
      if (f[e.u] >= 0 || f[e.v] >= 0) continue;
      // 收窄 dom[u]：存在 d ∈ dom[v] 使 (c,d) 相容
      let nu = 0;
      for (let c = 0; c < n; c++) {
        if (!(masks[e.u] & (1 << c))) continue;
        if (ctx.pairBits[ei * n + c] & masks[e.v] & freeMask) nu |= 1 << c;
      }
      // 收窄 dom[v]：pairBits 以 (u,v) 方向定义，这里直接查存在性表
      let nv = 0;
      for (let d = 0; d < n; d++) {
        if (!(masks[e.v] & (1 << d))) continue;
        let ok = false;
        for (let c = 0; c < n; c++) {
          if ((masks[e.u] & (1 << c)) && ctx.pairExists[key4(n, e.u, e.v, c, d)]) {
            ok = true;
            break;
          }
        }
        if (ok) nv |= 1 << d;
      }
      if (nu === 0 || nv === 0) return null;
      if (nu !== masks[e.u] || nv !== masks[e.v]) changed = true;
      masks[e.u] = nu;
      masks[e.v] = nv;
    }
  }
  return { masks, cost };
}

/** 位掩码完美匹配（Kuhn） */
function hasPerfectMatchingBits(masks: Int32Array, n: number, active: number[]): boolean {
  const matchC = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  const augment = (u: number): boolean => {
    let m = masks[u];
    while (m) {
      const bit = m & -m;
      m -= bit;
      const c = 31 - Math.clz32(bit);
      if (seen[c]) continue;
      seen[c] = 1;
      if (matchC[c] < 0 || augment(matchC[c])) {
        matchC[c] = u;
        return true;
      }
    }
    return false;
  };
  for (const u of active) {
    seen.fill(0);
    if (!augment(u)) return false;
  }
  return true;
}

/**
 * 最小权完美匹配下界（匈牙利 O(k³)）：剩余点到空闲通道的闭合边增量代价矩阵。
 * 未闭合边由 globalLB 单独计入，两者按边划分不重复。
 */
function hungarianLB(ctx: SearchCtx, cost: Float64Array, masks: Int32Array, f: Int32Array): number {
  const n = ctx.n;
  const pts: number[] = [];
  const chs: number[] = [];
  for (let u = 0; u < n; u++) if (f[u] < 0) pts.push(u);
  let freeMask = 0;
  for (let u = 0; u < n; u++) if (f[u] < 0) freeMask |= masks[u];
  for (let c = 0; c < n; c++) if (freeMask & (1 << c)) chs.push(c);
  const k = pts.length;
  if (k === 0) return 0;
  // 行：点；列：候选通道（补足为 k 列，缺失列代价 Infinity）
  const BIG = 1e12;
  const a: number[][] = Array.from({ length: k }, (_, i) => {
    const row: number[] = [];
    for (let j = 0; j < k; j++) {
      const c = chs[j] ?? -1;
      const v = c >= 0 && (masks[pts[i]] & (1 << c)) ? cost[pts[i] * n + c] : Infinity;
      row.push(v === Infinity ? BIG : v);
    }
    return row;
  });
  // 标准匈牙利（最小权），1-标号
  const u = new Float64Array(k + 1);
  const v = new Float64Array(k + 1);
  const p = new Int32Array(k + 1);
  const way = new Int32Array(k + 1);
  for (let i = 1; i <= k; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(k + 1).fill(Infinity);
    const usedV = new Uint8Array(k + 1);
    do {
      usedV[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = -1;
      for (let j = 1; j <= k; j++) {
        if (usedV[j]) continue;
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= k; j++) {
        if (usedV[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  // 匹配总权 = -v[0]
  const total = -v[0];
  return total >= BIG / 2 ? Infinity : total;
}

/** 行最小和下界（O(k²)，忽略通道唯一性，比匈牙利弱但便宜） */
function rowMinLB(n: number, cost: Float64Array, masks: Int32Array, f: Int32Array): number {
  let lb = 0;
  for (let u = 0; u < n; u++) {
    if (f[u] >= 0) continue;
    let m = Infinity;
    let mask = masks[u];
    while (mask) {
      const bit = mask & -mask;
      mask -= bit;
      const c = 31 - Math.clz32(bit);
      const v = cost[u * n + c];
      if (v < m) m = v;
    }
    if (m === Infinity) return Infinity;
    lb += m;
  }
  return lb;
}

/**
 * Gilmore–Lawler 风格下界（一般化到 |期望-实测| 边代价）。
 * Q(v,c) = 已闭合邻边代价 w(v,c)
 *        + 开放邻边（另一端也未分配）期望时延（v→x 方向）序列与
 *          通道 c 对空闲通道的有向实测时延序列按升序配对的 |差| 之和
 *          （重排不等式：双升序配对使绝对差之和最小；允许跨点错配通道，故为松弛）。
 * 对 Q 在剩余点×空闲通道上做匈牙利指派得 H。开放边在各行合计两次，
 * 故 floor(H/2) 是无向目标的合法下界；同时返回闭合边指派下界。
 */
function gilmoreLawlerLB(
  ctx: SearchCtx,
  f: Int32Array,
  masks: Int32Array,
  closedCost: Float64Array,
): { glb: number; closed: number } {
  const n = ctx.n;
  const model = ctx.model;
  const pts: number[] = [];
  const chs: number[] = [];
  for (let u = 0; u < n; u++) if (f[u] < 0) pts.push(u);
  let freeMask = 0;
  for (let c = 0; c < n; c++) {
    let claimed = false;
    for (const u of pts) if (masks[u] & (1 << c)) claimed = true;
    if (claimed) chs.push(c);
    if (!usedBit(f, c)) freeMask |= 1 << c;
  }
  void freeMask;
  const k = pts.length;
  if (k === 0) return { glb: 0, closed: 0 };

  // 每点开放邻边的期望时延（v→x 方向）升序
  const openExpected: number[][] = pts.map((v) => {
    const arr: number[] = [];
    for (const ei of model.installAdj[v]) {
      const e = model.installEdges[ei];
      const x = e.u === v ? e.v : e.u;
      if (f[x] < 0) arr.push(e.u === v ? e.delay : -e.delay);
    }
    arr.sort((a, b) => a - b);
    return arr;
  });

  // 每个候选通道 c 对全部候选通道的 c→d 有向实测时延（升序），只算一次
  const measByC: number[][] = chs.map((c) => {
    const meas: number[] = [];
    for (const d of chs) {
      if (d === c) continue;
      const x = Math.min(c, d);
      const y = Math.max(c, d);
      const ce = model.channelMatrix[x][y];
      if (ce) meas.push(c === x ? ce.delay : -ce.delay);
    }
    meas.sort((a, b) => a - b);
    return meas;
  });

  const BIG = 1e12;
  const w: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const pp: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < k; i++) {
    const v = pts[i];
    const exp = openExpected[i];
    for (let j = 0; j < k; j++) {
      const c = chs[j];
      if (!(masks[v] & (1 << c))) {
        w[i][j] = BIG;
        pp[i][j] = BIG;
        continue;
      }
      const wv = closedCost[v * n + c];
      w[i][j] = wv === Infinity ? BIG : wv;
      const meas = measByC[j];
      if (meas.length < exp.length) {
        pp[i][j] = BIG;
        continue;
      }
      // exp（升序）与 meas（升序, 更长）选单调子序列的最小 |差| 之和：
      // dp[i][j] = min(dp[i][j-1]（跳过 meas[j-1]）, dp[i-1][j-1]+|exp[i-1]-meas[j-1]|)
      let pairSum = 0;
      if (meas.length === exp.length) {
        for (let t = 0; t < exp.length; t++) pairSum += Math.abs(exp[t] - meas[t]);
      } else {
        let prev = new Array(meas.length + 1).fill(0);
        for (let i2 = 1; i2 <= exp.length; i2++) {
          const cur = new Array(meas.length + 1).fill(Infinity);
          for (let j2 = 1; j2 <= meas.length; j2++) {
            const use = prev[j2 - 1] + Math.abs(exp[i2 - 1] - meas[j2 - 1]);
            cur[j2] = Math.min(cur[j2 - 1], use);
          }
          prev = cur;
        }
        pairSum = prev[meas.length];
      }
      pp[i][j] = pairSum;
    }
  }

  const hClosed = hungarianMin(w, BIG);
  const hPair = hungarianMin(pp, BIG);
  if (hClosed >= BIG / 2 || hPair >= BIG / 2) return { glb: Infinity, closed: Infinity };
  // 闭合代价计一次；开放配对在两行各计一次（无向代价 ×2），故 ceil(P*/2)
  const glb = hClosed + Math.ceil(hPair / 2);
  return { glb, closed: hClosed };
}

function usedBit(f: Int32Array, c: number): boolean {
  for (let u = 0; u < f.length; u++) if (f[u] === c) return true;
  return false;
}

/** k×k 最小权指派（匈牙利），BIG 表示不可行；返回总权 */
function hungarianMin(a: number[][], BIG: number): number {
  const k = a.length;
  const u = new Float64Array(k + 1);
  const v = new Float64Array(k + 1);
  const p = new Int32Array(k + 1);
  const way = new Int32Array(k + 1);
  for (let i = 1; i <= k; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(k + 1).fill(Infinity);
    const usedV = new Uint8Array(k + 1);
    do {
      usedV[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = -1;
      for (let j = 1; j <= k; j++) {
        if (usedV[j]) continue;
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= k; j++) {
        if (usedV[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  void BIG;
  return -v[0];
}

/** 综合下界：浅层用行最小下界，深层升级匈牙利，仍剪不掉再升级 GL */
function combinedLB(
  ctx: SearchCtx,
  f: Int32Array,
  cost: Float64Array,
  masks: Int32Array,
  partialCost: number,
  bestCost: number,
  remaining: number,
): number {
  const open = openEdgeLB(ctx, f);
  if (open === Infinity) return Infinity;
  let cheap: number;
  if (remaining > 11) {
    const rm = rowMinLB(ctx.n, cost, masks, f);
    if (rm === Infinity) return Infinity;
    cheap = open + rm;
    if (partialCost + cheap > bestCost) return cheap;
    // 浅层也补一次匈牙利（行最小剪不掉时）
  }
  const hm = hungarianLB(ctx, cost, masks, f);
  if (hm === Infinity) return Infinity;
  cheap = open + hm;
  if (remaining > 9 || partialCost + cheap > bestCost) return cheap;
  const gl = gilmoreLawlerLB(ctx, f, masks, cost);
  if (gl.glb === Infinity || gl.closed === Infinity) return Infinity;
  return Math.max(cheap, gl.glb, gl.closed + open);
}

/** 未闭合安装边（至少一端未分配）各自全局最小误差之和；忽略符号，是合法下界 */
function globalLB(ctx: SearchCtx, f: Int32Array): number {
  let lb = 0;
  const edges = ctx.model.installEdges;
  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei];
    if (f[e.u] < 0 || f[e.v] < 0) {
      const m = ctx.edgeGlobalMin[ei];
      if (m === 0x7fffffff) return Infinity;
      lb += m;
    }
  }
  return lb;
}

/** 两端均未分配的安装边之独立最小误差之和（与匹配下界按边不重叠） */
function openEdgeLB(ctx: SearchCtx, f: Int32Array): number {
  let lb = 0;
  const edges = ctx.model.installEdges;
  for (let ei = 0; ei < edges.length; ei++) {
    const e = edges[ei];
    if (f[e.u] < 0 && f[e.v] < 0) {
      const m = ctx.edgeGlobalMin[ei];
      if (m === 0x7fffffff) return Infinity;
      lb += m;
    }
  }
  return lb;
}

function tick(ctx: SearchCtx): boolean {
  ctx.nodes++;
  if ((ctx.nodes & 0x3fff) === 0 && (Date.now() > ctx.deadline || ctx.nodes > NODE_LIMIT)) {
    ctx.limitReached = true;
    return false;
  }
  return true;
}

/** 每个搜索阶段独立享有完整的节点/时间预算 */
function resetBudget(ctx: SearchCtx): void {
  ctx.nodes = 0;
  ctx.deadline = Date.now() + TIME_LIMIT_MS;
  ctx.limitReached = false;
}

/** 阶段一：MRV 分支定界，只求最优成本 */
function phase1(ctx: SearchCtx): number | 'limit' | 'infeasible' {
  const n = ctx.n;
  const f = new Int32Array(n).fill(-1);
  const used = new Uint8Array(n);
  let bestCost = Infinity;

  const dfs = (assigned: number, partialCost: number, dsu: ParityDSU): void => {
    if (ctx.limitReached) return;
    if (!tick(ctx)) return;
    if (partialCost > bestCost) return;

    if (assigned === n) {
      bestCost = partialCost;
      return;
    }

    const ac = acDomains(ctx, f, used, dsu);
    if (!ac) return;
    const { masks, cost } = ac;
    const active: number[] = [];
    for (let u = 0; u < n; u++) if (f[u] < 0) active.push(u);
    if (!hasPerfectMatchingBits(masks, n, active)) return;
    if (partialCost + combinedLB(ctx, f, cost, masks, partialCost, bestCost, n - assigned) > bestCost) return;

    // MRV：域中候选位数最少者优先，并列取编号最小
    let u = -1;
    let bestSize = n + 1;
    for (const x of active) {
      const sz = bitCount(masks[x]);
      if (sz < bestSize) {
        bestSize = sz;
        u = x;
      }
    }

    // 候选按闭合边增量代价升序，尽快拿到紧的上界
    const cands: { c: number; delta: number }[] = [];
    let mask = masks[u];
    while (mask) {
      const bit = mask & -mask;
      mask -= bit;
      const c = 31 - Math.clz32(bit);
      cands.push({ c, delta: cost[u * n + c] });
    }
    cands.sort((a, b) => a.delta - b.delta || a.c - b.c);

    for (const { c, delta } of cands) {
      const probe = probeAssign(ctx, u, c, f, dsu);
      if (!probe) continue;
      const nc = partialCost + delta;
      f[u] = c;
      used[c] = 1;
      if (nc + globalLB(ctx, f) <= bestCost) {
        dfs(assigned + 1, nc, applyProbe(dsu, u, probe));
      }
      used[c] = 0;
      f[u] = -1;
      if (ctx.limitReached || bestCost === 0) return;
    }
  };

  dfs(0, 0, new ParityDSU(n));
  if (ctx.limitReached) return 'limit';
  if (bestCost === Infinity) return 'infeasible';
  return bestCost;
}

function bitCount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

function buildWitness(ctx: SearchCtx, f: Int32Array, pol: Int8Array, cost: number): Witness {
  const { model } = ctx;
  const mapping = Array.from(f);
  const polarity = Array.from(pol) as CorrSign[];
  const rows: PairWitnessRow[] = model.installEdges.map((e, ei) => {
    const c = f[e.u];
    const d = f[e.v];
    const x = Math.min(c, d);
    const y = Math.max(c, d);
    const ce = model.channelMatrix[x][y]!;
    const measuredDelay = c === x ? ce.delay : -ce.delay;
    return {
      edgeIndex: ei,
      pointU: model.pointNames[e.u],
      pointV: model.pointNames[e.v],
      channelU: model.channelNames[c],
      channelV: model.channelNames[d],
      expectedDelay: e.delay,
      expectedSign: e.sign,
      measuredDelay,
      measuredSign: ce.sign,
      error: Math.abs(measuredDelay - e.delay),
      signConsistent: e.sign * pol[e.u] * pol[e.v] === ce.sign,
    };
  });
  return { mapping, polarity, cost, rows };
}

/**
 * 映射确定后生成规范极性（p[0]=+1），按字典序最多 need 份。
 * 含 0 的连通分量方向由 p[0]=+1 钉死；其余分量可整体翻转：
 * 第一份令各自由分量的最小编号点为 +，其后每份依次翻转“最小编号点最大”的分量。
 */
function canonicalPolarities(ctx: SearchCtx, dsu: ParityDSU, need: number): Int8Array[] {
  const n = ctx.n;
  const rootOf = new Int32Array(n);
  const minVertex = new Map<number, number>();
  for (let u = 0; u < n; u++) {
    const { root } = dsu.find(u);
    rootOf[u] = root;
    const m = minVertex.get(root);
    if (m === undefined || u < m) minVertex.set(root, u);
  }
  const root0 = rootOf[0];
  const rootSign = new Map<number, number>();
  for (const [root, m] of minVertex) {
    const signM = dsu.find(m).sign; // p[m] = signM·p[root]
    if (root === root0) {
      const sign0 = dsu.find(0).sign;
      rootSign.set(root, sign0); // 使 p[0] = +1
    } else {
      rootSign.set(root, signM); // 使 p[m] = +1
    }
  }
  const materialize = (): Int8Array => {
    const pol = new Int8Array(n);
    for (let u = 0; u < n; u++) {
      const { root, sign } = dsu.find(u);
      pol[u] = rootSign.get(root)! * sign;
    }
    return pol;
  };
  const out: Int8Array[] = [materialize()];

  const freeSorted = [...minVertex.entries()]
    .filter(([root]) => root !== root0)
    .sort((a, b) => a[1] - b[1]); // 按最小编号点升序
  for (let i = freeSorted.length - 1; i >= 0 && out.length < need; i--) {
    const [root] = freeSorted[i];
    rootSign.set(root, -rootSign.get(root)!);
    out.push(materialize());
  }
  return out;
}

/** 阶段二：映射按（安装点顺序 × 通道名升序）字典序枚举，叶节点展开规范极性 */
function phase2(ctx: SearchCtx, bestCost: number): Witness[] | 'limit' {
  const n = ctx.n;
  const model = ctx.model;
  const channelOrder = model.channelNames
    .map((name, idx) => ({ name, idx }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((x) => x.idx);

  const f = new Int32Array(n).fill(-1);
  const used = new Uint8Array(n);
  const best: Witness[] = [];

  const dfs = (u: number, partialCost: number, dsu: ParityDSU): void => {
    if (ctx.limitReached || best.length >= 2) return;
    if (!tick(ctx)) return;
    if (partialCost > bestCost) return;

    if (u === n) {
      if (partialCost !== bestCost) return;
      const pols = canonicalPolarities(ctx, dsu, 2 - best.length);
      for (const p of pols) {
        best.push(buildWitness(ctx, f, p, bestCost));
        if (best.length >= 2) break;
      }
      return;
    }

    const ac = acDomains(ctx, f, used, dsu);
    if (!ac) return;
    const { masks, cost } = ac;
    const active: number[] = [];
    for (let x = u; x < n; x++) active.push(x);
    if (!hasPerfectMatchingBits(masks, n, active)) return;
    if (partialCost + combinedLB(ctx, f, cost, masks, partialCost, bestCost, n - u) > bestCost) return;

    for (const c of channelOrder) {
      if (used[c] || !(masks[u] & (1 << c))) continue;
      const probe = probeAssign(ctx, u, c, f, dsu);
      if (!probe) continue;
      const nc = partialCost + probe.delta;
      f[u] = c;
      used[c] = 1;
      if (nc + globalLB(ctx, f) <= bestCost) {
        dfs(u + 1, nc, applyProbe(dsu, u, probe));
      }
      used[c] = 0;
      f[u] = -1;
      if (ctx.limitReached || best.length >= 2) return;
    }
  };

  dfs(0, 0, new ParityDSU(n));
  if (ctx.limitReached) return 'limit';
  return best;
}

export function solve(model: NormalizedModel): SolveResult {
  const ctx = buildSolver(model);

  // 结构必要条件预检：
  // (a) 安装侧每条边必须在通道侧占用一条不同的边；
  // (b) 双射下安装点 u 的每条邻边须占用 f(u) 的不同邻边，
  //     故按“安装点度数 ≤ 通道度数”必须存在完美匹配（Hall）。
  const n = ctx.n;
  const degI = new Int32Array(n);
  const degC = new Int32Array(n);
  for (const e of model.installEdges) {
    degI[e.u]++;
    degI[e.v]++;
  }
  for (let x = 0; x < n; x++) {
    for (let y = x + 1; y < n; y++) if (model.channelMatrix[x][y]) degC[x]++, degC[y]++;
  }
  let channelEdgeCount = 0;
  for (let x = 0; x < n; x++) for (let y = x + 1; y < n; y++) if (model.channelMatrix[x][y]) channelEdgeCount++;
  if (model.installEdges.length > channelEdgeCount) {
    return { status: 'infeasible', witnesses: [], optimalCost: NaN, nodesVisited: 0, nodeLimit: NODE_LIMIT };
  }
  {
    const matchC = new Int32Array(n).fill(-1);
    const seen = new Uint8Array(n);
    const augment = (u: number): boolean => {
      for (let c = 0; c < n; c++) {
        if (degI[u] > degC[c] || seen[c]) continue;
        seen[c] = 1;
        if (matchC[c] < 0 || augment(matchC[c])) {
          matchC[c] = u;
          return true;
        }
      }
      return false;
    };
    let feasible = true;
    for (let u = 0; u < n; u++) {
      seen.fill(0);
      if (!augment(u)) {
        feasible = false;
        break;
      }
    }
    if (!feasible) {
      return { status: 'infeasible', witnesses: [], optimalCost: NaN, nodesVisited: 0, nodeLimit: NODE_LIMIT };
    }
  }

  resetBudget(ctx);
  const p1 = phase1(ctx);
  const p1Nodes = ctx.nodes;
  if (p1 === 'limit') {
    return { status: 'limit', witnesses: [], optimalCost: NaN, nodesVisited: p1Nodes, nodeLimit: NODE_LIMIT };
  }
  if (p1 === 'infeasible') {
    return { status: 'infeasible', witnesses: [], optimalCost: NaN, nodesVisited: p1Nodes, nodeLimit: NODE_LIMIT };
  }
  resetBudget(ctx);
  const p2 = phase2(ctx, p1);
  if (p2 === 'limit') {
    return { status: 'limit', witnesses: [], optimalCost: p1, nodesVisited: p1Nodes + ctx.nodes, nodeLimit: NODE_LIMIT };
  }
  return {
    status: p2.length >= 2 ? 'multiple' : 'unique',
    witnesses: p2,
    optimalCost: p1,
    nodesVisited: p1Nodes + ctx.nodes,
    nodeLimit: NODE_LIMIT,
  };
}
