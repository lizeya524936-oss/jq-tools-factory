# JQ Tools Factory

织物触觉传感器出厂检测工具，基于 Web Serial API 实现浏览器内直连硬件设备，支持压力计（CL2-500N-MH01）和传感器产品的实时数据采集、可视化与检测分析。

## 技术栈

| 类别 | 技术 |
|------|------|
| 前端框架 | React 19 + TypeScript 5.6 |
| 构建工具 | Vite 7 |
| 样式与 UI | Tailwind CSS 4 + shadcn/ui |
| 数据可视化 | Recharts |
| 硬件通信 | Web Serial API |
| 部署平台 | Cloudflare Pages |

## 功能模块

| 模块 | 说明 |
|------|------|
| 压力数据可视化 | 实时绘制压力计 200Hz 采集数据曲线，保持最近 200 个数据点 |
| 传感器矩阵热力图 | 16x16 ADC 矩阵实时热力图展示 |
| 一致性检测 | 多产品均值曲线对比分析 |
| 重复性检测 | 间隔采样误差分析 |
| 耐久性检测 | 机械手循环抓握测试 |
| 数据导出 | CSV 格式测试数据导出 |

## 检测设备

| 设备 | 型号 | 波特率 | 协议 |
|------|------|--------|------|
| 压力计 | CL2-500N-MH01 | 115200 | CL2 二进制协议（0x23 + float32LE + 0x0A） |
| 机械手 | 智元灵巧手 | 460800 | - |

## 在线访问

