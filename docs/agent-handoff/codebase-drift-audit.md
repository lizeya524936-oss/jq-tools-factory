# JQFactory 代码库漂移审计报告

> 审计对象：`docs/JQFactory-project-constraints.md`（674 行，基线 v1.9.27，整理日期 2026-07-23）
> 对照基准：`client/src/version.ts`（`APP_VERSION = 'v1.9.38'`，`BUILD_DATE = '2026-10-10'`）
> 审计日期：本次会话 | 结论：文档基线落后 **11 个 patch 版本**（v1.9.28 → v1.9.38）

---

## 一、概览

约束文档写于 **v1.9.27**（README.md:238 可佐证该版本为「项目交接」版本），当前代码为 **v1.9.38**（`client/src/version.ts:73`），落后 11 个版本。本次逐文件核对后共确认 **26 项实质性漂移**：**15 项「已过时/写错」**（含 4 项会导致按文档写代码直接报错或解析错帧的硬错误）、**11 项「缺失」**（3 个新传感器产品、3 个新通信协议、2 个新客户账号、拖拽上传、SUM/AVG 联动、TestPage 重构等均未记录）。文档最严重的失真集中在三处：**§七 硬件协议栈**（新增 3 协议/3 产品完全缺失，且 32×32 帧长写错）、**§十 项目结构树**（全部行数过期、`DataLogPage.tsx` 已删除、缺 4 个组件）、**§四 版本管理**（示例版本号仍为 v1.9.26）。部署规则（§二）与 `package.json:13-14` 完全一致，是文档中唯一**完全无漂移**的章节。

---

## 二、已过时的描述

