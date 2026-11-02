# JQFactory 项目约束与核心逻辑文档

> **代码基线**：`v1.9.38`（`BUILD_DATE` = 2026-10-10） | **整理日期**：2026-11-02
> **用途**：程序融合参考 —— 部署约束、数据流规则、上传/导出逻辑、状态管理模式

**与 `AGENTS.md` 的关系**：根目录的 `AGENTS.md` 是 **Agent 每次会话自动加载的规则总纲**（含铁律、环境坑、交接快照）；本文是**详细技术参考**。两者冲突时，以 `AGENTS.md` + 实际代码为准。

**本次修订说明（v1.9.27 → v1.9.38）**：

- 全文对照代码逐文件核对后重写，修正 26 项漂移（详见 `docs/agent-handoff/codebase-drift-audit.md`）。
- ⚠️ **本版起全文不再引用行号**。上一版失效的主因就是大量 `file.tsx:123-456` 引用随代码改动全部错位，甚至指向了无关逻辑。本版一律改用 **「文件路径 + 符号名（函数 / 常量 / 类型名）」** 定位。用 `Ctrl+Shift+F` 搜符号名比跳行号可靠。
- 只有少量「体量参考」性质的行数，且已标注会漂移。

---

## 一、项目概览

| 维度 | 说明 |
|------|------|
| **定位** | 织物触觉传感器出厂检测工具，浏览器内直连硬件设备 |
| **技术栈** | React 19 + TypeScript 5.6 + Vite 7 + Tailwind CSS 4 + shadcn/ui (Radix) |
| **图表** | Recharts 2.x |
| **硬件通信** | Web Serial API（浏览器原生，Chrome/Edge 89+，必须顶层窗口，不能在 iframe） |
| **路由** | wouter 3.x（轻量 SPA，打补丁 `patches/wouter@3.7.1.patch`） |
| **包管理** | pnpm 10.4.1（lockfile 强制） |
| **后台** | `server/index.ts` 仅静态托管 + SPA fallback（约 33 行），**无业务逻辑、无数据库** |
| **认证** | 前端静态凭证匹配（`client/src/config/clients.ts`），**无 JWT、无服务端校验** |
| **部署** | Cloudflare Pages，双环境（test / prod） |

**源码根**：`client/src/`。**构建 root**：`client/`（注意不是仓库根目录），产物输出 `dist/public/`。

---

## 二、部署约束（⚠️ 关键规则）

> 本章到上一版为止是**唯一零漂移**的章节，与 `package.json` 的 scripts 逐字一致，保持不变。

### 2.1 两个 Cloudflare Pages 项目

| 环境 | 项目名 | 分支 | URL | deploy 命令 |
|------|--------|------|-----|-------------|
| 测试 | `jq-tools-factory-test` | `main` | https://jq-tools-factory-test.pages.dev | `pnpm run deploy:test` |
| 正式 | `jq-tools-factory` | `master` | https://jq-tools-factory.pages.dev | `pnpm run deploy:prod` |

**⚠️ `--branch` 参数必须匹配项目对应的生产分支！** 测试用 `main`，正式用 `master`。写反了不会更新到目标域名。

### 2.2 部署命令（`package.json` 的 `scripts`）

```json
"deploy:test": "pnpm run build && npx wrangler pages deploy dist/public --project-name=jq-tools-factory-test --branch=main && node scripts/cleanup-deployments.js jq-tools-factory-test"
"deploy:prod": "pnpm run build && npx wrangler pages deploy dist/public --project-name=jq-tools-factory --branch=master && node scripts/cleanup-deployments.js jq-tools-factory"
```

### 2.3 部署后验证

```bash
npx wrangler pages deployment list --project-name=jq-tools-factory --environment=production
```

### 2.4 发布流程（强制，不可跳过）

1. **更新版本号**：改 `client/src/version.ts`，递增 `APP_VERSION`（如 v1.9.38 → v1.9.39），更新 `BUILD_DATE`
2. **更新 README.md**：在「版本变动记录」区域**顶部**添加新条目（时间倒序，最新在最上）
3. **提交并推送**：commit message 用 `feat/fix/chore/docs:` 前缀，push 到 GitHub
4. **部署测试**：`pnpm run deploy:test`
5. **确认用户**：明确询问是否需要推送正式
6. **部署正式**：**仅在用户确认后** `pnpm run deploy:prod`
7. **验证**：`npx wrangler pages deployment list` 确认最新 commit 已上线

**纪律**：不能跳过测试直接推正式；每次推送都要更新版本号和 README；即使只改了版本号也要重新部署。

> **执行环境注意**：本机 PowerShell 执行策略为 Restricted，`pnpm` / `npx` 需写成 `pnpm.cmd` / `npx.cmd`；
> `wrangler` 需要提升沙箱权限才能 spawn 子进程。详见 `AGENTS.md` §2。

---

## 三、构建配置约束

### 3.1 路径别名（`tsconfig.json` 与 `vite.config.ts` 必须一致）

```jsonc
// tsconfig.json → compilerOptions.paths
"@/*":       ["./client/src/*"],
"@shared/*": ["./shared/*"]
```

```ts
// vite.config.ts → resolve.alias
"@":       path.resolve(import.meta.dirname, "client", "src"),
"@shared": path.resolve(import.meta.dirname, "shared"),
"@assets": path.resolve(import.meta.dirname, "attached_assets"),
```

> 注：`@assets` 只在 vite 里配了，tsconfig 里没有。

### 3.2 Vite 特殊配置

