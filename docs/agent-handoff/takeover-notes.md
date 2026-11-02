# 项目接管交接说明（Reasonix → DeepSeek Harness）

> 交接日期：2026-10-26
> 交接原因：项目原由 **Reasonix agent**（DeepSeek Harness 之外的另一个 Agent harness）开发与维护，现移交至 **DeepSeek Harness（DSH）**。
> 本文档记录：**从哪里搬了什么、哪些搬不动、环境上与原来有什么不同、还有什么没做完。**

---

## 一、上一任 Agent 的资产在哪里（迁移来源）

Reasonix 的资产**不在项目目录内**，全部在用户级目录 `C:\Users\lizey\AppData\Roaming\reasonix\`，这是换了 harness 之后会「失忆」的根本原因。

| 资产 | 原始路径 | 性质 |
|------|---------|------|
| 全局记忆索引 | `memory\global\MEMORY.md` | 3 条记忆的索引 |
| 全局记忆正文 | `memory\global\*.md`（3 个文件） | 规则类记忆（feedback 型） |
| 项目注册表 | `desktop-projects.json` | 记录了 5 个项目的 root 与 topic |
| 会话历史 | `projects\d--jq_industries-04.claudecode-jqfactory\sessions\` | 主会话 jsonl 约 **2 MB / 2017 行 / 106 条用户消息**；另有 40+ 个子 agent 记录 |
| 会话附件 | `<项目>\.reasonix\attachments\` | 粘贴的图片/PDF、临时脚本 |
| 全局配置 | `config.toml` | 模型、权限、沙箱设置（与 DSH 不通用） |

**本项目在 Reasonix 里的会话跨度**：2026-07-23 → 2026-10-26（最后一次活动是"非线性度"提问）。

## 二、已搬运的内容（本仓库内）

| 目标文件 | 内容 | 状态 |
|---------|------|------|
| `AGENTS.md` | **项目规则总纲**，DSH 每次会话自动加载。含 3 条记忆提炼成的「铁律」+ 技术约束 + 环境坑 + 协议清单 + 当前状态 | ✅ 已完成 |
| `docs/agent-memory/README.md` | 迁移说明 + 记忆清单 + 为什么不用用户级 `~/.dsh/AGENTS.md` | ✅ 已完成 |
| `docs/agent-memory/deploy-prod-needs-confirmation.md` | 原记忆 1 原文（加 frontmatter 标注来源） | ✅ 原文保留 |
| `docs/agent-memory/release-checklist-version-readme.md` | 原记忆 2 原文 | ✅ 原文保留 |
| `docs/agent-memory/custrans-polish-tone-style.md` | 原记忆 3 原文（**属 CustTrans 项目，不适用本仓库**，仅存档） | ✅ 原文保留 |
| `docs/agent-handoff/codebase-drift-audit.md` | 相对 `docs/JQFactory-project-constraints.md`（v1.9.27 基线）的代码漂移审计 | ✅ 已完成 |

## 三、没有搬、也搬不干净的东西（⚠️ 需要知情）

1. **Reasonix 的 2 MB 会话历史没有导入 DSH。** DSH 有自己的会话存储（`C:\Users\lizey\.dsh\sessions\`），格式不同，不做迁移。
   - 这份历史仍完整保留在 `%APPDATA%\reasonix\projects\d--jq_industries-04.claudecode-jqfactory\sessions\`，**不要删除**——它是所有历史 bug 修复推理的唯一出处。
   - 需要时可以直接读原始 jsonl（UTF-8 按行 JSON），本次交接就是从里面还原出「最后在做什么」的。
2. **Reasonix 的 Plan/Executor 双模型协作、delivery-runtime 就绪校验等机制在 DSH 中不存在。** DSH 用 goal / todo / 子 agent 等另一套机制替代，不要照搬 Reasonix 的流程仪式。
3. **Reasonix 的记忆是「全局」的，而 DSH 的项目规则是「项目级」的。** 所以 3 条记忆有 2 条被落到了本仓库的 `AGENTS.md`，而不是 `~/.dsh/AGENTS.md`（理由见 `docs/agent-memory/README.md` §4）。若以后要接续 CustTrans，需要单独处理。
4. **`.reasonix/` 已被 `.gitignore` 忽略**，里面有本次「非线性度」任务的唯一实现脚本 `attachments/calc_nonlinearity.py`。**这是个风险**：一旦清理该目录，脚本就没了。见下文 §5 建议。

## 四、环境差异（在原 Reasonix 下能用、在 DSH 下要注意）

| 事项 | 现象 | 应对 |
|------|------|------|
| `pnpm` 调用 | DSH 的 PowerShell 执行策略为 Restricted，`pnpm` 直接调用报 `pnpm.ps1 cannot be loaded` | 一律用 `& pnpm.cmd ...`（已验证可用，pnpm 10.4.1） |
| `wrangler` 部署 | 沙箱下 `spawn EPERM`（wrangler 包一层 wrapper 再 spawn，esbuild 又要常驻子进程）；直接调 `wrangler-dist/cli.js` 也失败 | 部署需提升到 `danger-full-access` 后执行；**不要反复换写法重试** |
| `npx` | 同上，会写 npm 缓存 → EPERM | 用 `npx.cmd`，或在提权后执行 |
| 类型检查 | `& pnpm.cmd run check` 通过（已验证） | 改完代码必跑 |
| 会话上下文 | DSH 每次会话加载 `AGENTS.md`（约 13 KB） | 所以规则文件要保持精炼，细节放大 `docs/` 再用链接指过去 |

## 五、上一轮未完成的工作

### 5.1 明确未完成：「非线性度」指标落地

- **用户诉求**：「我们手套的曲线是 Hill 方程，我想知道这个曲线的非线性度是多少」。
- **已完成**：用实测参数 `a=103.0323 / b=7.7810 N / n=0.8277 / R²=0.9766` 做了离线数值计算，给出端基法 + 最佳拟合直线法两套结果（Pmax=20N 时约 **35 %FS**），并给出三点洞察（n=0.8277<1 负协同、n≈2 时非线性度最低、R² 高 ≠ 线性好）。
- **未完成**：把「非线性度」做成**前端面板自动指标**。用户当时被询问"要不要做成工具面板"，对话随即结束，**没有得到答复**。
- **若开工，改动点**：
  - `client/src/lib/hillFit.ts` — 新增 `computeNonlinearity(fit, pMax)`（在 `[0,pMax]` 采样的 Hill 曲线上做最小二乘直线拟合，取最大偏差 / 满量程）
  - `client/src/components/DataChart.tsx` — `HillFitPanel` 显示该值
  - 同文件 `generateExportJson()` / `generateLatex()` — 导出字段同步
  - `hill_fit_offline.py` — 与前端算法逐行对应，需同步
  - 走 `AGENTS.md` §1.2 三件事 + §1.1 部署流程

### 5.2 建议（尚未执行，等用户决定）

1. 把 `.reasonix/attachments/calc_nonlinearity.py` 移到仓库内（如 `scripts/calc_nonlinearity.py`）并提交，避免随 `.reasonix/` 被清理而丢失。
2. `__pycache__/hill_fit_offline.cpython-312.pyc` 目前**被 git 跟踪**，建议从索引移除并加进 `.gitignore`。
3. `docs/JQFactory-project-constraints.md` 仍是 **v1.9.27 基线**，已落后 11 个版本。建议按漂移审计结果更新，或直接标注「以 `AGENTS.md` 为准，本文件为历史参考」。

## 六、新接手者的工作方式（DSH 下）

1. **开工前先读** `AGENTS.md`（会自动注入）→ 需要细节再查 `docs/agent-handoff/codebase-drift-audit.md` 与 `docs/JQFactory-project-constraints.md`。
2. **改代码** → `& pnpm.cmd run check` → 更新 `version.ts` + `README.md` → commit & push → `deploy:test` → **问用户** → `deploy:prod`。
3. **不确定的取舍先问用户**，不要自作主张推正式环境。
4. 需要翻历史决策时，直接搜 Reasonix 的会话 jsonl（见 §3.1），那是唯一的一手记录。
