# AGENTS.md — JQFactory 项目规则

> **面向 AI Agent 的项目级规则文件。** 本文件由 DeepSeek Harness（DSH）在每次会话自动加载。
>
> - **来源**：迁移自上一任 Reasonix agent 的全局记忆（3 条，见 `docs/agent-memory/`）+ 项目约束文档 `docs/JQFactory-project-constraints.md`（已对齐 v1.9.40）。
> - **最后同步**：2026-11-03 | **对应代码版本**：`v1.9.40`
> - **维护约定**：规则变更直接改本文件；需要保留出处的历史决策放到 `docs/agent-memory/`。

---

## 0. 项目速览

**JQ Tools Factory** — 织物触觉传感器**出厂检测工具**。浏览器（Chrome/Edge 89+）通过 **Web Serial API 直连硬件**，无需安装本地软件。

| 维度 | 事实 |
|------|------|
| 定位 | 传感器出厂检测：一致性 / 重复性 / 耐久性 三种检测模式 |
| 前端 | React 19 + TypeScript 5.6 + Vite 7 + Tailwind CSS 4 + shadcn/ui (Radix) |
| 图表 | Recharts 2.x |
| 路由 | wouter 3.x（SPA，打补丁 `patches/wouter@3.7.1.patch`） |
| 硬件通信 | Web Serial API（浏览器原生），双串口独立角色：`force`（检测设备）/ `sensor`（传感器产品） |
| 包管理 | pnpm 10.4.1（lockfile 强制） |
| 部署 | Cloudflare Pages，**双环境**（test / prod） |
| 后台 | `server/index.ts` 仅做静态托管 + SPA fallback，**无后端业务逻辑、无数据库** |
| 认证 | **前端静态凭证匹配**（`client/src/config/clients.ts`），无 JWT、无服务端校验 |

**源码根**：`client/src/`。**构建 root**：`client/`（不是仓库根目录），产物输出 `dist/public/`。

---

## 1. 铁律（用户明确要求 · 最高优先级 · 不得变通）

### 1.1 正式环境部署必须先获用户明确确认

> 来源记忆：`deploy-prod-needs-confirmation`

每次改完代码后，**固定按此顺序**：

1. 自动执行 `pnpm run deploy:test` —— 测试环境，**无需询问**
2. **用提问工具明确询问用户**："是否部署正式环境？"
3. **仅在用户明确确认后**才执行 `pnpm run deploy:prod`
4. **绝不**在用户未确认的情况下自动推送正式环境

⚠️ 用户说过"可以推送正式版了"才算确认。**不要**把"部署到 test"或"修好了"理解为授权推正式。

### 1.2 每次改代码必做三件事

> 来源记忆：`release-checklist-version-readme`

1. **更新 `client/src/version.ts`**
   - `APP_VERSION` 递增（如 `v1.9.38` → `v1.9.39`）
   - `BUILD_DATE` 改为**当天**日期（`YYYY-MM-DD`）
   - 在文件头部大段注释的**版本历史末尾追加一行**：`* vX.Y.Z - 一句话概括改动`
2. **更新 `README.md`**
   - 在「版本变动记录」区域**顶部插入**新条目（**倒序，最新在最上**）
   - 格式照抄既有条目：标题 → `**类型：简短描述**` → 改动明细列表 → `**修改文件：**` 列表
3. **先 test，等确认，再 prod**

**纪律**：即使只改了一个版本号，也要重新部署；不能跳过测试直接推正式。

### 1.3 提交与推送

- commit message 前缀规范：`feat:` / `fix:` / `docs:` / `chore:` / `refactor:`
- 改完代码要 **commit 并 push 到 GitHub**，再部署
- 说明文字用中文或英文均可，但**变更本身要自解释**

### 1.4 保密要求

- **不要在代码注释 / README 中出现客户真实名称与登录凭证的曝光风险**，历史上有多次"redact client names/credentials"的提交。
- 客户账号密码在当前架构下是**前端明文**（架构限制，不是本次引入）。新增客户时沿用既有写法，但**不要在 README、注释、commit message 里复述密码**。