| 文档位置(章节+行号) | 文档现在的说法 | 实际代码 | 影响 |
|---|---|---|---|
| 文档头 L3 | 「版本：v1.9.27」「整理日期 2026-07-23」 | `version.ts:73` = `'v1.9.38'`；`version.ts:75` `BUILD_DATE='2026-10-10'` | 基线错 11 个版本，全部行号引用同步失效 |
| §四 4.1 L104 | `APP_VERSION = 'v1.9.26'` | `version.ts:73` = `'v1.9.38'` | 照抄示例会写出过期版本号 |
| §四 4.1 L106 | `BUILD_DATE = '2026-07-23'` | `version.ts:75` = `'2026-10-10'` | 同上；且 BUILD_DATE 已晚于文档整理日期 |
| §七 7.1 L300 | 32×32 帧格式 =「`AA 55 03 99` + 4B header + 01 + deviceID + 256B data（**262B 总长**）」 | `useSerialPort.ts:87-90,631-645`：4B 帧头 + **1024B 数据域 = 1028B**，无 `01`/deviceID 字节，另有 `MATRIX_32X32_MAP` 重排表(`useSerialPort.ts:131-164`) | **硬错误**：把 32×32 当成 262B 的极智帧，缓冲区将永久错位 |
| §七 7.1 L300-302 | 用 `sensorProduct='32×32'` / `'灏存'` / `'极智'` 作协议标识 | `SensorProtocol`(`useSerialPort.ts:181`) = `'16x16' \| '32x32' \| 'custom_haocun' \| 'custom_jizhi' \| 'custom_lingxin' \| 'custom_xingchen'` | 标识符名不符，`if` 分支永远不命中 |
| §七 7.2 L310-317 | deviceId 仅 0x01~0x05，「其它 → 按传感器产品配置解析」 | 另有**合成**设备类型：32×32→`'HD'`/`0xFF`(`:482-485`)、灏存→`'HC'`/`0xFE`(`:518-521`)；未知 id 回退 `DEV_XX`(`:675,698,733,777`)。32×32 帧**根本没有** deviceId 字节 | 漏 2 个设备标识 + 1 条回退规则 |
| §七 7.3 L322 | `useSerialPort(role: 'force' \| 'sensor', callbacks, options)` 三参数 | `useSerialPort(options: UseSerialPortOptions)` 单对象参数(`useSerialPort.ts:216-227`)；`role` 是 options 字段(`:54`) | **硬错误**：按文档调用无法通过 `tsc` |
| §七 7.3 L328 | 帧解析有 **3 种**分支：双包 / 单包固定长度 / 单包**动态长度** | 实为 **5 条协议分支 + 1 条兜底**：`32x32`/`custom_haocun`/`custom_jizhi`/`custom_lingxin`/`custom_xingchen`，`else` 兜底 16×16 双包(`useSerialPort.ts:631-804`)；不存在「单包动态长度」分支 | 新增协议无处挂载，重构者会漏改 |
| §五 5.2 L149 | `realtimeDataPipeline.ts` (**458 行**) | 实际 **457 行** | 行数偏差（轻微） |
| §五 5.3 L184 | `sensorDataStreamV2.ts` (**97 行**) | 实际 **96 行** | 行数偏差（轻微） |
| §八 8.1 L338 | 格式 A 入口 = `SerialMonitor.tsx:88-150` | 实际：CSV 拼接 `SerialMonitor.tsx:157`(Blob)、`handleStartRecording:170`、`handleStopRecording:224` | 行号区间已指向无关代码 |
| §八 8.2 L369 | CSV 上传入口 = `ConsistencyPage.tsx:397-493` | 实际 `processCSVFiles:615`、`handleDrop:720-735`、拖拽容器 `1131-1133`；**且 RepeatabilityPage 同样支持**(`RepeatabilityPage.tsx:246,351-366`) | 原区间已是下压机计时逻辑；漏掉一个页面 |
| §八 8.3 L382 | JSON 导出入口 = `DataChart.tsx:340-380` | `generateExportJson:332`、下载触发 `442` | 入口指向生成器而非下载点 |
| §八 8.4 L400 | LaTeX 导出入口 = `DataChart.tsx:442` | `442` 实为 **JSON** 下载；LaTeX 在 `449`，`generateLatex:260` | 指向错误按钮 |
| §八 8.5 L406 | 基准文件导出 = `SerialMonitor.tsx:227-288` | 实际 `handleGenerateBaseline:253`、JSON Blob `304` | 行号区间失效 |
| §八 8.7 L445 | 剪贴板 = `DataChart.tsx:449-465` | 实际 `456-465` | 起点偏移 7 行 |
| §九 9.1 L468-469 | 主背景 `oklch(0.17 0.025 265)`、主边框 `oklch(0.25 0.03 265)` | `index.css:54` `--background: oklch(0.13 0.02 265)`；`index.css:70` `--border: oklch(0.28 0.03 265)`（文档两值实为 `--card` / `--sidebar-border`） | 取色取错 token |
| §九 9.4 L490-491 | 「实际页面切换通过 Home 组件的 Sidebar Tab（5 个页面）」 | Sidebar 已抽为独立组件 `components/Sidebar.tsx`(129 行，`Home.tsx:15,484`)；Tab 仍 5 个(`Home.tsx:80-101`)；但 `App.tsx:11-16` 新增登录闸门，未登录整棵树被 `LoginPage` 替换 | 未提及 Sidebar 抽离与登录闸门 |
| §十三 13.3 L622-623 | 「未登录（默认）用户看到全部 **4 种**传感器产品」；产品列表 4 项 | 实际 **7 种**(`SerialConnectPanel.tsx:47-112`)；且 `App.tsx:14-16` 未登录直接渲染 `LoginPage`，`client===null` 兜底分支**实际不可达** | 产品清单少 3 项；兜底分支是死代码 |
| §十三 13.7 L644 | `serialDriver.ts` **398 行** | 实际 **397 行** | 行数偏差（轻微） |
| §十三 13.8 L646-648 | `DataLogPage.tsx` (372 行)「静态演示页，不在 Sidebar 5 个 Tab 中」 | **文件已删除**，`client/src/pages/` 下无此文件；`Home.tsx` 也无对应 Tab | 文档描述了一个不存在的页面 |
| §十三 13.10 L660 | 「`shared/const.ts` 无任何 import 引用，可能废弃」 | `shared/` 目录**为空**（0 文件），`const.ts` 不存在 | 技术债条目已失效 |
| §六 6.5 L281-286 | localStorage key 表仅 4 个 key，并称「页面间通过 localStorage key 共享状态」 | 实际 8 个 key：多出 `testPage_useHandLayout`、`testPage_handSelectedIndices`(`TestPage.tsx:64,80`)、`durabilityPage_useHandLayout`(`DurabilityPage.tsx:118`)、`jq_client_id`(`ClientContext.tsx:10`，值为 `{"id":...}` JSON 而非裸 id)。**TestPage 手形选点已改用独立 key，不再与一致性页共享** | 漏 4 个 key；「跨页共享」结论对 TestPage 已不成立 |
| §十 L501-564 | 项目结构树（含全部行数） | 见本报告第五节完整清单；树中缺 `Sidebar.tsx`/`PressureRangeBar.tsx`/`ConsistencyChart.tsx`/`DataTable.tsx`/`lib/defaultActions.json`，`ui/` 实为 **53** 个文件（文档「40+」） | 结构树整体过期 |

