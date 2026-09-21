import type { ProblemInput, Sign, Solution } from '../types';

interface Props {
  input: ProblemInput;
  solution: Solution;
  cost: number;
  label: string;
}

const fmtSign = (s: Sign) => (s === 1 ? '＋' : '－');

/** 最优见证视图：映射与极性表 + 逐对期望/实测/误差表。 */
export function WitnessView({ input, solution, cost, label }: Props) {
  const n = input.points.length;
  const chanDelay = (a: number, b: number) =>
    a < b ? input.channelDelays[a][b] : -input.channelDelays[b][a];
  const chanSign = (a: number, b: number): Sign =>
    a < b ? input.channelSigns[a][b] : input.channelSigns[b][a];

  const pairs: Array<{
    key: string;
    i: number;
    j: number;
    a: number;
    b: number;
    expected: number;
    measured: number;
    err: number;
    expSign: Sign;
    measSign: Sign;
  }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = solution.assignment[i];
      const b = solution.assignment[j];
      const expected = input.pointDelays[i][j];
      const measured = chanDelay(a, b);
      pairs.push({
        key: `${i}-${j}`,
        i,
        j,
        a,
        b,
        expected,
        measured,
        err: Math.abs(expected - measured),
        expSign: input.pointSigns[i][j],
        measSign: (chanSign(a, b) * solution.polarities[i] * solution.polarities[j]) as Sign,
      });
    }
  }

  return (
    <div className="witness" data-testid="witness">
      <h4>
        {label}（总绝对误差 <span data-testid="total-cost">{cost}</span>）
      </h4>
      <div className="witness-cols">
        <div>
          <h5>映射与极性</h5>
          <table className="result-table" data-testid="mapping-table">
            <thead>
              <tr>
                <th>安装点</th>
                <th></th>
                <th>通道</th>
                <th>极性</th>
              </tr>
            </thead>
            <tbody>
              {solution.assignment.map((a, i) => (
                <tr key={i} data-testid={`mapping-row-${i}`}>
                  <td>{input.points[i]}</td>
                  <td>→</td>
                  <td>{input.channels[a]}</td>
                  <td>{fmtSign(solution.polarities[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h5>逐对复核（方向：前者 → 后者）</h5>
          <table className="result-table" data-testid="pair-table">
            <thead>
              <tr>
                <th>安装点对</th>
                <th>通道对</th>
                <th>期望时延</th>
                <th>实测时延</th>
                <th>误差</th>
                <th>容差内</th>
                <th>期望符号</th>
                <th>实测符号</th>
                <th>符号一致</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p) => (
                <tr key={p.key} data-testid={`pair-row-${p.key}`}>
                  <td>
                    {input.points[p.i]}–{input.points[p.j]}
                  </td>
                  <td>
                    {input.channels[p.a]}–{input.channels[p.b]}
                  </td>
                  <td>{p.expected}</td>
                  <td>{p.measured}</td>
                  <td>{p.err}</td>
                  <td className={p.err <= input.tolerance ? 'ok' : 'bad'}>
                    {p.err <= input.tolerance ? '✓' : '✗'}
                  </td>
                  <td>{fmtSign(p.expSign)}</td>
                  <td>{fmtSign(p.measSign)}</td>
                  <td className={p.expSign === p.measSign ? 'ok' : 'bad'}>
                    {p.expSign === p.measSign ? '✓' : '✗'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
