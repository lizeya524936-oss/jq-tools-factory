import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';

/**
 * 白天/黑夜主题切换按钮。
 * 主题由 <html class="dark"> 控制，切换不触发任何组件重渲染（颜色全部走 CSS 变量）。
 */
export default function ThemeToggle({ compact = true }: { compact?: boolean }) {
  const { theme, toggleTheme, switchable } = useTheme();
  if (!switchable || !toggleTheme) return null;

  const isDark = theme === 'dark';
  const label = isDark ? '切换到白天模式' : '切换到黑夜模式';
  // 图标表示「当前」主题，文字也是当前主题，标题提示点击后的结果
  const Icon = isDark ? Moon : Sun;

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      className="flex items-center gap-1.5 rounded transition-colors"
      style={{
        height: compact ? '18px' : '28px',
        padding: compact ? '0 5px' : '0 10px',
        background: 'var(--jk-s3)',
        border: '1px solid var(--jk-line-1)',
        color: 'var(--jk-text-mid)',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: compact ? '10px' : '11px',
      }}
    >
      <Icon size={compact ? 11 : 13} />
      {!compact && <span>{isDark ? '黑夜' : '白天'}</span>}
    </button>
  );
}