> **已核对无误、无需修改的引用**：§8.1 格式 B 入口 `sensorData.ts:317-337`（实际正是 `exportToCSV` 317-337）；§2.2 部署命令（与 `package.json:13-14` 逐字一致）；§13.9 状态栏；§11.3「每 2 秒输出调试日志」（`realtimeDataPipeline.ts:227` 实为 2000ms）；§13.4 `forceDeviceMode` 双态；§13.5「协议必须在 `connect()` 前设置」（`Home.tsx:245-247` 仍如此）。

---

## 三、文档缺失的内容

| 新增能力 | 涉及的代码位置 | 是否应写入约束文档 |
|---|---|---|
| **新增 2 个客户账号**（共 5 个：`jq`/`haocun`/`jizhi`/`lingxin`/`xingchen`） | `config/clients.ts:19-67` | **必须**（§13.2/13.3 的「4 客户/4 产品」模型已错） |
| **新增传感器产品「灵心巧手 16×16」(LX-16×16)** | `SerialConnectPanel.tsx:93-101`；协议解析 `useSerialPort.ts:106-112,687-712` | **必须** |
| **新增传感器产品「星尘科技 20×14」(XC-20×14)，首个非正方形矩阵** | `SerialConnectPanel.tsx:102-111`（`matrixCols:20`）；`useSerialPort.ts:114-124,412-455,713-759`；`Home.tsx:114-115`（`sensorMatrixCols`） | **必须**（并需说明 `matrixSize/matrixCols` 双字段约定） |
| **新增传感器产品「机器人足底 16×16」(JQ-FOOT-16)**，复用 16×16 双包协议，LF/RF 识别 | `SerialConnectPanel.tsx:57-65`；`clients.ts:28` | **必须**（产品复用既有协议，是「协议 ≠ 产品」的关键示例） |
| **新增协议 `custom_lingxin`**：单帧 278B（4+0x01+左右手+256+16 四元数） | `useSerialPort.ts:106-112`（常量）、`579-606`(处理)、`687-712`(分支) | **必须**（§七 协议栈核心内容） |
| **新增协议 `custom_xingchen`**：双包 146B + 162B → 280B → 14×20 | `useSerialPort.ts:114-124,412-455,713-759` | **必须** |
| **合成设备类型 HD / HC**（32×32、灏存无 deviceId 字节） | `useSerialPort.ts:482-485`、`518-521` | **必须** |
| **图表区域拖拽 CSV 上传**（按钮/拖拽共用 `processCSVFiles`，20 文件上限，非 CSV 提示，全局拖拽保护） | `ConsistencyPage.tsx:615-678,704-735,1131-1133`；`RepeatabilityPage.tsx:246-309,335-366,730-732` | **必须**（§8.2 只记录了按钮上传） |
| **SUM/AVG 切换联动 CV 分析**：`showAvg` 提升到页面级、`DataChart` 受控化、AVG 按传感器数归一化（`adcSum/adcValues.length`）、数据签名带 `avg`、残差阈值同比例缩放 | `DataChart.tsx:77,698,717-725,790-800,820-836,966-976`；`ConsistencyAnalysis.tsx:126-136,206-219,258,276-293`；`ConsistencyPage.tsx:755,1140,1160`；`RepeatabilityPage.tsx:410,721,766` | **必须**（当前文档把 SUM/AVG 当作 DataChart 内部行为） |
| **TestPage 重构**：移除自研采集按钮，接入 `SerialMonitor`（新增 `onRecordingStart`/`onRecordingComplete`），停止后显示区间压力曲线 + Hill 参数（a/b/n/R²/RMSE + 正/反推公式），面板移入左侧列 | `TestPage.tsx:12-13,116-143,400-419,431-461`；`SerialMonitor.tsx:45-47,77-83,190,242`；`PressureChart.tsx` `externalData` 模式 | **必须** |
| **`fitInverseHill` 反推拟合引擎**（ADC→压力，含 `InvHillFitResult`、`invHillFunc`、`generateInvFitCurve`） | `hillFit.ts:417-560` | 建议（Hill 引擎能力已扩展，文档只记录正向拟合） |
| **下压机压力事件驱动 + 采集前归零**：等待压力上升→释放→缓冲 7s；超时 15s 警告；开始采集自动发 `0x23 0x55 0x00 0x0A` | `ConsistencyPage.tsx:211-316`；`TestPage.tsx:410-415` | 建议（属行为规则，非纯结构） |
| **`RealtimeDataPipeline` 新增查询 API**：`getLatestSensorMatrix`/`getSensorFrameSeq`/`getSensorFrameInterval`/`getForceFrameInterval`/`getStats`/`resetStats`/`clear` | `realtimeDataPipeline.ts:298-307,317-329,399-446` | 建议（§5.2 API 表需补全） |
| **`SensorDataStreamV2.subscribe()`** 订阅接口 | `sensorDataStreamV2.ts:66-71` | 建议（§5.3 只列了 4 个 API） |
| **新增 4 个组件文件**：`Sidebar.tsx`、`PressureRangeBar.tsx`、`ConsistencyChart.tsx`、`DataTable.tsx` | 见第五节 | 建议 |
| **根目录新增独立脚本/文档**：`sensor_hill_fit.py`、`hill_fit_offline.py`、`PROJECT_DOCUMENTATION.md`、`docs/User_Manual.md`、`optimization-report.md`、`omni_hand_sensor_connection_guide.md`、`components.json` | 项目根目录、`docs/` | 建议（§十 结构树未收录） |