- **root**：`client/`（不是项目根目录）
- **outDir**：`dist/public/`
- **产物命名**：`assets/[name]-[hash]-${Date.now()}.js`（带时间戳防缓存）
- **dev server**：port 3000（`strictPort: false`，占用时自动递增），`host: true`
- **allowedHosts**：`.manuspre.computer` / `.manus.computer` / `.manus-asia.computer` / `.manuscomputer.ai` / `.manusvm.computer` / `localhost` / `127.0.0.1`
- **自定义插件**：`vitePluginManusRuntime()` 与 `vitePluginManusDebugCollector()`
  - 后者在开发时向页面注入 `/__manus__/debug-collector.js`，并把浏览器 console / network / sessionReplay 日志写到 **`.manus-logs/`**（单文件超 1MB 时裁到 60%）。**生产构建不注入**（`NODE_ENV === 'production'` 时跳过）。

### 3.3 TypeScript 配置

```jsonc
{
  "strict": true,
  "target": "ESNext",
  "module": "ESNext",
  "moduleResolution": "bundler",
  "jsx": "preserve",
  "noEmit": true,
  "skipLibCheck": true,
  "allowImportingTsExtensions": true,
  "types": ["node", "vite/client", "w3c-web-serial"],
  "include": ["client/src/**/*", "shared/**/*", "server/**/*"]
}
```

类型检查命令：`pnpm.cmd run check`（即 `tsc --noEmit`）。**改完必须跑一次**。

---

## 四、版本管理约束

### 4.1 `client/src/version.ts`

```ts
export const APP_VERSION = 'v1.9.38';   // 当前值
export const APP_NAME    = 'JQ Tools Factory';
export const BUILD_DATE  = '2026-10-10'; // 当前值
```

- 版本号格式 `v<major>.<minor>.<patch>`；`BUILD_DATE` 格式 `YYYY-MM-DD`
- 文件头部大段注释用于记录版本历史，**每次改动在末尾追加一行** `* vX.Y.Z - 一句话概括`

### 4.2 README 版本记录格式

```markdown
### vX.Y.Z（YYYY-MM-DD）

**类型：简短描述**

- 详细改动 1
- 详细改动 2

**修改文件：**
- 修改 `path/to/file.tsx` — 改动说明
```

### 4.3 ⚠️ 已知历史断层（不要被误导）

`version.ts` 注释里的版本历史**并不完整**：

- 从 `v1.9.8` 直接跳到 `v1.9.26`，**`v1.9.9` ~ `v1.9.25` 共 17 个版本没有注释记录**
- **`v1.9.27` 在 `version.ts` 注释里缺失**（只在 `README.md` 的版本变动记录里有）

**结论**：要查完整历史请看 `README.md` 的「版本变动记录」（倒序，85+ 条），不要以 `version.ts` 注释为准。
上一版文档写的"必须记录**完整**版本历史"与实际不符，本版改为"**记录每次新增的版本**"，历史缺口不强制回填。

---

## 五、数据流核心架构（⚠️ 关键约束）

### 5.1 全局单例模式

**核心原则**：高频数据（传感器 100~300Hz、压力计 200Hz）**不能**走 React State，必须走全局单例 + Ref。

```ts
import { getRealtimeDataPipeline } from '@/lib/realtimeDataPipeline';
import { getSensorDataStreamV2 }   from '@/lib/sensorDataStreamV2';

const pipeline = getRealtimeDataPipeline(); // 全局唯一实例
const stream   = getSensorDataStreamV2();   // 全局唯一实例
```

两者都在模块级别维护 `let instance: Xxx | null = null`，`getXxx()` 返回唯一实例。

### 5.2 RealtimeDataPipeline（主数据管道，`client/src/lib/realtimeDataPipeline.ts`）

**数据写入**（所有入口**只能在解析层** `useSerialPort` 调用）：

| 方法 | 来源 | 功能 |
|------|------|------|
| `updateForceData(forceN)` | 压力计解析 | 更新压力值，触发 `forceCallbacks` + `forceFrameCallbacks` |
| `updateSensorData(matrix)` | 传感器帧解析 | 更新矩阵，**帧去重后**触发 `sensorFrameCallbacks` |
| `updateAdcData(adcValues)` | 传感器帧解析 | 仅更新 ADC 值，**不触发**帧通知（避免重复计帧） |

**数据读取**（消费者随处调用，零渲染开销）：

| 方法 | 返回 | 用途 |
|------|------|------|
| `getCurrentSnapshot()` | `DataSnapshot` | 完整快照 |
| `getLatestForce()` | `number \| null` | 最新压力值 |
| `getLatestAdcValues()` | `number[] \| null` | 最新 ADC 数组 |
| `getLatestSensorMatrix()` | `number[][] \| null` | 最新矩阵 |
| `getSensorFrameSeq()` | `number` | 传感器帧序号 |
| `getSensorFps()` / `getForceFps()` | `number` | 实时帧率 |
| `getSensorFrameInterval()` / `getForceFrameInterval()` | `number` | 帧间隔 ms |

**订阅接口**（全部返回取消订阅函数）：

| 方法 | 触发条件 | 用途 |
|------|----------|------|
| `subscribe(cb)` | 任何数据更新 | 通用订阅 |
| `subscribeForce(cb)` | `updateForceData` | 压力专用（零开销，直接传 `forceN`） |
| `subscribeSensorFrame(cb)` | 新传感器帧（**去重后**） | 自适应事件驱动采集 |
| `subscribeForceFrame(cb)` | 新压力计帧 | 自适应采集 |

**维护接口**：`getStats()` / `resetStats()` / `reset()` / `clear()`

**关键特性**：

- **帧去重**：`computeFrameSignature()` 采样关键位置（四角 + 中心 + 对角线 + 首尾行和），同签名帧跳过通知
- **帧率统计**：滑动窗口（60 帧），每 500ms 重算
- **错误隔离**：每个 callback 独立 try-catch，单个订阅者崩溃不影响其他
- **调试日志**：每 2000ms 输出一次（调用次数 / 新帧 / 重复帧 / 订阅者数 / fps）

### 5.3 SensorDataStreamV2（传感器专用流，`client/src/lib/sensorDataStreamV2.ts`，约 96 行）

