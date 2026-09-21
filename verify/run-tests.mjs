/**
 * 浏览器验收脚本（一次性运行，以退出码报告结果）：
 *  - 等待 web 服务健康检查通过
 *  - 在真实 Chromium 中执行全部验收场景
 *  - 全部通过退出码 0，否则 1
 */
import { chromium } from 'playwright';

const base = (process.env.BASE_URL || 'http://web:80').replace(/\/$/, '');

const results = [];
let failures = 0;
const pass = (name) => results.push(`PASS  ${name}`);
const fail = (name, err) => {
  failures += 1;
  results.push(`FAIL  ${name}  ->  ${err instanceof Error ? err.message : String(err)}`);
};

async function waitForServer() {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.ok) return;
    } catch {
      /* 尚未就绪 */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`服务未就绪：${base}`);
}

const expectKind = async (page, kind) => {
  const verdict = page.getByTestId('verdict');
  await verdict.waitFor({ timeout: 30000 });
  const actual = await verdict.getAttribute('data-kind');
  if (actual !== kind) throw new Error(`裁决类型应为 ${kind}，实际为 ${actual}`);
  return verdict;
};

async function main() {
  await waitForServer();

  // 1. 健康检查端点
  try {
    const r = await fetch(`${base}/healthz`);
    if (r.status !== 200) throw new Error(`状态码 ${r.status}`);
    pass('健康检查 /healthz 返回 200');
  } catch (e) {
    fail('健康检查 /healthz 返回 200', e);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const t = async (name, fn) => {
    try {
      await fn();
      pass(name);
    } catch (e) {
      fail(name, e);
    }
  };

  await t('首页加载（纯前端静态页）', async () => {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '水声阵列接线复核台' }).waitFor();
  });

  await t('唯一最优：裁决类型、真值映射、总误差 0、逐对表格', async () => {
    await page.goto(base);
    await page.getByTestId('sample-unique').click();
    await page.getByTestId('run-audit').click();
    await expectKind(page, 'unique');
    const expectMap = ['C3', 'C1', 'C5', 'C2', 'C4'];
    for (let i = 0; i < expectMap.length; i++) {
      const row = await page.getByTestId(`mapping-row-${i}`).innerText();
      if (!row.includes(`P${i + 1}`) || !row.includes(expectMap[i])) {
        throw new Error(`映射行 ${i} 应为 P${i + 1} -> ${expectMap[i]}，实际：${row}`);
      }
    }
    const cost = (await page.getByTestId('total-cost').first().innerText()).trim();
    if (cost !== '0') throw new Error(`总误差应为 0，实际 ${cost}`);
    const pairRows = await page.locator('[data-testid^="pair-row-"]').count();
    if (pairRows !== 10) throw new Error(`点对行数应为 C(5,2)=10，实际 ${pairRows}`);
    const firstPair = await page.getByTestId('pair-row-0-1').innerText();
    for (const col of ['P1', 'P2', 'C3', 'C1', '✓']) {
      if (!firstPair.includes(col)) throw new Error(`首行点对缺少「${col}」：${firstPair}`);
    }
  });

  await t('多解最优：返回字典序最小两份见证且可切换', async () => {
    await page.goto(base);
    await page.getByTestId('sample-multiple').click();
    await page.getByTestId('run-audit').click();
    await expectKind(page, 'multiple');
    const w1 = await page.getByTestId('mapping-row-2').innerText();
    if (!w1.includes('C3')) throw new Error(`见证1 P3 应映射 C3，实际：${w1}`);
    const w1b = await page.getByTestId('mapping-row-3').innerText();
    if (!w1b.includes('C4')) throw new Error(`见证1 P4 应映射 C4，实际：${w1b}`);
    await page.getByTestId('witness-tab-1').click();
    const w2 = await page.getByTestId('mapping-row-2').innerText();
    if (!w2.includes('C4')) throw new Error(`见证2 P3 应映射 C4，实际：${w2}`);
    const w2b = await page.getByTestId('mapping-row-3').innerText();
    if (!w2b.includes('C3')) throw new Error(`见证2 P4 应映射 C3，实际：${w2b}`);
  });

  await t('无可行解判定', async () => {
    await page.goto(base);
    await page.getByTestId('sample-infeasible').click();
    await page.getByTestId('run-audit').click();
    await expectKind(page, 'infeasible');
  });

  await t('较大规模唯一最优 (n=8)', async () => {
    await page.goto(base);
    await page.getByTestId('sample-large').click();
    await page.getByTestId('run-audit').click();
    await expectKind(page, 'unique');
    const row = await page.getByTestId('mapping-row-0').innerText();
    if (!row.includes('C4')) throw new Error(`P1 应映射 C4，实际：${row}`);
  });

  await t('无效输入判定（重复名称）', async () => {
    await page.goto(base);
    await page.getByTestId('sample-unique').click();
    await page.getByTestId('point-name-1').fill('P1');
    await page.getByTestId('run-audit').click();
    await expectKind(page, 'invalid');
    const errs = await page.getByTestId('verdict-errors').innerText();
    if (!errs.includes('重复')) throw new Error(`应报告名称重复，实际：${errs}`);
  });

  await t('无效输入判定（非整数时延）', async () => {
    await page.goto(base);
    await page.getByTestId('sample-unique').click();
    await page.getByTestId('pdelay-0-1').fill('1.5');
    await page.getByTestId('run-audit').click();
    await expectKind(page, 'invalid');
    const errs = await page.getByTestId('verdict-errors').innerText();
    if (!errs.includes('整数')) throw new Error(`应报告整数约束，实际：${errs}`);
  });

  await t('修改输入后旧裁决被清除', async () => {
    await page.goto(base);
    await page.getByTestId('sample-unique').click();
    await page.getByTestId('run-audit').click();
    await expectKind(page, 'unique');
    await page.getByTestId('pdelay-0-1').fill('13');
    if ((await page.getByTestId('verdict').count()) !== 0) throw new Error('旧裁决仍保留');
    await page.getByTestId('stale-hint').waitFor();
  });

  await t('导出-导入往返一致', async () => {
    await page.goto(base);
    await page.getByTestId('sample-unique').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-btn').click(),
    ]);
    const filePath = await download.path();
    if (!filePath) throw new Error('导出未产生文件');
    await page.getByTestId('sample-infeasible').click();
    await page.getByTestId('import-file').setInputFiles(filePath);
    await page.getByTestId('run-audit').click();
    await expectKind(page, 'unique');
  });

  await t('篡改观测数据后判定无可行解', async () => {
    await page.goto(base);
    await page.getByTestId('sample-multiple').click();
    await page.getByTestId('run-audit').click();
    await expectKind(page, 'multiple');
    // 把通道侧时延全部改成 0（容差 0 下必不可行）
    await page.getByTestId('sample-multiple').click();
    for (const [i, j] of [
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3],
    ]) {
      await page.getByTestId(`cdelay-${i}-${j}`).fill('0');
    }
    await page.getByTestId('run-audit').click();
    await expectKind(page, 'infeasible');
  });

  await browser.close();

  console.log('================ 验收结果 ================');
  for (const r of results) console.log(r);
  console.log('==========================================');
  if (failures > 0) {
    console.error(`${failures} 项验收失败`);
    process.exit(1);
  }
  console.log(`${results.length} 项验收全部通过`);
  process.exit(0);
}

main().catch((e) => {
  console.error('验收执行异常：', e);
  process.exit(1);
});