---

## 四、精确的设备/协议清单（当前真实状态）

### 4.1 传感器产品（`SerialConnectPanel.tsx:47-112` 的 `SENSOR_PRODUCTS`，共 7 项）

| # | 产品名（label） | 代码协议标识 | 默认波特率（快捷档） | 帧格式/长度 | 设备 ID | 可见客户 |
|---|---|---|---|---|---|---|
| 1 | 16×16 触觉传感器 | `'16x16'` | 921600（2400/115200/921600） | 双包：PKT01 `AA 55 03 99`+`01`+id+128B = **134B**；PKT02 同头+`02`+id+144B(128数据+16陀螺) = **150B**；拼 256B → 16×16 行优先(`useSerialPort.ts:77-85,363-405`) | PKT01 第 6 字节 ∈ `DEVICE_TYPE_MAP` | `jq` |
| 2 | 机器人足底 16×16（JQ-FOOT-16，宇树G1） | `'16x16'`（复用） | 921600（仅 921600） | 同 #1 双包协议 | `0x03` LF / `0x04` RF | `jq` |
| 3 | 32×32 高密度传感器（JQGY-YL-09） | `'32x32'` | 1000000（921600/1000000） | 单帧：4B 帧头 + **1024B** 数据域 = **1028B**，经 `MATRIX_32X32_MAP` 重排(`useSerialPort.ts:131-164`) | 无 deviceId 字节 → 合成 `'HD'`/`0xFF` | `jq` |
| 4 | 灏存科技定制（HC-16×16） | `'custom_haocun'` | 921600（仅 921600） | 单帧：4B 头 + 2B 无效 + 256B 传感器 + 16B 陀螺 = **278B** | 无 → 合成 `'HC'`/`0xFE` | `haocun` |
| 5 | 极智动量小黑采集板（JZ-16×16） | `'custom_jizhi'` | 1000000（921600/1000000） | 单帧：4B 头 + `0x01` + id + 256B = **262B** | 第 6 字节 ∈ `DEVICE_TYPE_MAP` | `jizhi` |
| 6 | 灵心巧手 16×16（LX-16×16） | `'custom_lingxin'` | 921600（仅 921600） | 单帧：4B 头 + `0x01` + 左右手 + 256B + 16B 四元数 = **278B** | 第 6 字节 `0x01`=LH / `0x02`=RH | `lingxin` |
| 7 | 星尘科技 20×14（XC-20×14） | `'custom_xingchen'` | 921600（仅 921600） | 双包：PKT01 4+`01`+id+140B = **146B**；PKT02 4+`02`+id+140B+16B四元数 = **162B**；拼 280B → **14 行 × 20 列** | PKT01 第 6 字节 ∈ `DEVICE_TYPE_MAP` | `xingchen` |