- `updateSensorData(matrix, adcValues, rawBytes)` —— 唯一数据入口
- `getCurrentSnapshot()` —— **深拷贝**返回（外部可安全修改）
- `getLatestAdcValues()` / `getLatestMatrix()` —— 直接返回引用（**零拷贝，只读！**）
- `subscribe(cb)` —— 订阅接口

### 5.4 数据流关键路径

```
硬件串口 → useSerialPort(解析帧) → RealtimeDataPipeline(去重+分发)
    │                                    │
    ├── forceN ──────────────────────────┤
    ├── sensorMatrix ────────────────────┤
    └── adcValues ───────────────────────┤
                                         ▼
                              Home.tsx  SerialCtx
                              (≈100ms 批量 UI 更新)
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ConsistencyPage  RepeatabilityPage   TestPage
            (事件驱动采集)    (CSV 上传分析)     (SerialMonitor
                                              + 区间压力曲线
                                              + Hill 参数)
                    │
                    ▼
            DataChart ←─ CSV 上传 / 拖拽
            (Hill 拟合 + SUM/AVG)
                    │
                    ▼
            ConsistencyAnalysis
            (CV 分析 + 残差)
```

---

## 六、状态管理模式（⚠️ 必须遵守）

### 6.1 Ref vs State 选择

| 场景 | 用 Ref | 用 State |
|------|--------|----------|
| 高频传感器数据（>10Hz） | ✅ | ❌ |
| 采集缓冲区 | ✅ | ❌ |
| 定时器 ID | ✅ | ❌ |
| 串口 port / reader / writer | ✅ | ❌ |
| 回调函数引用（避免闭包过期） | ✅ | ❌ |
| UI 显示状态（连接/断开） | ❌ | ✅ |
| 采集计数显示 | ❌ | ✅ |
| 表单输入值 | ❌ | ✅ |

### 6.2 ref 代理模式（避免闭包过期）

```ts
const callbackRef = useRef(someCallback);
callbackRef.current = someCallback;   // 每次渲染同步更新

useEffect(() => {
    const handler = () => callbackRef.current();
    window.addEventListener('event', handler);
    return () => window.removeEventListener('event', handler);
}, []);  // 空依赖，只注册一次
```

**不能用** `useEffect(..., [callback])` 每次渲染重新注册。此模式修复了 v1.9.26 的 `insertBefore` DOM 崩溃。

### 6.3 避免用 `useEffect` 同步 Ref

```ts
// ❌ 错误：延迟一帧
useEffect(() => { ref.current = props.value; }, [props.value]);

// ✅ 正确：组件顶层直接赋值（同步、零延迟）
ref.current = props.value;
```

这是 v1.8.6 数据延迟问题的根因。**低频 props（如 `selectedSensors`）可以用 useEffect，高频数据必须直接赋值。**

### 6.4 禁止在高频回调中 `setState`

```ts
// ❌ 错误：200Hz → 每秒 200 次渲染 → 卡死
pipeline.subscribeForce((forceN) => setForceN(forceN));

// ✅ 正确：零渲染写入 ref，UI 用低频定时器刷新
pipeline.subscribeForce((forceN) => { forceRef.current = forceN; });
setInterval(() => setForceN(forceRef.current), 100);
```

### 6.5 localStorage 持久化（跨页面共享状态，不经 Context）

| Key | 用途 | 存放处 | 值格式 |
|-----|------|--------|--------|
| `jq_client_id` | 登录客户 | `ClientContext.tsx` | **JSON** `{"id":"..."}`（不是裸 id 字符串） |
| `selectedSensorPoints` | 传感器矩阵选点 | `ConsistencyPage.tsx` | `JSON.stringify(["0_1","2_3"])` |
| `handSelectedIndices` | 手形矩阵选点 | `ConsistencyPage.tsx` | `JSON.stringify([1,5,7])` |
| `matrixRows` / `matrixCols` | 矩阵尺寸 | `ConsistencyPage.tsx` | 整数字符串 |
| `consistencyPage_useHandLayout` | 一致性页布局偏好 | `ConsistencyPage.tsx` | `"true"` / `"false"` |
| `testPage_useHandLayout` | 测试页布局偏好 | `TestPage.tsx` | `"true"` / `"false"` |
| `testPage_handSelectedIndices` | 测试页手形选点 | `TestPage.tsx` | 同 `handSelectedIndices` |
| `durabilityPage_useHandLayout` | 耐久性页布局偏好 | `DurabilityPage.tsx` | `"true"` / `"false"` |

**规则**：`useEffect` 监听 state → 写 localStorage；`useState` 初始化函数 → 读 localStorage。

**⚠️ 手形选点已按页面拆分**：`testPage_handSelectedIndices` 与 `handSelectedIndices` 是**独立**的，不再跨页共享。改这块先确认要"共享"还是"独立"。

---

## 七、硬件通信协议栈

### 7.1 两个独立的串口角色

系统把设备分为两个 `role`，各自独立缓冲区 / 解析器 / 状态：

| role | 界面名称 | 设备 |
|------|---------|------|
| `force` | 检测设备 | CL2 压力计 **或** 智元灵巧手（二选一，由 `deviceMode` 决定） |
| `sensor` | 传感器产品 | 7 种触觉传感器产品，见 §7.3 |

> **第三台设备不在此列**：Arduino 下压机走独立模块 `PressController.tsx`（模块级单例 writer），**不经过 `useSerialPort`**。

### 7.2 检测设备（`role='force'`）

`SerialConnectPanel.tsx` 的 `DETECTION_DEVICES` 定义：

