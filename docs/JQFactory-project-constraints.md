# JQFactory 项目约束与核心逻辑文档

> 整理日期：2026-07-23 | 版本：v1.9.26
> 用途：程序融合参考 — 包含所有部署约束、数据流规则、上传/导出逻辑、状态管理模式

---

## 一、项目概览

| 维度 | 说明 |
|------|------|
| **定位** | 织物触觉传感器出厂检测工具，浏览器内直连硬件设备 |
| **技术栈** | React 19 + TypeScript 5.6 + Vite 7 + Tailwind CSS 4 + shadcn/ui (Radix) |
| **图表** | Recharts 2.x |
| **硬件通信** | Web Serial API（浏览器原生） |
| **路由** | wouter 3.x（轻量级 SPA，patched via `patches/wouter@3.7.1.patch`） |
| **包管理** | pnpm 10.4.1（lockfile 强制 pnpm） |
| **部署** | Cloudflare Pages（两个独立项目） |

---

## 二、部署约束（⚠️ 关键规则）

### 2.1 两个 Cloudflare Pages 项目

| 环境 | 项目名 | 分支 | URL | deploy 命令 |
|------|--------|------|-----|-------------|
| 测试 | `jq-tools-factory-test` | `main` | https://jq-tools-factory-test.pages.dev | `pnpm run deploy:test` |
| 正式 | `jq-tools-factory` | `master` | https://jq-tools-factory.pages.dev | `pnpm run deploy:prod` |

**⚠️ `--branch` 参数必须匹配项目对应的生产分支！** 测试用 `main`，正式用 `master`。

### 2.2 部署命令（package.json scripts）

```json
"deploy:test": "pnpm run build && npx wrangler pages deploy dist/public --project-name=jq-tools-factory-test --branch=main && node scripts/cleanup-deployments.js jq-tools-factory-test"
"deploy:prod": "pnpm run build && npx wrangler pages deploy dist/public --project-name=jq-tools-factory --branch=master && node scripts/cleanup-deployments.js jq-tools-factory"
```

### 2.3 部署后验证

```bash
npx wrangler pages deployment list --project-name=jq-tools-factory --environment=production
```

### 2.4 发布流程（强制，不可跳过）

1. **更新版本号**：修改 `client/src/version.ts`，递增 `APP_VERSION`（如 v1.9.25 → v1.9.26），更新 `BUILD_DATE`
2. **更新 README.md**：在「版本变动记录」区域添加新版本条目（时间倒序，最新的在上）
3. **提交并推送**：commit message 规范 `feat/fix/chore/docs:` 前缀，push 到 GitHub
4. **部署测试**：`pnpm run deploy:test`
5. **确认用户**：询问是否需要推送正式
6. **部署正式**：仅在用户确认后 `pnpm run deploy:prod`
7. **验证**：`npx wrangler pages deployment list` 确认最新 commit 已上线

**纪律**：不能跳过测试直接推正式；每次推送都要更新版本号和 README；即使只改了版本号也要重新部署。

---

## 三、构建配置约束

### 3.1 路径别名（tsconfig.json + vite.config.ts）

```json
// tsconfig.json paths
"@/*": ["./client/src/*"]
"@shared/*": ["./shared/*"]

// vite.config.ts resolve.alias
"@": path.resolve("client/src")
"@shared": path.resolve("shared")
"@assets": path.resolve("attached_assets")
```

### 3.2 Vite 特殊配置

- **root**: `client/`（不是项目根目录）
- **outDir**: `dist/public/`
- **构建产物命名**：`assets/[name]-[hash]-${Date.now()}.js`（带时间戳防缓存）
- **dev server**: port 3000，host: true
- **allowedHosts**: `.manuspre.computer`, `.manus.computer`, `.manus-asia.computer`, `.manuscomputer.ai`, `.manusvm.computer`

### 3.3 TypeScript 配置

```json
{
  "strict": true,
  "module": "ESNext",
  "moduleResolution": "bundler",
  "jsx": "preserve",
  "types": ["node", "vite/client", "w3c-web-serial"]
}
```

---

## 四、版本管理约束

### 4.1 version.ts 位置和格式

文件：[client/src/version.ts](client/src/version.ts)