**永久地址：** [https://jq-tools-factory.pages.dev](https://jq-tools-factory.pages.dev)

> Web Serial API 需要 Chrome/Edge 89+ 浏览器，串口连接功能需在本地环境中使用。

## 本地开发

```bash
pnpm install
pnpm dev
```

## 部署

```bash
pnpm build
npx wrangler pages deploy dist/public --project-name jq-tools-factory --branch master --commit-dirty=true
```

---

## 版本变动记录

### v1.4.4（2026-03-17）

**传感器设备类型识别 + 连接面板自动关闭**

新增两个功能：

1. **设备类型识别**：解析传感器数据包 PKT01 中的设备 ID 字节（帧头4B + 包号1B 后的第6字节），映射关系为 `0x01=LH`（Left Hand）、`0x02=RH`（Right Hand）、`0x03=LF`（Left Foot）、`0x04=RF`（Right Foot）、`0x05=WB`（Whole Body）。识别到的设备类型通过 `onDeviceType` 回调传递到 `SerialDataContext`，并在传感器连接按钮标签和底部状态栏显示。

2. **连接面板自动关闭**：串口连接成功后，`SerialConnectPanel` 自动收起展开的连接面板；点击顶部连接按钮可随时切换面板展开/收起（已连接状态下展开显示连接详情和断开按钮）。

修改文件：`client/src/hooks/useSerialPort.ts`、`client/src/pages/Home.tsx`、`client/src/components/SerialConnectPanel.tsx`

### v1.4.3（2026-03-17）

**一致性页面压力数据可视化与综合视图位置互换**

将右侧列中“压力数据可视化”（PressureChart）与“压力 & ADC Sum 综合曲线”（DataChart）的上下位置互换，现在压力实时曲线在上方，综合分析曲线在下方。

修改文件：`client/src/pages/ConsistencyPage.tsx`

### v1.4.2（2026-03-17）

**重新规划页面布局，支持整页滚动**

数据采集控制区域的按钮被挤压出可视区域外。根本原因是 `Home.tsx` 中主内容区域 `<main>` 设置了 `overflow-hidden`，同时 `ConsistencyPage` 外层容器使用 `h-full` 限制了高度。修复方案：`<main>` 改为 `overflow-auto` 允许滚动，`ConsistencyPage` 外层从 `h-full` 改为 `minHeight: 100%` 允许内容自然撑开高度。

修改文件：`client/src/pages/Home.tsx`、`client/src/pages/ConsistencyPage.tsx`

### v1.4.1（2026-03-17）

**修复传感器矩阵与下方区块溢出覆盖问题**

16×16 矩阵在 520px 宽度下内容高度超出容器，导致矩阵底部与下方的“导出数据”“重置”按钮及“一致性判定”区域产生视觉覆盖。修复方案：左侧列容器添加 `overflow-y: auto` 使其可滚动，矩阵容器移除 `flex-1 min-h-0` 改为 `flexShrink: 0` 保持自然高度。

修改文件：`client/src/pages/ConsistencyPage.tsx`

### v1.4.0（2026-03-17）

**一致性检测页面精简优化**

根据实际使用需求精简了一致性检测页面的布局：移除了“多产品对比”和“数据表格”两个 Tab 页，仅保留综合视图；移除了“平均压力”和“平均ADC Sum”统计卡片；移除了“开始检测”按钮区域（保留导出和重置按钮）；将传感器数组展示区域从 384px 放大到 520px，提升矩阵可视化效果。

修改文件：`client/src/pages/ConsistencyPage.tsx`

### v1.3.9（2026-03-17）

**重置按钮增加 CMD_RESET 归零指令**

在 `useSerialPort` Hook 中新增 `sendCommand()` 方法，通过 `SerialCtx` 上下文将 `sendForceCommand` 暴露给所有子组件。点击重置按钮时，除了清空界面数据外，还会向压力计发送 `CMD_RESET`（`0x23 0x55 0x00 0x0A`）归零指令，与硬件状态保持同步。涉及页面包括 PressureChart、ConsistencyPage、RepeatabilityPage 和 DurabilityPage。

修改文件：`client/src/hooks/useSerialPort.ts`、`client/src/pages/Home.tsx`、`client/src/components/PressureChart.tsx`、`client/src/pages/ConsistencyPage.tsx`、`client/src/pages/RepeatabilityPage.tsx`、`client/src/pages/DurabilityPage.tsx`

### v1.3.8（2026-03-17）

**修复压力计数据解析方式，彻底解决图表刷新问题**

v1.3.4 至 v1.3.7 版本中，`useSerialPort` 的 force role 使用 ASCII 文本行解析（`TextDecoder` + `parseFloat`）处理压力计数据，但 CL2-500N-MH01 压力计实际发送的是二进制协议帧（`0x23` + 4 字节 float32 小端 + `0x0A`），导致数据无法被正确解析，图表无法实时刷新。

本版本将 force role 的数据解析逻辑完全改写为与 v1.3.1 中 `SerialDriver.parseBuffer()` 一致的 CL2 二进制协议解析，在字节缓冲区中查找 `0x23` 帧头，提取 4 字节 float32 小端数据，校验 `0x0A` 帧尾，确保每一帧数据都被正确解析并传递到图表组件。

修改文件：`client/src/hooks/useSerialPort.ts`

### v1.3.7（2026-03-17）

**新增 subscribeForce 专用通道，消除数据丢失**

在 `RealtimeDataPipeline` 中新增 `subscribeForce()` 专用回调注册方法，`PressureChart` 通过该通道直接接收每个压力数据点，不受 sensor 数据更新干扰，不创建 snapshot 对象，零 GC 开销。

修改文件：`client/src/lib/realtimeDataPipeline.ts`、`client/src/components/PressureChart.tsx`

### v1.3.6（2026-03-17）

**改为 subscribe 事件订阅模式，修复采集频率和延迟问题**

将 `PressureChart` 从 50ms 定时器轮询改为 `pipeline.subscribe()` 事件订阅模式，消除轮询间隔导致的频率瓶颈（20Hz → 200Hz）和延迟叠加。

修改文件：`client/src/components/PressureChart.tsx`

### v1.3.5（2026-03-17）

**压力图表改为定时轮询模式**

连接后持续采集数据并实时绘制 200 个数据点，无论压力值是否变化都持续更新图表，解决了压力值不变时图表停止刷新的问题。

修改文件：`client/src/components/PressureChart.tsx`

### v1.3.4（2026-03-17）

**修复压力计数据无法显示的 bug**

`PressureChart` 从依赖已废弃的 `SerialDriver` 旧单例改为通过 `useSerialData()` 从 `SerialCtx` 读取 `latestForceN`，统一数据流架构。

修改文件：`client/src/components/PressureChart.tsx`

### v1.3.3（2026-03-17）

**压力计连接时自动发送 CL2 初始化命令**

在 `useSerialPort` 的 `connect` 方法中，force role 连接成功后自动发送 `CMD_CONNECT`（`0x23 0x50 0x00 0x0A`）和 `CMD_START`（`0x23 0x51 0x00 0x0A`），断开时发送 `CMD_STOP`（`0x23 0x52 0x00 0x0A`）。

修改文件：`client/src/hooks/useSerialPort.ts`

### v1.3.2（2026-03-17）

**右上角改为"检测设备"选择器，移除压力图表内连接按钮**

将右上角"选择力学仪器"改为"选择检测设备"，支持在压力计（CL2-500N-MH01，115200）和机械手（智元灵巧手，460800）之间切换。移除 `PressureChart` 内部的连接/断开按钮，保留重置按钮。

修改文件：`client/src/components/SerialConnectPanel.tsx`、`client/src/components/PressureChart.tsx`

### v1.3.1（2026-03-17）

**修复切换页面后频率显示归零的 bug**

将 `PressureChart` 的频率统计数据（`dataPointCount`、`collectionStartTime`）从组件级局部 Ref 提升至 `SerialDriver` 全局单例持久保存，组件挂载时从全局单例恢复数据，解决页面切换导致统计归零的问题。

修改文件：`client/src/lib/serialDriver.ts`、`client/src/components/PressureChart.tsx`

### v1.3.0

**初始版本（项目文档基准版本）**

包含完整的串口通信、数据采集、可视化、一致性/重复性/耐久性检测功能。