| 设备 | 代码标识 | 默认波特率（快捷档） | 帧格式 |
|------|---------|-------------------|--------|
| CL2-500N-MH01 压力计 | `deviceMode='pressure'` | 19200（9600 / 19200 / 115200） | **收**：`0x23` + float32LE(4B) + `0x0A` = 6B<br>**发**：连接 `0x23 50 00 0A`、开始 `0x23 51 00 0A`、停止 `0x23 52 00 0A`、**归零** `0x23 55 00 0A` |
| 智元灵巧手 | `deviceMode='robot'` | 460800（115200 / 460800 / 921600） | `EE AA` + deviceId(2B LE) + len(1B) + cmd(1B) + data + CRC16-CCITT(2B LE)<br>使能 `cmd=0x01,data=0x01`、失能 `cmd=0x01,data=0x00`、位置 `cmd=0x08` + 10×int16 |

**行为约束**：

- `robot` 模式下**跳过** CL2 初始化指令
- 灵巧手：连接成功后**自动发使能**，断开前**自动发失能**
- 灵巧手协议实现在 `client/src/lib/omniHandProtocol.ts`，`OMNI_DEVICE_ID = 1`
- 位置值范围 `0 ~ 4096`，连续发指令建议间隔 200ms 防硬件缓冲溢出
- 开始采集时自动下发压力计**归零**指令（v1.9.28 起），确保数据准确

### 7.3 传感器产品（`role='sensor'`，当前 **7 种**）

**真源**：`SerialConnectPanel.tsx` 的 `SENSOR_PRODUCTS` 数组；协议标识类型是 `useSerialPort.ts` 的 `SensorProtocol` 联合类型。

| 产品 label | sublabel | `protocol` | 矩阵 | 默认波特率 | 帧格式（总长） | 设备 ID 来源 |
|-----------|----------|-----------|------|-----------|---------------|-------------|
| 16×16 触觉传感器 | 织物触觉传感器 | `16x16` | 16×16 | 921600 | **双包**：PKT01 134B（头4+`01`+id+128数据）+ PKT02 150B（头4+`02`+id+128数据+16陀螺） | PKT01 第 6 字节 |
| 机器人足底 16×16 | JQ-FOOT-16 (宇树G1) | `16x16`（**复用**） | 16×16 | 921600 | 同上一行（完全复用） | `0x03`=LF / `0x04`=RF |
| 32×32 高密度传感器 | JQGY-YL-09 | `32x32` | 32×32 | 1000000 | **单帧 1028B**（4 帧头 + **1024B** 数据域），需 `MATRIX_32X32_MAP` 重排，100Hz | **无该字节** → 合成 `'HD'`/`0xFF` |
| 灏存科技定制 | HC-16×16 | `custom_haocun` | 16×16 | 921600 | **单帧 278B**（4 帧头 + 2 无效 + 256 数据 + 16 陀螺），200Hz | **无该字节** → 合成 `'HC'`/`0xFE` |
| 极智动量小黑采集板 | JZ-16×16 | `custom_jizhi` | 16×16 | 1000000 | **单帧 262B**（4 帧头 + `01` + id + 256 数据），300Hz | 第 6 字节 |
| 灵心巧手 16×16 | LX-16×16 | `custom_lingxin` | 16×16 | 921600 | **单帧 278B**（4 帧头 + `01` + 左右手 + 256 数据 + 16 四元数） | 第 6 字节（`0x01`LH / `0x02`RH） |
| 星尘科技 20×14 | XC-20×14 | `custom_xingchen` | **14 行 × 20 列**（280点，**非正方形**） | 921600 | **双包**：PKT01 146B（4+`01`+id+140数据）+ PKT02 162B（4+`02`+id+140数据+16四元数），拼 280B | PKT01 第 6 字节 |

**⚠️ 三个极易搞错的点**：

1. **32×32 的帧长是 1028B，不是 262B**。262B 是极智动量的。两者都是"4 字节帧头 + 一大段数据"，历史上混淆过。
2. **「产品」≠「协议」**。机器人足底产品**完全复用** `16x16` 协议，只是设备 ID 不同，一行解析代码都没改。新增产品先判断能否复用已有 protocol。
3. **星尘是唯一非正方形矩阵**：`matrixSize = 14`（行）、`matrixCols = 20`（列）。同时要检查 `Home.tsx` 里 `sensorMatrixSize` / `sensorMatrixCols` 的推导。

### 7.4 设备 ID 映射（`useSerialPort.ts` 的 `DEVICE_TYPE_MAP`）

| deviceId | 类型 | 说明 |
|----------|------|------|
| `0x01` / `0x02` | LH / RH | 左 / 右手套 |
| `0x03` / `0x04` | LF / RF | 左 / 右足（机器人足底产品使用） |
| `0x05` | WB | 全身 |
| `0xFE`（**合成**） | HC | 灏存定制 —— 帧内**没有** deviceId 字节，解析器内写死 |
| `0xFF`（**合成**） | HD | 32×32 高密度 —— 同上 |
| 其它 | `DEV_XX` | 未识别回退，形如 `DEV_0A` |

### 7.5 `useSerialPort` 调用签名与帧解析路径

```ts
// ✅ 正确：单对象参数，role 是 options 的一个字段
const forceSerial = useSerialPort({
  role: 'force',          // 'force' | 'sensor'
  deviceMode: 'pressure', // 'pressure' | 'robot'（仅 force 用）
  onForceData,
  onDeviceType,
  // ...
});

// ❌ 错误（上一版文档写的是这样，编译不过）
useSerialPort('force', callbacks, options);
```

**帧解析共 6 条路径**（`useSerialPort.ts` 读循环内按 `protocol` 分支）：

| # | 分支 | 帧类型 |
|---|------|--------|
| 1 | `protocol === '32x32'` | 单帧固定 1028B |
| 2 | `protocol === 'custom_haocun'` | 单帧固定 278B |
| 3 | `protocol === 'custom_jizhi'` | 单帧固定 262B |
| 4 | `protocol === 'custom_lingxin'` | 单帧固定 278B |
| 5 | `protocol === 'custom_xingchen'` | 双包（146B + 162B） |
| 6 | `else` 兜底 | `16x16` 双包（134B + 150B） |