---

## 2. 本机环境注意事项（⚠️ 踩过的坑）

### 2.1 `pnpm` 必须用 `pnpm.cmd`

PowerShell 的脚本执行策略是 **Restricted**，直接写 `pnpm` 会报：

```
pnpm.ps1 cannot be loaded because running scripts is disabled on this system.
```

**正确写法**：`& pnpm.cmd run check` / `& pnpm.cmd run build`。同理 `npx` → `npx.cmd`。

### 2.2 Cloudflare 部署在收紧的沙箱下跑不起来

`wrangler` 的入口会 `spawn` 子进程（wrangler.js → `wrangler-dist/cli.js`；后者又需要 esbuild 常驻服务进程），在仅允许写工作区的沙箱模式下必然报 **`spawn EPERM`**。绕过包装器直接跑 `wrangler-dist/cli.js` 仍然失败（esbuild 层）。

**结论**：执行 `deploy:test` / `deploy:prod` / `build` 需要 `danger-full-access`。

**本机当前状态（2026-11-03）**：沙箱已设为 `danger-full-access` 且**审批提示已关闭**，上述命令可**直接执行**（`build` 与 `deploy:test` 均已实测通过）。⚠️ 因为审批被禁用，**不要再设置 `sandbox_permissions` 请求提权 —— 会被直接拒绝**。若将来沙箱被收窄回 `workspace-write` 并再次出现 `spawn EPERM`，只能请用户自行调整设置。

### 2.3 `git push` 有两个必须处理的问题（已实测）

**问题 1：`schannel` TLS 后端不可用，必须改用 openssl**

默认 `http.sslBackend=schannel`（Windows 原生 TLS）在本机环境下会失败：

```
schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS (0x8009030e)
```

连 `git ls-remote` 都跑不通。**解决：命令行临时覆盖后端**

```powershell
git -c http.sslBackend=openssl push origin master
```

已实测：同一命令换 openssl 后 `ls-remote` / `push` 均正常。

**问题 2：push 需要提升沙箱权限**

`credential.helper=manager`（Git Credential Manager）取凭证时会 spawn `sh.exe` + 管道，
在仅允许写工作区的沙箱下报：

```
fatal error - couldn't create signal pipe, Win32 error 5
fatal: could not read Username for 'https://github.com': terminal prompts disabled
```

**结论**：`git push` 需要 `danger-full-access`；`git add` / `git commit`（纯本地）不需要。

> 另注：仓库 `.git/config` 里配了本地代理 `http.proxy=http://127.0.0.1:7897`。
> 代理没开时 push 同样会失败 —— 先确认 7897 端口在监听。

### 2.4 其他

- Node **v24.15.0**，git **2.54.0**，可直接用。
- 类型检查：`& pnpm.cmd run check`（`tsc --noEmit`），当前**通过**。改完代码必须跑一次。
- `.manus-logs/` 是 vite 插件收集的**浏览器端日志**（开发时自动写入），不是构建产物。

---

## 3. 双环境部署（⚠️ `--branch` 极易搞错）

| 环境 | Cloudflare 项目名 | `--branch` | URL | 命令 |
|------|------------------|-----------|-----|------|
| 测试 | `jq-tools-factory-test` | **`main`** | https://jq-tools-factory-test.pages.dev | `pnpm run deploy:test` |
| 正式 | `jq-tools-factory` | **`master`** | https://jq-tools-factory.pages.dev | `pnpm run deploy:prod` |

- 两个项目**生产分支不同**：测试是 `main`，正式是 `master`。写反了不会更新到对应域名。
- 每个部署命令尾部都会跑 `node scripts/cleanup-deployments.js <项目名>`，自动删除旧部署，防止 Pages 部署配额累积。
- 部署后验证：`npx wrangler pages deployment list --project-name=jq-tools-factory --environment=production`
- Git 仓库分支名为 `master`（本地与远端一致）。

---

