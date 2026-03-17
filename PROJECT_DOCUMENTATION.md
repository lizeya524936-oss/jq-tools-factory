# JQ Tools Factory - 项目使用说明文档

**版本：** v1.3  
**产品名称：** JQ Tools Factory 产品出厂检测工具  
**开发方：** 矩侨工业  
**文档日期：** 2026年3月13日

---

## 一、项目概述

JQ Tools Factory 是一款基于 Web 技术的**织物触觉传感器产品出厂检测工具**，通过 Web Serial API 连接力学仪器和传感器产品，实现传感器 ADC 数据采集、力学数据采集、一致性/重复性/耐久性三种检测模式，以及机械手（智元灵巧手）自动化控制。整个系统运行在浏览器中（Chrome/Edge 89+），无需安装任何本地软件。

### 1.1 核心功能

| 功能模块 | 说明 |
|---------|------|
| 传感器数据采集 | 通过串口连接织物触觉传感器，实时采集 16×16（最大 64×64）ADC 矩阵数据 |
| 力学数据采集 | 通过串口连接 CL2-500N-MH01 测力仪，实时采集压力值（N） |
| 一致性检测 | 手动垂直下压机，多产品均值曲线对比，误差阈值判定 |
| 重复性检测 | PLC 可编程垂直下压机，间隔采样，误差阈值判定 |
| 耐久性检测 | 机械手反复抓握，验证传感器 ADC 有效性和灵敏度变化 |
| 机械手控制 | 通过串口控制智元灵巧手，支持 hold/release 循环和自定义动作 |
| 数据导出 | CSV 格式导出，包含绝对时间戳、压力值、传感器 ADC 数据 |

### 1.2 技术栈

| 技术 | 版本/说明 |
|------|----------|
| React | 19.2.1 |
| TypeScript | 5.6.3 |
| Tailwind CSS | 4.x |
| Vite | 7.x |
| shadcn/ui | Radix UI 组件库 |
| Recharts | 2.x（数据可视化） |
| Framer Motion | 12.x（动画） |
| Web Serial API | Chrome/Edge 89+ 原生支持 |
| 字体 | IBM Plex Sans + IBM Plex Mono |

---

## 二、环境要求与安装

### 2.1 运行环境

浏览器必须支持 Web Serial API，目前仅 **Chromium 内核浏览器**（Chrome 89+、Edge 89+）支持。Safari 和 Firefox 不支持 Web Serial API。页面必须在**顶层窗口**中打开（不能在 iframe 中），否则会报 `Permissions Policy` 错误。

### 2.2 安装步骤

```bash
# 1. 克隆项目
git clone <repository-url> jq-tools-factory
cd jq-tools-factory

# 2. 安装依赖（使用 pnpm）
pnpm install

# 3. 启动开发服务器
pnpm dev

# 4. 构建生产版本
pnpm build

# 5. 预览生产版本
pnpm preview
```

### 2.3 项目脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发服务器（端口 3000） |
| `pnpm build` | 构建生产版本 |
| `pnpm preview` | 预览生产构建 |
| `pnpm check` | TypeScript 类型检查 |
| `pnpm format` | Prettier 代码格式化 |

---

## 三、项目文件结构

