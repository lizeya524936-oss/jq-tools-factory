/**
 * Sidebar - 左侧导航栏
 * 设计风格：精密科学仪器，深色侧边栏
 */
import { Activity, RotateCcw, Clock, Info, Zap, Weight } from 'lucide-react';

export type TabType = 'test' | 'consistency' | 'weight-consistency' | 'repeatability' | 'durability' | 'about';

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
    id: 'weight-consistency',
    label: '一致性（砝码）',
    sublabel: 'Weight Calibration',
    icon: <Weight size={16} />,
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
        background: 'var(--jk-s1)',
        borderRight: '1px solid var(--jk-s4)',
      }}
    >
      {/* Logo区域 */}
      <div
        className="px-4 py-4"
        style={{ borderBottom: '1px solid var(--jk-s3)' }}
      >
        <div className="flex items-center gap-2 mb-1">
          <div
            className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--jk-primary)', fontSize: '10px', fontWeight: 700, color: 'var(--jk-on-primary)', fontFamily: "'IBM Plex Mono', monospace" }}
          >
            JQ
          </div>
          <div>
            <div className="text-xs font-semibold leading-tight" style={{ color: 'var(--jk-ink)', fontFamily: "'IBM Plex Sans', sans-serif" }}>
              Tools Factory
            </div>
          </div>
        </div>
        <div className="text-xs font-mono mt-1" style={{ color: 'var(--jk-text-low)', fontSize: '9px' }}>
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
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onTabChange(item.id)}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-all"
              style={{
                background: isActive ? 'color-mix(in srgb, var(--jk-primary) 15%, transparent)' : 'transparent',
                borderLeft: isActive ? '2px solid var(--jk-primary)' : '2px solid transparent',
                color: isActive ? 'var(--jk-ink)' : 'var(--jk-text-body)',
              }}
            >
              <span style={{ color: isActive ? 'var(--jk-accent)' : 'var(--jk-text-low)', flexShrink: 0 }}>
                {item.icon}
              </span>
              <div className="min-w-0">
                <div className="text-xs font-medium leading-tight" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
                  {item.label}
                </div>
                <div className="text-xs leading-tight" style={{ fontSize: '9px', color: isActive ? 'var(--jk-text-high)' : 'var(--jk-text-dim)', fontFamily: "'IBM Plex Mono', monospace" }}>
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
        style={{ borderTop: '1px solid var(--jk-s3)' }}
      >
        <div className="flex items-center gap-1.5 mb-1">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--jk-ok)' }} />
          <span className="text-xs font-mono" style={{ color: 'var(--jk-text-mid)', fontSize: '9px' }}>
            模拟模式
          </span>
        </div>
        <div className="text-xs font-mono" style={{ color: 'var(--jk-text-dim)', fontSize: '9px' }}>
          矩侨工业 © 2025
        </div>
      </div>
    </aside>
  );
}