```ts
export const APP_VERSION = 'v1.9.26';
export const APP_NAME = 'JQ Tools Factory';
export const BUILD_DATE = '2026-07-23';
```

- 版本号格式：`v<major>.<minor>.<patch>`
- BUILD_DATE 格式：`YYYY-MM-DD`
- 版本号必须在文件中以大段注释记录完整版本历史

### 4.2 README 版本记录格式

```markdown
### vX.Y.Z（YYYY-MM-DD）

**类型：简短描述**

- 详细改动 1
- 详细改动 2

**修改文件：**
- 修改 `path/to/file.tsx` — 改动说明
```

---

## 五、数据流核心架构（⚠️ 关键约束）

### 5.1 全局单例模式（数据管道）

**核心原则**：高频数据（传感器 200Hz+）**不能**走 React State，必须走全局单例 + Ref。

```ts
// realtimeDataPipeline.ts — 全局单例获取方式
import { getRealtimeDataPipeline } from '@/lib/realtimeDataPipeline';
const pipeline = getRealtimeDataPipeline(); // 全局唯一实例

// sensorDataStreamV2.ts — 同上
import { getSensorDataStreamV2 } from '@/lib/sensorDataStreamV2';
const stream = getSensorDataStreamV2(); // 全局唯一实例
```

两个全局单例都在模块级别维护 `let instance: Xxx | null = null`，`getXxx()` 函数返回唯一实例。

### 5.2 RealtimeDataPipeline（主数据管道）

**文件**：[client/src/lib/realtimeDataPipeline.ts](client/src/lib/realtimeDataPipeline.ts) (458 行)

**数据写入**（所有入口只能在解析层调用）：

| 方法 | 来源 | 功能 |
|------|------|------|
| `updateForceData(forceN)` | useSerialPort 压力计解析 | 更新压力值，触发 forceCallbacks + forceFrameCallbacks |
| `updateSensorData(matrix)` | useSerialPort 传感器帧解析 | 更新矩阵，帧去重后触发 sensorFrameCallbacks |
| `updateAdcData(adcValues[])` | useSerialPort 传感器帧解析 | 仅更新 ADC 值，不触发帧通知（避免重复） |

**数据读取**（消费者在任何地方调用，零开销）：

| 方法 | 返回值 | 用途 |
|------|--------|------|
| `getCurrentSnapshot()` | DataSnapshot | 获取完整快照 |
| `getLatestForce()` | number \| null | 获取最新压力值 |
| `getLatestAdcValues()` | number[] \| null | 获取最新 ADC 值 |
| `getSensorFps()` / `getForceFps()` | number | 获取实时帧率 |

**订阅接口**：

| 方法 | 触发条件 | 用途 |
|------|----------|------|
| `subscribe(callback)` | 任何数据更新 | 通用订阅 |
| `subscribeForce(callback)` | updateForceData | 压力专用（零开销，直接传 forceN） |
| `subscribeSensorFrame(callback)` | 新传感器帧（去重后） | 自适应事件驱动采集 |
| `subscribeForceFrame(callback)` | 新压力计帧 | 自适应采集 |

**关键特性**：
- **帧去重**：`computeFrameSignature()` 采样关键位置（四角 + 中心 + 对角线 + 首尾行和），相同签名跳过帧通知
- **帧率统计**：滑动窗口（60 帧），每 500ms 重新计算
- **错误隔离**：每个 callback 独立 try-catch，单个订阅者崩溃不影响其他

### 5.3 SensorDataStreamV2（传感器专用流）

**文件**：[client/src/lib/sensorDataStreamV2.ts](client/src/lib/sensorDataStreamV2.ts) (97 行)

- `updateSensorData(matrix, adcValues, rawBytes)` — 唯一数据入口
- `getCurrentSnapshot()` — 深拷贝返回（安全，外部可修改）
- `getLatestAdcValues()` / `getLatestMatrix()` — 直接返回引用（零拷贝，只读）

### 5.4 数据流关键路径