## 4. 数据流与状态管理（⚠️ 改 UI 前必读）

### 4.1 核心原则：高频数据永不进 React State

传感器最高 **100~300Hz**，压力计 **200Hz**。高频数据必须走**全局单例 + Ref**，UI 用低频定时器（50~100ms）批量刷新。

```
硬件串口 → useSerialPort(解析帧) → 全局单例管道(去重+分发)
                                        │
                                        ▼
                          Home.tsx SerialCtx (≈100ms 批量 UI 更新)
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
          ConsistencyPage      RepeatabilityPage        TestPage
                                        │
                                        ▼
                    DataChart（Hill 拟合 + SUM/AVG）
                                        │
                                        ▼
                    ConsistencyAnalysis（CV + 残差）
```

### 4.2 两个全局单例

```ts
import { getRealtimeDataPipeline } from '@/lib/realtimeDataPipeline'; // 主管道
import { getSensorDataStreamV2 }   from '@/lib/sensorDataStreamV2';   // 传感器专用流
```

- 写入**只允许在解析层**（`useSerialPort`）发生。
- 读取随处可调用，零渲染开销：`getCurrentSnapshot()` / `getLatestForce()` / `getLatestAdcValues()` / `getSensorFps()`。
- 帧去重：`computeFrameSignature()` 采样关键位置（四角+中心+对角线+首尾行和），同签名帧不触发通知。
- 每个订阅回调独立 try-catch（错误隔离）。

### 4.3 三条硬规则

| # | 规则 | 反面教材 |
|---|------|---------|
| 1 | **禁止在高频回调里 `setState`** | `subscribeForce(f => setForceN(f))` → 200Hz 渲染卡死 |
| 2 | **禁止用 `useEffect` 同步高频 props 到 ref** | 会延迟一帧；应直接 `ref.current = props.value`（组件顶层赋值） |
| 3 | **回调一律用 ref 代理** | `cbRef.current = fn;` + `useEffect(..., [])` 只注册一次。写成 `useEffect(..., [fn])` 会每次渲染重复注册事件 |

规则 2 曾导致 v1.8.6 数据延迟；规则 3 曾导致 v1.9.26 `insertBefore` DOM 崩溃。

### 4.4 Ref vs State 速查

| 用 Ref | 用 State |
|--------|---------|
| 高频传感器数据 / 采集缓冲区 | UI 显示状态（连接/断开） |
| 定时器 ID、串口 port/reader/writer | 采集计数显示 |
| 回调函数引用（防闭包过期） | 表单输入值 |

### 4.5 localStorage（跨页面共享状态，不走 Context）

| Key | 用途 | 存放处 |
|-----|------|-------|
| `jq_client_id` | 登录客户（**值是 JSON** `{"id":...}`，不是裸 id 字符串） | `ClientContext.tsx` |
| `selectedSensorPoints` | 矩阵选点 `["0_1","2_3"]` | 一致性页 |
| `handSelectedIndices` | 手形选点 `[1,5,7]` | 一致性页 |
| `matrixRows` / `matrixCols` | 矩阵尺寸 | 一致性页 |
| `consistencyPage_useHandLayout` | 一致性页 手掌/矩阵布局偏好 | 一致性页 |
| `testPage_useHandLayout` | 测试页 布局偏好 | `TestPage.tsx` |
| `testPage_handSelectedIndices` | 测试页 手形选点（**独立 key**，与一致性页**不再共享**） | `TestPage.tsx` |
| `durabilityPage_useHandLayout` | 耐久性页 布局偏好 | `DurabilityPage.tsx` |

写法：`useEffect` 监听 state → 写 localStorage；`useState` 初始化函数 → 读 localStorage。

⚠️ 注意分页 key 的演变：手形选点曾经跨页共享，现在已按页面拆分（`testPage_*`）。改这块时先确认你要的是"共享"还是"独立"。

---

## 5. 硬件与协议

### 5.1 检测设备（role = `force`，二选一）