> 上一版文档说的"3 种分支（含单包**动态长度**）"是错的 —— **不存在动态长度分支**，全部按固定长度切帧。

**其他约束**：

- 每个 `role` 在 `Home.tsx` 里**只创建一个实例**
- 回调全部走 ref 代理（`onForceDataRef.current = onForceData`）
- 二进制缓冲区逐帧解析（非行模式）

### 7.6 协议切换规则

⚠️ **协议必须在调用 `sensorSerial.connect()` 之前设置**。`sensorProtocol` 是 React state，切换它会改变读循环里的帧解析器 —— 连接后再改，读循环拿到的还是旧解析器。

### 7.7 下压机（独立串口）

`client/src/components/PressController.tsx`：

- 波特率 9600，ASCII 文本，发送 `"1"` 触发一次下压
- 模块级单例 writer，状态经 `onPressStateChange` 广播
- 循环逻辑由页面驱动（`ConsistencyPage` / `TestPage`）：**压力事件驱动**而非固定间隔 —— 等待实际压力上升 → 释放 → 缓冲 7s → 下一次
- 压力 15s 内始终未超过 1N 会弹警告，提示压头对位

---

## 八、文件上传 / 导出 / 下载逻辑

### 8.1 CSV 导出（3 种格式）

#### 格式 A：SerialMonitor 导出（数据采集用）

入口：`SerialMonitor.tsx` 的 `handleStartRecording` / `handleStopRecording`

```
BOM() + 时间,压力(N),传感器#1,传感器#2,...
xxh.xxm.xxs.xxxms,10.52,123,156,...
```

- 表头含 **BOM** 确保 Excel 正确识别 UTF-8
- 时间戳格式 `HHh.MMm.SSs.SSSms`
- 传感器列按 `selectedIndices` 顺序排列
- 触发：停止采集后自动导出（延迟约 50ms）

#### 格式 B：ConsistencyPage / TestPage 通用导出

入口：`client/src/lib/sensorData.ts` 的 `exportToCSV()`

```
Time,Pressure(N),ADC Value,ADC Sum,ADC Sum(Hex),Test Mode,Sample Index,Product Index
14:30:25,10.52,"123;156;89",368,0x170,consistency,0,0
```

- `ADC Value` 列用分号 `;` 分隔多个传感器 ADC 值
- `ADC Sum` 是各值之和

#### 格式 C：PressureChart 压力数据导出

由 `TestPage` 触发，含 time + forceN 两列。

### 8.2 CSV 上传 / 解析（**含拖拽**）

**入口**：

- `ConsistencyPage.tsx` —— `processCSVFiles()`（按钮与拖拽**共用**）
- `RepeatabilityPage.tsx` —— 同名 `processCSVFiles()`（**代码重复**，见 §13.10）

**自动识别两种输入格式**：

- **格式 A**：表头含 `传感器#` 或 `压力(N)` —— 多列传感器格式
- **格式 B**：表头含 `ADC Value` 或 `ADC Sum` —— 分号分隔格式

**上传后自动处理**：

- 过滤：只保留压力**上升**阶段（0 → 峰值），舍弃下降阶段
- 每个文件用 `SERIES_COLORS` 中不同颜色渲染
- 最多 **20 个文件**，超出提示

**拖拽上传**（v1.9.37 起，两个页面都支持）：

- 图表区域可直接拖入 CSV；悬停显示高亮覆盖层「松开以导入 CSV 文件」
- 拖入非 CSV 时提示「仅支持 CSV 文件」；混合拖拽提示被忽略的非 CSV 数量
- **全局拖拽保护**：文件拖到图表区域外时不触发浏览器导航（否则会丢失内存中的数据）

### 8.3 JSON 导出（Hill 拟合）

入口：`DataChart.tsx` 的 `generateExportJson()`（生成）+ 下载触发

```json
{
  "hill_fit": {
    "coefficients": { "a": {...}, "b": {...}, "n": {...} },
    "fit_quality":  { "r_squared": 0.99, "rmse": 1.23, "method": "LM" },
    "formulas": {
      "forward": { "text": "...", "latex": "...", "latex_symbolic": "..." },
      "inverse": { "text": "...", "latex": "...", "latex_symbolic": "..." }
    }
  },
  "metadata": { "tool": "JQ Tools Factory - Hill Equation Fitting Engine" }
}
```

### 8.4 LaTeX 导出

入口：`DataChart.tsx` 的 `generateLatex()`（生成）+ 独立下载按钮

生成独立 `.tex` 文件，包含：符号公式、代入系数公式、系数列表、拟合质量。

### 8.5 基准文件导出（JSON）

入口：`SerialMonitor.tsx` 的 `handleGenerateBaseline()`

```json
{
  "timestamp": "2026-07-23T...",
  "testType": "基准测试",
  "totalDataPoints": 500,
  "pressure":  { "average": "25.30", "max": "48.20", "min": "5.10", "samples": 500 },
  "sensorADC": { "传感器#1": { "average": "128.50", "max": "...", "min": "...", "samples": 500 } }
}
```

### 8.6 文件下载通用模式

```ts
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);   // 临时挂载
  link.click();                      // 触发下载
  document.body.removeChild(link);   // 立即移除
  URL.revokeObjectURL(url);          // 释放 Blob URL
}
```

存在位置：`DataChart.tsx`（JSON / LaTeX）、`SerialMonitor.tsx`（CSV + 基准文件）、`TestPage.tsx`（CSV）、`sensorData.ts` 的 `exportToCSV()`（不 append/remove，直接 click）。

### 8.7 剪贴板复制

入口：`DataChart.tsx` 的复制按钮处理函数

```ts
try {
  await navigator.clipboard.writeText(latex);
} catch {
  const textarea = document.createElement('textarea');
  textarea.value = latex;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}
```

---

## 九、UI 组件约束

### 9.1 颜色系统（oklch，取自 `client/src/index.css`）

