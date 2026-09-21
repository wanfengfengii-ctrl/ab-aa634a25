import { useMemo, useRef, useState } from 'react';
import { audit } from './audit';
import type { AuditInput, AuditResult, CorrSign, PairRecord, Witness } from './types';
import { exampleCrossedReversed, exampleInfeasible, exampleSymmetric } from './sample';

type Side = 'install' | 'channel';

export function App() {
  const [input, setInput] = useState<AuditInput>(exampleCrossedReversed());
  const [result, setResult] = useState<AuditResult | null>(null);
  const [running, setRunning] = useState(false);
  const [witnessIdx, setWitnessIdx] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  /** 任何编辑动作都立即作废旧裁决（修改输入后不得保留旧裁决） */
  const mutate = (fn: (draft: AuditInput) => AuditInput) => {
    setInput((prev) => fn(structuredClone(prev)));
    setResult(null);
    setWitnessIdx(0);
  };

  const runAudit = () => {
    setRunning(true);
    setResult(null);
    const snapshot = structuredClone(inputRef.current);
    // 让“计算中”状态先渲染；求解全程同步、纯本地
    setTimeout(() => {
      setResult(audit(snapshot));
      setWitnessIdx(0);
      setRunning(false);
    }, 30);
  };

  const applyImport = () => {
    try {
      const parsed = JSON.parse(importText);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('根节点必须是 JSON 对象');
      const missing = ['pointNames', 'channelNames', 'installPairs', 'channelPairs'].filter(
        (k) => !Array.isArray((parsed as Record<string, unknown>)[k]),
      );
      if (missing.length > 0) throw new Error(`缺少数组字段：${missing.join('、')}`);
      if (typeof (parsed as Record<string, unknown>).tolerance !== 'number') {
        throw new Error('缺少数值字段 tolerance');
      }
      setInput(parsed as AuditInput);
      setResult(null);
      setWitnessIdx(0);
      setImportError(null);
      setImportOpen(false);
    } catch (e) {
      setImportError(`JSON 解析失败：${(e as Error).message}`);
    }
  };

  const onImportFile = async (file: File | null) => {
    if (!file) return;
    setImportText(await file.text());
    setImportError(null);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(input, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audit-input.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const witnesses = result?.solve?.witnesses ?? [];
  const current: Witness | null = witnesses[witnessIdx] ?? witnesses[0] ?? null;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>水听器阵列布线复核台</h1>
          <div className="sub">交叉换插 / 反接双射审计 · 纯浏览器本地计算 · 不调用任何业务后端</div>
        </div>
        <div className="btn-row">
          <button data-testid="sample-unique" onClick={() => { setInput(exampleCrossedReversed()); setResult(null); }}>
            示例：交叉+反接（唯一最优）
          </button>
          <button data-testid="sample-multiple" onClick={() => { setInput(exampleSymmetric()); setResult(null); }}>
            示例：对称（多解最优）
          </button>
          <button data-testid="sample-infeasible" onClick={() => { setInput(exampleInfeasible()); setResult(null); }}>
            示例：无可行解
          </button>
        </div>
      </header>

      <div className="layout">
        <section className="panel" data-testid="input-panel">
          <h2>输入编辑</h2>

          <NameEditor
            title="安装点编号（4–14 个，唯一）"
            names={input.pointNames}
            testidPrefix="point"
            onChange={(names) => mutate((d) => ({ ...d, pointNames: names }))}
          />
          <NameEditor
            title="采集通道编号（与安装点等量，唯一）"
            names={input.channelNames}
            testidPrefix="channel"
            onChange={(names) => mutate((d) => ({ ...d, channelNames: names }))}
          />

          <div className="section">
            <label className="field">
              非负时延容差（整数）
              <input
                data-testid="tolerance"
                type="number"
                min={0}
                step={1}
                value={input.tolerance}
                onChange={(e) => mutate((d) => ({ ...d, tolerance: Number(e.target.value) }))}
              />
            </label>
          </div>

          <PairEditor
            className="section"
            title="安装点侧无序点对（有向时延 + 相关符号）"
            side="install"
            input={input}
            mutate={mutate}
          />
          <PairEditor
            className="section"
            title="通道侧无序点对（有向时延 + 相关符号）"
            side="channel"
            input={input}
            mutate={mutate}
          />

          <div className="section btn-row">
            <button className="primary" data-testid="run-audit" onClick={runAudit} disabled={running}>
              {running ? '审计计算中…' : '启动审计'}
            </button>
            <button data-testid="open-import" onClick={() => setImportOpen((v) => !v)}>
              导入 JSON
            </button>
            <button onClick={exportJson}>导出当前输入</button>
          </div>

          {importOpen && (
            <div className="section">
              <label className="field">
                粘贴审计输入 JSON
                <textarea
                  data-testid="import-json"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder='{"pointNames":[...],"channelNames":[...],"installPairs":[...],"channelPairs":[...],"tolerance":0}'
                />
              </label>
              <div className="btn-row">
                <button className="primary" data-testid="apply-import" onClick={applyImport}>应用导入</button>
                <label className="small" style={{ alignSelf: 'center' }}>
                  或选择文件：
                  <input
                    type="file"
                    accept=".json,application/json"
                    style={{ display: 'inline', width: 'auto', marginLeft: 6 }}
                    onChange={(e) => void onImportFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              {importError && <div className="verdict invalid" style={{ marginTop: 8 }}>{importError}</div>}
            </div>
          )}
        </section>

        <section className="panel" data-testid="result-panel">
          <h2>审计裁决与最优见证</h2>
          {running && <div className="verdict limit"><div className="big">计算中…</div></div>}
          {!running && !result && (
            <div className="muted">编辑输入后点击「启动审计」。结果一经输入修改立即作废，不会保留旧裁决。</div>
          )}
          {!running && result && (
            <ResultView result={result} witnessIdx={witnessIdx} setWitnessIdx={setWitnessIdx} witness={current} />
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------------- 名称编辑 ---------------- */

function NameEditor(props: {
  title: string;
  names: string[];
  testidPrefix: string;
  onChange: (names: string[]) => void;
}) {
  const { title, names, testidPrefix, onChange } = props;
  return (
    <div className="section">
      <label className="field">
        {title}
        <span className="count-badge">{names.length} 个</span>
      </label>
      {names.map((name, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <input
            data-testid={`${testidPrefix}-name-${i}`}
            type="text"
            value={name}
            onChange={(e) => {
              const next = [...names];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <button
            className="danger"
            aria-label={`删除第 ${i + 1} 项`}
            onClick={() => onChange(names.filter((_, j) => j !== i))}
          >
            删除
          </button>
        </div>
      ))}
      <div className="btn-row">
        <button onClick={() => onChange([...names, `${testidPrefix === 'point' ? 'P' : 'C'}${names.length + 1}`])}>
          添加
        </button>
      </div>
    </div>
  );
}

/* ---------------- 点对编辑 ---------------- */

function PairEditor(props: {
  className?: string;
  title: string;
  side: Side;
  input: AuditInput;
  mutate: (fn: (draft: AuditInput) => AuditInput) => void;
}) {
  const { className, title, side, input, mutate } = props;
  const names = side === 'install' ? input.pointNames : input.channelNames;
  const pairs = side === 'install' ? input.installPairs : input.channelPairs;
  const key = side === 'install' ? 'installPairs' : 'channelPairs';

  const update = (i: number, patch: Partial<PairRecord>) =>
    mutate((d) => {
      const list = d[key].map((p, j) => (j === i ? { ...p, ...patch } : p));
      return { ...d, [key]: list };
    });

  return (
    <div className={className}>
      <label className="field">
        {title}
        <span className="count-badge">{pairs.length} 行</span>
      </label>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>端点 a</th><th>端点 b</th><th className="num">时延 a→b</th><th>相关符号</th><th></th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p, i) => (
              <tr className="row-edit" key={i} data-testid={`${side}-row-${i}`}>
                <td>
                  <select value={p.a} data-testid={`${side}-a-${i}`} onChange={(e) => update(i, { a: e.target.value })}>
                    {names.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </td>
                <td>
                  <select value={p.b} data-testid={`${side}-b-${i}`} onChange={(e) => update(i, { b: e.target.value })}>
                    {names.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </td>
                <td className="num">
                  <input
                    type="number"
                    step={1}
                    value={p.delay}
                    data-testid={`${side}-delay-${i}`}
                    onChange={(e) => update(i, { delay: Number(e.target.value) })}
                  />
                </td>
                <td>
                  <select
                    value={p.sign}
                    data-testid={`${side}-sign-${i}`}
                    onChange={(e) => update(i, { sign: Number(e.target.value) as CorrSign })}
                  >
                    <option value={1}>+1 同相</option>
                    <option value={-1}>−1 反相</option>
                  </select>
                </td>
                <td>
                  <button className="danger" onClick={() =>
                    mutate((d) => ({ ...d, [key]: d[key].filter((_, j) => j !== i) }))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="btn-row">
        <button
          data-testid={`add-${side}-pair`}
          onClick={() =>
            mutate((d) => ({
              ...d,
              [key]: [
                ...d[key],
                {
                  a: names[0] ?? '',
                  b: names[1] ?? names[0] ?? '',
                  delay: 0,
                  sign: 1 as CorrSign,
                },
              ],
            }))
          }
          disabled={names.length < 2}
        >
          添加点对
        </button>
      </div>
    </div>
  );
}

/* ---------------- 结果展示 ---------------- */

const VERDICT_TEXT: Record<AuditResult['verdict'], string> = {
  invalid: '输入无效',
  infeasible: '无可行解',
  unique: '唯一最优解',
  multiple: '多解最优（并列）',
  limit: '计算达到搜索上限（未能完整判定）',
};

function ResultView(props: {
  result: AuditResult;
  witnessIdx: number;
  setWitnessIdx: (i: number) => void;
  witness: Witness | null;
}) {
  const { result, witnessIdx, setWitnessIdx, witness } = props;
  return (
    <div>
      <div className={`verdict ${result.verdict}`} data-testid="verdict-banner" data-verdict={result.verdict}>
        <div className="big">{VERDICT_TEXT[result.verdict]}</div>
        {result.verdict === 'invalid' && (
          <ul data-testid="invalid-errors">
            {result.errors!.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
        {result.verdict === 'infeasible' && (
          <div className="meta">
            在容差 {result.model!.tolerance} 内不存在同时满足点对存在性、时延误差与相关符号一致性的双射+极性方案。
            遍历节点数：{result.solve!.nodesVisited}。
          </div>
        )}
        {result.verdict === 'limit' && (
          <div className="meta">
            已用尽量界与前向剪枝，仍触及节点/时限上限（{result.solve!.nodeLimit.toLocaleString()} 节点 / 20 秒）。
            {Number.isFinite(result.solve!.optimalCost) ? ` 当前最优成本上界：${result.solve!.optimalCost}` : ''}
          </div>
        )}
        {(result.verdict === 'unique' || result.verdict === 'multiple') && (
          <div className="meta">
            目标：全部时延绝对误差之和最小；最优总成本 =
            <strong data-testid="total-cost"> {result.solve!.optimalCost}</strong>
            ，容差 {result.model!.tolerance}，遍历节点 {result.solve!.nodesVisited.toLocaleString()}。
            {result.verdict === 'multiple' && ' 下列两份为按安装点编号顺序、通道名字字典序最小的最优映射与极性。'}
            <div className="small muted">
              极性已规范化：编号最小安装点极性固定为 +（整体翻转极性不可区分，不计为不同布线结论）。
            </div>
          </div>
        )}
      </div>

      {witness && (
        <div data-testid="witness-panel">
          <div className="tabs">
            {result.solve!.witnesses.map((_, i) => (
              <button
                key={i}
                className={i === witnessIdx ? 'active' : ''}
                data-testid={`witness-tab-${i}`}
                onClick={() => setWitnessIdx(i)}
              >
                最优见证 {i + 1}
              </button>
            ))}
          </div>
          <WitnessView result={result} witness={witness} />
        </div>
      )}
    </div>
  );
}

function WitnessView({ result, witness }: { result: AuditResult; witness: Witness }) {
  const model = result.model!;
  const sumErrors = useMemo(() => witness.rows.reduce((s, r) => s + r.error, 0), [witness]);
  return (
    <div>
      <div className="cost-line small muted">安装点 → 采集通道（括号内为该通道选择的极性）：</div>
      <div className="map-grid" data-testid="mapping-grid">
        {model.pointNames.map((pn, i) => {
          const chIdx = witness.mapping[i];
          return (
            <div className="map-chip" key={pn} data-testid={`mapping-row-${i}`}>
              <span>{pn}</span>
              <span>→ {model.channelNames[chIdx]}</span>
              <span className={`pol-badge ${witness.polarity[i] === 1 ? 'pos' : 'neg'}`} data-testid={`polarity-${i}`}>
                {witness.polarity[i] === 1 ? '+ 正接' : '− 反接'}
              </span>
            </div>
          );
        })}
      </div>

      <div className="table-wrap">
        <table data-testid="witness-table">
          <thead>
            <tr>
              <th>安装点对</th>
              <th>通道对</th>
              <th className="num">期望时延</th>
              <th className="num">实测时延</th>
              <th className="num">绝对误差</th>
              <th>期望符号</th>
              <th>实测符号</th>
              <th>乘极性后</th>
            </tr>
          </thead>
          <tbody>
            {witness.rows.map((r, i) => {
              // 取该边两端安装点极性
              const uIdx = model.pointNames.indexOf(r.pointU);
              const vIdx = model.pointNames.indexOf(r.pointV);
              const prod = witness.polarity[uIdx] * witness.polarity[vIdx];
              const adjusted = r.expectedSign * prod;
              return (
                <tr key={i} data-testid={`witness-row-${i}`}>
                  <td>{r.pointU} → {r.pointV}</td>
                  <td>{r.channelU} → {r.channelV}</td>
                  <td className="num" data-testid={`expected-${i}`}>{r.expectedDelay}</td>
                  <td className="num" data-testid={`measured-${i}`}>{r.measuredDelay}</td>
                  <td className={`num ${r.error > model.tolerance ? 'bad' : ''}`} data-testid={`error-${i}`}>
                    {r.error}
                  </td>
                  <td className={r.expectedSign === 1 ? 'sign-pos' : 'sign-neg'}>
                    {r.expectedSign === 1 ? '+1' : '−1'}
                  </td>
                  <td className={r.measuredSign === 1 ? 'sign-pos' : 'sign-neg'}>
                    {r.measuredSign === 1 ? '+1' : '−1'}
                  </td>
                  <td className={r.signConsistent ? 'ok-text' : ''}>
                    {adjusted === 1 ? '+1' : '−1'} {r.signConsistent ? '✓' : '✗'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} style={{ textAlign: 'right' }}><strong>绝对误差之和</strong></td>
              <td className="num" data-testid="sum-errors"><strong>{sumErrors}</strong></td>
              <td colSpan={3}></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        时延方向：均按端点方向（安装点对 u→v 与映射通道 f(u)→f(v)）规范化后比较；
        「乘极性后」= 期望符号 × 两端极性，须与实测符号一致。
      </div>
    </div>
  );
}
