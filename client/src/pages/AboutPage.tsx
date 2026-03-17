/**
 * AboutPage - 关于页面
 * 展示产品信息、检测工具说明、检测目标（第三版需求）
 */
import { CheckCircle, Cpu, Layers, Zap, Usb, GitBranch } from 'lucide-react';
import { APP_VERSION, BUILD_DATE } from '@/version';

export default function AboutPage() {
  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* 标题 */}
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded flex items-center justify-center font-mono font-bold text-white flex-shrink-0"
            style={{ background: 'oklch(0.58 0.22 265)', fontSize: '14px' }}
          >
            JQ
          </div>
          <div>
            <h1
              className="text-lg font-semibold"
              style={{ color: 'oklch(0.92 0.01 220)', fontFamily: "'IBM Plex Sans', sans-serif" }}
            >
              JQ Tools Factory
            </h1>
            <p className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)' }}>
              产品出厂检测工具 {APP_VERSION} | 矩侨工业 · {BUILD_DATE}
            </p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-xs font-mono" style={{ color: 'oklch(0.48 0.02 240)', lineHeight: '1.6' }}>
              我们是矩侨工业，做织物传感器件，压阻原理<br />
              数据多以矩阵化数组进行输出ADC数值<br />
              用在不同领域的压力数据采集
            </p>
          </div>
        </div>

        {/* 检测目标 */}
        <div
          className="rounded p-4"
          style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={14} style={{ color: 'oklch(0.72 0.20 145)' }} />
            <span className="text-sm font-medium" style={{ color: 'oklch(0.85 0.01 220)' }}>
              检测目标
            </span>
            <span className="text-xs font-mono ml-auto" style={{ color: 'oklch(0.45 0.02 240)' }}>
              误差阈值默认±8%，具体可定义
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                label: '一致性',
                value: '±8%',
                desc: '验证产品检测区域的一致性要求',
                tool: '手动垂直下压机',
                method: '检测方法A',
                color: 'oklch(0.70 0.18 200)',
              },
              {
                label: '重复性',
                value: '±8%',
                desc: '验证产品检测区域的重复性要求',
                tool: 'PLC可编程垂直下压机',
                method: '检测方法B',
                color: 'oklch(0.72 0.20 145)',
              },
              {
                label: '耐久性',
                value: '±8%',
                desc: '验证产品检测区域的耐久性要求',
                tool: '机器人灵巧手套',
                method: '1万次抓握',
                color: 'oklch(0.65 0.22 25)',
              },
            ].map(item => (
              <div
                key={item.label}
                className="rounded p-3"
                style={{ background: 'oklch(0.14 0.02 265)', border: '1px solid oklch(0.22 0.03 265)' }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium" style={{ color: 'oklch(0.75 0.01 220)' }}>
                    {item.label}
                  </span>
                  <span className="text-lg font-mono font-bold" style={{ color: item.color }}>
                    {item.value}
                  </span>
                </div>
                <div className="text-xs mb-2" style={{ color: 'oklch(0.55 0.02 240)' }}>
                  {item.desc}
                </div>
                <div
                  className="text-xs font-mono px-2 py-1 rounded"
                  style={{
                    background: `${item.color.replace(')', ' / 0.1)')}`,
                    border: `1px solid ${item.color.replace(')', ' / 0.25)')}`,
                    color: item.color,
                  }}
                >
                  {item.tool} · {item.method}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 设备连接流程 */}
        <div
          className="rounded p-4"
          style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Usb size={14} style={{ color: 'oklch(0.58 0.22 265)' }} />
            <span className="text-sm font-medium" style={{ color: 'oklch(0.85 0.01 220)' }}>
              设备连接流程（两个USB串口）
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div
              className="rounded p-3"
              style={{ background: 'oklch(0.14 0.02 265)', border: '1px solid oklch(0.70 0.18 200 / 0.3)' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-5 h-5 rounded flex items-center justify-center text-xs font-mono font-bold"
                  style={{ background: 'oklch(0.70 0.18 200 / 0.2)', color: 'oklch(0.70 0.18 200)' }}
                >
                  1
                </div>
                <span className="text-xs font-medium" style={{ color: 'oklch(0.70 0.18 200)' }}>
                  选择力学检测设备
                </span>
              </div>
              <p className="text-xs" style={{ color: 'oklch(0.60 0.02 240)' }}>
                通过USB串口选择力学检测设备
              </p>
              <p className="text-xs font-mono mt-1" style={{ color: 'oklch(0.50 0.02 240)' }}>
                数显手持测力仪 CL2-500N-MH01
              </p>
              <p className="text-xs font-mono" style={{ color: 'oklch(0.45 0.02 240)' }}>
                量程500N/50Kgf，用于检测压力数据
              </p>
            </div>
            <div
              className="rounded p-3"
              style={{ background: 'oklch(0.14 0.02 265)', border: '1px solid oklch(0.72 0.20 145 / 0.3)' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-5 h-5 rounded flex items-center justify-center text-xs font-mono font-bold"
                  style={{ background: 'oklch(0.72 0.20 145 / 0.2)', color: 'oklch(0.72 0.20 145)' }}
                >
                  2
                </div>
                <span className="text-xs font-medium" style={{ color: 'oklch(0.72 0.20 145)' }}>
                  选择被测传感器产品
                </span>
              </div>
              <p className="text-xs" style={{ color: 'oklch(0.60 0.02 240)' }}>
                通过USB串口选择被测传感器
              </p>
              <p className="text-xs font-mono mt-1" style={{ color: 'oklch(0.50 0.02 240)' }}>
                不同形态、点密度的织物触觉传感器
              </p>
              <p className="text-xs font-mono" style={{ color: 'oklch(0.45 0.02 240)' }}>
                最大点阵密度64×64，横纵点阵支持1到64可设置
              </p>
            </div>
          </div>
        </div>

        {/* 检测产品 */}
        <div
          className="rounded p-4"
          style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Layers size={14} style={{ color: 'oklch(0.70 0.18 200)' }} />
            <span className="text-sm font-medium" style={{ color: 'oklch(0.85 0.01 220)' }}>
              传感器矩阵规格
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { size: '8×8', desc: '64点', example: '触觉手套（小）', color: 'oklch(0.70 0.18 200)' },
              { size: '16×16', desc: '256点', example: '足底传感器', color: 'oklch(0.72 0.20 145)' },
              { size: '32×32', desc: '1024点', example: '皮肤传感器', color: 'oklch(0.75 0.18 55)' },
              { size: '64×64', desc: '4096点', example: '大面积阵列', color: 'oklch(0.65 0.22 25)' },
            ].map(item => (
              <div
                key={item.size}
                className="rounded p-2.5 text-center"
                style={{ background: 'oklch(0.14 0.02 265)', border: '1px solid oklch(0.22 0.03 265)' }}
              >
                <div className="text-base font-mono font-bold" style={{ color: item.color }}>
                  {item.size}
                </div>
                <div className="text-xs font-mono mt-0.5" style={{ color: 'oklch(0.55 0.02 240)' }}>
                  {item.desc}
                </div>
                <div className="text-xs mt-1" style={{ color: 'oklch(0.45 0.02 240)' }}>
                  {item.example}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs font-mono mt-2" style={{ color: 'oklch(0.45 0.02 240)' }}>
            * 横纵点阵支持1到64任意设置，软件按被测产品的横纵比例进行数据展示
          </p>
        </div>

        {/* 检测流程 */}
        <div
          className="rounded p-4"
          style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <GitBranch size={14} style={{ color: 'oklch(0.75 0.18 55)' }} />
            <span className="text-sm font-medium" style={{ color: 'oklch(0.85 0.01 220)' }}>
              检测流程说明
            </span>
          </div>
          <div className="space-y-2">
            {[
              {
                step: '01',
                title: '一致性检测（方法A）',
                color: 'oklch(0.70 0.18 200)',
                items: [
                  '手动垂直下压机，人工下压检测一致性',
                  '对传感器的特定区域做高频采样力学、多个压力传感点的求和数据',
                  '抽样10个产品，剔除偏差较大的数据，求出均值10条曲线的线性均值曲线',
                  '判断方法A：平滑曲线10N到50N范围内，选取5个间隔一致的数值，判断误差范围是否在±8%范围内',
                  '对同一批次的不同传感器按"检测方法A"测试，并进行逻辑判定，逻辑"判定方法A"可设定',
                ],
              },
              {
                step: '02',
                title: '重复性检测（方法B）',
                color: 'oklch(0.72 0.20 145)',
                items: [
                  'PLC可编程垂直下压机，编程检测重复性',
                  '对传感器的特定区域做高频采样力学、多个压力传感点的求和数据',
                  '使用PLC可编程垂直下压机，对传感器特定区域按"检测方法B"测试，并进行逻辑判定',
                  '判断方法B：间隔1分钟取一次压力数值和ADC求和的数值，判断两类数据在采样期间的误差范围是否在±8%范围内',
                ],
              },
              {
                step: '03',
                title: '耐久性检测',
                color: 'oklch(0.65 0.22 25)',
                items: [
                  '定制一对机器人灵巧手套，反复抓握一个特定物体，1万次',
                  '查看ADC求和数据，并验证全部传感感点的有效性和灵敏度是否变化',
                ],
              },
            ].map(section => (
              <div
                key={section.step}
                className="rounded p-3"
                style={{ background: 'oklch(0.14 0.02 265)', border: '1px solid oklch(0.22 0.03 265)' }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="text-xs font-mono font-bold px-1.5 py-0.5 rounded"
                    style={{
                      background: `${section.color.replace(')', ' / 0.15)')}`,
                      color: section.color,
                    }}
                  >
                    {section.step}
                  </span>
                  <span className="text-xs font-medium" style={{ color: section.color }}>
                    {section.title}
                  </span>
                </div>
                <ul className="space-y-1">
                  {section.items.map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <div
                        className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0"
                        style={{ background: section.color }}
                      />
                      <span className="text-xs" style={{ color: 'oklch(0.58 0.02 240)' }}>
                        {item}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* 数据格式 */}
        <div
          className="rounded p-4"
          style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Zap size={14} style={{ color: 'oklch(0.65 0.22 25)' }} />
            <span className="text-sm font-medium" style={{ color: 'oklch(0.85 0.01 220)' }}>
              数据记录/导出格式
            </span>
          </div>
          <div
            className="rounded p-3 font-mono text-xs"
            style={{ background: 'oklch(0.12 0.02 265)', border: '1px solid oklch(0.20 0.03 265)' }}
          >
            <div style={{ color: 'oklch(0.55 0.02 240)' }} className="mb-1">
              # CSV导出格式（数据导出格式为CSV数据）
            </div>
            <div style={{ color: 'oklch(0.72 0.20 145)' }}>
              Time, Pressure, ADC Value, ADC Sum
            </div>
            <div className="mt-2 space-y-1">
              {[
                ['Time', '时间戳'],
                ['Pressure', '串口数据上报的力学数据，以N为单位（横坐标）'],
                ['ADC Value', '多个传感感点的ADC数值（分号分隔）'],
                ['ADC Sum', '以选定区域的串口上报十六进制数组求和（纵坐标）'],
              ].map(([key, desc]) => (
                <div key={key}>
                  <span style={{ color: 'oklch(0.70 0.18 200)' }}>{key}</span>
                  <span style={{ color: 'oklch(0.50 0.02 240)' }}> — {desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 软件功能 */}
        <div
          className="rounded p-4"
          style={{ background: 'oklch(0.17 0.025 265)', border: '1px solid oklch(0.25 0.03 265)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Cpu size={14} style={{ color: 'oklch(0.58 0.22 265)' }} />
            <span className="text-sm font-medium" style={{ color: 'oklch(0.85 0.01 220)' }}>
              软件功能模块
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              {
                module: '传感器矩阵展示/选择',
                desc: '按被测产品横纵比例1:1展示，点击/拖拽选择检测区域，蓝色→绿色高亮，显示已选传感点数量',
              },
              {
                module: '显示形式',
                desc: '横坐标：串口数据上报的力学数据（N）；纵坐标：选定区域的串口上报十六进制数组求和',
              },
              {
                module: '一致性检测',
                desc: '方法A：10个产品采样，均值曲线，5个检查点，误差阈值可定义，判定方法A可设定',
              },
              {
                module: '重复性检测',
                desc: '方法B：间隔1分钟采样，两类数据误差判定，阈值可定义，判定方法B可设定',
              },
              {
                module: '耐久性检测',
                desc: '机器人灵巧手套1万次抓握，ADC衰减趋势图，验证传感点有效性和灵敏度变化',
              },
              {
                module: '数据记录/导出',
                desc: 'CSV格式导出：Time, Pressure, ADC Value, ADC Sum，支持按检测模式分别导出',
              },
            ].map(f => (
              <div
                key={f.module}
                className="rounded p-2.5"
                style={{ background: 'oklch(0.14 0.02 265)', border: '1px solid oklch(0.22 0.03 265)' }}
              >
                <div className="font-medium mb-1" style={{ color: 'oklch(0.70 0.18 200)' }}>
                  {f.module}
                </div>
                <div style={{ color: 'oklch(0.55 0.02 240)', lineHeight: '1.5' }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
