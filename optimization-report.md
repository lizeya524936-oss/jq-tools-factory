# JQ Tools Factory 代码全局审查与优化报告

**项目名称：** JQ Tools Factory - 产品出厂检测工具 v1.6  
**审查日期：** 2026年3月4日  
**审查范围：** client/src 目录下全部 TypeScript/TSX 源码文件  

---

## 一、项目概况

本项目是一个基于 React 19 + Tailwind 4 的前端应用，用于织物触觉传感器的出厂检测。项目通过 Web Serial API 连接力学仪器和传感器设备，支持一致性检测、重复性检测、耐久性检测三种检测模式，并提供实时数据可视化和 CSV 数据导出功能。

优化前项目共有 **95 个源码文件**，经过本次审查后精简为 **85 个**，删除了 10 个废弃或冗余文件，同时修复了数据流架构中的闭包问题和 import 残留。

---

## 二、审查发现

### 2.1 废弃文件（Dead Code）

通过对全部源码文件的引用关系进行交叉分析，识别出以下三类废弃代码：

| 分类 | 文件名 | 行数 | 废弃原因 |
|------|--------|------|----------|
| lib 层 | `parallelDataCollector.ts` | 145 | SerialMonitor 已重写，不再使用并行采集器 |
| lib 层 | `sensorDataManager.ts` | 112 | 已被 `SensorDataStreamV2` 完全取代 |
| lib 层 | `sensorDataStreamDebug.ts` | 63 | 仅用于 console.log 调试输出，生产环境不应保留 |
| 组件层 | `DataStreamDiagnostics.tsx` | 110 | 零引用，调试面板已废弃 |
| 组件层 | `DetailedDataStreamDiagnostics.tsx` | 101 | 零引用，详细调试面板已废弃 |
| 组件层 | `Map.tsx` | 155 | 模板自带的地图组件，项目无地图需求 |
| 组件层 | `OmniHandControl.tsx` | 213 | 机械手控制面板，功能尚未实现 |
| 组件层 | `ADCHeatmap.tsx` | 103 | 零引用，热力图组件已废弃 |
| 组件层 | `PressureChartSimple.tsx` | 202 | PressureChart 的简化版本，未被使用 |
| 组件层 | `ManusDialog.tsx` | 85 | 零引用，自定义对话框已废弃 |

以上 10 个文件合计 **1,289 行代码**，全部为无效代码。

### 2.2 数据流架构不一致

项目中存在 **四个功能重叠的数据管理单例**，这是多次迭代优化后遗留的历史问题：

| 数据管道 | 更新位置 | 消费位置 | 职责 |
|----------|----------|----------|------|
| `SensorDataStreamV2` | `useSerialPort.ts` | TestPage, SerialMonitor | 传感器矩阵 + ADC 值 |
| `RealtimeDataPipeline` | `Home.tsx` 回调 | ConsistencyPage | 压力 + 传感器 + ADC |
| `serialDriver` | PressureChart 自身 | PressureChart | 独立的压力串口连接 |
| React Context (`SerialCtx`) | `Home.tsx` | 所有子页面 | 全部数据的 React State 版本 |

其中 `SensorDataStreamV2` 和 `RealtimeDataPipeline` 功能高度重叠，但分别在不同位置被更新，容易造成数据不同步。`serialDriver` 是 PressureChart 的独立串口驱动，与 `useSerialPort` 的力学仪器连接逻辑完全独立，两者各自管理自己的串口端口选择和连接状态。

### 2.3 闭包捕获问题

`ConsistencyPage.handleStart` 中的 `setInterval` 回调通过闭包捕获了 `latestSensorMatrix` 和 `latestAdcValues`，但这两个值在 `useCallback` 的依赖数组中并未列出，导致闭包中始终持有初始值（null），采集到的传感器数据全为空。

### 2.4 残留 import

`Home.tsx` 中保留了 `getSensorDataManager` 的 import 语句，但方法体中从未调用过该模块的任何方法。`useSerialPort.ts` 中保留了 `getSensorDataStreamDebug` 的 import 和三处调用，每次收到数据包都会执行 `console.log`，在高频数据流下会产生大量无用日志输出。

---

## 三、优化措施

### 3.1 删除废弃文件

删除了上述 10 个废弃文件，减少 1,289 行无效代码。删除过程中发现 `useComposition.ts` 和 `usePersistFn.ts` 被 shadcn/ui 的 `input.tsx` 和 `textarea.tsx` 组件依赖，因此予以恢复保留。

### 3.2 修复编译错误

`DurabilityPage` 中引用了已删除的 `OmniHandControl` 组件，将其替换为一个简洁的占位提示面板（"机械手控制面板 - 功能开发中"），保持页面布局完整。

### 3.3 清理残留 import 和调试代码

从 `Home.tsx` 中移除了未使用的 `getSensorDataManager` import。从 `useSerialPort.ts` 中移除了 `getSensorDataStreamDebug` 的 import 及全部三处调用（`recordPkt01`、`recordPkt02`、`recordProcessed`），消除了高频 console.log 输出对浏览器性能的影响。

### 3.4 修复 ConsistencyPage 数据流

将 `ConsistencyPage.handleStart` 中的传感器数据获取方式从闭包中的 React State 改为直接调用 `getSensorDataStreamV2().getLatestAdcValues()`。该全局单例在 `useSerialPort` 的 `processSensorPackets` 中被同步更新，不受 React 调度和闭包捕获的影响，确保每次 `setInterval` 回调都能获取到最新的传感器数据。

---

## 四、优化结果

| 指标 | 优化前 | 优化后 | 变化 |
|------|--------|--------|------|
| 源码文件数 | 95 | 85 | -10 |
| 废弃代码行数 | 1,289 | 0 | -1,289 |
| 数据管道数量 | 4 | 4 | 不变（保持兼容） |
| 生产环境调试日志 | 3处高频输出 | 0 | -3 |
| TypeScript 编译错误 | 0 | 0 | 通过 |

---

## 五、保留未动的模块及理由

以下模块经评估后决定暂不改动，原因如下：

**`serialDriver.ts`（363行）** — PressureChart 组件的独立压力串口驱动。虽然与 `useSerialPort` 在功能上有重叠，但 PressureChart 的连接/断开/重置逻辑与传感器串口完全独立，贸然合并可能影响已稳定的压力数据采集功能。

**`realtimeDataPipeline.ts`（170行）** — ConsistencyPage 的 `handleStart` 仍通过该管道获取压力数据（`snapshot.forceN`）。虽然与 `SensorDataStreamV2` 功能重叠，但两者的更新时机不同（前者在 Home.tsx 回调中，后者在 useSerialPort 中），合并需要重新设计数据更新链路。

**`ErrorBoundary.tsx`（62行）** — 被 `App.tsx` 包裹在路由外层，作为全局错误边界。虽然当前未触发过，但对生产环境的稳定性有保障价值。

**`sensorData.ts` 中的 `MatrixConfig` 接口** — 未被任何文件引用，但作为类型定义不产生运行时代码，保留不影响打包体积。
