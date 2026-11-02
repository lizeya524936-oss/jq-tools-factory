---
name: deploy-prod-needs-confirmation
description: 部署正式环境前必须先让用户确认，不可自动推送 prod
metadata:
  type: feedback
  migrated_from: reasonix
  original_path: "%APPDATA%\\reasonix\\memory\\global\\deploy-prod-needs-confirmation.md"
---

**Why:** 用户要求部署正式环境前必须等他明确确认，不可自动推送。

**How to apply:** 每次完成代码修改后：
1. 自动执行 `pnpm run deploy:test`（测试环境无需确认）
2. 用 `ask` 工具询问"是否部署正式环境？"
3. **仅当用户明确确认后**才执行 `pnpm run deploy:prod`
4. 绝不在用户未确认的情况下自动部署正式环境
