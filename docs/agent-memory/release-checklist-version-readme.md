---
name: release-checklist-version-readme
description: 每次修改代码必须更新版本号+README，先测试后等确认推正式
metadata:
  type: feedback
  migrated_from: reasonix
  original_path: "%APPDATA%\\reasonix\\memory\\global\\release-checklist-version-readme.md"
---

**Why:** 用户明确要求每次代码修改必须做三件事。

**How to apply:** 每次代码修改后：
1. 更新 `client/src/version.ts`: APP_VERSION 递增 + BUILD_DATE 当天 + 版本历史注释
2. 更新 `README.md`: 版本变动记录顶部插入新条目，倒叙概述
3. 先 `deploy:test`，确认后等用户指令再 `deploy:prod`
