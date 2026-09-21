import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';

function runAudit() {
  fireEvent.click(screen.getByTestId('run-audit'));
}

describe('复核台 UI 端到端流程', () => {
  beforeEach(() => {
    render(<App />);
  });

  it('默认为交叉+反接示例，审计得到唯一最优并恢复真实接线', async () => {
    runAudit();
    const banner = await screen.findByTestId('verdict-banner');
    await waitFor(() => expect(banner.getAttribute('data-verdict')).toBe('unique'));
    expect((await screen.findByTestId('total-cost')).textContent!.trim()).toBe('0');

    const grid = screen.getByTestId('mapping-grid');
    const rows = within(grid).getAllByTestId(/mapping-row-/);
    const text = rows.map((r) => r.textContent);
    expect(text[0]).toContain('P1');
    expect(text[0]).toContain('C1');
    expect(text[1]).toContain('P2');
    expect(text[1]).toContain('C3');
    expect(text[2]).toContain('P3');
    expect(text[2]).toContain('C2');
    expect(text[3]).toContain('P4');
    expect(text[3]).toContain('C4');
    // P4 反接
    expect(within(rows[3]).getByTestId('polarity-3').textContent).toContain('反接');

    const table = screen.getByTestId('witness-table');
    const errorCells = within(table).getAllByTestId(/^error-/);
    for (const c of errorCells) expect(c.textContent).toBe('0');
    expect(screen.getByTestId('sum-errors').textContent).toBe('0');
    // 期望/实测逐对展示
    const firstRow = within(table).getAllByTestId(/witness-row-/)[0];
    expect(firstRow.textContent).toContain('P1 → P2');
    expect(within(firstRow).getByTestId('expected-0').textContent).toBe('10');
    expect(within(firstRow).getByTestId('measured-0').textContent).toBe('10');
  });

  it('对称示例：两份字典序最优见证可切换', async () => {
    fireEvent.click(screen.getByTestId('sample-multiple'));
    runAudit();
    const banner = await screen.findByTestId('verdict-banner');
    await waitFor(() => expect(banner.getAttribute('data-verdict')).toBe('multiple'));

    const tabs = [screen.getByTestId('witness-tab-0'), screen.getByTestId('witness-tab-1')];
    expect(tabs[0]).toBeTruthy();
    const mappingText = () =>
      within(screen.getByTestId('mapping-grid'))
        .getAllByTestId(/mapping-row-/)
        .map((r) => r.textContent);

    expect(mappingText()[1]).toContain('C2');
    fireEvent.click(tabs[1]);
    expect(mappingText()[1]).toContain('C3');
    expect(mappingText()[2]).toContain('C2');
  });

  it('无可行解示例给出明确裁决', async () => {
    fireEvent.click(screen.getByTestId('sample-infeasible'));
    runAudit();
    const banner = await screen.findByTestId('verdict-banner');
    await waitFor(() => expect(banner.getAttribute('data-verdict')).toBe('infeasible'));
    expect(screen.queryByTestId('witness-panel')).toBeNull();
  });

  it('删除到 3 个安装点再审计 → 输入无效并列出原因', async () => {
    const delButtons = screen.getAllByLabelText(/删除第/);
    fireEvent.click(delButtons[0]);
    runAudit();
    const banner = await screen.findByTestId('verdict-banner');
    expect(banner.getAttribute('data-verdict')).toBe('invalid');
    const errs = screen.getByTestId('invalid-errors').textContent!;
    expect(errs).toContain('4 至 14');
  });

  it('审计后修改输入立即作废旧裁决（不保留旧结果）', async () => {
    runAudit();
    await screen.findByTestId('verdict-banner');
    // 修改容差
    fireEvent.change(screen.getByTestId('tolerance'), { target: { value: '99' } });
    await waitFor(() => expect(screen.queryByTestId('verdict-banner')).toBeNull());
    expect(screen.queryByTestId('witness-panel')).toBeNull();
  });

  it('可通过 JSON 导入自定义输入并完成审计', async () => {
    const payload = {
      pointNames: ['A1', 'A2', 'A3', 'A4'],
      channelNames: ['D1', 'D2', 'D3', 'D4'],
      installPairs: [
        { a: 'A1', b: 'A2', delay: 1, sign: 1 },
        { a: 'A1', b: 'A3', delay: 2, sign: -1 },
        { a: 'A1', b: 'A4', delay: 3, sign: 1 },
        { a: 'A2', b: 'A3', delay: 4, sign: 1 },
        { a: 'A2', b: 'A4', delay: 5, sign: -1 },
        { a: 'A3', b: 'A4', delay: 6, sign: 1 },
      ],
      channelPairs: [
        { a: 'D1', b: 'D2', delay: 1, sign: 1 },
        { a: 'D1', b: 'D3', delay: 2, sign: -1 },
        { a: 'D1', b: 'D4', delay: 3, sign: 1 },
        { a: 'D2', b: 'D3', delay: 4, sign: 1 },
        { a: 'D2', b: 'D4', delay: 5, sign: -1 },
        { a: 'D3', b: 'D4', delay: 6, sign: 1 },
      ],
      tolerance: 0,
    };
    fireEvent.click(screen.getByTestId('open-import'));
    fireEvent.change(screen.getByTestId('import-json'), { target: { value: JSON.stringify(payload) } });
    fireEvent.click(screen.getByTestId('apply-import'));
    runAudit();
    const banner = await screen.findByTestId('verdict-banner');
    await waitFor(() => expect(banner.getAttribute('data-verdict')).toBe('unique'));
    const text = within(screen.getByTestId('mapping-grid'))
      .getAllByTestId(/mapping-row-/)
      .map((r) => r.textContent);
    expect(text[0]).toContain('A1');
    expect(text[0]).toContain('D1');
  });

  it('导入畸形 JSON 时给出解析错误且不启动审计', async () => {
    fireEvent.click(screen.getByTestId('open-import'));
    fireEvent.change(screen.getByTestId('import-json'), { target: { value: '{not json' } });
    fireEvent.click(screen.getByTestId('apply-import'));
    expect(screen.getByText(/JSON 解析失败/)).toBeTruthy();
  });

  it('添加点对行可编辑后参与审计', async () => {
    const user = userEvent.setup();
    // 唯一示例只有 6 行安装点对（已满 K4），改为在通道侧添加重复行会被判无效
    fireEvent.click(screen.getByTestId('add-channel-pair'));
    const rows = screen.getAllByTestId(/^channel-row-/);
    const last = rows[rows.length - 1];
    await user.selectOptions(within(last).getByTestId(/channel-a-/), 'C1');
    await user.selectOptions(within(last).getByTestId(/channel-b-/), 'C2');
    runAudit();
    const banner = await screen.findByTestId('verdict-banner');
    expect(banner.getAttribute('data-verdict')).toBe('invalid');
    expect(screen.getByTestId('invalid-errors').textContent!).toContain('重复无序点对');
  });
});
