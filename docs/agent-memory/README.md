# Agent 记忆归档（从 Reasonix 迁移）

> 迁移日期：2026-10-26
> 迁移来源：Reasonix Desktop 的全局记忆库 `%APPDATA%\reasonix\memory\global\`
> 迁移去向：可执行规则已提炼进项目根目录 [`AGENTS.md`](../../AGENTS.md)；此处保留**原始记忆文件**作为可追溯存档。

## 一、迁移说明

Reasonix 的记忆库采用「`MEMORY.md` 索引 + 一条记忆一个 `.md` 文件」的结构，全部存放在**用户级全局目录**（不是项目目录内），因此：

- 换 harness（Agent 框架）后**不会自动继承**；
- 新 harness（DeepSeek Harness / DSH）通过项目根目录的 `AGENTS.md` 加载项目规则，故需显式搬运。

本次搬运共 3 条记忆，其中 **2 条属于本项目的硬性规则**，已写入 `AGENTS.md` 第 1 章「铁律」；第 3 条属于**另一个项目（CustTrans）**，仅作存档，不适用于本项目。

## 二、记忆清单

| # | 记忆文件 | 归属 | 已提炼进 AGENTS.md | 说明 |
|---|---------|------|-------------------|------|
| 1 | [`deploy-prod-needs-confirmation.md`](deploy-prod-needs-confirmation.md) | JQFactory ✅ | 是（§1.1） | 部署正式环境前必须先获用户确认，不可自动推 prod |
| 2 | [`release-checklist-version-readme.md`](release-checklist-version-readme.md) | JQFactory ✅ | 是（§1.2） | 每次改代码必须更新版本号 + README，先测试后等确认推正式 |
| 3 | [`custrans-polish-tone-style.md`](custrans-polish-tone-style.md) | CustTrans ❌ | 否（不适用） | Albert 英文邮件润色的语气/态度/角度风格 — 与本项目无关 |

## 三、原始 MEMORY.md 索引

迁移时 Reasonix 的索引文件内容如下（原样保留）：

```markdown
# Memory

- [deploy prod needs confirmation](deploy-prod-needs-confirmation.md) — 部署正式环境前必须先让用户确认，不可自动推送 prod

- [release checklist version readme](release-checklist-version-readme.md) — 每次修改代码必须更新版本号+README，先测试后等确认推正式

- [CustTrans 润色语气风格](custrans-polish-tone-style.md) — Albert 英文邮件润色的语气风格/说话态度/说话角度（卖方主动回访+顺势推介，温暖专业、不施压）
```

## 四、为什么不用 `~/.dsh/AGENTS.md`（用户级）

DSH 也支持用户级指令文件 `$DSH_HOME/AGENTS.md`（本机为 `C:\Users\lizey\.dsh\AGENTS.md`），会注入到**所有**项目的对话。但以上 2 条 JQFactory 规则的正文都绑定本项目的 `pnpm run deploy:test` / `deploy:prod` 脚本与 Cloudflare 项目名，放到用户级会污染其他项目（例如 CustTrans 的部署方式完全不同）。因此本项目的规则一律放在**项目级** `AGENTS.md`。

若以后出现真正跨项目的通用偏好（例如"回答用中文"、"不要自动 git push"），再写入 `~/.dsh/AGENTS.md`。

## 五、后续如何维护记忆

- **正在生效的规则** → 直接改项目根 `AGENTS.md`（DSH 每次会话自动加载，改完下次读取即生效）。
- **需要保留出处的历史决策** → 在本目录新增一个 `.md`，并在上面「记忆清单」表格补一行。
- 不要把"临时任务进度"写进本目录 — 进度应写进 `docs/agent-handoff/` 或在对话中跟踪。
