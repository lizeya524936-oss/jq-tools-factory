/**
 * Sidebar - 左侧导航栏
 * 设计风格：精密科学仪器，深色侧边栏
 */
import { Activity, RotateCcw, Clock, Database, Info, Zap } from 'lucide-react';

export type TabType = 'test' | 'consistency' | 'repeatability' | 'durability' | 'data' | 'about';

interface SidebarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

const navItems: { id: TabType; label: string; sublabel: string; icon: React.ReactNode }[] = [
  {
    id: 'test',
    label: '测试页',
    sublabel: 'Test',
    icon: <Zap size={16} />,
  },
  {
    id: 'consistency',
    label: '一致性',
    sublabel: 'Consistency',
    icon: <Activity size={16} />,
  },
  {
    id: 'repeatability',
    label: '重复性',
    sublabel: 'Repeatability',
    icon: <RotateCcw size={16} />,
  },
  {
    id: 'durability',
    label: '耐久性',
    sublabel: 'Durability',
    icon: <Clock size={16} />,
  },
  {
    id: 'data',
    label: '数据记录',
    sublabel: 'Data Log',
    icon: <Database size={16} />,
  },
  {
    id: 'about',
    label: '关于',
    sublabel: 'About',
    icon: <Info size={16} />,
  },
];

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  return (
    <aside
      className="flex flex-col h-full"
      style={{
        width: '160px',
        minWidth: '160px',
        background: 'oklch(0.15 0.025 265)',
        borderRight: '1px solid oklch(0.22 0.03 265)',
      }}
    >
      {/* Logo区域 */}
      <div
        className="px-4 py-4"
        style={{ borderBottom: '1px solid oklch(0.20 0.03 265)' }}
      >
        <div className="flex items-center gap-2 mb-1">
          <div
            className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
            style={{ background: 'oklch(0.58 0.22 265)', fontSize: '10px', fontWeight: 700, color: 'white', fontFamily: "'IBM Plex Mono', monospace" }}
          >
            JQ
          </div>
          <div>
            <div className="text-xs font-semibold leading-tight" style={{ color: 'oklch(0.90 0.01 220)', fontFamily: "'IBM Plex Sans', sans-serif" }}>
              Tools Factory
            </div>
          </div>
        </div>
        <div className="text-xs font-mono mt-1" style={{ color: 'oklch(0.45 0.02 240)', fontSize: '9px' }}>
          产品出厂检测工具 v1.0
        </div>
      </div>

      {/* 导航项 */}
      <nav className="flex-1 py-2">
        {navItems.map(item => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-all"
              style={{
                background: isActive ? 'oklch(0.58 0.22 265 / 0.15)' : 'transparent',
                borderLeft: isActive ? '2px solid oklch(0.58 0.22 265)' : '2px solid transparent',
                color: isActive ? 'oklch(0.90 0.01 220)' : 'oklch(0.55 0.02 240)',
              }}
            >
              <span style={{ color: isActive ? 'oklch(0.70 0.18 200)' : 'oklch(0.45 0.02 240)', flexShrink: 0 }}>
                {item.icon}
              </span>
              <div className="min-w-0">
                <div className="text-xs font-medium leading-tight" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
                  {item.label}
                </div>
                <div className="text-xs leading-tight" style={{ fontSize: '9px', color: isActive ? 'oklch(0.60 0.02 240)' : 'oklch(0.38 0.02 240)', fontFamily: "'IBM Plex Mono', monospace" }}>
                  {item.sublabel}
                </div>
              </div>
            </button>
          );
        })}
      </nav>

      {/* 底部信息 */}
      <div
        className="px-4 py-3"
        style={{ borderTop: '1px solid oklch(0.20 0.03 265)' }}
      >
        <div className="flex items-center gap-1.5 mb-1">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'oklch(0.72 0.20 145)' }} />
          <span className="text-xs font-mono" style={{ color: 'oklch(0.50 0.02 240)', fontSize: '9px' }}>
            模拟模式
          </span>
        </div>
        <div className="text-xs font-mono" style={{ color: 'oklch(0.38 0.02 240)', fontSize: '9px' }}>
          矩侨工业 © 2025
        </div>
      </div>
    </aside>
  );
}