```
jq-tools-factory/
├── client/
│   ├── index.html                    # HTML 入口，加载 IBM Plex 字体
│   ├── public/                       # 静态资源目录
│   └── src/
│       ├── main.tsx                  # React 入口
│       ├── App.tsx                   # 路由配置（暗色主题）
│       ├── index.css                 # 全局样式（Tailwind + 设计 Token）
│       ├── const.ts                  # 共享常量
│       │
│       ├── pages/                    # 页面组件
│       │   ├── Home.tsx              # 主页面（布局、串口管理、Context Provider）
│       │   ├── TestPage.tsx          # 测试页（传感器矩阵 + 数据采集）
│       │   ├── ConsistencyPage.tsx   # 一致性检测页
│       │   ├── RepeatabilityPage.tsx # 重复性检测页
│       │   ├── DurabilityPage.tsx    # 耐久性检测页
│       │   ├── DataLogPage.tsx       # 数据记录汇总页
│       │   ├── AboutPage.tsx         # 关于页面
│       │   └── NotFound.tsx          # 404 页面
│       │
│       ├── components/               # 可复用组件
│       │   ├── Sidebar.tsx           # 左侧导航栏
│       │   ├── SensorMatrix.tsx      # 传感器点阵展示/选择组件（816行）
│       │   ├── OmniHandControl.tsx   # 智元灵巧手控制面板（692行）
│       │   ├── PressureChart.tsx     # 压力数据实时图表（470行）
│       │   ├── SerialMonitor.tsx     # 数据采集控制面板（396行）
│       │   ├── SerialConnectPanel.tsx# 串口连接面板（350行）
│       │   ├── ParameterPanel.tsx    # 检测参数设置面板（279行）
│       │   ├── DataChart.tsx         # 力学-ADC 数据图表（222行）
│       │   ├── DataTable.tsx         # 数据记录表格（151行）
│       │   ├── TestResultCard.tsx    # 检测结果评估卡片（157行）
│       │   ├── ConsistencyChart.tsx  # 一致性多产品对比图表（135行）
│       │   ├── ErrorBoundary.tsx     # 错误边界组件（62行）
│       │   └── ui/                   # shadcn/ui 基础组件（50+个）
│       │
│       ├── hooks/                    # 自定义 Hook
│       │   ├── useSerialPort.ts      # Web Serial API 串口管理（439行，核心）
│       │   ├── useComposition.ts     # 中文输入法组合事件处理
│       │   ├── usePersistFn.ts       # 持久化函数引用
│       │   └── useMobile.tsx         # 移动端检测
│       │
│       ├── lib/                      # 工具库
│       │   ├── sensorData.ts         # 传感器数据模型和工具函数（342行）
│       │   ├── serialDriver.ts       # 独立串口驱动（CL2 测力仪协议，363行）
│       │   ├── realtimeDataPipeline.ts # 实时数据流管道（169行）
│       │   ├── sensorDataStreamV2.ts # 传感器数据流 V2 全局单例（96行）
│       │   └── utils.ts              # 通用工具
│       │
│       └── contexts/
│           └── ThemeContext.tsx       # 主题上下文（暗色/亮色）
│
├── server/                           # 服务端占位目录（静态项目不使用）
├── shared/                           # 共享类型占位目录
├── package.json                      # 项目配置和依赖
└── tsconfig.json                     # TypeScript 配置
```

---

## 四、界面功能描述

### 4.1 整体布局

整个应用采用**三段式布局**：顶部标题栏（48px）、中间主体区域（左侧导航 + 右侧内容）、底部状态栏（24px）。设计风格为**精密科学仪器**风格，深色主题（背景色 `oklch(0.13 0.02 265)`），使用 IBM Plex 字体系列。

**顶部标题栏**包含品牌标识（JQ TOOLS FACTORY）、当前页面标题和副标题、两个串口连接面板（力学仪器和传感器）、实时数据预览（力值 F 和 ADC Sum）、连接状态指示灯、实时时钟。

**左侧导航栏**（Sidebar）包含 6 个导航项：测试页、一致性、重复性、耐久性、数据记录、关于。每个导航项显示图标、中文名称和英文副标题。底部显示版本号和公司信息。

**底部状态栏**显示软件版本、公司名称、两个串口的连接状态（端口号和波特率）、当前时间。

### 4.2 测试页（TestPage）

测试页是传感器数据的**基础测试和采集界面**。页面分为左右两栏：

**左栏**包含传感器矩阵点阵组件（SensorMatrix），支持 1×1 到 64×64 的矩阵尺寸设置（默认 8×8），支持单点选取和矩形框选，选中点以绿色高亮显示并标注在矩阵中的序号。矩阵下方是检测参数面板和数据采集控制面板。