### 4.2 检测设备（force role，`SerialConnectPanel.tsx:117-138` `DETECTION_DEVICES`）

| 设备 | 代码标识 | 波特率（默认/快捷） | 帧格式 | 备注 |
|---|---|---|---|---|
| CL2-500N-MH01 压力计 | `role='force'` + `deviceMode='pressure'` | 19200（9600/19200/115200） | 收：`0x23` + float32LE(4B) + `0x0A` = **6B**；发：连接 `0x23 50 00 0A`、开始 `0x23 51 00 0A`、停止 `0x23 52 00 0A`、归零 `0x23 55 00 0A`（`useSerialPort.ts:851-854`） | 连接时自动初始化；`skipInit=true` 可跳过 |
| 智元灵巧手 | `role='force'` + `deviceMode='robot'` | 460800（115200/460800/921600） | `EE AA` + deviceId(2B LE) + len(1B) + cmd(1B) + data + CRC16-CCITT(2B LE)；使能 `cmd=0x01,data=0x01`、失能 `cmd=0x01,data=0x00`、位置 `cmd=0x08`+10×int16（`omniHandProtocol.ts:29-73`） | `OMNI_DEVICE_ID = 1`；连接后自动使能、断开前失能(`Home.tsx:221-265`) |
| Arduino 下压机 | `PressController` 模块（**不经** `useSerialPort`） | 9600 | ASCII 文本发送 `"1"` 触发下压（`PressController.tsx:26-33`） | 模块级单例 writer，状态经 `onPressStateChange` 广播 |

### 4.3 设备 ID 映射（`useSerialPort.ts:45-51`）

| deviceId | 类型 | 说明 |
|---|---|---|
| `0x01` / `0x02` | LH / RH | 左/右手套 |
| `0x03` / `0x04` | LF / RF | 左/右足（足底产品用此二值） |
| `0x05` | WB | 全身 |
| `0xFE`（合成） | HC | 灏存定制，无 deviceId 字节 |
| `0xFF`（合成） | HD | 32×32 高密度，无 deviceId 字节 |
| 其它 | `DEV_XX` | 未识别回退，字符串形如 `DEV_0A` |

> 客户可见性规则：`SerialConnectPanel.tsx:176-179` 用 `client.allowedProducts.includes(p.label)` 按 **label 全名精确匹配**过滤；force role 的检测设备**不受**客户过滤。

---

## 五、页面与组件清单（当前真实状态）

### 5.1 `client/src/pages/`（8 个文件）

| 文件 | 行数 | 备注 |
|---|---|---|
| `ConsistencyPage.tsx` | **1167** | ⚠ 全项目最大文件；含下压机循环、CSV 解析、拖拽、图表编排 |
| `DurabilityPage.tsx` | **972** | ⚠ 偏大 |
| `RepeatabilityPage.tsx` | **771** | ⚠ 偏大 |
| `Home.tsx` | 545 | 主壳 + `SerialCtx` 提供者 |
| `TestPage.tsx` | 504 | v1.9.34/35 重构后**比文档的 645 行更小** |
| `AboutPage.tsx` | 391 | — |
| `LoginPage.tsx` | 187 | — |
| `NotFound.tsx` | 49 | — |
| ~~`DataLogPage.tsx`~~ | **文件不存在** | 文档 §13.8 仍描述为 372 行 |