| 设备 | 型号 | 默认波特率 | 协议 |
|------|------|-----------|------|
| 压力计 | CL2-500N-MH01 | 19200 | `0x23` + float32LE(4B) + `0x0A` = 6B；连接时发 CL2 初始化，断开发 STOP |
| 机械手 | 智元灵巧手 | 460800 | `EE AA` + deviceId(2B LE) + len + cmd + data + CRC16-CCITT；连接后自动发**使能**，断开发**失能** |

- 内部模式名：`forceDeviceMode = 'pressure' | 'robot'`。`robot` 模式**跳过**压力计初始化。
- 灵巧手控制协议实现在 `client/src/lib/omniHandProtocol.ts`。
- 另有一台 **Arduino 下压机**（9600，ASCII，发 `1` 触发下压），由 `PressController.tsx` 管理，与上面两个不是同一串口。

### 5.2 传感器产品（role = `sensor`，当前 8 种）

真源：`client/src/components/SerialConnectPanel.tsx` 的 `SENSOR_PRODUCTS`；协议分支在 `client/src/hooks/useSerialPort.ts` 的 `SensorProtocol`。

| 产品 label | sublabel | protocol | 矩阵 | 默认波特率 | 帧格式（总长） | 设备 ID |
|-----------|----------|----------|------|-----------|---------------|--------|
| 16×16 触觉传感器 | 织物触觉传感器 | `16x16` | 16×16 | 921600 | 双包：PKT01 **134B**（头4+`01`+id+128数据）+ PKT02 **150B**（头4+`02`+id+128数据+16陀螺） | PKT01 第 6 字节 |
| 机器人足底 16×16 | JQ-FOOT-16 (宇树G1) | `16x16`（**复用**） | 16×16 | 921600 | 同上一行双包协议 | `0x03` LF / `0x04` RF |
| 32×32 高密度传感器 | JQGY-YL-09 | `32x32` | 32×32 | 1000000 | 单帧 **1028B**（4 帧头 + **1024B** 数据域），需 `MATRIX_32X32_MAP` 重排，100Hz | **无该字节** → 合成 `'HD'`/`0xFF` |
| 灏存科技定制 | HC-16×16 | `custom_haocun` | 16×16 | 921600 | 单帧 **278B**（4 帧头 + 2 无效 + 256 数据 + 16 陀螺），200Hz | **无该字节** → 合成 `'HC'`/`0xFE` |
| 极智动量小黑采集板 | JZ-16×16 | `custom_jizhi` | 16×16 | 1000000 | 单帧 **262B**（4 帧头 + `01` + id + 256 数据），300Hz | 第 6 字节 |
| 灵心巧手 16×16 | LX-16×16 | `custom_lingxin` | 16×16 | 921600 | 单帧 **278B**（4 帧头 + `01` + 左右手 + 256 数据 + 16 四元数） | 第 6 字节（`0x01`LH/`0x02`RH） |
| 星尘科技 20×14 | XC-20×14 | `custom_xingchen` | **14 行 × 20 列**（280点，**非正方形**） | 921600 | 双包：PKT01 **146B**（4+`01`+id+140数据）+ PKT02 **162B**（4+`02`+id+140数据+16四元数），拼 280B | PKT01 第 6 字节 |
| 自适应 16×16 | AD-16×16 | `adaptive_16x16` | 16×16 | **自动探测** 921600/1000000/5000000/6000000 | **帧长自适应 8 种**：单包 262/278/298/314 B，双包 268/284/304/320 B（附加负载 0/16/36/52 = 无 / 四元数16 / 九轴36 / 两者） | PKT01 第 6 字节 |

⚠️ **32×32 的帧长是 1028B，不是 262B**（262B 是极智动量的）——两者都是"4 字节帧头 + 一大段数据"，极易混淆。

**设备 ID 映射**（`useSerialPort.ts` 的 `DEVICE_TYPE_MAP`）：