**右栏**包含力学-ADC 数据图表（DataChart）和数据记录表格（DataTable）。图表横坐标为压力值（N），纵坐标为选中传感器点的 ADC 求和值。

**数据采集功能：** 点击"开始采集"按钮后，系统以 10ms 间隔从 `SensorDataStreamV2` 全局单例获取传感器数据，从 `RealtimeDataPipeline` 获取压力数据，写入内存缓冲区。点击"停止采集"后自动导出 CSV 文件。CSV 格式为：`时间(xxh.xxm.xxs.xxxms), 压力(N), 传感器#N, 传感器#M, ...`。选点状态持久化到 localStorage，页面切换后自动恢复。

### 4.3 一致性检测页（ConsistencyPage）

一致性检测采用**检测方法 A**：手动垂直下压机，对多个产品进行检测，剔除偏差较大的数据，求出均值曲线。

**左栏**包含传感器矩阵（支持点选/全选/清空/中心区域/边缘区域快捷选择）、检测参数面板（误差阈值、产品数量、采样数、力学范围等）、"开始检测"按钮、一致性判定结果卡片、数据采集控制面板（SerialMonitor）。

**右栏**包含三个标签页：
- **综合视图**：压力与 ADC Sum 综合曲线图，下方显示平均压力、平均 ADC Sum 统计卡片和压力数据可视化（PressureChart）
- **多产品对比**：10 条产品均值曲线的线性对比图（ConsistencyChart）
- **数据表格**：详细数据记录表格（DataTable）

**判定方法 A：** 在 forceMin 到 forceMax 范围内，选取 5 个等间隔的一致数据点，计算 10 条曲线的线性均值，判断误差范围是否在 ±threshold% 内。

### 4.4 重复性检测页（RepeatabilityPage）

重复性检测采用**检测方法 B**：PLC 可编程垂直下压机，间隔 1 分钟采样，验证两类数据的误差范围。

**左栏**包含传感器矩阵、检测参数面板（误差阈值、循环次数、采样间隔等）、"开始检测"按钮、重复性判定结果卡片、数据采集控制面板。

**右栏**包含三个标签页：
- **散点图**：压力-ADC 散点分布图（ScatterChart），直观展示数据离散程度
- **趋势图**：ADC Sum 随时间变化的趋势曲线（AreaChart），观察传感器响应稳定性
- **数据表格**：详细数据记录

### 4.5 耐久性检测页（DurabilityPage）

耐久性检测使用**机器人灵巧手套**反复抓握特定物体 N 次，验证全部传感器点的有效性和灵敏度是否变化。

**左栏**包含传感器矩阵、检测参数面板、"开始检测"按钮、耐久性判定结果卡片、数据采集控制面板。

**右栏**包含三个标签页：
- **趋势图**：ADC Sum 随抓握次数变化的面积图（AreaChart），观察灵敏度衰减趋势
- **灵巧手控制**：OmniHandControl 组件，支持串口连接机械手、设置循环次数和动作间隔、执行 hold/release 循环
- **数据表格**：详细数据记录

### 4.6 数据记录页（DataLogPage）

数据记录页汇总展示所有检测模式的数据，支持按检测类型筛选（一致性/重复性/耐久性），提供 CSV 格式批量导出功能。页面包含数据统计柱状图和详细数据表格。

### 4.7 关于页（AboutPage）

展示产品信息（JQ Tools Factory v1.2）、矩侨工业公司信息、检测工具功能说明、支持的检测目标、技术规格等。

---

## 五、核心组件详解

### 5.1 SensorMatrix（传感器点阵组件）

这是整个系统最核心的可视化组件（816行），负责传感器矩阵的展示和交互。

**功能特性：**
- 支持 1×1 到 64×64 的矩阵尺寸动态调整
- 支持两种选择模式：单点选取（鼠标点击）和矩形框选（鼠标拖拽）
- 选中点以绿色高亮，未选中点根据 ADC 值显示蓝-红渐变色
- 支持快捷操作：全选、清空、中心区域选择、边缘区域选择
- 支持点击放大查看局部区域详情
- 实时显示每个点的 ADC 值（0-255）
- 已选点数量和总点数实时统计