### 5.2 `client/src/components/`（顶层 16 个，`ui/` 另有 **53** 个）

| 文件 | 行数 | 备注 |
|---|---|---|
| `DataChart.tsx` | **1085** | ⚠ 散点图 + Hill 面板 + SUM/AVG + 降采样 |
| `SensorMatrix.tsx` | **831** | ⚠ — |
| `ConsistencyAnalysis.tsx` | **735** | ⚠ CV 分析 + 残差 |
| `OmniHandControl.tsx` | **692** | ⚠ 动作库/循环编排 |
| `SerialConnectPanel.tsx` | 585 | 7 产品 + 2 检测设备 + 波特率 UI |
| `HandMatrix.tsx` | 574 | — |
| `SerialMonitor.tsx` | 454 | 采集控制 + CSV/基准导出 |
| `PressureChart.tsx` | 367 | 支持 `externalData` 区间模式 |
| `ParameterPanel.tsx` | 279 | — |
| `PressureRangeBar.tsx` | 202 | v1.9.7 抽出，**文档未收录** |
| `PressController.tsx` | 194 | — |
| `TestResultCard.tsx` | 157 | — |
| `DataTable.tsx` | 151 | **文档未收录** |
| `ConsistencyChart.tsx` | 135 | **文档未收录** |
| `Sidebar.tsx` | 129 | **文档未收录**（v1.9.x 从 Home 抽出） |
| `ErrorBoundary.tsx` | 62 | — |

### 5.3 其它关键文件

| 文件 | 行数 | 备注 |
|---|---|---|
| `hooks/useSerialPort.ts` | **1009** | ⚠ 全项目第二大；6 种协议 + 32×32 映射表（131-164 行占 34 行） |
| `lib/hillFit.ts` | 599 | 正/反双向 Hill + LM |
| `lib/realtimeDataPipeline.ts` | 457 | — |
| `lib/serialDriver.ts` | 397 | 遗留 CL2 驱动 |
| `lib/sensorData.ts` | 342 | — |
| `lib/sensorDataStreamV2.ts` | 96 | — |
| `lib/omniHandProtocol.ts` | 73 | — |
| `lib/utils.ts` | 6 | — |
| `lib/defaultActions.json` | 62 | **文档未收录** |
| `config/clients.ts` | 78 | 5 个客户账号 |
| `contexts/ClientContext.tsx` / `ThemeContext.tsx` | 84 / 64 | — |
| `version.ts` / `App.tsx` / `index.css` | 75 / 42 / 207 | — |
| `server/index.ts` | 33 | — |
| `hooks/useComposition.ts` / `useMobile.tsx` / `usePersistFn.ts` | 78 / 21 / 18 | — |

> **真实超大文件（需关注）**：`ConsistencyPage.tsx`(1167)、`DataChart.tsx`(1085)、`useSerialPort.ts`(1009)、`DurabilityPage.tsx`(972)、`SensorMatrix.tsx`(831)、`RepeatabilityPage.tsx`(771)、`ConsistencyAnalysis.tsx`(735)、`OmniHandControl.tsx`(692)、`hillFit.ts`(599) — 共 9 个文件 ≥ 599 行。文档 §13.10 的技术债清单未包含其中任何一条。

---

## 六、需要修正的硬性规则