| id | 类型 | 说明 |
|----|------|------|
| `0x01` / `0x02` | LH / RH | 左 / 右手套 |
| `0x03` / `0x04` | LF / RF | 左 / 右足（机器人足底产品用） |
| `0x05` | WB | 全身 |
| `0xFE`（**合成**） | HC | 灏存定制，帧内无 deviceId 字节，解析器内写死 |
| `0xFF`（**合成**） | HD | 32×32 高密度，同上 |
| 其它 | `DEV_XX` | 未识别回退，如 `DEV_0A` |

**两条关键概念区分**：**「产品」≠「协议」**。机器人足底复用了 `16x16` 协议（只是设备 ID 不同）；反过来一个协议也可能对应多个产品。新增产品时先判断"能不能复用已有 protocol"。

### 5.3 客户账户与产品白名单

`client/src/config/clients.ts` —— 登录后按 `allowedProducts` 过滤传感器产品下拉列表。

| id | 名称 | 可见产品 |
|----|------|---------|
| `jq` | JQ 工业 | 16×16 触觉传感器、32×32 高密度传感器、机器人足底 16×16、自适应 16×16 |
| `haocun` | 灏存科技 | 灏存科技定制 |
| `jizhi` | 极智动量 | 极智动量小黑采集板 |
| `lingxin` | 灵心巧手 | 灵心巧手 16×16 |
| `xingchen` | 星尘科技 | 星尘科技 20×14 |

- `allowedProducts` 按 **label 全名精确匹配**（`p.label`），改产品 label 会导致对应客户看不到产品。
- **`force` 角色（检测设备）不受客户过滤**，只有 `sensor` 角色过滤。
- ⚠️ **没有"未登录也能用"这回事**：`App.tsx` 有登录闸门，未登录时整棵组件树被 `LoginPage` 替换，所以 `SerialConnectPanel` 里 `client === null` 的"显示全部产品"分支**实际不可达（死代码）**。别依赖它。

### 5.4 协议切换规则

⚠️ **协议必须在调用 `sensorSerial.connect()` 之前设置**。`sensorProtocol` 是 React state，切换它会改变读循环里的帧解析器。

### 5.5 新增传感器产品 Checklist

1. `SerialConnectPanel.tsx` → `SENSOR_PRODUCTS` 加一条（label / sublabel / defaultBaud / quickBauds / hint / matrixSize / `matrixCols` / protocol）
2. `useSerialPort.ts` → `SensorProtocol` 联合类型加值 + 读循环加帧解析分支
   - ⚠️ **能复用协议就别新开协议**：机器人足底产品完全复用 `16x16`，只靠设备 ID 区分，一行解析代码都没改
3. **非正方形矩阵**：必须同时设 `matrixCols`，并检查 `Home.tsx` 里 `sensorMatrixSize` / `sensorMatrixCols` 的推导逻辑（参考 `custom_xingchen` 的 14 行 × 20 列）
4. **帧内没有 deviceId 字节的产品**：在解析器内**合成**一个设备类型（先例：32×32 → `'HD'`/`0xFF`，灏存 → `'HC'`/`0xFE`），否则 UI 的设备类型显示会空
5. 若为新客户：`config/clients.ts` → `CLIENTS` 加账号 + `allowedProducts` 填**精确匹配的 label**
6. 走 §1.2 三件事 + §1.1 部署流程

### 5.6 `useSerialPort` 调用签名（⚠️ 老文档写错过）

```ts
// ✅ 正确：单对象参数，role 是 options 的一个字段
const forceSerial = useSerialPort({ role: 'force', deviceMode: 'pressure', onForceData, ... });

// ❌ 错误（旧文档写的是这样，编译不过）
useSerialPort('force', callbacks, options);
```

