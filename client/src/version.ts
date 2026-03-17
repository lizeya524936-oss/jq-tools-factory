/**
 * 版本号管理
 * 每次发布修改时更新此文件
 *
 * 版本历史：
 * v1.3.0  - 初始版本（项目文档基准版本）
 * v1.3.1  - 修复切换页面后频率显示归零的 bug（统计数据提升至 SerialDriver 全局单例）
 * v1.3.2  - 右上角"力学仪器"改为"检测设备"选择器（压力计/机械手），移除压力图表内连接按钮
 * v1.3.3  - 压力计连接时自动发送 CL2 初始化命令（CMD_CONNECT + CMD_START），断开时发送 CMD_STOP
 * v1.3.4  - 修复压力计数据无法显示的 bug：PressureChart 改为从 SerialCtx 读取数据，统一数据流
 * v1.3.5  - 压力图表改为定时轮询模式，连接后持续采集并实时绘制200个数据点，无论压力值是否变化
 * v1.3.6  - 修复采集频率和延迟问题：改为 subscribe 事件订阅模式，零丢失零延迟接收200Hz数据
 * v1.3.7  - 修复压力数据丢失：新增 subscribeForce 专用通道，每个数据点直接写入缓冲区
 * v1.3.8  - 修复压力计数据解析：force role 改为 CL2 二进制协议解析（与 v1.3.1 SerialDriver 一致）
 * v1.3.9  - 重置按钮增加 CMD_RESET 归零指令：点击重置时同时向压力计发送 0x23 0x55 0x00 0x0A
 * v1.4.0  - 一致性检测页面精简：移除多产品对比/数据表格Tab、平均压力/ADC区域、开始检测按钮，放大传感器数组
 */
export const APP_VERSION = 'v1.4.0';
export const APP_NAME = 'JQ Tools Factory';
export const BUILD_DATE = '2026-03-17';