| 章节 | 文档规则 | 与当前代码事实的冲突 | 建议 |
|---|---|---|---|
| §二 2.1-2.3 | `deploy:test`→`--branch=main`、`deploy:prod`→`--branch=master`、两项目名 | **完全正确**，与 `package.json:13-14` 逐字一致；`scripts/cleanup-deployments.js` 存在 | ✅ 保留原样 |
| §二 2.4 步骤 1 | 示例「v1.9.25 → v1.9.26」 | 当前应为「v1.9.37 → **v1.9.38**」 | 更改为通用表述或当前值 |
| §四 4.1 | `APP_VERSION='v1.9.26'`、`BUILD_DATE='2026-07-23'` | 实为 `'v1.9.38'` / `'2026-10-10'`（`version.ts:73,75`） | 必须更新 |
| §四 4.1 | 「版本号必须在文件中以大段注释记录**完整**版本历史」 | **规则与代码不符**：`version.ts:59-61` 从 `v1.9.8` 直接跳到 `v1.9.26`，`v1.9.9~v1.9.25` 共 17 个版本**无注释记录**；`v1.9.27` 在 README.md:238 有条目但 `version.ts` 注释中**缺失** | 二选一：补齐历史注释，或把规则改为「记录关键版本」 |
| §十一 11.1 | ❌ 不要用 `--branch=main` 部署正式环境 | 仍成立（`deploy:prod` 用 `master`） | ✅ 保留 |
| §十一 11.1 | ❌ 不要忘记更新版本号和 README | 仍成立；README 版本条目 85 条，最新 `v1.9.38`（README.md:74） | ✅ 保留 |
| §十一 11.2 | ✅ 颜色一律用 oklch | **代码自身违反**：`SerialConnectPanel.tsx:380` 用 `#16213e` / `#e0e0e0`；说明「一律」并非现状 | 改为「新增颜色用 oklch」，或先清理例外 |
| §十一 11.2 | ✅ 数据字体 `'IBM Plex Mono'` | 成立（`index.css:108,157`）；但界面字体为 `'IBM Plex Sans'`（`index.css:94`），§9.2 只写了两种等宽字体 | 补充 `IBM Plex Sans` |
| §十一 11.3 | 每 2 秒输出调试日志 / `.manus-logs/` | 成立（`realtimeDataPipeline.ts:227`；`vite.config.ts:15` 生成 `.manus-logs`，目录已存在） | ✅ 保留 |
| §十二 Checklist | 新增产品 4 步：clients → `SENSOR_PRODUCTS` → `SensorProtocol`+帧解析 → 部署 | **遗漏 2 个必改点**：① 非正方形产品需同时设 `matrixCols` 并改 `Home.tsx:114-115` 的 `sensorMatrixSize/sensorMatrixCols` 推导；② 无 deviceId 字节的产品需在解析器内合成设备类型（`HD`/`HC` 先例）；③ 复用协议的产品（足底）无需改 `SensorProtocol` | 扩为 6 步 |

---

## 附：核实方式与未核实项

- **已逐行核实**：`version.ts`(75 行全文)、`config/clients.ts`(78)、`SerialConnectPanel.tsx`(585)、`useSerialPort.ts`(1009)、`realtimeDataPipeline.ts`(457)、`sensorDataStreamV2.ts`(96)、`sensorData.ts`(342)、`hillFit.ts`(599)、`Home.tsx`(545)、`TestPage.tsx`(504)、`App.tsx`(42)、`omniHandProtocol.ts`(73)、`package.json`(107)、`vite.config.ts`(196)、`tsconfig.json`、README.md:60-200。所有行数由 UTF-8 精确计数得出。
- **已用 grep/read 定点核实**：`ConsistencyPage.tsx`、`RepeatabilityPage.tsx`、`DurabilityPage.tsx`、`DataChart.tsx`、`ConsistencyAnalysis.tsx`、`SerialMonitor.tsx`、`PressController.tsx`、`index.css`、`ClientContext.tsx`（未逐行通读全文，但所述行号与符号均已直接命中）。
- **`HillFitResult` 形状（`hillFit.ts:15-22`）**：`{ a, b, n, rmse, r2, method: 'hill' | 'hyperbolic' | 'fallback' }`；反向为独立接口 `InvHillFitResult`(`:441-448`) `{ Vmax, K, n, rmse, r2, method }`。**不存在任何「非线性度 / linearity error」指标**（已全仓 grep `非线性|linearity|nonlinear`，仅命中注释与 README 中的「非线性最小二乘」表述，无该指标）。
- **未核实**：`docs/User_Manual.md`(120 行) 与文档的一致性；`dist/` 构建产物是否与源码同步；`.reasonix/`、`.claude/` 目录用途；Cloudflare 线上部署状态（未执行 wrangler 查询）。