```
硬件串口 → useSerialPort(解析帧) → RealtimeDataPipeline(去重+分发)
    │                                    │
    ├── forceN ──────────────────────────┤
    ├── sensorMatrix ────────────────────┤
    └── adcValues ───────────────────────┤
                                         ▼
                              Home (SerialCtx)
                              (100ms 批量 UI 更新)
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            ConsistencyPage  RepeatabilityPage  TestPage
            (事件驱动采集)   (模拟数据)        (pipeline 订阅)
                    │
                    ▼
            DataChart ←─ CSV 上传
            (Hill 拟合 + SUM/AVG)
                    │
                    ▼
            ConsistencyAnalysis
            (CV 分析 + 残差)
```

---

## 六、状态管理模式（⚠️ 必须遵守）

### 6.1 什么时候用 Ref vs State

| 场景 | 用 Ref | 用 State |
|------|--------|----------|
| 高频传感器数据（>10Hz） | ✅ | ❌ |
| 采集缓冲区 | ✅ | ❌ |
| 定时器 ID | ✅ | ❌ |
| 串口 port/reader/writer | ✅ | ❌ |
| 回调函数引用（避免闭包过期） | ✅ | ❌ |
| UI 显示状态（连接/断开） | ❌ | ✅ |
| 采集计数显示 | ❌ | ✅ |
| 表单输入值 | ❌ | ✅ |

### 6.2 ref 代理模式（避免闭包过期）

```ts
// 标准模式：ref 代理确保始终调用最新函数
const callbackRef = useRef(someCallback);
callbackRef.current = someCallback;  // 每次渲染更新

useEffect(() => {
    const handler = () => callbackRef.current();
    window.addEventListener('event', handler);
    return () => window.removeEventListener('event', handler);
}, []);  // 空依赖，只注册一次
```

这是本次 v1.9.26 修复 SensorMatrix 时使用的模式。**不能用** `useEffect(..., [callback])` 然后每次渲染重新注册。

### 6.3 避免 useEffect 同步 Ref

```ts
// ❌ 错误：用 useEffect 同步 props 到 ref（延迟一帧）
useEffect(() => { ref.current = props.value; }, [props.value]);

// ✅ 正确：直接赋值（同步，零延迟）
ref.current = props.value;  // 写在组件顶层，不在 useEffect 内
```

这是 v1.8.6 修复的延迟问题根源。低频的 props（如 selectedSensors）可以用 useEffect，但高频数据必须直接赋值。

### 6.4 禁止 setState 在高频回调中

```ts
// ❌ 错误
pipeline.subscribeForce((forceN) => {
    setForceN(forceN);  // 200Hz → 每秒 200 次渲染 → 卡死
});

// ✅ 正确
pipeline.subscribeForce((forceN) => {
    forceRef.current = forceN;  // 零渲染
});
// UI 更新用低频定时器（50-100ms）
setInterval(() => setForceN(forceRef.current), 100);
```

### 6.5 localStorage 持久化模式

项目使用直接 localStorage 读写（不通过 Context），页面间通过 localStorage key 共享状态：

| Key | 用途 | 存储格式 |
|-----|------|----------|
| `selectedSensorPoints` | 传感器矩阵选点 | `JSON.stringify(["0_1","2_3",...])` |
| `handSelectedIndices` | HandMatrix 选点 | `JSON.stringify([1,5,7,...])` |
| `matrixRows` / `matrixCols` | 矩阵尺寸 | 整数字符串 |
| `consistencyPage_useHandLayout` | 手掌/矩阵布局偏好 | `"true"` / `"false"` |

**规则**：useEffect 监听 state → 写入 localStorage；useState 初始化函数从 localStorage 读取。

---

## 七、硬件通信协议栈

### 7.1 支持设备一览

| 设备 | 波特率 | 帧格式 | 识别方式 |
|------|--------|--------|----------|
| CL2 压力计 | 19200（默认）| `0x23` + float32LE(4B) + `0x0A` = 6B | role='force' |
| 16×16 触觉传感器 | 921600 | `AA 55 03 99` + PKT01(128B) + PKT02(144B 含陀螺仪) | 双包协议 |
| 32×32 高密度 (JQGY-YL-09) | 1,000,000 | `AA 55 03 99` + 4B header + 01 + deviceID + 256B data (262B 总长) | sensorProduct='32×32' |
| 灏存科技定制 | 921600 | `AA 55 03 99` + 2B 无效 + 256B + 16B 陀螺仪 = 278B | sensorProduct='灏存' |
| 极智动量小黑采集板 | 1,000,000 | 4B header + 01 + device + 256B data = 262B | sensorProduct='极智' |
| Arduino 下压机 | 9600 | ASCII 文本控制（发送 `1` 触发下压） | PressController |
| 智元灵巧手 | 460800 | `EE AA` + deviceID(2B LE) + len + cmd + data + CRC16 | OmniHandControl |

