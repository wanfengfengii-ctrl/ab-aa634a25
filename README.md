# 水听器阵列布线复核台

水下声学阵列检修后，水听器通道可能被**交叉换插**或**反接**。逐对挑选最接近的时延会得到
彼此矛盾的布线结论；本工具把问题一次性建模为全局双射 + 极性指派，在浏览器内完成精确审计，
**全程不调用任何业务后端**。

## 审计模型

设安装点为 `P0..P(n-1)`、采集通道为 `C0..C(n-1)`，工程师输入：

- 4–14 个**唯一**安装点编号与等量（4–14 个）**唯一**采集通道编号；
- 安装点侧、通道侧各自每一个**无序点对**的：有向整数时延（端点 a→b）与相关符号（+1/−1）；
- 非负整数时延容差。

求解决策：

- `f`：安装点 → 采集通道的**双射**；
- `p[u] ∈ {+1, −1}`：安装点 `u` 所接通道的接线极性（正接/反接）。

对每个安装点侧无序点对 `(u,v)`（u<v），时延按端点方向规范化为期望 `d(u→v)`；映射后通道点对
`(f(u),f(v))` 的实测时延按 `f(u)→f(v)` 方向规范化为 `d'`。合法解须同时满足：

1. 通道侧存在该无序点对；
2. `|d' − d| ≤ 容差`；
3. 相关符号一致：`s(安装) · p[u] · p[v] = s'(通道)`。

**唯一目标**：全部点对时延绝对误差之和 `Σ|d' − d|` 最小。

裁决为四态之一：**输入无效 / 无可行解 / 唯一最优 / 多解最优**。多解时按安装点编号顺序、
通道名字字典序返回最小的两份映射与极性。极性说明：所有符号约束只涉及两端极性之积，
整体翻转极性不可观测，故编号最小安装点的极性固定为 `+1` 作为规范代表；约束图不连通时
其余连通分量仍可翻转，照样计入多解。

算法：分支定界（MRV + 位掩码弧相容传播 + Kuhn/Hall 完美匹配前向剪枝 + 匈牙利指派与
Gilmore–Lawler 风格下界 + 奇偶并查集符号剪枝），两阶段分别求最优成本与字典序前两份见证；
求解结果经 84 组随机实例对拍暴力枚举验证。设有节点/时间上限，极端情况下会明确报告
“未能完整判定”而不伪造结论。

## 本地开发

```bash
npm install
npm run dev        # 开发服务器 http://localhost:5173
npm test           # 单元/UI 测试（含暴力对拍）
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview    # 本地预览生产产物
```

## Docker 运行

```bash
# 宿主机端口可用 HOST_PORT 配置（默认 8080）
HOST_PORT=9090 docker compose up -d --build web
# 打开 http://localhost:9090
```

Web 容器为 nginx 静态站点，带 `/healthz` 健康检查（Compose 与 Dockerfile 内均配置）。

## 一次性浏览器验收服务

`verify` 是**一次性**服务：等待 `web` 健康后，用 Playwright/Chromium 在真实浏览器内完成
27 项验收（四种裁决、双见证切换、逐对期望/实测/误差展示、改输入即作废旧裁决、JSON 导入、
全程无跨源业务后端请求），随后**自行退出并以退出码报告结果**（0 成功 / 1 失败），
可直接用于 CI：

```bash
docker compose build
docker compose run --rm verify     # 推荐：verify 容器退出码原样返回给 shell
# 或一次性带日志运行（web 与 verify 都会启动）：
# docker compose up --build --abort-on-container-exit --exit-code-from verify verify
```

```bash
npm ci && npx playwright install --with-deps chromium
npm run build && npm run preview &
BASE_URL=http://localhost:4173 npm run verify
```

## 数据格式（可导入 / 导出 JSON）

```json
{
  "pointNames": ["P1", "P2", "P3", "P4"],
  "channelNames": ["C1", "C2", "C3", "C4"],
  "installPairs": [
    { "a": "P1", "b": "P2", "delay": 10, "sign": 1 }
  ],
  "channelPairs": [
    { "a": "C1", "b": "C3", "delay": 10, "sign": -1 }
  ],
  "tolerance": 2
}
```

点对为无序点对，`delay` 是按记录方向 `a→b` 的有向整数时延（反向录入会自动按端点方向
规范化，相关符号不随时延翻转而变号）；`sign` 只能是 `1` 或 `-1`。

## 目录结构

```
src/
  types.ts     类型定义
  validate.ts  完整输入校验与规范化
  solver.ts    分支定界精确求解器
  audit.ts     审计编排（校验 → 求解 → 四态裁决）
  App.tsx      复核台界面（编辑 / 导入导出 / 审计 / 双见证）
scripts/acceptance.mjs  Playwright 浏览器验收（一次性，退出码报告）
test/            Vitest 单元、对拍、UI 测试
Dockerfile           nginx 静态 Web（含 HEALTHCHECK）
Dockerfile.verify    Node + Chromium 的一次性验收镜像
docker-compose.yml   web 服务 + verify 一次性服务
```