**Props 接口：**
```typescript
interface SensorMatrixProps {
  sensors: SensorPoint[];
  onSelectionChange: (sensors: SensorPoint[]) => void;
  matrixRows: number;
  matrixCols: number;
  onMatrixSizeChange?: (rows: number, cols: number) => void;
}
```

### 5.2 OmniHandControl（智元灵巧手控制面板）

通过 Web Serial API 控制智元灵巧手（OmniHand），支持自动化抓握循环测试。

**通信协议：**
- 波特率：460800
- 帧格式：`0xEE 0xAA` + 设备ID(2B) + 数据长度(1B) + CMD(1B) + DATA(NB) + CRC16(2B)
- CRC16 算法：CCITT（多项式 0x1021，初始值 0x0000），校验范围从帧头到数据段结束
- 使能命令：CMD=0x01, DATA=0x01
- 失能命令：CMD=0x01, DATA=0x00
- 设置全轴位置：CMD=0x08, DATA=10个 uint16（小端序）

**预设动作：**

| 动作名称 | 说明 | 10轴位置值 |
|---------|------|-----------|
| hold | 抓握 | 3191, 4095, 452, 133, 0, 0, 2340, 0, 3430, 0 |
| release2 | 释放 | 2074, 3404, 3111, 3085, 3749, 3749, 3297, 3882, 1915, 3909 |
| ok | OK手势 | 2074, 3404, 452, 133, 3749, 3749, 3297, 3882, 1915, 3909 |
| release | 完全释放 | 2074, 3404, 3111, 3085, 3749, 3749, 3297, 3882, 1915, 3909 |

**循环控制：** 支持设置循环次数（1-100000）和动作间隔（500-10000ms），执行 hold → 等待 → release2 → 等待 → 循环的自动化流程。支持加载自定义 JSON 动作文件。

### 5.3 PressureChart（压力数据实时图表）

使用独立的 `serialDriver` 连接 CL2 测力仪，实时绘制压力曲线。采用 Recharts 的 ComposedChart + Area + Line 组合，橙黄色主题。

**性能优化策略：** 数据回调只写入 Ref 缓冲区（零 React 开销），UI 通过 200ms 定时器批量刷新，最多保留 200 个数据点。

### 5.4 SerialMonitor（数据采集控制面板）

负责传感器和压力数据的同步采集和 CSV 导出。

**数据源策略（全部绕过 React State，零延迟）：**
- 传感器数据：从 `SensorDataStreamV2` 全局单例获取
- 压力数据：从 `RealtimeDataPipeline` 全局单例获取
- 采集间隔：10ms（`setInterval`）
- 数据写入内存缓冲区，不触发 React 重渲染
- 停止采集时一次性导出 CSV

---

## 六、数据流架构

### 6.1 串口数据流

整个系统有两条独立的串口数据链路：

**链路1 — 传感器数据：**
```
串口(921600bps) → useSerialPort(role:'sensor') → processSensorBuffer()
  → 帧解析(AA 55 03 99 + 包号 + 设备类型 + 数据)
  → processSensorPackets() → buildMatrix(16×16)
  → SensorDataStreamV2.updateSensorData() [全局单例，零延迟]
  → RealtimeDataPipeline.updateSensorData() [全局单例]
  → pendingMatrixRef/pendingAdcRef [暂存到 Ref]
  → 100ms UI 定时器 → setState [批量更新 React State]
  → SerialCtx.Provider → 子组件消费
```

**链路2 — 力学仪器数据：**
```
串口(115200bps) → useSerialPort(role:'force') → parseForceData()
  → onForceData 回调
  → RealtimeDataPipeline.updateForceData() [全局单例，零延迟]
  → pendingForceRef [暂存到 Ref]
  → 100ms UI 定时器 → setState [批量更新 React State]
  → SerialCtx.Provider → 子组件消费
```