### 7.2 设备识别（PKT01）

传感器设备类型通过 PKT01 帧中第 5 字节（deviceId）识别：

| deviceId | 设备类型 | 说明 |
|----------|----------|------|
| 0x01 | LH | 左手手套 |
| 0x02 | RH | 右手手套 |
| 0x03 | LF | 左足 |
| 0x04 | RF | 右足 |
| 0x05 | WB | 全身 |
| 其它 | 通用 16×16 / 32×32 | 按传感器产品配置解析 |

### 7.3 useSerialPort Hook 核心约束

```ts
useSerialPort(role: 'force' | 'sensor', callbacks, options)
```

- **每个 role 只能创建一个实例**（Home.tsx 创建 force + sensor 两个实例）
- 回调全部用 ref 代理（`onForceDataRef.current = onForceData`）
- 二进制缓冲区逐帧解析（非行模式）
- 传感器帧解析有 3 种分支：双包协议 / 单包固定长度 / 单包动态长度

---

## 八、文件上传/导出/下载逻辑

### 8.1 CSV 导出（3 种格式）

#### 格式 A：SerialMonitor 导出（数据采集用）

**入口**：[SerialMonitor.tsx:88-150](client/src/components/SerialMonitor.tsx#L88-L150)

```
BOM(﻿) + 时间,压力(N),传感器#1,传感器#2,...
xxh.xxm.xxs.xxxms,10.52,123,156,...
```

- 表头含 BOM（`﻿`）确保 Excel 正确识别 UTF-8
- 时间戳格式化为 `HHh.MMm.SSs.SSSms`
- 传感器列按 selectedIndices 顺序排列
- 触发：停止采集后自动导出（50ms 延迟）

#### 格式 B：ConsistencyPage/TestPage 通用导出

**入口**：[sensorData.ts:317-337](client/src/lib/sensorData.ts#L317-L337)

```
Time,Pressure(N),ADC Value,ADC Sum,ADC Sum(Hex),Test Mode,Sample Index,Product Index
14:30:25,10.52,"123;156;89",368,0x170,consistency,0,0
```

- `ADC Value` 列用分号 `;` 分隔多个传感器的 ADC 值
- `ADC Sum` 是 ADC Value 中各值的和

#### 格式 C：PressureChart 压力数据导出

- 由 TestPage 触发
- 含 time + forceN 两列

### 8.2 CSV 上传/解析

**入口**：[ConsistencyPage.tsx:397-493](client/src/pages/ConsistencyPage.tsx#L397-L493)

自动识别两种输入格式：
- **格式 A**：表头含 `传感器#` 或 `压力(N)` — 多列传感器格式
- **格式 B**：表头含 `ADC Value` 或 `ADC Sum` — 分号分隔格式

**上传后自动处理**：
- 过滤：只保留压力上升阶段（0 → 峰值），舍弃下降阶段
- 每个文件用 SERIES_COLORS 中不同颜色渲染
- 最多 20 个文件，超出提示

### 8.3 JSON 导出（Hill 拟合）

**入口**：[DataChart.tsx:340-380](client/src/components/DataChart.tsx#L340-L380)

```json
{
  "hill_fit": {
    "coefficients": { "a": {...}, "b": {...}, "n": {...} },
    "fit_quality": { "r_squared": 0.99, "rmse": 1.23, "method": "LM" },
    "formulas": {
      "forward": { "text": "...", "latex": "...", "latex_symbolic": "..." },
      "inverse": { "text": "...", "latex": "...", "latex_symbolic": "..." }
    }
  },
  "metadata": { "tool": "JQ Tools Factory - Hill Equation Fitting Engine" }
}
```

### 8.4 LaTeX 导出

**入口**：[DataChart.tsx:442](client/src/components/DataChart.tsx#L442)

生成独立 `.tex` 文件，包含：符号公式、代入系数公式、系数列表、拟合质量。

### 8.5 基准文件导出（JSON）

**入口**：[SerialMonitor.tsx:227-288](client/src/components/SerialMonitor.tsx#L227-L288)

```json
{
  "timestamp": "2026-07-23T...",
  "testType": "基准测试",
  "totalDataPoints": 500,
  "pressure": { "average": "25.30", "max": "48.20", "min": "5.10", "samples": 500 },
  "sensorADC": { "传感器#1": { "average": "128.50", ... }, ... }
}
```

### 8.6 文件下载通用函数

```ts
// 所有下载都用同一个模式
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);   // 临时挂载
  link.click();                       // 触发下载
  document.body.removeChild(link);    // 立即移除
  URL.revokeObjectURL(url);           // 释放 Blob URL
}
```

**存在位置**：
- `DataChart.tsx` — `downloadFile()` (JSON/LaTeX)
- `SerialMonitor.tsx` — CSV 导出 + 基准文件导出
- `TestPage.tsx` — CSV 导出
- `sensorData.ts` — `exportToCSV()`（不 append/remove，直接 click）

### 8.7 剪贴板复制

优先使用 `navigator.clipboard.writeText()`，fallback 为 `document.execCommand('copy')`：
```ts
// DataChart.tsx:449-465
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

### 9.1 颜色系统

所有颜色使用 **oklch** 色彩空间（不是 hex/rgb/hsl）：

```css
/* 暗色主题（默认 dark） */
background: oklch(0.17 0.025 265)       /* 主背景 */
border: oklch(0.25 0.03 265)             /* 主边框 */
color: oklch(0.72 0.20 145)              /* 绿色强调 */
color: oklch(0.70 0.18 200)              /* 蓝色强调 */
color: oklch(0.65 0.22 25)               /* 红色警告 */
```

### 9.2 字体

```css
font-family: 'IBM Plex Mono', monospace  /* 代码/数据专用 */
font-family: monospace                    /* 通用等宽 */
```

### 9.3 shadcn/ui 组件架构

- 所有 Radix UI 原语包装在 `client/src/components/ui/` 下
- Dialog / Sheet / Tooltip / Popover / Select 等都使用 Radix Portal 渲染到 document.body
- `cn()` 工具函数来自 `@/lib/utils`，合并 Tailwind 类名

### 9.4 路由

- wouter (SPA)，仅 `/` 和 `/404` 两个路由
- 实际页面切换通过 Home 组件的 Sidebar Tab（5 个页面在同一个 Home 布局下切换）

### 9.5 ErrorBoundary

[ErrorBoundary.tsx](client/src/components/ErrorBoundary.tsx) — class 组件，捕获所有未处理的 React 错误，显示错误栈 + "Reload Page" 按钮。

---

## 十、项目结构

```
JQFactory/
├── client/                         # Vite root
│   ├── index.html                  # HTML 入口
│   └── src/
│       ├── main.tsx                # JS 入口 (createRoot)
│       ├── App.tsx                 # 根组件 (ErrorBoundary → Providers → Router)
│       ├── version.ts              # 版本号管理
│       ├── index.css               # 全局样式
│       ├── components/
│       │   ├── ui/                 # 40+ shadcn/ui 包装组件
│       │   ├── DataChart.tsx       # 散点图 + Hill 拟合 (1071 行)
│       │   ├── SensorMatrix.tsx    # 传感器矩阵热力图 (817 行)
│       │   ├── ConsistencyAnalysis.tsx # CV 分析 + 残差 (713 行)
│       │   ├── HandMatrix.tsx      # 手形分区可视化 (575 行)
│       │   ├── SerialConnectPanel.tsx  # 串口连接面板 (547 行)
│       │   ├── SerialMonitor.tsx   # 数据采集控制面板 (413 行)
│       │   ├── PressureChart.tsx   # 压力时序图 (356 行)
│       │   ├── PressController.tsx # Arduino 下压机控制
│       │   ├── OmniHandControl.tsx # 灵巧手控制
│       │   ├── ErrorBoundary.tsx   # 全局错误边界
│       │   ├── TestResultCard.tsx
│       │   └── ParameterPanel.tsx
│       ├── pages/
│       │   ├── Home.tsx            # 主壳 (527 行)
│       │   ├── ConsistencyPage.tsx # 一致性检测 (867 行)
│       │   ├── RepeatabilityPage.tsx # 重复性检测 (682 行)
│       │   ├── DurabilityPage.tsx  # 耐久性检测 (967 行)
│       │   ├── TestPage.tsx        # 实时监控 (645 行)
│       │   ├── DataLogPage.tsx     # 静态演示页
│       │   ├── AboutPage.tsx       # 产品说明
│       │   ├── LoginPage.tsx       # 登录
│       │   └── NotFound.tsx        # 404
│       ├── hooks/
│       │   ├── useSerialPort.ts    # 串口核心 Hook (776 行)
│       │   ├── useComposition.ts   # IME 组合状态
│       │   ├── usePersistFn.ts     # 持久函数引用
│       │   └── useMobile.tsx       # 移动端检测
│       ├── lib/
│       │   ├── realtimeDataPipeline.ts  # 数据管道 (458 行) ⭐
│       │   ├── sensorDataStreamV2.ts    # 传感器流 (97 行) ⭐
│       │   ├── hillFit.ts           # Hill 方程 + LM 拟合 (600 行)
│       │   ├── sensorData.ts        # 数据模型 + CSV 导出 (343 行)
│       │   ├── serialDriver.ts      # CL2 压力计驱动 (398 行)
│       │   ├── omniHandProtocol.ts  # 灵巧手协议 (74 行)
│       │   └── utils.ts             # cn() 类名合并 (7 行)
│       ├── contexts/
│       │   ├── ThemeContext.tsx      # 主题 (dark only)
│       │   └── ClientContext.tsx     # 登录状态
│       └── config/
│           └── clients.ts           # 客户账户配置
├── server/
│   └── index.ts                    # Express (静态 + SPA fallback, 34 行)
├── shared/                         # 共享类型（目前为空）
├── scripts/
│   └── cleanup-deployments.js      # Cloudflare Pages 旧部署清理
├── patches/
│   └── wouter@3.7.1.patch          # wouter 补丁
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── package.json
└── README.md
```

---

## 十一、关键代码约束速查

### 11.1 禁止事项

- ❌ 不要在高频回调中调用 `setState`
- ❌ 不要用 `useEffect` 同步高频 props 到 ref（直接赋值即可）
- ❌ 不要在 `useEffect` 中遗漏依赖数组（会导致每次渲染重复注册事件）
- ❌ 不要用 `--branch=main` 部署正式环境（正式是 `master`）
- ❌ 不要跳过测试环境直接推正式
- ❌ 不要忘记更新版本号和 README

### 11.2 必须事项

- ✅ 高频数据走全局单例 + Ref，不走 React State
- ✅ 回调函数用 ref 代理模式（`callbackRef.current = fn; useEffect(..., [])`）
- ✅ 文件下载用临时 `<a>` 元素 + Blob URL 模式
- ✅ 颜色用 oklch 色彩空间
- ✅ 数据字体用 'IBM Plex Mono'
- ✅ 每个 try-catch 包裹回调调用（错误隔离）

### 11.3 调试相关

- `RealtimeDataPipeline` 每 2 秒输出调试日志（调用次数、新帧数、重复帧数、订阅者数、fps）
- `updateSensorData` 有帧去重机制（采样关键位置计算签名）
- `.manus-logs/` 目录下存放 Vite 开发服务器收集的浏览器日志

---

## 十二、添加新传感器产品 Checklist

1. `config/clients.ts` — 如有新客户，配置 `allowedProducts`
2. `SerialConnectPanel.tsx` — `SENSOR_PRODUCTS` 数组加一条
3. `useSerialPort.ts` — `SensorProtocol` 类型 + 帧解析分支
4. 测试 → `pnpm run deploy:test` → 验证 → `pnpm run deploy:prod`

---

## 十三、补充约束（Agent 扫描发现）

### 13.1 部署清理脚本

[scripts/cleanup-deployments.js](scripts/cleanup-deployments.js) — 每次部署后自动运行，列出所有部署 → 保留最新 → 删除旧部署，防止 Cloudflare Pages 部署配额累积。

### 13.2 客户端认证模型

- 简单静态凭证匹配（[config/clients.ts](client/src/config/clients.ts)）
- 无 JWT、无后端认证
- 登录状态持久化在 localStorage（key: `jq_client_id`）
- `ClientContext` 监听 `storage` 事件（跨标签页同步登录状态）
- 每个 client 有 `allowedProducts` 白名单，过滤传感器产品下拉列表

### 13.3 传感器产品过滤

- 传感器连接面板的产品列表根据登录客户端的 `allowedProducts` 过滤
- 未登录（默认）用户看到全部 4 种传感器产品
- 当前产品列表：16×16 触觉传感器、32×32 高密度 (JQGY-YL-09)、灏存科技定制、极智动量小黑采集板

### 13.4 力传感器双模式

- `forceDeviceMode` 有两种子状态：
  - `'pressure'` — CL2 压力计（发送 CL2 初始化命令）
  - `'robot'` — 灵巧手（跳过 CL2 初始化，发送使能命令）
- 模式在连接时设置，断开时清除

### 13.5 协议切换规则

- `sensorProtocol` 是 React state，传给 `useSerialPort`
- 切换协议类型会改变读循环中的帧解析器
- **协议必须在调用 `sensorSerial.connect()` 之前设置**

### 13.6 wouter 补丁

[patches/wouter@3.7.1.patch](patches/wouter@3.7.1.patch) — 添加 hook 收集所有路由路径到 `window.__WOUTER_ROUTES__`，供 Manus 运行时使用。

### 13.7 serialDriver.ts（遗留架构）

[client/src/lib/serialDriver.ts](client/src/lib/serialDriver.ts) (398 行) — 旧的全局单例，专门用于 CL2 压力计。维护全局统计（`globalDataPointCount`、`globalCollectionStartTime`），跨组件卸载持久化。新代码通过 `useSerialPort` 间接使用。

### 13.8 DataLogPage（静态演示页）

[client/src/pages/DataLogPage.tsx](client/src/pages/DataLogPage.tsx) (372 行) — 纯静态演示页面，无串口连接，使用纯模拟数据。不在 Sidebar 的 5 个主 Tab 中。

### 13.9 状态栏（Footer）

- 高度 24px，暗色背景
- 显示：APP_VERSION、公司名、压力/传感器连接状态 + 波特率、实时帧率（`F:XXHz S:XXHz`）、当前时间
- 浏览器不支持 Web Serial API 时显示警告

### 13.10 已知技术债务

1. `RealtimeDataPipeline` 和 `SensorDataStreamV2` 功能重叠（都做 pub/sub），可合并
2. `RepeatabilityPage` / `DurabilityPage` 使用模拟数据，未连接真实 pipeline 事件驱动采集
3. `shared/const.ts` 无任何 import 引用，可能废弃
4. CSV 解析逻辑在 ConsistencyPage 和 RepeatabilityPage 中完全重复
5. 无单元测试
6. `serialDriver.ts` 与 `useSerialPort.ts` 功能重叠

### 13.11 命名约定

- 组件文件：PascalCase（`SensorMatrix.tsx`、`DataChart.tsx`）
- Hook 文件：camelCase（`useSerialPort.ts`、`useMobile.tsx`）
- lib 模块：camelCase（`realtimeDataPipeline.ts`、`hillFit.ts`）
- UI 组件：kebab-case 文件名，导出 PascalCase 组件（`dialog.tsx` → `Dialog`）
- 全局单例获取函数：`get` + PascalCase（`getRealtimeDataPipeline()`、`getSensorDataStreamV2()`）
- 事件处理函数：`handle` + 动词（`handleStartRecording`、`handleMouseUp`）
- Ref 变量：`xxxRef` 后缀（`portRef`、`bufferRef`、`isRecordingRef`）
- 类型/接口：PascalCase（`DataSnapshot`、`SensorPoint`、`PressConfig`）
