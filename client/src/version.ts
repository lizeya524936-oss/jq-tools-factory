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
 */
export const APP_VERSION = 'v1.3.5';
export const APP_NAME = 'JQ Tools Factory';
export const BUILD_DATE = '2026-03-17';