```css
--background:  oklch(0.13 0.02 265);   /* 主背景（最暗） */
--card:        oklch(0.17 0.025 265);  /* 卡片 */
--foreground:  oklch(0.92 0.01 220);   /* 主文字 */
--border:      oklch(0.28 0.03 265);   /* 主边框 */
--primary:     oklch(0.58 0.22 265);   /* 主色（紫蓝） */
--accent:      oklch(0.70 0.18 200);   /* 蓝色强调 */
--destructive: oklch(0.65 0.22 25);    /* 红色警告 */
```

⚠️ **上一版把主背景写成 `oklch(0.17 0.025 265)`、主边框写成 `oklch(0.25 0.03 265)` —— 那其实是 `--card` 和 `--sidebar-border` 的值，取错了 token。**

**另有一处历史例外**：`SerialConnectPanel.tsx` 里仍有 `#16213e` / `#e0e0e0` 两处 hex 硬编码未清理。**新增**颜色一律用 oklch。

### 9.2 字体

```css
font-family: 'IBM Plex Sans', sans-serif;      /* 界面文本 */
font-family: 'IBM Plex Mono', monospace;       /* 代码 / 数据专用 */
```

### 9.3 shadcn/ui 组件架构

- 所有 Radix UI 原语包装在 `client/src/components/ui/` 下（**当前 53 个文件**）
- Dialog / Sheet / Tooltip / Popover / Select 等都使用 Radix Portal 渲染到 `document.body`
- `cn()` 工具函数来自 `@/lib/utils`（`clsx` + `tailwind-merge`）

### 9.4 路由与登录闸门

- wouter（SPA），仅 `/` 与 `/404`
- **登录闸门**：`App.tsx` 里未登录时**整棵组件树被 `LoginPage` 替换**，不渲染 Home
- 实际页面切换通过 `components/Sidebar.tsx`（已从 Home 抽出为独立组件）的 5 个 Tab，在同一个 Home 布局下切换
- ⚠️ 因为登录闸门的存在，`SerialConnectPanel.tsx` 里 `client === null` 时"显示全部产品"的分支**实际不可达（死代码）**

### 9.5 ErrorBoundary

`client/src/components/ErrorBoundary.tsx` —— class 组件，捕获未处理的 React 错误，显示错误栈 + "Reload Page" 按钮，包裹在 `App.tsx` 路由外层。

---

## 十、项目结构（当前真实状态）

> 行数为整理时统计值，**仅作体量参考，会随开发漂移**。标 ⚠ 的是超大文件，改动前请评估影响面。

```
JQFactory/
├── client/                              # Vite root
│   ├── index.html
│   ├── public/                          # favicon / __manus__/debug-collector.js
│   └── src/
│       ├── main.tsx                     # JS 入口 (createRoot)
│       ├── App.tsx                      # 根组件（ErrorBoundary → Providers → 登录闸门 → Router）
│       ├── version.ts                   # 版本号管理
│       ├── index.css                    # 全局样式 + 设计 token
│       ├── components/
│       │   ├── ui/                      # 53 个 shadcn/ui 包装组件
│       │   ├── DataChart.tsx            # ⚠ 1085 散点图 + Hill 面板 + SUM/AVG + 降采样
│       │   ├── SensorMatrix.tsx         # ⚠ 831 传感器矩阵热力图
│       │   ├── ConsistencyAnalysis.tsx  # ⚠ 735 CV 分析 + 残差
│       │   ├── OmniHandControl.tsx      # ⚠ 692 动作库 / 循环编排
│       │   ├── SerialConnectPanel.tsx   # 585 7 产品 + 2 检测设备 + 波特率 UI
│       │   ├── HandMatrix.tsx           # 574 手形分区可视化
│       │   ├── SerialMonitor.tsx        # 454 采集控制 + CSV/基准导出
│       │   ├── PressureChart.tsx        # 367 压力时序图（支持 externalData 区间模式）
│       │   ├── ParameterPanel.tsx       # 279
│       │   ├── PressureRangeBar.tsx     # 202 滑块+输入框+快捷按钮+Max
│       │   ├── PressController.tsx      # 194 Arduino 下压机控制
│       │   ├── TestResultCard.tsx       # 157
│       │   ├── DataTable.tsx            # 151
│       │   ├── ConsistencyChart.tsx     # 135
│       │   ├── Sidebar.tsx              # 129 页面 Tab
│       │   └── ErrorBoundary.tsx        # 62 全局错误边界
│       ├── pages/
│       │   ├── ConsistencyPage.tsx      # ⚠ 1167 全项目最大：下压机循环 + CSV + 拖拽 + 图表编排
│       │   ├── DurabilityPage.tsx       # ⚠ 972 耐久性检测
│       │   ├── RepeatabilityPage.tsx    # ⚠ 771 重复性检测
│       │   ├── Home.tsx                 # 545 主壳 + SerialCtx 提供者
│       │   ├── TestPage.tsx             # 504 实时监控
│       │   ├── AboutPage.tsx            # 391 产品说明
│       │   ├── LoginPage.tsx            # 187 登录
│       │   └── NotFound.tsx             # 49 404
│       ├── hooks/
│       │   ├── useSerialPort.ts         # ⚠ 1009 串口核心 Hook，6 条协议分支
│       │   ├── useComposition.ts        # 78  IME 组合状态
│       │   ├── useMobile.tsx            # 21
│       │   └── usePersistFn.ts          # 18
│       ├── lib/
│       │   ├── hillFit.ts               # ⚠ 599 正/反向 Hill + Levenberg-Marquardt
│       │   ├── realtimeDataPipeline.ts  # 457 主数据管道 ⭐
│       │   ├── serialDriver.ts          # 397 遗留 CL2 压力计驱动
│       │   ├── sensorData.ts            # 342 数据模型 + CSV 导出
│       │   ├── sensorDataStreamV2.ts    # 96  传感器专用流 ⭐
│       │   ├── omniHandProtocol.ts      # 73  灵巧手协议
│       │   ├── defaultActions.json      # 62  默认动作库
│       │   └── utils.ts                 # 6   cn()
│       ├── contexts/
│       │   ├── ClientContext.tsx        # 84  登录状态
│       │   └── ThemeContext.tsx         # 64  主题（dark only）
│       └── config/
│           └── clients.ts               # 78  5 个客户账号
├── server/index.ts                      # 33 Express 静态 + SPA fallback
├── shared/                              # ⚠ 空目录（0 文件）
├── scripts/cleanup-deployments.js       # Cloudflare 旧部署清理
├── patches/wouter@3.7.1.patch           # wouter 补丁
├── docs/
│   ├── JQFactory-project-constraints.md # 本文件
│   ├── agent-memory/                    # Agent 记忆归档
│   ├── agent-handoff/                   # 接管交接 + 漂移审计
│   ├── User_Manual.md / .pdf
│   ├── cv-to-pressure-error.md
│   └── screenshots/
├── AGENTS.md                            # Agent 规则总纲（会话自动加载）
├── PROJECT_DOCUMENTATION.md             # 产品使用说明 v1.3（历史）
├── README.md                            # 版本变动记录（倒序，完整）
├── optimization-report.md                # 历史代码审查记录（v1.6 时代）
├── omni_hand_sensor_connection_guide.md # 灵巧手 / 传感器连接配置
├── hill_fit_offline.py                  # Hill 拟合离线工具（对齐 hillFit.ts）
├── sensor_hill_fit.py                   # Hill 拟合 GUI 分析工具
├── components.json / vite.config.ts / tsconfig.json / tsconfig.node.json
└── package.json / pnpm-lock.yaml
```