- `role` 只能是 `'force' | 'sensor'`；每个 role 在 `Home.tsx` 里**只允许创建一个实例**。
- 回调全部走 ref 代理。
- 帧解析共 **7 条路径**：`32x32` / `custom_haocun` / `custom_jizhi` / `custom_lingxin` / `custom_xingchen` / `adaptive_16x16` + `else` 兜底（16×16 双包）。**不存在**"单包动态长度"分支（旧文档虚构的）。
- `adaptive_16x16` 是唯一**帧长不固定**的协议：先靠 offset 134 是否有合法 PKT02 判定单包/双包，再在候选帧长处验证「下一帧起始」反推总长；识别成功后锁定帧长走快路径，失步丢 1 字节重同步（连续失步 60 次会打印一次诊断线索）。波特率传 `0` 时先探测（见 `ADAPTIVE_BAUD_CANDIDATES`），传具体值则跳过探测。
  - ⚠️ **候选帧长必须按结构穷举，不能照抄需求样例**：v1.9.39 只写了清单里的 5 种，漏掉 278/268/298 导致读不到数据（v1.9.40 修复）。完整集合 = 单包 `262/278/298/314` + 双包 `268/284/304/320`。

### 5.7 Hill 拟合引擎能力（`client/src/lib/hillFit.ts`，599 行）

- **正向拟合** `fitHill` → `HillFitResult = { a, b, n, rmse, r2, method: 'hill' | 'hyperbolic' | 'fallback' }`
- **反向拟合** `fitInverseHill`（ADC → 压力）→ `InvHillFitResult = { Vmax, K, n, rmse, r2, method }`，配套 `invHillFunc` / `generateInvFitCurve`
- 算法：Levenberg-Marquardt 非线性最小二乘
- ⚠️ **当前不存在"非线性度 / 线性度误差"指标**。若要加，见 §10。

---

## 6. 代码规范

- **路径别名**：`@/*` → `client/src/*`，`@shared/*` → `shared/*`（tsconfig 与 vite 都要一致）
- **命名**：组件 PascalCase / Hook `useXxx` camelCase / lib 模块 camelCase / `ui/` 下 kebab-case 文件名导出 PascalCase 组件 / 全局单例获取函数 `getXxx()` / Ref 变量 `xxxRef` / 事件处理 `handleVerb`
- **颜色**：**新增**颜色一律用 **oklch()** 色彩空间（历史遗留例外：`SerialConnectPanel.tsx` 里仍有 `#16213e` / `#e0e0e0` 两处 hex，未清理）
- **字体**：界面 `'IBM Plex Sans'`；数据/代码用 `'IBM Plex Mono', monospace`
- **TS**：`strict: true`，`moduleResolution: "bundler"`，`jsx: "preserve"`
- **文件下载**：临时 `<a>` + Blob URL + `revokeObjectURL`（照抄既有 `downloadFile()`）
- **剪贴板**：优先 `navigator.clipboard.writeText()`，fallback `document.execCommand('copy')`
- **CSV 导出**：Excel 兼容必须在表头加 **BOM `\ufeff`**
- **错误隔离**：每个订阅回调独立 try-catch，单个订阅者崩溃不能影响其他
- 格式化：`pnpm run format`（Prettier）

---

## 7. 禁止事项速查（❌）与必须事项（✅）

❌ 高频回调里 `setState`
❌ 用 `useEffect` 同步高频 props 到 ref（直接赋值）
❌ `useEffect` 依赖数组漏项 → 每次渲染重复注册监听
❌ 用 `--branch=main` 部署**正式**环境（正式是 `master`）
❌ 跳过测试环境直接推正式
❌ 忘记更新 `version.ts` 和 `README.md`
❌ 在注释/README/commit 里复述客户密码
❌ 在 `sensorSerial.connect()` 之后再改协议
❌ 把 `useSerialPort` 当成三参数函数调用（是单对象参数）
❌ 把 32×32 的帧长记成 262B（是 1028B）
❌ 改动 `SENSOR_PRODUCTS` 的 `label` 而不检查 `clients.ts` 的 `allowedProducts`

✅ 高频数据走全局单例 + Ref
✅ 回调用 ref 代理（`cbRef.current = fn` + `useEffect(..., [])`）
✅ 文件下载用 `<a>` + Blob URL
✅ 颜色用 oklch
✅ 订阅回调 try-catch 包裹
✅ 改完跑 `& pnpm.cmd run check`

