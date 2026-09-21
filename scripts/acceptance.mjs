#!/usr/bin/env node
/**
 * 浏览器端验收（一次性服务 verify 运行）。
 * 连接 BASE_URL（默认 http://localhost:8080），用 Playwright/Chromium 执行真实浏览器操作，
 * 全部通过则以退出码 0 退出；任何失败打印原因并以退出码 1 退出。
 */
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const checks = [];
function check(name, cond, detail = '') {
  if (!cond) throw new Error(`验收失败：${name}${detail ? `（${detail}）` : ''}`);
  checks.push(name);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForVerdict(page, expected, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await page.getAttribute('[data-testid="verdict-banner"]', 'data-verdict').catch(() => null);
    if (v) {
      if (expected ? v === expected : true) return v;
    }
    await sleep(100);
  }
  throw new Error(`等待裁决 ${expected} 超时`);
}

async function runAudit(page) {
  await page.click('[data-testid="run-audit"]');
}

async function mappingTexts(page) {
  return page.$$eval('[data-testid^="mapping-row-"]', (els) => els.map((e) => e.textContent));
}

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();

  // 记录所有网络请求：本应用为纯前端，除同源静态资源外不得有任何业务后端调用
  const externalRequests = [];
  const origin = new URL(BASE_URL).origin;
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) {
      externalRequests.push(`${req.method()} ${url}`);
    }
  });

  // 0. 页面加载
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  check('页面可访问且标题正确', (await page.title()).includes('水听器阵列布线复核台'));
  check('输入面板渲染', (await page.$('[data-testid="input-panel"]')) !== null);
  check('结果面板渲染', (await page.$('[data-testid="result-panel"]')) !== null);
  check('安装点数量在 4–14 之间', (await page.$$('[data-testid^="point-name-"]')).length === 4);

  // 1. 默认示例（交叉 + 反接）→ 唯一最优
  await runAudit(page);
  let verdict = await waitForVerdict(page, 'unique');
  check('默认示例裁决为唯一最优', verdict === 'unique');
  check('最优总成本为 0', (await page.textContent('[data-testid="total-cost"]')).trim() === '0');
  let texts = await mappingTexts(page);
  check('P1 → C1', texts[0].includes('P1') && texts[0].includes('C1'), texts[0]);
  check('P2 → C3（识别交叉换插）', texts[1].includes('P2') && texts[1].includes('C3'), texts[1]);
  check('P3 → C2（识别交叉换插）', texts[2].includes('P3') && texts[2].includes('C2'), texts[2]);
  check('P4 → C4', texts[3].includes('P4') && texts[3].includes('C4'), texts[3]);
  check('P4 判为反接', (await page.textContent('[data-testid="polarity-3"]')).includes('反接'));
  // 逐对期望/实测/误差
  const errTexts = await page.$$eval('[data-testid^="error-"]', (els) => els.map((e) => e.textContent));
  check('每对误差均为 0', errTexts.every((t) => t.trim() === '0'), errTexts.join(','));
  check(
    '绝对误差之和为 0',
    (await page.textContent('[data-testid="sum-errors"]')).trim() === '0',
  );
  check('每行符号一致标记', await page.locator('text=✓').count() >= 6);

  // 2. 对称示例 → 多解最优，两份字典序见证可切换
  await page.click('[data-testid="sample-multiple"]');
  await runAudit(page);
  verdict = await waitForVerdict(page, 'multiple');
  check('对称示例裁决为多解最优', verdict === 'multiple');
  check('存在两个见证页签', (await page.$('[data-testid="witness-tab-0"]')) !== null
    && (await page.$('[data-testid="witness-tab-1"]')) !== null);
  texts = await mappingTexts(page);
  check('见证1：P2 → C2', texts[1].includes('C2'), texts[1]);
  await page.click('[data-testid="witness-tab-1"]');
  texts = await mappingTexts(page);
  check('见证2：P2 → C3、P3 → C2', texts[1].includes('C3') && texts[2].includes('C2'), `${texts[1]} | ${texts[2]}`);
  await page.click('[data-testid="witness-tab-0"]');

  // 3. 无可行解示例
  await page.click('[data-testid="sample-infeasible"]');
  await runAudit(page);
  verdict = await waitForVerdict(page, 'infeasible');
  check('缺边示例裁决为无可行解', verdict === 'infeasible');
  check('无可行解时不展示见证', (await page.$('[data-testid="witness-panel"]')) === null);

  // 4. 输入无效：删除一个安装点（数量变为 3）
  const delButtons = await page.$$('button[aria-label^="删除第"]');
  await delButtons[0].click();
  await runAudit(page);
  verdict = await waitForVerdict(page, 'invalid');
  check('数量越界裁决为输入无效', verdict === 'invalid');
  const invalidText = await page.textContent('[data-testid="invalid-errors"]');
  check('列出 4–14 数量原因', invalidText.includes('4') && invalidText.includes('14'), invalidText);

  // 5. 修改输入立即作废旧裁决
  await page.click('[data-testid="sample-unique"]');
  await runAudit(page);
  await waitForVerdict(page, 'unique');
  await page.fill('[data-testid="tolerance"]', '77');
  await sleep(150);
  check('修改容差后旧裁决被作废', (await page.$('[data-testid="verdict-banner"]')) === null);
  check('旧见证同时被清除', (await page.$('[data-testid="witness-panel"]')) === null);

  // 6. JSON 导入 → 唯一最优
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
  await page.click('[data-testid="open-import"]');
  await page.fill('[data-testid="import-json"]', JSON.stringify(payload));
  await page.click('[data-testid="apply-import"]');
  await runAudit(page);
  verdict = await waitForVerdict(page, 'unique');
  check('JSON 导入后裁决唯一最优', verdict === 'unique');
  texts = await mappingTexts(page);
  check('导入用例恢复 A1 → D1', texts[0].includes('A1') && texts[0].includes('D1'), texts[0]);

  // 7. 全程无跨源（业务后端）请求
  check('全程未调用任何业务后端（无跨源请求）', externalRequests.length === 0, externalRequests.join('; '));

  await browser.close();
  console.log(`\n浏览器验收全部通过（${checks.length} 项）：`);
  checks.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
  process.exit(0);
}

main().catch((e) => {
  console.error('\n浏览器验收失败：', e.message);
  process.exit(1);
});