**⚠️ `pages/DataLogPage.tsx` 已被删除** —— 上一版文档（§13.8）仍把它描述为 372 行的静态演示页，现已不存在。

**9 个 ≥599 行的超大文件**：`ConsistencyPage`(1167) / `DataChart`(1085) / `useSerialPort`(1009) / `DurabilityPage`(972) / `SensorMatrix`(831) / `RepeatabilityPage`(771) / `ConsistencyAnalysis`(735) / `OmniHandControl`(692) / `hillFit`(599)。

---

## 十一、关键代码约束速查

### 11.1 禁止事项

- ❌ 不要在高频回调中调用 `setState`
- ❌ 不要用 `useEffect` 同步高频 props 到 ref（直接赋值即可）
- ❌ 不要在 `useEffect` 中遗漏依赖数组（每次渲染重复注册事件）
- ❌ 不要用 `--branch=main` 部署正式环境（正式是 `master`）
- ❌ 不要跳过测试环境直接推正式
- ❌ 不要忘记更新版本号和 README
- ❌ 不要在注释 / README / commit message 中复述客户密码
- ❌ 不要在 `sensorSerial.connect()` 之后再改协议
- ❌ 不要把 `useSerialPort` 当三参数函数调用（是单对象参数）
- ❌ 不要把 32×32 的帧长记成 262B（是 1028B）
- ❌ 不要改 `SENSOR_PRODUCTS` 的 `label` 而不检查 `clients.ts` 的 `allowedProducts`（label 是精确匹配的关联键）

### 11.2 必须事项

- ✅ 高频数据走全局单例 + Ref，不走 React State
- ✅ 回调函数用 ref 代理模式（`cbRef.current = fn; useEffect(..., [])`）
- ✅ 文件下载用临时 `<a>` + Blob URL
- ✅ **新增**颜色用 oklch 色彩空间
- ✅ 数据字体用 `'IBM Plex Mono'`，界面字体 `'IBM Plex Sans'`
- ✅ 每个订阅回调用 try-catch 包裹（错误隔离）
- ✅ 改完跑 `pnpm.cmd run check`

### 11.3 调试相关

- `RealtimeDataPipeline` 每 **2000ms** 输出调试日志（调用次数 / 新帧 / 重复帧 / 订阅者数 / fps）
- `updateSensorData` 有帧去重机制（采样关键位置计算签名）
- 开发时浏览器日志写入 **`.manus-logs/`**（`browserConsole.log` / `networkRequests.log` / `sessionReplay.log`）

---

## 十二、新增传感器产品 Checklist（6 步）

1. **`SerialConnectPanel.tsx`** → `SENSOR_PRODUCTS` 加一条
   `{ label, sublabel, defaultBaud, quickBauds, hint, matrixSize, matrixCols?, protocol }`
2. **`useSerialPort.ts`** → 若需新协议：`SensorProtocol` 联合类型加值 + 读循环加帧解析分支 + 帧长常量
   - ⚠️ **能复用就别新开**：机器人足底完全复用 `16x16`，只靠设备 ID 区分
3. **非正方形矩阵**：必须同时设 `matrixCols`，并检查 `Home.tsx` 的 `sensorMatrixSize` / `sensorMatrixCols` 推导（参考 `custom_xingchen` 的 14×20）
4. **帧内没有 deviceId 字节的产品**：在解析器内**合成**设备类型（先例：32×32 → `'HD'`/`0xFF`，灏存 → `'HC'`/`0xFE`），否则 UI 设备类型显示为空
5. **若为新客户**：`config/clients.ts` → `CLIENTS` 加账号，`allowedProducts` 填**精确匹配的 label**
6. **发布**：走 §2.4 流程（改 `version.ts` + `README.md` → push → `deploy:test` → 等确认 → `deploy:prod`）

---

## 十三、补充约束

### 13.1 部署清理脚本

`scripts/cleanup-deployments.js` —— 每次部署后自动运行：列出所有部署 → 保留最新 → 删除旧的，防止 Cloudflare Pages 部署配额累积。

### 13.2 客户端认证模型

