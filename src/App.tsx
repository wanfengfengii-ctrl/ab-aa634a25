import { useRef, useState } from 'react';
import type { ProblemInput, Sign, Verdict } from './types';
import { MAX_N, MIN_N } from './types';
import { validateInput } from './solver';
import { SAMPLES, defaultInput } from './samples';
import { parseImport, toExport } from './jsonio';
import { PairMatrixEditor } from './components/PairMatrixEditor';
import type { CellState, MatState } from './components/PairMatrixEditor';
import { WitnessView } from './components/WitnessView';

const toMat = (delays: number[][], signs: Sign[][]): MatState => {
  const n = delays.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => ({
      delay: i < j ? String(delays[i][j]) : '',
      sign: (i < j ? signs[i][j] : 1) as Sign,
    })),
  );
};

const resizeNames = (old: string[], m: number, prefix: string): string[] =>
  Array.from({ length: m }, (_, i) => old[i] ?? `${prefix}${i + 1}`);

const resizeMat = (old: MatState, m: number): MatState =>
  Array.from({ length: m }, (_, i) =>
    Array.from({ length: m }, (_, j) => old[i]?.[j] ?? ({ delay: '0', sign: 1 as Sign })),
  );

const parseNum = (s: string): number => (s.trim() === '' ? NaN : Number(s));

const initial = defaultInput();