**链路3 — PressureChart 独立链路（仅一致性页面）：**
```
串口(19200bps) → serialDriver.connect() → readLoop()
  → parseBuffer() → onDataCallback
  → RealtimeDataPipeline.updateForceData() [全局单例]
  → dataBufferRef [暂存到 Ref]
  → 200ms UI 定时器 → setPressureData [批量更新]
```

### 6.2 全局数据单例

| 单例 | 文件 | 职责 |
|------|------|------|
| `SensorDataStreamV2` | sensorDataStreamV2.ts | 存储最新的传感器矩阵、ADC 值、原始字节 |
| `RealtimeDataPipeline` | realtimeDataPipeline.ts | 存储最新的压力值、传感器矩阵、ADC 值 |
| `SerialDriver` | serialDriver.ts | PressureChart 独立的串口驱动（CL2 协议） |

### 6.3 性能优化策略

系统的核心性能挑战是：**两条高频串口数据流同时运行时，频繁的 React `setState` 会阻塞主线程，导致串口 `reader.read()` 的 Promise 回调被延迟**。

解决方案采用**"写入全局单例 + 定时器批量刷新"**架构：
1. 串口数据到来时，立即写入全局单例（`SensorDataStreamV2` / `RealtimeDataPipeline`），零开销
2. 同时暂存到 Ref（`pendingForceRef` / `pendingMatrixRef` 等），不触发 React 重渲染
3. 每 100ms 由 UI 定时器检查是否有待更新数据，批量调用 `setState`
4. 采集时直接从全局单例读取数据，完全绕过 React 调度机制

---

## 七、通信协议详解

### 7.1 传感器产品协议

| 参数 | 值 |
|------|-----|
| 波特率 | 921600 bps |
| 数据位 | 8 |
| 校验位 | 无 |
| 停止位 | 1 |

**帧格式（双包协议）：**

```
帧头(4B): 0xAA 0x55 0x03 0x99
PKT01(134B): 帧头 + 0x01(包号) + 设备类型(1B) + 128字节传感器数据
PKT02(150B): 帧头 + 0x02(包号) + 设备类型(1B) + 128字节传感器数据 + 16字节陀螺仪
```

**设备类型字节：**

| 值 | 含义 |
|----|------|
| 0x01 | LH (Left Hand) |
| 0x02 | RH (Right Hand) |
| 0x03 | LF (Left Foot) |
| 0x04 | RF (Right Foot) |
| 0x05 | WB (Whole Body) |

PKT01 的 128 字节对应传感器矩阵的第 1-128 点（第 0-7 行），PKT02 的前 128 字节对应第 129-256 点（第 8-15 行），两包拼合后构成完整的 16×16 = 256 字节矩阵。每个字节为 0-255 的 ADC 值。矩阵按行优先排列。

### 7.2 CL2 测力仪协议

| 参数 | 值 |
|------|-----|
| 波特率 | 19200 bps（PressureChart 默认）/ 115200 bps（Home.tsx 默认） |
| 数据位 | 8 |
| 校验位 | 无 |
| 停止位 | 1 |

**命令格式（serialDriver）：**

| 命令 | 字节序列 |
|------|---------|
| 连接 | 0x23 0x50 0x00 0x0A |
| 重置 | 0x23 0x55 0x00 0x0A |
| 开始采集 | 0x23 0x51 0x00 0x0A |
| 停止采集 | 0x23 0x52 0x00 0x0A |

**数据格式：** `0x23` + 4字节浮点数（小端序） + `0x0A`，或 ASCII 文本行如 `+0012.34N\r\n`。

### 7.3 智元灵巧手协议

| 参数 | 值 |
|------|-----|
| 波特率 | 460800 bps |
| 数据位 | 8 |
| 校验位 | 无 |
| 停止位 | 1 |