---

## 8. 已知技术债（改到相关区域时留意）

**超大文件**（改之前先想清楚影响面）：

| 文件 | 行数 |
|------|------|
| `pages/ConsistencyPage.tsx` | **1167** ⚠ 全项目最大（下压机循环 + CSV 解析 + 拖拽 + 图表编排全塞在一起） |
| `components/DataChart.tsx` | **1085** ⚠ 散点图 + Hill 面板 + SUM/AVG + 降采样 |
| `hooks/useSerialPort.ts` | **1009** ⚠ 7 条协议分支 + 32×32 映射表 |
| `pages/DurabilityPage.tsx` | **972** |
| `components/SensorMatrix.tsx` | **831** |
| `components/ConsistencyAnalysis.tsx` | **735** |
| `components/OmniHandControl.tsx` | **692** |
| `lib/hillFit.ts` | **599** |

**结构性问题**：

1. `RealtimeDataPipeline` 与 `SensorDataStreamV2` 功能重叠（都是 pub/sub），可合并但**不要顺手重构**——改动面太大。
2. `serialDriver.ts`（CL2 压力计旧驱动，397 行）与 `useSerialPort.ts` 功能重叠。
3. CSV 解析逻辑在 `ConsistencyPage` 与 `RepeatabilityPage` 中重复（两页都各有一份 `processCSVFiles`）。
4. `shared/` 目录**完全为空**（0 文件），`@shared` 别名目前指向空目录。
5. **无任何单元测试**（`vitest` 已装但零测试文件）。
6. `__pycache__/hill_fit_offline.cpython-312.pyc` 被 git 跟踪（应移出索引）。
7. `version.ts` 的版本历史注释**有断层**：从 v1.9.8 跳到 v1.9.26，v1.9.9–v1.9.25（17 个版本）无注释；**v1.9.27 只在 README 里有，`version.ts` 注释中缺失**。所以「以 version.ts 注释为准」是不成立的，完整历史看 `README.md`。
8. 部署用的 `wrangler` **不是项目依赖**，靠 `npx` 临时拉取（`package.json` 里没有 wrangler）。版本不可控。

---

## 9. 文档地图（先看哪里）

| 想看什么 | 去哪 |
|---------|------|
| **Agent 规则**（本文件） | `AGENTS.md` |
| 上一任 agent 的原始记忆 | `docs/agent-memory/` |
| 部署约束 / 数据流 / 导出逻辑 / 状态管理详解 | `docs/JQFactory-project-constraints.md`（**已对齐 v1.9.40，全文不引用行号**） |
| 相对约束文档的**代码漂移审计** | `docs/agent-handoff/codebase-drift-audit.md` |
| 版本变动全部历史 | `README.md` 的「版本变动记录」（倒序） |
| 版本号 + 构建日期 | `client/src/version.ts` |
| 产品使用说明（人看） | `PROJECT_DOCUMENTATION.md`、`docs/User_Manual.md` |
| 灵巧手 / 传感器连接配置 | `omni_hand_sensor_connection_guide.md` |
| 历史代码审查与优化记录 | `optimization-report.md` |

---

## 10. 当前状态（交接快照 · 2026-11-03）

- **代码版本**：`v1.9.40`（`BUILD_DATE` = 2026-11-03）。
- **部署状态**：`v1.9.40` **已在测试环境**上线（source commit `aae9c11`），待用户接真机复验。**正式环境仍是 `v1.9.38`**。
  （v1.9.39 曾上线测试但读不到数据 —— 候选帧长漏了 278/268/298，v1.9.40 已修复。）
- **最近完成**：修复自适应 16×16 帧长漏识别（v1.9.40）、自适应 16×16 产品（v1.9.39）、SUM/AVG 切换联动 CV（v1.9.38）、图表区拖拽 CSV（v1.9.37）、机器人足底产品（v1.9.36）。
- **下一步待办**：等用户接真机复验 `v1.9.40`。通过后 `deploy:prod`；若仍读不到数据，让用户提供控制台的失步诊断日志（会打印前 64 字节十六进制）。
- **Git**：分支 `master`，本地与远端保持同步。**最新提交请看 `git log -1`**（此处不写死 SHA，避免过期）。