export default function App() {
  const [n, setN] = useState(initial.points.length);
  const [pointNames, setPointNames] = useState<string[]>(initial.points);
  const [channelNames, setChannelNames] = useState<string[]>(initial.channels);
  const [pointMat, setPointMat] = useState<MatState>(() => toMat(initial.pointDelays, initial.pointSigns));
  const [channelMat, setChannelMat] = useState<MatState>(() => toMat(initial.channelDelays, initial.channelSigns));
  const [tolerance, setTolerance] = useState(String(initial.tolerance));
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [lastInput, setLastInput] = useState<ProblemInput | null>(null);
  const [stale, setStale] = useState(false);
  const [running, setRunning] = useState(false);
  const [witnessIdx, setWitnessIdx] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const seqRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);

  // 任何输入修改：作废旧裁决与进行中的计算
  const touch = () => {
    seqRef.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    setRunning(false);
    if (verdict) setStale(true);
    setVerdict(null);
  };

  const loadInput = (inp: ProblemInput, msg?: string) => {
    touch();
    setN(inp.points.length);
    setPointNames(inp.points);
    setChannelNames(inp.channels);
    setPointMat(toMat(inp.pointDelays, inp.pointSigns));
    setChannelMat(toMat(inp.channelDelays, inp.channelSigns));
    setTolerance(String(inp.tolerance));
    setStale(false);
    setWitnessIdx(0);
    setImportError(null);
    setNotice(msg ?? null);
  };

  const changeN = (m: number) => {
    touch();
    setN(m);
    setPointNames((old) => resizeNames(old, m, 'P'));
    setChannelNames((old) => resizeNames(old, m, 'C'));
    setPointMat((old) => resizeMat(old, m));
    setChannelMat((old) => resizeMat(old, m));
  };

  const updateCell = (side: 'p' | 'c') => (i: number, j: number, cell: CellState) => {
    touch();
    const setMat = side === 'p' ? setPointMat : setChannelMat;
    setMat((old) => old.map((row, r) => (r === i ? row.map((c, q) => (q === j ? cell : c)) : row)));
  };

  const buildInput = (): ProblemInput => {
    const read = (mat: MatState) => {
      const d: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
      const s: Sign[][] = Array.from({ length: n }, () => new Array<Sign>(n).fill(1 as Sign));
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          d[i][j] = parseNum(mat[i][j].delay);
          s[i][j] = mat[i][j].sign;
          s[j][i] = mat[i][j].sign;
        }
      }
      return { d, s };
    };
    const p = read(pointMat);
    const c = read(channelMat);
    return {
      points: pointNames,
      channels: channelNames,
      pointDelays: p.d,
      pointSigns: p.s,
      channelDelays: c.d,
      channelSigns: c.s,
      tolerance: parseNum(tolerance),
    };
  };

  const runAudit = () => {
    const input = buildInput();
    const errors = validateInput(input);
    workerRef.current?.terminate();
    const id = ++seqRef.current;
    setStale(false);
    setWitnessIdx(0);
    setNotice(null);
    setImportError(null);
    if (errors.length > 0) {
      setVerdict({ kind: 'invalid', errors });
      setLastInput(null);
      setRunning(false);
      return;
    }
    setLastInput(input);
    setVerdict(null);
    setRunning(true);
    const w = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    w.onmessage = (e: MessageEvent<{ id: number; result: Verdict }>) => {
      if (e.data.id !== seqRef.current) return;
      setVerdict(e.data.result);
      setRunning(false);
    };
    w.onerror = () => {
      if (id !== seqRef.current) return;
      setRunning(false);
      setNotice('计算过程出错，请检查输入');
    };
    w.postMessage({ id, input });
  };

  const doExport = () => {
    const input = buildInput();
    const errors = validateInput(input);
    if (errors.length > 0) {
      setNotice('当前输入无效，无法导出');
      return;
    }
    const blob = new Blob([JSON.stringify(toExport(input), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wiring-audit-input.json';
    a.click();
    URL.revokeObjectURL(a.href);
    setNotice('已导出 JSON');
  };

  const doImport = (file: File) => {
    file
      .text()
      .then((txt) => {
        let raw: unknown;
        try {
          raw = JSON.parse(txt);
        } catch {
          setImportError('文件不是合法 JSON');
          return;
        }
        const parsed = parseImport(raw);
        if (!parsed.ok) {
          setImportError(parsed.error);
          return;
        }
        loadInput(parsed.data, '导入成功');
      })
      .catch(() => setImportError('读取文件失败'));
  };

  const rename = (side: 'p' | 'c', idx: number, value: string) => {
    touch();
    const setter = side === 'p' ? setPointNames : setChannelNames;
    setter((old) => old.map((nm, i) => (i === idx ? value : nm)));
  };

  const statsOf = (v: Verdict) => (v.kind === 'unique' || v.kind === 'multiple' ? v.stats : null);
  const stats = verdict ? statsOf(verdict) : null;

  return (
    <div className="app">
      <header>
        <h1>水声阵列接线复核台</h1>
        <p>
          纯前端精确复核：将安装点双射到采集通道并为每个通道选择极性，按端点方向规范化后逐对校验时延与相关符号，
          以全部点对时延绝对误差之和最小为唯一目标。
        </p>
      </header>

      <section className="toolbar">
        <label>
          规模 n
          <select data-testid="n-select" value={n} onChange={(e) => changeN(Number(e.target.value))}>
            {Array.from({ length: MAX_N - MIN_N + 1 }, (_, k) => MIN_N + k).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          时延容差
          <input
            data-testid="tolerance"
            value={tolerance}
            size={6}
            onChange={(e) => {
              touch();
              setTolerance(e.target.value);
            }}
          />
        </label>
        <button data-testid="run-audit" className="primary" onClick={runAudit} disabled={running}>
          {running ? '计算中…' : '开始审计'}
        </button>
        <button data-testid="export-btn" onClick={doExport}>
          导出 JSON
        </button>
        <label className="import-label">
          导入 JSON
          <input
            data-testid="import-file"
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) doImport(f);
              e.target.value = '';
            }}
          />
        </label>
        <span className="toolbar-sep" />
        {SAMPLES.map((s) => (
          <button key={s.key} data-testid={`sample-${s.key}`} onClick={() => loadInput(s.build(), `已载入${s.label}`)}>
            {s.label}
          </button>
        ))}
      </section>

      {notice && <div className="notice">{notice}</div>}
      {importError && <div className="import-error">导入失败：{importError}</div>}

      <section className="names">
        <div className="names-col">
          <h3>安装点（{n}）</h3>
          {pointNames.map((nm, i) => (
            <input
              key={i}
              data-testid={`point-name-${i}`}
              value={nm}
              onChange={(e) => rename('p', i, e.target.value)}
            />
          ))}
        </div>
        <div className="names-col">
          <h3>采集通道（{n}）</h3>
          {channelNames.map((nm, i) => (
            <input
              key={i}
              data-testid={`channel-name-${i}`}
              value={nm}
              onChange={(e) => rename('c', i, e.target.value)}
            />
          ))}
        </div>
      </section>

      <PairMatrixEditor
        title="安装点侧：点对时延与相关符号"
        names={pointNames}
        mat={pointMat}
        testIdPrefix="p"
        onCellChange={updateCell('p')}
      />
      <PairMatrixEditor
        title="通道侧：点对时延与相关符号"
        names={channelNames}
        mat={channelMat}
        testIdPrefix="c"
        onCellChange={updateCell('c')}
      />

      {stale && !verdict && (
        <div className="stale" data-testid="stale-hint">
          输入已修改，旧裁决已失效，请重新审计。
        </div>
      )}

      {verdict && (
        <section className={`verdict ${verdict.kind}`} data-testid="verdict" data-kind={verdict.kind}>
          {verdict.kind === 'invalid' && (
            <>
              <h2>裁决：输入无效</h2>
              <ul data-testid="verdict-errors">
                {verdict.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </>
          )}
          {verdict.kind === 'infeasible' && (
            <>
              <h2>裁决：无可行解</h2>
              <p>不存在同时满足全部点对时延容差与相关符号约束的「双射＋极性」方案。</p>
            </>
          )}
          {verdict.kind === 'unique' && (
            <h2>
              裁决：唯一最优（总绝对误差 <span data-testid="total-cost">{verdict.cost}</span>）
            </h2>
          )}
          {verdict.kind === 'multiple' && (
            <h2>
              裁决：多解最优（总绝对误差 <span data-testid="total-cost">{verdict.cost}</span>
              ，以下为字典序最小的两份见证）
            </h2>
          )}
          {stats && (
            <p className="stats">
              搜索节点 {stats.nodes}，耗时 {stats.elapsedMs} ms
            </p>
          )}
        </section>
      )}

      {verdict && verdict.kind === 'multiple' && (
        <div className="tabs">
          <button
            data-testid="witness-tab-0"
            className={witnessIdx === 0 ? 'active' : ''}
            onClick={() => setWitnessIdx(0)}
          >
            见证 1（字典序最小）
          </button>
          <button
            data-testid="witness-tab-1"
            className={witnessIdx === 1 ? 'active' : ''}
            onClick={() => setWitnessIdx(1)}
          >
            见证 2
          </button>
        </div>
      )}

      {lastInput && verdict && verdict.kind === 'unique' && (
        <WitnessView input={lastInput} solution={verdict.solution} cost={verdict.cost} label="最优见证" />
      )}
      {lastInput && verdict && verdict.kind === 'multiple' && (
        <WitnessView
          input={lastInput}
          solution={verdict.solutions[witnessIdx]}
          cost={verdict.cost}
          label={witnessIdx === 0 ? '见证 1' : '见证 2'}
        />
      )}

      <footer>
        <p>
          说明：整体极性翻转在物理上不可区分，裁决已将首个安装点对应通道的极性规范化为 ＋；
          字典序按安装点编号顺序比较映射序列（通道按列表编号）。修改任何输入都会作废旧裁决。
        </p>
      </footer>
    </div>
  );
}