**帧格式：**
```
帧头(2B): 0xEE 0xAA
设备ID(2B): 默认 0x01 0x00 (小端序)
数据长度(1B): CMD + DATA 的总字节数
CMD(1B): 命令字节
DATA(NB): 数据字节
CRC16(2B): CCITT CRC16，校验范围从帧头到 DATA 结束
```

**CRC16 算法：** CCITT 标准，多项式 0x1021，初始值 0x0000。对每个字节的每一位进行移位和异或运算。

---

## 八、CSV 数据格式

### 8.1 SerialMonitor 导出格式

```csv
时间,压力(N),传感器#2,传感器#3,传感器#4
10h.25m.33s.127ms,12.34,128,96,64
10h.25m.33s.137ms,12.56,130,98,66
```

时间列使用电脑绝对时间，格式为 `xxh.xxm.xxs.xxxms`。传感器列名中的编号对应矩阵中选中点的一维索引（从 0 开始）。

### 8.2 TestPage 导出格式

```csv
时间,压力(N),传感器#2,传感器#3,传感器#4
10h.25m.33s.127ms,12.34,128,96,64
```

格式与 SerialMonitor 相同，区别在于 TestPage 的采集是在测试页中进行的。

---

## 九、本地存储（localStorage）

系统使用 localStorage 持久化以下数据：

| Key | 说明 | 格式 |
|-----|------|------|
| `selectedSensorPoints` | 选中的传感器点坐标 | JSON 数组 `[[row,col], ...]` |
| `matrixRows` | 矩阵行数 | 数字字符串 |
| `matrixCols` | 矩阵列数 | 数字字符串 |

选点状态在一致性页面和测试页之间共享，切换页面后自动恢复。

---

## 十、开发注意事项

### 10.1 Web Serial API 限制

Web Serial API 必须在**安全上下文**（HTTPS 或 localhost）中使用，且必须在**顶层窗口**中运行（不能在 iframe 中）。`navigator.serial.requestPort()` 必须由用户手势（如点击事件）触发。

### 10.2 主线程性能

两条串口数据流同时运行时，必须避免高频 `setState`。所有串口数据回调应只写入全局单例和 Ref，通过定时器批量更新 UI。如果出现传感器数据延迟或阻塞，首先检查是否有组件在数据回调中直接调用 `setState`。

### 10.3 传感器帧解析

传感器帧格式为双包协议，PKT01 和 PKT02 必须成对拼合才能构成完整的 16×16 矩阵。帧头后的第 5 字节是包号（0x01/0x02），第 6 字节是设备类型（0x01-0x05），第 7 字节开始才是传感器数据。如果矩阵数据出现错位，检查帧解析中的字节偏移是否正确。

### 10.4 双串口系统

当前系统存在两套独立的压力计串口连接：`useSerialPort({role:'force'})` 和 `serialDriver`（PressureChart 内部）。两者不会冲突（因为连接不同的物理串口），但数据都会写入 `RealtimeDataPipeline`。后续优化可考虑合并为单一串口管理层。

---

## 十一、已知问题与后续规划

### 11.1 已知限制

1. PressureChart 使用独立的 `serialDriver`，与 Home.tsx 的 `useSerialPort` 是两套并行系统
2. 陀螺仪数据（PKT02 最后 16 字节）目前未解析和展示
3. 耐久性检测的机械手循环与传感器采集尚未自动联动

### 11.2 后续规划

1. **统一串口管理层** — 合并 `serialDriver` 和 `useSerialPort` 为单一系统
2. **设备类型显示** — 在界面上显示当前连接的传感器设备类型（LH/RH/LF/RF/WB）
3. **陀螺仪数据解析** — 解析 PKT02 中的 16 字节陀螺仪数据并展示姿态信息
4. **机械手-传感器联动** — 在 hold 动作后自动触发传感器采集，生成耐久性衰减曲线
5. **批量测试模式** — 支持连续多次采集并自动编号文件
6. **测试报告生成** — 将检测数据整合为 PDF 格式的出厂检测报告

---

*文档由 Manus AI 自动生成，基于项目源码分析。如有疑问请联系矩侨工业技术支持。*