### 10.1 上一轮未竟事项：「非线性度」指标

用户诉求：**「我们手套的曲线是 Hill 方程，我想知道这个曲线的非线性度是多少」**。

**已完成（离线计算，未进代码）**：用实测参数 `a=103.0323 / b=7.7810 N / n=0.8277 / R²=0.9766` 算出端基法与最佳拟合直线法两套结果：

| Pmax | 端基法 | 最佳拟合直线法 |
|------|--------|---------------|
| 10 N | 26.74 %FS | 25.20 %FS |
| **20 N** | **35.08 %FS** | **34.31 %FS** |
| 30 N | 40.47 %FS | 40.52 %FS |
| 50 N | 47.49 %FS | 48.88 %FS |

三点结论：① `n=0.8277 < 1` → 负协同，最大偏差在 P≈6N（半饱和点附近）；② n 与非线性度非单调，`n≈2` 时非线性度最低（20N 下 16~22 %FS）；③ **R² 高 ≠ 线性好**（R² 衡量曲线贴合度，非线性度衡量偏离直线的程度）。

**未完成**：把「非线性度」做成**前端面板自动指标**。当时询问"要不要做成工具面板"后对话结束，**用户还没答复过**。

**若开工，改动点**：
1. `client/src/lib/hillFit.ts` → 新增 `computeNonlinearity(fit, pMax)`：在 `[0,pMax]` 上采样 Hill 曲线 → 对采样点做最小二乘直线拟合 → `max|y_hill − y_line| / FS × 100%`
2. `client/src/components/DataChart.tsx` → `HillFitPanel` 显示该值
3. 同文件 `generateExportJson()` / `generateLatex()` → 导出字段同步
4. `hill_fit_offline.py` → 与前端算法逐行对应，需同步（`sensor_hill_fit.py` 的 GUI 也建议同步）
5. 走 §1.2 三件事 + §1.1 部署流程

⚠️ **风险提示**：那次计算的脚本 `calc_nonlinearity.py` 落在 `.reasonix/attachments/` 里，而 `.reasonix/` 是 **gitignore 的**。一旦清理该目录脚本就没了。要做这个功能，先把脚本挪进仓库（如 `scripts/calc_nonlinearity.py`）并提交。

### 10.2 决策记录（2026-11-02 用户已拍板）

| # | 事项 | 用户决定 | 后续怎么做 |
|---|------|---------|-----------|
| 1 | 「非线性度」做成前端指标（v1.9.39） | **暂不做**（选 C） | ⛔ **不要再主动问**。用户明确说了"需要非线性度时会主动提"。§10.1 已留全部公式、实测参数与结果表，真要做时照它落地即可。 |
| 2 | `docs/JQFactory-project-constraints.md` 落后 11 个版本 | **先选 C（不动），后改为 B（全面更新）** | ✅ **已于 2026-11-02 按审计结果重写到 v1.9.38 基线**。全文改为「文件路径 + 符号名」定位，**不再引用行号**（行号正是上一版失效的主因）。两份文档分工：`AGENTS.md` = Agent 规则总纲，约束文档 = 详细技术参考。 |
| 3 | `calc_nonlinearity.py` 在 gitignore 目录里 | **不挪**（随 #1 一同搁置） | 风险已可接受：§10.1 已完整记录算法、参数与结果，脚本丢了也能重建。**注意：不要清理 `.reasonix/` 目录**。 |

**仍然开放（用户尚未表态）**：

| # | 事项 | 建议 |
|---|------|------|
| 4 | `__pycache__/*.pyc` 被 git 跟踪 | `git rm --cached` + 加入 `.gitignore` |
| 5 | 部署需提权才能跑 wrangler | 接受每次提权；或把 `wrangler` 加进 devDependencies 以固定版本 |