- 简单静态凭证匹配（`config/clients.ts` 的 `authenticateClient()`）
- 无 JWT、无后端认证、**密码在前端明文**（架构现状，非本次引入）
- 登录状态持久化在 localStorage（key `jq_client_id`，**值是 JSON** `{"id":"..."}`）
- `ClientContext` 监听 `storage` 事件（跨标签页同步登录状态）
- 每个 client 有 `allowedProducts` 白名单

### 13.3 客户与传感器产品过滤（**当前 5 客户 / 7 产品**）

| id | 名称 | 可见产品 |
|----|------|---------|
| `jq` | JQ 工业 | 16×16 触觉传感器、32×32 高密度传感器、机器人足底 16×16 |
| `haocun` | 灏存科技 | 灏存科技定制 |
| `jizhi` | 极智动量 | 极智动量小黑采集板 |
| `lingxin` | 灵心巧手 | 灵心巧手 16×16 |
| `xingchen` | 星尘科技 | 星尘科技 20×14 |

- 过滤规则：`client.allowedProducts.includes(p.label)`，按 **label 全名精确匹配**
- **只有 `sensor` 角色被过滤**；`force` 角色（检测设备）不受客户限制
- 上一版写的"未登录用户看到全部 4 种产品"已失效：**登录闸门让该分支不可达**

### 13.4 力传感器双模式

`forceDeviceMode` 两态：

- `'pressure'` —— CL2 压力计，发送 CL2 初始化命令
- `'robot'` —— 灵巧手，**跳过** CL2 初始化，改发使能命令

模式在连接时设置，断开时清除。

### 13.5 协议切换规则

见 §7.6 —— **必须在 `connect()` 之前设置**。

### 13.6 wouter 补丁

`patches/wouter@3.7.1.patch` —— 把路由路径收集到 `window.__WOUTER_ROUTES__`，供 Manus 运行时使用。

### 13.7 `serialDriver.ts`（遗留架构）

`client/src/lib/serialDriver.ts`（397 行）—— 旧的全局单例，专用于 CL2 压力计。维护全局统计（`globalDataPointCount`、`globalCollectionStartTime`），跨组件卸载持久化。新代码通过 `useSerialPort` 间接使用，两者功能重叠。

### 13.8 `DataLogPage`（已删除）

上一版文档记载的静态演示页 `pages/DataLogPage.tsx`（372 行）**已不存在**，`Sidebar` 也无对应 Tab。若在文档或注释里看到它，一律视为过时。

### 13.9 状态栏（Footer）

- 高度 24px，暗色背景
- 显示：`APP_VERSION`、公司名、压力/传感器连接状态 + 波特率、实时帧率（`F:XXHz S:XXHz`）、当前时间
- 浏览器不支持 Web Serial API 时显示警告

### 13.10 已知技术债

1. `RealtimeDataPipeline` 与 `SensorDataStreamV2` 功能重叠（都是 pub/sub），**可合并但改动面太大**
2. `serialDriver.ts` 与 `useSerialPort.ts` 功能重叠
3. CSV 解析逻辑在 `ConsistencyPage` 与 `RepeatabilityPage` 中**完全重复**（各有一份 `processCSVFiles`）
4. `shared/` 目录**完全为空**（0 文件），`@shared` 别名指向空目录 —— 上一版提到的 `shared/const.ts` 不存在
5. **无任何单元测试**（`vitest` 已安装但零测试文件）
6. `__pycache__/hill_fit_offline.cpython-312.pyc` 被 git 跟踪（应移出索引）
7. `version.ts` 版本历史有断层（见 §4.3）
8. `wrangler` **不是项目依赖**，靠 `npx` 临时拉取，版本不可控
9. 9 个文件 ≥599 行，最大 1167 行，缺乏模块拆分

> 上一版列的三条技术债已不成立：`RepeatabilityPage` 已支持真实 CSV 上传（不是模拟数据）、`OmniHandControl` 已实现（不是"未实现"）、`shared/const.ts` 不存在。

### 13.11 命名约定

- 组件文件：PascalCase（`SensorMatrix.tsx`、`DataChart.tsx`）
- Hook 文件：`use` + camelCase（`useSerialPort.ts`、`useMobile.tsx`）
- lib 模块：camelCase（`realtimeDataPipeline.ts`、`hillFit.ts`）
- UI 组件：kebab-case 文件名，导出 PascalCase 组件（`dialog.tsx` → `Dialog`）
- 全局单例获取函数：`get` + PascalCase（`getRealtimeDataPipeline()`、`getSensorDataStreamV2()`）
- 事件处理函数：`handle` + 动词（`handleStartRecording`、`handleGenerateBaseline`）
- Ref 变量：`xxxRef` 后缀（`portRef`、`bufferRef`、`isRecordingRef`）
- 类型 / 接口：PascalCase（`DataSnapshot`、`SensorProductConfig`、`HillFitResult`）

### 13.12 Hill 拟合引擎（`client/src/lib/hillFit.ts`，599 行）

**正向**（压力 → ADC）：

```ts
fitHill(points) => HillFitResult
// { a, b, n, rmse, r2, method: 'hill' | 'hyperbolic' | 'fallback' }
// ADC = a * P^n / (b^n + P^n)
```

**反向**（ADC → 压力，v1.9.x 新增）：

```ts
fitInverseHill(points) => InvHillFitResult
// { Vmax, K, n, rmse, r2, method }
// P = b * (ADC / (a - ADC))^(1/n)
```

配套：`invHillFunc()`、`generateInvFitCurve()`。算法为 **Levenberg-Marquardt 非线性最小二乘**。

> ⚠️ **当前不存在「非线性度 / 线性度误差」指标**。`HillFitResult` 只有 `{a, b, n, rmse, r2, method}`。
> 若要新增：在 `[0, pMax]` 采样 Hill 曲线 → 做最小二乘直线拟合 → `max|y_hill − y_line| / FS × 100%`。
> 相关离线计算方法与实测结果见 `AGENTS.md` §10.1。
