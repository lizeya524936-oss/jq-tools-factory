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
| 压力计 | CL2-500N-MH01 | 19200 | CL2 二进制协议（0x23 + float32LE + 0x0A） |
| 机械手 | 智元灵巧手 | 460800 | - |

## 在线访问

| 环境 | 地址 | 说明 |
|------|------|------|
| 正式环境 | [https://jq-tools-factory.pages.dev](https://jq-tools-factory.pages.dev) | 客户使用，确认无误后才更新 |
| 测试环境 | [https://jq-tools-factory-test.pages.dev](https://jq-tools-factory-test.pages.dev) | 开发预览，每次修改先发布到这里 |

> Web Serial API 需要 Chrome/Edge 89+ 浏览器，串口连接功能需在本地环境中使用。

## 本地开发

```bash
pnpm install
pnpm dev
```

## 部署

项目采用双环境部署策略，修改先发布到测试环境验证，确认无误后再更新正式环境。

```bash
# 部署到测试环境（日常开发使用）
pnpm deploy:test

# 部署到正式环境（确认无误后更新给客户）
pnpm deploy:prod
```

> **工作流程：** 修改代码 → `pnpm deploy:test` → 在测试环境验证 → 确认OK → `pnpm deploy:prod` → 客户使用正式环境

> ⚠️ **注意：** 两个 Cloudflare Pages 项目的生产分支不同：
> - 测试项目 `jq-tools-factory-test` → 生产分支 = `main`
> - 正式项目 `jq-tools-factory` → 生产分支 = `master`
>
> 修改 deploy 命令时必须确保 `--branch` 参数与对应项目的生产分支一致，否则部署不会更新到正式域名。

---

## 版本变动记录

### v1.9.15（2026-06-05）

**新增离线 Hill 拟合工具 `hill_fit_offline.py`**

创建与网页前端 `client/src/lib/hillFit.ts` 算法逐行一致的 Python 离线分析工具：

- Hill 方程正向/反向、双曲线方程、Levenberg-Marquardt 拟合、降采样策略完全对应 TS 实现
- 支持网页端全部 3 种 CSV 格式，含上升段过滤
- 一致性分析：多文件独立拟合 + 全局拟合 + 关键压力点 CV 分析 + 残差统计
- 支持自定义压力点 CV 计算、JSON 结果导出、matplotlib 图表生成
- 仅依赖 numpy，不依赖 scipy

**修改文件：**

- 新增 `hill_fit_offline.py` — 离线 Hill 拟合 CLI 工具
- 修改 `client/src/version.ts` — 版本号更新为 v1.9.15

### v1.9.14（2026-06-05）

**一致性评估：自定义压力点 CV 计算器**

在一致性评估面板右侧散点图上方新增「自定义压力点 CV 计算」卡片：

- 用户可输入任意压力值 (N)，基于各文件的独立 Hill 拟合参数实时计算该点的 CV%、均值、标准差和等级
- 展示每个文件在该压力点的预测 ADC 值，颜色与散点图图例一致
- 输入值超出当前分析范围时给出越界提示，结果仍可参考
- 输入框支持直接输入、回车确认，清除按钮一键重置

**修改文件：**

- 修改 `client/src/components/ConsistencyAnalysis.tsx` — 新增 customPressure 状态、customCVResult useMemo 计算逻辑、自定义 CV 计算器 UI 卡片
- 修改 `client/src/version.ts` — 版本号更新为 v1.9.14

### v1.9.13（2026-05-26）

**传感器矩阵显示模式切换**

矩阵单元格显示内容从简单的开关改为三态循环切换：

- `#序号`：显示数组位序号（默认，原有行为）
- `#数值`：显示 ADC 信号数值，解决热力图颜色区分不明显时无法直观看到信号值的问题
- `#关闭`：不显示任何文本

点击选中统计栏右侧的按钮即可循环切换三种模式。

**修改文件：**

- 修改 `client/src/components/SensorMatrix.tsx` — showArrayIndex boolean 改为 displayMode 三态，更新按钮和渲染逻辑
- 修改 `client/src/version.ts` — 版本号更新为 v1.9.13

### v1.9.12（2026-05-22）

**修复：Python 工具横纵模式切换后参数面板和图表公式未同步更新**

切换 Hill（压力→ADC）和 Inverse Hill（ADC→压力）模式后，参数面板中的公式、标签和图表标题仍显示旧模式内容：

- `_on_mode_changed()` 新增 `_update_params_text()` 和 `_refresh_plots()` 调用，确保切换后所有 UI 同步刷新
- `_update_params_text()` 按当前模式（正向/逆向）过滤显示，不再混合展示两种模式的结果
- 新增 `_refresh_plots()` 方法，根据当前模式重绘"拟合曲线"、"残差分析"、"各次实验对比"、"加载参数残差"四个 Tab

**修改文件：**

- 修改 `sensor_hill_fit.py` — 模式切换回调新增参数刷新和图表重绘逻辑

### v1.9.11（2026-05-16）

**Inverse Hill 拟合实现（ADC → 压力）**

将坐标轴切换后的拟合逻辑从"Hill 反函数公式推导"替换为真正的 Inverse Hill 直接拟合，X 轴 = ADC，Y 轴 = 压力：

- `hillFit.ts` 新增 `fitInverseHill`、`invHillFunc`、`generateInvFitCurve`、`formatInvHillEquation` 函数
- `DataChart.tsx` axisSwapped 模式下使用 Inverse Hill 直接拟合（P = K·(ADC/(Vmax-ADC))^(1/n)）
- Python 分析工具 `sensor_hill_fit.py` 升级至 v1.7：
  - 加载参数模式支持 Inverse Hill（Vmax/K/n 输入 + 逐传感器残差计算）
  - UI 动态切换 Hill / Inverse Hill 参数面板
  - JSON 导入/导出、CSV 导出完整适配 Inverse Hill
  - 新增 Inverse Hill 加载参数模式可视化图表

**修改文件：**

- 修改 `client/src/components/DataChart.tsx` — axisSwapped 模式改用 fitInverseHill
- 修改 `client/src/lib/hillFit.ts` — 新增 Inverse Hill 拟合全套函数
- 修改 `sensor_hill_fit.py` — v1.7 Inverse Hill 加载参数模式（本地分析工具）

### v1.9.10（2026-05-15）

**横纵坐标切换功能**

在综合曲线图表（DataChart）中新增横纵坐标切换开关，点击后交换 X/Y 轴数据方向，Hill 拟合方程自动反向计算：

- 切换开关位于压力范围栏下方，双向箭头图标 + "横纵切换" 文字
- 激活后 X 轴显示 ADC Sum，Y 轴显示压力 (N)
- Hill 拟合自动反向：原 `ADC = f(P)` → 切换后 `P = f(ADC)`
- 拟合面板所有标签联动更新：正向方程、反推公式、系数说明、在线计算器
- LaTeX/JSON 导出内容自动适配当前坐标轴方向
- Tooltip 标签顺序跟随坐标轴方向调整
- 切换后隐藏 PressureRangeBar（因 X 轴不再是压力）

**修改文件：**

- 修改 `client/src/components/DataChart.tsx` — 新增 axisSwapped 状态、切换按钮、X/Y 轴交换、拟合反向、HillFitPanel/tooltip/导出函数全部适配

### v1.9.9（2026-05-14）

**版本号更新**

- 应用版本号从 v1.9.8 更新为 v1.9.9，补全 README 版本记录

**修改文件：**

- 修改 `client/src/version.ts` — 版本号更新为 v1.9.9，build date 更新为 2026-05-14
- 修改 `README.md` — 补全版本记录

### v1.9.8.1（2026-04-26）

**添加浏览器 Favicon**

为网站添加 JQ 品牌 favicon，替换 Chrome 默认的地球图标：

- 新增 SVG/ICO/PNG 多格式 favicon（蓝紫色背景 + 白色 JQ 文字，与侧边栏 logo 一致）
- 新增 Apple Touch Icon (180x180)
- 配置 `index.html` 中的 favicon 链接

**新增文件：**

- `client/public/favicon.svg` — SVG 格式 favicon
- `client/public/favicon.ico` — ICO 格式 favicon (16x16 + 32x32)
- `client/public/favicon-32x32.png` — 32x32 PNG
- `client/public/favicon-16x16.png` — 16x16 PNG
- `client/public/apple-touch-icon.png` — Apple Touch Icon 180x180
- 修改 `client/index.html` — 添加 favicon 链接标签

### v1.9.8（2026-04-26）

**压力范围重新拟合 + 滑块防抖**

调整压力范围滑块后，只使用 0~pressureMax 范围内的数据重新进行 Hill 拟合，避免曲线尾段对前段的影响：

- 拟合数据过滤：`hillFitResult` 的 `useMemo` 中添加 `r.pressure <= pressureMax` 过滤条件，只用选定范围内的数据拟合
- 缓存签名更新：数据签名中包含 `range=pressureMax`，确保范围变化时缓存失效并重新拟合
- 滑块防抖：拖动过程中只更新显示值（X轴范围实时变化），松手后才触发 `onPressureMaxChange` 重新拟合
- 依赖更新：`xMax` 加入 `useMemo` 依赖数组

**修改文件：**

- 修改 `client/src/components/DataChart.tsx` — 拟合数据过滤添加 pressureMax 范围限制
- 修改 `client/src/components/PressureRangeBar.tsx` — 滑块拖动防抖，松手后才触发回调
- 修改 `client/src/version.ts` — 版本号更新为 v1.9.8

### v1.9.7（2026-04-26）

**压力范围双向联动**

将压力范围控制提升为共享状态，综合曲线图表的 X 轴范围和一致性评估的分析范围双向联动：

- 提取共享 `PressureRangeBar` 组件（滑块 + 输入框 + 快捷按钮 50/100/200/500N + Max 按钮）
- DataChart 内的固定 X 轴范围按钮（20/30/50/70/100N）替换为 PressureRangeBar
- 父组件（ConsistencyPage / RepeatabilityPage）统一维护 `pressureMax` 状态
- 调整综合曲线的压力范围 → 一致性评估的分析点同步更新
- 调整一致性评估的压力范围 → 综合曲线的 X 轴同步更新
- 滑块上限由数据中的最大压力值决定

**修改文件：**

- 新增 `client/src/components/PressureRangeBar.tsx` — 共享压力范围控制栏组件
- 修改 `client/src/components/DataChart.tsx` — 接收外部 pressureMax，替换固定按钮为 PressureRangeBar
- 修改 `client/src/components/ConsistencyAnalysis.tsx` — 接收外部 pressureMax，移除内部压力范围状态
- 修改 `client/src/pages/ConsistencyPage.tsx` — 添加共享 pressureMax 状态，传递给 DataChart 和 ConsistencyAnalysis
- 修改 `client/src/pages/RepeatabilityPage.tsx` — 同上
- 修改 `client/src/version.ts` — 版本号更新为 v1.9.7

### v1.9.6（2026-04-26）

**压力范围可配置**

CV 分析的关键压力点从固定 7 点（5/10/20/30/50/70/100N）改为动态生成，用户可自由选择 0-XX N 的压力范围：

- **滑块控制**：拖动滑块设置最大压力值，关键压力点自动均匀分布
- **输入框**：直接输入精确的最大压力值（回车或失焦确认）
- **快捷按钮**：50N / 100N / 200N / 500N 一键切换
- **数据自适应**：滑块上限由导入数据中的最大压力值决定，并显示 Max 按钮
- **动态点数**：根据范围大小自动调整分析点数（小范围 4 点，大范围 12 点）
- **图表联动**：散点图 X 轴范围跟随滑块设置自动更新

修改文件：
- 修改 `client/src/components/ConsistencyAnalysis.tsx` — 动态压力点生成 + 滑块/输入框/快捷按钮
- 修改 `client/src/version.ts` — 版本号更新为 v1.9.6

### v1.9.5（2026-04-25）

**关键压力点 CV 分析 + 残差分布可视化**

在一致性和重复性页面的综合曲线图表下方新增「一致性评估」面板，基于 Data_analysis 仓库的 Hill 拟合分析算法，提供两个核心可视化：

1. **关键压力点 CV 分析**：
   - 对每个导入的 CSV 文件独立进行 Hill 方程拟合
   - 在7个关键压力点（5/10/20/30/50/70/100N）计算各文件的 ADC 预测值
   - 计算每个压力点的变异系数 CV = σ/μ×100%
   - 折线图显示 CV 随压力变化趋势，带 5% 警戒线和 10% 不合格线
   - 自动等级判定：A级（CV<5%）/ B级（5-10%）/ C级（>10%）
   - 右侧散点图展示各文件在关键压力点的 ADC 预测值分布

2. **残差分布分析**：
   - 使用全局 Hill 拟合参数回代计算每个数据点的残差（实际值 - 拟合值）
   - 直方图显示全局残差分布，±1σ 范围内高亮显示
   - 显示残差统计：均值、标准差、最大绝对残差
   - 右侧柱状图对比各文件的残差标准差和最大绝对残差

3. **重复性页面新增 CSV 上传功能**：
   - 与一致性页面相同的 CSV 多文件上传管理（最多20个）
   - 文件勾选列表、Hill 拟合 checkbox、清除全部功能

修改文件：
- 新增 `client/src/components/ConsistencyAnalysis.tsx` — CV 分析 + 残差分布可视化组件
- 修改 `client/src/pages/ConsistencyPage.tsx` — 集成 ConsistencyAnalysis 组件
- 修改 `client/src/pages/RepeatabilityPage.tsx` — 新增 CSV 上传功能 + 集成 ConsistencyAnalysis 组件
- 修改 `client/src/version.ts` — 版本号更新为 v1.9.5

### v1.9.4（2026-04-25）

**拟合公式导出：系数 JSON + LaTeX 公式 + 剪贴板复制**

在 Hill 拟合参数面板的标题行右侧新增三个导出按钮：

1. **⬇ JSON**：导出完整的拟合结果为 JSON 文件，包含：
   - 系数 `a`、`b`、`n` 的数值和说明
   - 拟合质量 `R²`、`RMSE`、拟合方法
   - 正向公式（P→ADC）的纯文本、LaTeX、符号 LaTeX 三种格式
   - 反向公式（ADC→N）的纯文本、LaTeX、符号 LaTeX 三种格式

2. **⬇ LaTeX**：导出为 `.tex` 文件，可直接在 LaTeX 文档中 `\input` 引用，包含：
   - 符号形式的 Hill 方程（`\begin{equation}` 环境）
   - 代入具体系数的拟合方程
   - 符号形式的反推公式
   - 代入具体系数的反推公式
   - 系数列表（`\begin{align}` 环境，含英文说明）
   - 拟合质量 R² 和 RMSE

3. **⎘ 复制 LaTeX**：一键复制完整 LaTeX 内容到剪贴板，方便粘贴到论文或文档中

修改文件：
- 修改 `client/src/components/DataChart.tsx` — 新增 `generateLatex()`、`generateExportJson()`、`downloadFile()` 工具函数，HillFitPanel 标题行增加导出按钮组
- 修改 `client/src/version.ts` — 版本号更新为 v1.9.4

### v1.9.3（2026-04-21）

**彻底修复卡顿：散点降采样显示 + React.memo 防止无关重渲染**

v1.9.2 修复了拟合重复计算的问题，但导入多个 CSV 文件后页面仍然卡顿。根因是 Recharts 的 SVG 渲染模式下，每个散点都是一个独立的 SVG `<circle>` DOM 节点，数千个散点 + 连线的 DOM 树在每次 React 渲染时都需要完整重绘，占用大量主线程时间。清除数据后页面立即流畅，证实了是图表渲染而非计算的问题。

优化措施：

1. **散点降采样显示**：每个数据系列最多显示 200 个点（按压力值均匀采样），保留曲线形状但大幅减少 SVG DOM 节点数量。例如 10 个文件×1000点 = 10000 个 SVG 节点 → 降采样后只有 10×200 = 2000 个节点
2. **React.memo 包裹 DataChart**：阻止父组件（ConsistencyPage）的无关状态变化（如传感器矩阵实时更新）导致 DataChart 重渲染
3. **拟合曲线点数优化**：从 150 点减少到 100 点，足够画出平滑曲线但减少 DOM 开销
4. **降采样提示**：图表上方显示“已降采样显示 (200/1000 点)”提示，用户知道显示的是采样数据

修改文件：
- 修改 `client/src/components/DataChart.tsx` — 散点降采样、React.memo、拟合曲线点数优化
- 修改 `client/src/version.ts` — 版本号更新为 v1.9.3

### v1.9.2（2026-04-21）

**性能优化：修复拟合后页面卡顿问题**

导入 CSV 数据并拟合 Hill 方程后，页面会变得非常卡顿。根因分析发现 `chartSeries` 和 `allSeriesForFit` 是普通变量（非 `useMemo`），每次 React 渲染都会创建新的数组引用，导致 DataChart 内部的 `hillFitResult` useMemo 依赖变化，每次渲染都重新执行 Levenberg-Marquardt 拟合算法（最多 8000 次迭代）。结合实时传感器数据的 100ms UI 更新定时器，每秒在主线程上执行约 10 次完整的非线性拟合，直接阻塞 UI。

优化措施：

1. **useMemo 缓存数据引用**：`chartSeries` 和 `allSeriesForFit` 改为 `useMemo`，仅在 `records` 或 `uploadedSeries` 变化时才创建新引用
2. **拟合结果缓存**：在 DataChart 内部使用数据签名（采样关键位置的 pressure/adcSum 值）与上次拟合结果比较，数据未变化时直接返回缓存结果，跳过 LM 计算
3. **大数据集降采样**：当数据点超过 500 时，按压力值均匀分桶取中位数降采样后再拟合，评估仍用全量数据计算 R²/RMSE
4. **关闭 Scatter 动画**：所有 Scatter 组件设置 `isAnimationActive={false}`，消除 Recharts 动画帧的渲染开销

修改文件：
- 修改 `client/src/components/DataChart.tsx` — 拟合结果缓存、关闭动画
- 修改 `client/src/lib/hillFit.ts` — 大数据集降采样、全量数据评估
- 修改 `client/src/pages/ConsistencyPage.tsx` — chartSeries/allSeriesForFit 改为 useMemo
- 修改 `client/src/version.ts` — 版本号更新为 v1.9.2

### v1.9.1（2026-04-13）

**拟合曲线修复：独立于数据系列可见性 + Legend 颜色修正**

1. **拟合基于全部数据**：拟合计算使用所有已导入的数据（包含取消勾选的系列），取消勾选数据系列后拟合曲线仍然保留显示
2. **拟合曲线加入文件勾选列表**：在文件列表的第一个位置增加「Hill 拟合」独立 checkbox，用户可以单独控制拟合曲线的显示/隐藏，带虚线图标和金黄色标识
3. **修正 Legend 颜色**：自定义 Legend 渲染器，拟合曲线显示虚线图标 + 金黄色，数据系列显示圆点 + 实线图标，颜色与实际曲线完全一致

修改文件：
- 修改 `client/src/components/DataChart.tsx` — 拟合独立于可见性、自定义 Legend、支持外部控制拟合显示
- 修改 `client/src/pages/ConsistencyPage.tsx` — 添加 Hill 拟合 checkbox、传入 allSeriesForFit
- 修改 `client/src/version.ts` — 版本号更新为 v1.9.1

### v1.9.0（2026-04-13）

**Hill 方程拟合：压力 & ADC Sum 综合曲线自动拟合，显示拟合方程、系数和 ADC→N 反推公式**

基于 Python hill_core 库移植的 TypeScript 版 Hill 方程拟合引擎，在一致性和重复性页面的「压力 & ADC Sum 综合曲线」图表中集成 Hill 方程拟合功能：

1. **Hill 方程拟合引擎**（`client/src/lib/hillFit.ts`）：纯 TypeScript 实现，无外部依赖，包含 Levenberg-Marquardt 非线性最小二乘法
2. **拟合策略**：先尝试完整 3 参数 Hill 拟合 `ADC = a × P^n / (b^n + P^n)`，若 R² < 0.9 则降级为双曲线拟合 (n=1)，取 R² 更高的结果
3. **拟合曲线显示**：在图表中以金黄色虚线叠加显示拟合曲线，可通过按钮显示/隐藏
4. **拟合参数面板**：图表下方显示拟合方程、系数 (a=饱和值, b=半饱和压力, n=Hill系数)、R² 和 RMSE
5. **ADC→N 反推公式**：显示 `P(N) = b × (ADC / (a - ADC))^(1/n)` 反向计算公式
6. **在线计算器**：输入 ADC 值即可实时反推对应的压力值 (N)

修改文件：
- 新增 `client/src/lib/hillFit.ts` — Hill 方程拟合引擎
- 修改 `client/src/components/DataChart.tsx` — 集成拟合曲线和参数面板
- 修改 `client/src/pages/RepeatabilityPage.tsx` — 散点图视图改用 DataChart 组件
- 修改 `client/src/version.ts` — 版本号更新为 v1.9.0

### v1.8.8（2026-04-08）

**帧去重机制：彻底消除重复数据采集，确保采集频率精确匹配传感器实际帧率**

v1.8.7 的纯事件驱动采集在实际测试中仍然产生 62.5% 重复数据行（100Hz 采集，实际传感器只有 ~37.5Hz）。根因分析发现两个问题：

1. **updateAdcData 不再触发帧通知**：之前 `onSensorMatrix` 和 `onSensorData` 回调分别调用 `updateSensorData()` 和 `updateAdcData()`，后者也会触发帧率统计和帧通知，导致每帧被计数 2 次。现在 `updateAdcData()` 只更新数据，不触发帧通知和帧率统计
2. **数据变化检测（帧去重）**：`updateSensorData()` 现在会计算矩阵数据的快速签名（采样关键位置的值），如果与上一帧相同则跳过帧通知。这确保 `subscribeSensorFrame` 只在数据真正变化时触发，彻底消除重复采集
3. **采集频率统计日志**：采集过程中每 2 秒在控制台输出实际采集频率，方便确认帧去重是否生效
4. **Pipeline 调试日志**：每 2 秒输出 `updateSensorData` 的调用次数、新帧数、重复帧数，帮助诊断数据流问题

修改文件：`client/src/lib/realtimeDataPipeline.ts`、`client/src/pages/TestPage.tsx`、`client/src/pages/ConsistencyPage.tsx`、`client/src/version.ts`

### v1.8.7（2026-04-07）

**彻底改用纯事件驱动采集：抛弃 setInterval 定时器，采集频率 100% 匹配传感器实际发送频率**

v1.8.6 的基于检测帧率的定时器方案在实际测试中仍然产生 10ms 间隔的重复数据。本版彻底抛弃 `setInterval` 轮询模式，改用纯事件驱动：

1. **subscribeSensorFrame 订阅新帧事件**：采集时通过 `pipeline.subscribeSensorFrame()` 订阅传感器新帧事件，每当传感器有新数据到达时回调函数被触发，记录一条数据
2. **零重复零丢失**：每收到一帧就记录一条，不会重复采样，也不会遗漏任何帧
3. **完全自适应**：无论传感器发送频率是 12Hz、37Hz、73Hz 还是 200Hz，采集频率都自动匹配
4. **停止采集时自动取消订阅**：通过 `unsubscribe()` 函数清理，无内存泄漏

修改文件：`client/src/pages/TestPage.tsx`、`client/src/pages/ConsistencyPage.tsx`、`client/src/version.ts`

### v1.8.6（2026-04-07）

**修复采集频率：基于检测帧率的定时器 + 帧序号去重，采集按钮不再强制要求压力计**

v1.8.5 的 subscribeSensorFrame 事件驱动模式在实际测试中未生效，采集仍然是 10ms 轮询模式。本版改为更可靠的方案：

1. **基于检测帧率的定时器**：连接传感器后自动检测上报频率（如 12Hz），采集定时器间隔 = 1000/帧率（如 83ms）
2. **帧序号去重**：每次定时器触发时检查 `sensorFrameSeq` 是否变化，只有新帧才记录数据，彻底消除重复采样
3. **采集按钮条件放宽**：TestPage 采集按钮不再强制要求连接压力计，只要连接传感器并选择采样点即可采集
4. **采集状态显示**：采集时显示检测帧率和采集间隔，方便确认自适应是否生效

修改文件：`client/src/pages/TestPage.tsx`、`client/src/pages/ConsistencyPage.tsx`、`client/src/version.ts`

### v1.8.5（2026-04-07）

**自适应采样频率：自动检测传感器实际发送频率，采集改为新帧事件驱动**

之前采集逻辑使用固定 10ms 定时器轮询，对于 12Hz 等低频传感器会产生大量重复采样。本版改为自适应模式：

1. **帧率自动检测**：RealtimeDataPipeline 统计传感器和压力计的实际帧间隔，计算实时 Hz
2. **新帧事件驱动采集**：采集改为订阅传感器新帧回调（subscribeSensorFrame），每帧只采集一次，避免重复采样
3. **帧率显示**：底部状态栏显示 `F:xxxHz S:xxxHz`，测试页采集按钮旁显示实时帧率标签
4. **兼容所有频率**：无论传感器是 12Hz、50Hz 还是 200Hz，都能精确采集每一帧数据

修改文件：`client/src/lib/realtimeDataPipeline.ts`、`client/src/pages/Home.tsx`、`client/src/pages/TestPage.tsx`、`client/src/pages/ConsistencyPage.tsx`、`client/src/pages/DurabilityPage.tsx`、`client/src/pages/RepeatabilityPage.tsx`、`client/src/version.ts`

### v1.8.4（2026-04-01）

**双环境部署：测试环境 + 正式环境分离**

新增 Cloudflare Pages 测试项目 `jq-tools-factory-test`，实现开发预览与客户使用的环境分离：

1. 测试环境：`jq-tools-factory-test.pages.dev`，每次修改先发布到这里验证
2. 正式环境：`jq-tools-factory.pages.dev`，确认无误后才更新给客户
3. 新增 `pnpm deploy:test` 和 `pnpm deploy:prod` 一键部署命令

修改文件：`package.json`、`README.md`

### v1.8.3（2026-04-01）

**切换按钮改为醒目的 Tab 切换样式**

v1.8.2 的切换按钮太小太淡，用户连接手套后难以发现。本版重新设计为并排的 Tab 切换样式：

1. 两个选项（手掌布局 / 矩阵显示）并排显示在矩阵上方，占满宽度
2. 当前选中项高亮显示（手掌布局=蓝色高亮，矩阵显示=绿色高亮），未选中项灰色
3. 图标放大至 16px，文字放大至 text-sm，整体更容易点击
4. 三个页面（测试/一致性/耐久性）统一采用相同样式

修改文件：`client/src/pages/TestPage.tsx`、`client/src/pages/ConsistencyPage.tsx`、`client/src/pages/DurabilityPage.tsx`、`client/src/version.ts`

### v1.8.2（2026-04-01）

**三个页面添加手掌布局/矩阵显示切换开关**

连接手套设备（LH/RH）时，测试页面、一致性检测页面、耐久性检测页面均会显示一个切换按钮，用户可自由选择“手掌布局”（HandMatrix）或“矩阵显示”（SensorMatrix）。

1. 切换按钮仅在连接手套设备（LH/RH）时显示，其他传感器类型不受影响
2. 用户的显示模式偏好保存到 localStorage，下次打开自动恢复
3. 测试页面默认“矩阵显示”，一致性/耐久性页面默认“手掌布局”
4. 手掌布局模式下显示全选/取消按钮，矩阵模式下显示矩阵尺寸调整
5. 数据采集和 CSV 导出根据当前显示模式自动切换选点逻辑

修改文件：`client/src/pages/TestPage.tsx`、`client/src/pages/ConsistencyPage.tsx`、`client/src/pages/DurabilityPage.tsx`、`client/src/version.ts`

### v1.8.1（2026-03-31）

**测试页面统一使用标准矩阵显示**

1. 移除 HandMatrix 手形状可视化组件，连接手套（LH/RH，921600波特率）后不再显示手形状布局
2. 统一使用 SensorMatrix 标准16×16矩阵显示所有传感器数据
3. 简化 CSV 导出逻辑，移除 HandMatrix 选点的特殊处理

修改文件：`client/src/pages/TestPage.tsx`

### v1.8.0（2026-03-19）

**支持32×32高密度手部压力传感器（JQGY-YL-09）**

1. 新增传感器产品选择器：右上角“选择传感器产品”支持选择16×16或32×32传感器，切换时自动调整波特率
2. 新增1000000bps波特率选项，适配32×32传感器高速数据传输
3. 实现单帧1028字节协议解析：帧头0xAA 0x55 0x03 0x99 + 1024字节数据域，与现有16×16双包协议共存
4. 实现32×32矩阵映射表：将线性字节流按规格书定义的行列顺序重排到矩阵坐标
5. 各页面（测试页/一致性/重复性/耐久性）自动感知传感器协议变化，自动切换矩阵尺寸为32×32
6. 矩阵尺寸上限从16放开到64，支持更大规模传感器阵列

修改文件：`client/src/hooks/useSerialPort.ts`、`client/src/components/SerialConnectPanel.tsx`、`client/src/pages/Home.tsx`、`client/src/pages/TestPage.tsx`、`client/src/pages/ConsistencyPage.tsx`、`client/src/pages/RepeatabilityPage.tsx`、`client/src/pages/DurabilityPage.tsx`

### v1.7.1（2026-03-19）

**灵巧手控制增强：使能按钮 + 默认动作库 + 快捷执行**

1. 标题栏添加使能/失能切换按钮，连接后默认自动使能，点击按钮可切换失能/使能状态
2. 默认内嵌 `okandreleasehold.json` 动作库（hold/ok/release/release2），进入页面即可看到动作列表，无需手动上传；用户仍可通过“上传 JSON”替换动作库
3. 动作库下方新增“快捷执行”按钮行，点击直接发送对应动作命令到灵巧手（需已连接并使能）

修改文件：`client/src/pages/DurabilityPage.tsx`、`client/src/lib/defaultActions.json`（新增）

### v1.7.0（2026-03-19）

**灵巧手连接整合到右上角“选择检测设备”**

移除耐久性页面右侧面板中独立的“连接 (460800)”按钮和独立串口管理逻辑，灵巧手连接统一通过右上角“选择检测设备”的机械手模式管理。连接成功后自动发送使能命令，断开时自动发送失能命令。协议函数（CRC16-CCITT、buildPacket、buildEnablePacket、buildSetPositionsPacket 等）从 DurabilityPage 提取到公共模块 `omniHandProtocol.ts`。

修改文件：`client/src/lib/omniHandProtocol.ts`（新增）、`client/src/pages/Home.tsx`、`client/src/pages/DurabilityPage.tsx`

### v1.6.3（2026-03-19）

**修复耐久性页面放大后无法滚动到底部的问题**

浏览器放大百分比后，左侧面板底部的“数据采集控制”和“开始采集”按钮被 footer 遮挡且无法滚动。根因是外层容器使用 `minHeight: 100%` 时，容器高度被子项擑开但父层 main 的 `overflow-auto` 无法感知溢出。修复方案：外层容器改为 `height: 100%` + `overflow-y: auto`，让 DurabilityPage 自身成为滚动容器；右侧面板 `maxHeight` 从 `calc(100vh - 72px)` 改为 `100%`，相对于滚动容器的可视区域定位。

修改文件：`client/src/pages/DurabilityPage.tsx`

### v1.6.2（2026-03-19）

**彻底修复耐久性页面滚动问题**

放大浏览器百分比时，左侧面板底部的“数据采集控制”和“开始采集”按钮被截断且页面无法滚动。根因是外层 `div.flex` 水平布局默认 `align-items: stretch` 导致左右面板被拉伸到相同高度，右侧面板的 `flex-1` 约束住了容器高度。修复方案：外层容器添加 `items-start` 让左右面板各自按内容高度展开，右侧面板改为 `position: sticky` 固定在视口顶部并支持独立滚动。

修改文件：`client/src/pages/DurabilityPage.tsx`

### v1.6.1（2026-03-19）

**修复右上角机械手串口与灵巧手控制冲突 + 耐久性页面滚动优化**

右上角选择“机械手”连接时，会发送 CL2 压力计初始化命令导致灵巧手无法正常使能，且串口被占用后耐久性页面无法独立连接。修复方案：`useSerialPort` 的 `connect` 方法增加 `skipInit` 参数，机械手模式跳过 CL2 初始化命令；通过 `SerialCtx` 传递 `forceDeviceMode` 和 `sendForceCommand`，耐久性页面检测到右上角已连接机械手时自动复用该连接发送使能/位置命令。同时修复底部版本号硬编码问题，改为引用 `APP_VERSION` 变量。

修改文件：`client/src/hooks/useSerialPort.ts`、`client/src/components/SerialConnectPanel.tsx`、`client/src/pages/Home.tsx`、`client/src/pages/DurabilityPage.tsx`

### v1.6.0（2026-03-18）

**修复一致性页面图表高度问题**

上传20个CSV文件时，文件列表占据过多空间导致图表Y轴被压缩无法显示。文件列表区域限制最大高度100px并支持滚动，图表区域设置最小高度500px（内部绘图区400px），确保Y轴与X轴同等空间充分显示。

修改文件：`client/src/pages/ConsistencyPage.tsx`、`client/src/components/DataChart.tsx`

### v1.5.9（2026-03-18）

**耐久性页面改造：灵巧手控制面板 + 滚动修复**

右侧区域从“趋势/概览/表格”替换为灵巧手控制面板：上传 JSON 动作文件解析动作库，单击添加到循环序列，双击手动执行；循环序列支持上移/下移/删除/清空；设置循环次数和动作间隔；连接灵巧手后执行循环测试，实时显示进度和运行日志。修复左侧面板滚动问题。

修改文件：`client/src/pages/DurabilityPage.tsx`

### v1.5.8（2026-03-18）

**耐久性页面集成 HandMatrix**

删除旧的灵巧手控制面板，集成 HandMatrix 组件（LH/RH 自动切换手形矩阵），选点状态与一致性页面同步。

修改文件：`client/src/pages/DurabilityPage.tsx`

### v1.5.7（2026-03-18）

**HandMatrix 全选/全部取消按钮**

在手形矩阵底部按钮区域新增全选/全部取消按钮，一键切换所有传感器点的选中状态。

修改文件：`client/src/pages/ConsistencyPage.tsx`、`client/src/components/HandMatrix.tsx`

### v1.5.6（2026-03-18）

**CSV 上传自动过滤压力下降阶段**

上传 CSV 文件后自动识别压力峰值点，只保留上升阶段（0→峰值 N）数据，舍弃下降阶段，避免设备放松时数据失真干扰分析。

修改文件：`client/src/pages/ConsistencyPage.tsx`

### v1.5.5（2026-03-18）

**压力计默认波特率改为 19200bps**

压力计默认波特率从 115200 改为 19200，匹配 CL2-500N-MH01 实际配置。删除矩阵框选 crosshair 鼠标样式。

修改文件：`client/src/hooks/useSerialPort.ts`、`client/src/components/SerialConnectPanel.tsx`、`client/src/components/SensorMatrix.tsx`

### v1.5.4（2026-03-17）

**图表缩放改为快捷按钮**

删除红色参考线（forceMin/forceMax）避免误导；图表缩放从框选模式改为 5 个快捷按钮（20N/30N/50N/70N/100N）切换 X 轴范围。

修改文件：`client/src/components/DataChart.tsx`、`client/src/pages/ConsistencyPage.tsx`

### v1.5.3（2026-03-17）

**CSV 批量上传 + 图表框选缩放**

文件选择框支持多选，一次可导入多个 CSV 文件；图表支持拖拽框选区域放大查看，复位按钮恢复全局视图。

修改文件：`client/src/pages/ConsistencyPage.tsx`、`client/src/components/DataChart.tsx`

### v1.5.2（2026-03-17）

**多 CSV 文件上传管理**

支持最多 20 个 CSV 文件，每个文件用不同颜色曲线绘制，checkbox 控制显示/隐藏，支持单独移除或清除全部。DataChart 改为 ScatterChart 多系列模式。

修改文件：`client/src/pages/ConsistencyPage.tsx`、`client/src/components/DataChart.tsx`

### v1.5.1（2026-03-17）

**修复 CSV 上传解析**

自动识别两种 CSV 格式（SerialMonitor 导出的多列传感器格式 + ConsistencyPage 导出的分号分隔格式）；传感器数据横向求和生成 ADC Sum。

修改文件：`client/src/pages/ConsistencyPage.tsx`

### v1.5.0（2026-03-17）

**修复 HandMatrix 选点与采集逻辑联动**

SerialMonitor 新增 `handSelectedIndices` prop，选点检查同时判断 `handSelectedIndices.size > 0` 或 `selectedSensors.length > 0`，修复手形矩阵模式下采集报错的问题。

修改文件：`client/src/components/SerialMonitor.tsx`、`client/src/pages/ConsistencyPage.tsx`、`client/src/pages/TestPage.tsx`

### v1.4.9（2026-03-17）

**手形矩阵选点功能 + 弯折区对齐修复**

HandMatrix 支持点击选中/取消，选中点参与 ADC Sum 计算；弯折区与指尖红色框精确中心对齐。

修改文件：`client/src/components/HandMatrix.tsx`、`client/src/pages/ConsistencyPage.tsx`、`client/src/pages/TestPage.tsx`

### v1.4.8（2026-03-17）

**弯折区对齐 + CSV 上传功能**

弯折区与指尖一一中心对齐并标明小拇指/大拇指；综合曲线区添加 CSV 上传按钮，支持导入历史数据回放展示。

修改文件：`client/src/components/HandMatrix.tsx`、`client/src/pages/ConsistencyPage.tsx`

### v1.4.7（2026-03-17）

**手掌区域沿中指中心对齐**

手掌各行以中指中心列为轴居中排列，宽度与指尖区域对齐。

修改文件：`client/src/components/HandMatrix.tsx`

### v1.4.6（2026-03-17）

**HandMatrix 紧凑分区视图**

重新设计 HandMatrix 布局：指尖红色框→弯折彩色方块→手掌暗色区，不显示 ADC 数值，格子仅显示原始编号。

修改文件：`client/src/components/HandMatrix.tsx`

### v1.4.5（2026-03-17）

**手形矩阵可视化：LH/RH 自动切换手形矩阵**

当传感器识别为 LH（左手）或 RH（右手）时，矩阵自动切换为专用手形可视化组件 `HandMatrix`，替代通用点阵矩阵。

手形矩阵布局设计：

| 区域 | 左手（LH）列位 | 右手（RH）列位 | 传感器数量 |
|------|---------|---------|----------|
| 小拇指压力 | col 0-2 | col 12-14 | 12个 |
| 无名指压力 | col 3-5 | col 9-11 | 12个 |
| 中指压力 | col 6-8 | col 6-8 | 12个 |
| 食指压力 | col 9-11 | col 3-5 | 12个 |
| 大拇指压力 | col 12-14 | col 0-2 | 12个 |
| 弯折传感器 | row 4-5 | row 4-5 | 5个 |
| 手掌 | row 5-9 | row 5-9 | 67个 |

每个单元格显示原始数组编号（#N）和实时 ADC 值，热力图色彩映射压力大小。弯折传感器用彩色方块区分。同时在一致性检测页自动将矩阵尺寸设置为 16×16。

修改文件：`client/src/components/HandMatrix.tsx`（新建）、`client/src/pages/TestPage.tsx`、`client/src/pages/ConsistencyPage.tsx`

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
