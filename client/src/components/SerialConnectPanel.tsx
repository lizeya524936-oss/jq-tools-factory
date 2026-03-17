/**
 * SerialConnectPanel - 串口连接面板组件
 * 支持力学仪器（CL2-500N-MH01）和传感器各自独立的串口连接
 * 波特率可自定义，实时显示连接状态和数据接收情况
 */
import { useState, useCallback } from 'react';
import { Cpu, Layers, Usb, X, AlertCircle, CheckCircle2, Loader2, Settings2 } from 'lucide-react';
import { isWebSerialSupported, SerialPortState, SerialStatus } from '@/hooks/useSerialPort';

interface SerialConnectPanelProps {
  role: 'force' | 'sensor';
  state: SerialPortState;
  onConnect: (baudRate: number) => Promise<boolean>;
  onDisconnect: () => Promise<void>;
}

const COMMON_BAUDS = [9600, 19200, 38400, 57600, 115200, 230400, 256000, 460800, 921600];

// 快捷预设：最常用的几个波特率，直接显示为按钮
const QUICK_BAUDS = [2400, 115200, 921600];

const ROLE_CONFIG = {
  force: {
    label: '力学仪器',
    sublabel: 'CL2-500N-MH01',
    icon: Cpu,
    defaultBaud: 115200,
    accentColor: 'oklch(0.70 0.18 200)',
    accentBg: 'oklch(0.70 0.18 200 / 0.12)',
    accentBorder: 'oklch(0.70 0.18 200 / 0.35)',
    hint: '数显手持测力仪，量程500N/50Kgf',
  },
  sensor: {
    label: '传感器产品',
    sublabel: '织物触觉传感器',
    icon: Layers,
    defaultBaud: 115200,
    accentColor: 'oklch(0.72 0.20 145)',
    accentBg: 'oklch(0.72 0.20 145 / 0.12)',
    accentBorder: 'oklch(0.72 0.20 145 / 0.35)',
    hint: '最大64×64点阵，ADC值范围0~255',
  },
};

const STATUS_CONFIG: Record<SerialStatus, { label: string; color: string }> = {
  disconnected: { label: '未连接', color: 'oklch(0.42 0.02 240)' },
  connecting: { label: '连接中...', color: 'oklch(0.75 0.18 55)' },
  connected: { label: '已连接', color: 'oklch(0.72 0.20 145)' },
  error: { label: '连接错误', color: 'oklch(0.65 0.22 25)' },
};

