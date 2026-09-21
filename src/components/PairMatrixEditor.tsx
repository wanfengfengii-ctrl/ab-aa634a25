import type { Sign } from '../types';

export interface CellState {
  delay: string;
  sign: Sign;
}
export type MatState = CellState[][];

interface Props {
  title: string;
  names: string[];
  mat: MatState;
  testIdPrefix: 'p' | 'c';
  onCellChange: (i: number, j: number, next: CellState) => void;
}

/** 无序点对矩阵编辑器：仅上三角（行 -> 列方向）可编辑，下三角展示镜像。 */
export function PairMatrixEditor({ title, names, mat, testIdPrefix, onCellChange }: Props) {
  const mirrorDelay = (i: number, j: number): string => {
    const raw = (mat[j]?.[i]?.delay ?? '').trim();
    if (raw === '') return '—';
    const v = Number(raw);
    return Number.isFinite(v) ? String(-v) : '—';
  };

  return (
    <section className="matrix-block">
      <h3>{title}</h3>
      <p className="hint">每格 = 有向整数时延（行 → 列）＋相关符号；仅上三角可编辑，下三角为自动镜像。</p>
      <div className="matrix-scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th className="corner">时延 / 符号</th>
              {names.map((nm, j) => (
                <th key={j}>{nm}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {names.map((nm, i) => (
              <tr key={i}>
                <th>{nm}</th>
                {names.map((_, j) => {
                  if (i === j) {
                    return (
                      <td key={j} className="diag">
                        —
                      </td>
                    );
                  }
                  if (i < j) {
                    const cell = mat[i][j];
                    return (
                      <td key={j} className="edit">
                        <input
                          data-testid={`${testIdPrefix}delay-${i}-${j}`}
                          value={cell.delay}
                          size={5}
                          onChange={(e) => onCellChange(i, j, { ...cell, delay: e.target.value })}
                        />
                        <select
                          data-testid={`${testIdPrefix}sign-${i}-${j}`}
                          value={cell.sign}
                          onChange={(e) => onCellChange(i, j, { ...cell, sign: Number(e.target.value) as Sign })}
                        >
                          <option value={1}>＋</option>
                          <option value={-1}>－</option>
                        </select>
                      </td>
                    );
                  }
                  return (
                    <td key={j} className="mirror">
                      <span className="mirror-delay">{mirrorDelay(i, j)}</span>
                      <span className="mirror-sign">{mat[j][i].sign === 1 ? '＋' : '－'}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