export default function SerialConnectPanel({
  role,
  state,
  onConnect,
  onDisconnect,
}: SerialConnectPanelProps) {
  const cfg = ROLE_CONFIG[role];
  const Icon = cfg.icon;
  const statusCfg = STATUS_CONFIG[state.status];
  const supported = isWebSerialSupported();

  const [baudInput, setBaudInput] = useState(cfg.defaultBaud.toString());
  const [showBaudMenu, setShowBaudMenu] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const handleConnect = useCallback(async () => {
    const baud = parseInt(baudInput, 10);
    if (isNaN(baud) || baud <= 0) return;
    await onConnect(baud);
  }, [baudInput, onConnect]);

  const handleDisconnect = useCallback(async () => {
    await onDisconnect();
  }, [onDisconnect]);

  const isConnected = state.status === 'connected';
  const isConnecting = state.status === 'connecting';

  return (
    <div className="relative">
      {/* 主按钮区域 */}
      <div
        className="flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-all"
        style={{
          background: isConnected ? cfg.accentBg : 'oklch(0.20 0.025 265)',
          border: `1px solid ${isConnected ? cfg.accentBorder : 'oklch(0.28 0.03 265)'}`,
        }}
        onClick={() => !isConnected && !isConnecting && setShowDetails(!showDetails)}
      >
        {/* 状态指示点 */}
        <div
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{
            background: statusCfg.color,
            boxShadow: isConnected ? `0 0 5px ${statusCfg.color}` : 'none',
            animation: isConnecting ? 'pulse 1s infinite' : 'none',
          }}
        />

        <Icon size={11} style={{ color: isConnected ? cfg.accentColor : 'oklch(0.55 0.02 240)', flexShrink: 0 }} />

        <span
          className="text-xs font-mono max-w-28 truncate"
          style={{ color: isConnected ? cfg.accentColor : 'oklch(0.55 0.02 240)' }}
        >
          {isConnected
            ? `${cfg.label} · ${state.portInfo ?? '已连接'}`
            : isConnecting
            ? `${cfg.label} · 连接中...`
            : `选择${cfg.label}`}
        </span>

        {isConnected ? (
          <button
            onClick={e => { e.stopPropagation(); handleDisconnect(); }}
            className="ml-0.5 hover:opacity-70 transition-opacity"
          >
            <X size={10} style={{ color: cfg.accentColor }} />
          </button>
        ) : (
          <Settings2
            size={10}
            style={{ color: 'oklch(0.42 0.02 240)' }}
            onClick={e => { e.stopPropagation(); setShowDetails(!showDetails); }}
          />
        )}
      </div>

      {/* 展开的连接面板 */}
      {showDetails && !isConnected && (
        <div
          className="absolute right-0 top-full mt-1 rounded shadow-2xl z-50 p-3"
          style={{
            background: 'oklch(0.16 0.025 265)',
            border: '1px solid oklch(0.28 0.04 265)',
            minWidth: '280px',
          }}
        >
          {/* 标题 */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Icon size={13} style={{ color: cfg.accentColor }} />
              <span className="text-xs font-medium" style={{ color: cfg.accentColor }}>
                {cfg.label}
              </span>
            </div>
            <button onClick={() => setShowDetails(false)}>
              <X size={12} style={{ color: 'oklch(0.45 0.02 240)' }} />
            </button>
          </div>

          {/* 提示信息 */}
          <p className="text-xs mb-3" style={{ color: 'oklch(0.50 0.02 240)', fontFamily: "'IBM Plex Mono', monospace" }}>
            {cfg.hint}
          </p>

          {/* 浏览器不支持提示 */}
          {!supported && (
            <div
              className="flex items-start gap-2 p-2 rounded mb-3"
              style={{ background: 'oklch(0.65 0.22 25 / 0.1)', border: '1px solid oklch(0.65 0.22 25 / 0.3)' }}
            >
              <AlertCircle size={12} style={{ color: 'oklch(0.65 0.22 25)', flexShrink: 0, marginTop: '1px' }} />
              <p className="text-xs" style={{ color: 'oklch(0.65 0.22 25)' }}>
                当前浏览器不支持 Web Serial API。请使用 Chrome 89+ 或 Edge 89+，并确保通过 HTTPS 访问。
              </p>
            </div>
          )}

          {/* 错误提示 */}
          {state.errorMsg && (
            <div
              className="flex items-start gap-2 p-2 rounded mb-3"
              style={{ background: 'oklch(0.65 0.22 25 / 0.1)', border: '1px solid oklch(0.65 0.22 25 / 0.3)' }}
            >
              <AlertCircle size={12} style={{ color: 'oklch(0.65 0.22 25)', flexShrink: 0, marginTop: '1px' }} />
              <p className="text-xs" style={{ color: 'oklch(0.65 0.22 25)' }}>{state.errorMsg}</p>
            </div>
          )}

          {/* 波特率设置 */}
          <div className="mb-3">
            <label className="block text-xs mb-1.5" style={{ color: 'oklch(0.55 0.02 240)', fontFamily: "'IBM Plex Mono', monospace" }}>
              采样波特率（可自定义）
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="number"
                  value={baudInput}
                  onChange={e => setBaudInput(e.target.value)}
                  className="w-full px-2 py-1.5 rounded text-xs font-mono outline-none"
                  style={{
                    background: 'oklch(0.12 0.02 265)',
                    border: '1px solid oklch(0.25 0.03 265)',
                    color: 'oklch(0.82 0.01 220)',
                  }}
                  placeholder="115200"
                  min={300}
                  max={4000000}
                />
              </div>
              <div className="relative">
                <button
                  onClick={() => setShowBaudMenu(!showBaudMenu)}
                  className="px-2 py-1.5 rounded text-xs font-mono transition-colors"
                  style={{
                    background: 'oklch(0.20 0.025 265)',
                    border: '1px solid oklch(0.28 0.03 265)',
                    color: 'oklch(0.55 0.02 240)',
                  }}
                >
                  全部
                </button>
                {showBaudMenu && (
                  <div
                    className="absolute right-0 top-full mt-1 rounded shadow-xl z-50 py-1"
                    style={{
                      background: 'oklch(0.18 0.025 265)',
                      border: '1px solid oklch(0.28 0.04 265)',
                      minWidth: '100px',
                    }}
                  >
                    {COMMON_BAUDS.map(b => (
                      <button
                        key={b}
                        onClick={() => { setBaudInput(b.toString()); setShowBaudMenu(false); }}
                        className="w-full px-3 py-1 text-left text-xs font-mono hover:bg-white/5 transition-colors"
                        style={{
                          color: parseInt(baudInput) === b ? cfg.accentColor : 'oklch(0.65 0.02 240)',
                        }}
                      >
                        {b.toLocaleString()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 快捷预设按钮 */}
            <div className="flex gap-1.5 mt-2">
              {QUICK_BAUDS.map(b => {
                const isActive = parseInt(baudInput) === b;
                return (
                  <button
                    key={b}
                    onClick={() => setBaudInput(b.toString())}
                    className="flex-1 py-1 rounded text-xs font-mono font-medium transition-all"
                    style={{
                      background: isActive ? cfg.accentBg : 'oklch(0.20 0.025 265)',
                      border: `1px solid ${isActive ? cfg.accentBorder : 'oklch(0.28 0.03 265)'}`,
                      color: isActive ? cfg.accentColor : 'oklch(0.55 0.02 240)',
                      boxShadow: isActive ? `0 0 6px ${cfg.accentColor.replace(')', ' / 0.15)')}` : 'none',
                    }}
                  >
                    {b >= 1000 ? `${b / 1000}k` : b}
                  </button>
                );
              })}
            </div>
            <div className="mt-1.5 text-xs font-mono" style={{ color: 'oklch(0.38 0.02 240)', fontSize: '9px' }}>
              点击快捷按钮或输入自定义值，点"全部"查看更多
            </div>
          </div>

          {/* 连接按钮 */}
          <button
            onClick={handleConnect}
            disabled={!supported || isConnecting}
            className="w-full flex items-center justify-center gap-2 py-2 rounded text-xs font-mono font-medium transition-all disabled:opacity-50"
            style={{
              background: supported ? cfg.accentBg : 'oklch(0.20 0.025 265)',
              border: `1px solid ${supported ? cfg.accentBorder : 'oklch(0.28 0.03 265)'}`,
              color: supported ? cfg.accentColor : 'oklch(0.45 0.02 240)',
            }}
          >
            {isConnecting ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                正在连接...
              </>
            ) : (
              <>
                <Usb size={12} />
                选择串口并连接
              </>
            )}
          </button>

          <p className="text-xs mt-2 text-center" style={{ color: 'oklch(0.38 0.02 240)', fontFamily: "'IBM Plex Mono', monospace" }}>
            点击后将弹出系统串口选择对话框
          </p>
        </div>
      )}

      {/* 已连接状态的详情悬浮 */}
      {isConnected && showDetails && (
        <div
          className="absolute right-0 top-full mt-1 rounded shadow-2xl z-50 p-3"
          style={{
            background: 'oklch(0.16 0.025 265)',
            border: `1px solid ${cfg.accentBorder}`,
            minWidth: '240px',
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={12} style={{ color: cfg.accentColor }} />
              <span className="text-xs font-medium" style={{ color: cfg.accentColor }}>
                {cfg.label} · 已连接
              </span>
            </div>
            <button onClick={() => setShowDetails(false)}>
              <X size={12} style={{ color: 'oklch(0.45 0.02 240)' }} />
            </button>
          </div>
          <div className="space-y-1.5 text-xs font-mono">
            {[
              { label: '设备', value: state.portInfo ?? '未知' },
              { label: '波特率', value: `${state.baudRate.toLocaleString()} baud` },
              { label: '最新数据', value: state.lastData ?? '等待数据...' }
            ].map(row => (
              <div key={row.label} className="flex justify-between gap-3">
                <span style={{ color: 'oklch(0.45 0.02 240)' }}>{row.label}</span>
                <span
                  className="truncate max-w-32 text-right"
                  style={{ color: 'oklch(0.72 0.01 220)' }}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={() => { handleDisconnect(); setShowDetails(false); }}
            className="w-full mt-3 py-1.5 rounded text-xs font-mono transition-colors hover:bg-white/5"
            style={{
              border: '1px solid oklch(0.65 0.22 25 / 0.4)',
              color: 'oklch(0.65 0.22 25)',
            }}
          >
            断开连接
          </button>
        </div>
      )}
    </div>
  );
}
