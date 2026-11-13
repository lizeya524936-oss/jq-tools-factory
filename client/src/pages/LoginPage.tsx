/**
 * LoginPage — 客户登录页面（用户名 + 密码）
 */

import { useState, type FormEvent } from 'react';
import { useClient } from '@/contexts/ClientContext';
import ThemeToggle from '@/components/ThemeToggle';
import { APP_VERSION } from '@/version';
import { Key, User } from 'lucide-react';

export default function LoginPage() {
  const { login } = useClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码');
      return;
    }

    const err = login(username.trim(), password, remember);
    if (err) {
      setError(err);
    }
  };

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen"
      style={{ background: 'var(--jk-sunken)' }}
    >
      {/* 主题切换（登录前也能切，方便确认配色） */}
      <div style={{ position: 'fixed', top: 12, right: 12, zIndex: 50 }}>
        <ThemeToggle compact={false} />
      </div>

      {/* 卡片 */}
      <div
        className="rounded-2xl p-8 w-full max-w-sm"
        style={{
          background: 'var(--jk-s2)',
          border: '1px solid var(--jk-line-1)',
          boxShadow: '0 0 60px color-mix(in srgb, var(--jk-ink) 12%, transparent)',
        }}
      >
        {/* 标题 */}
        <div className="text-center mb-6">
          <h1
            className="text-xl font-bold mb-1"
            style={{ color: 'var(--jk-ok)', fontFamily: "'IBM Plex Mono', monospace" }}
          >
            JQ Tools Factory
          </h1>
          <p
            className="text-xs"
            style={{ color: 'var(--jk-text-mid)', fontFamily: "'IBM Plex Mono', monospace" }}
          >
            产品出厂检测工具
          </p>
        </div>

        <div
          className="mb-6"
          style={{ borderTop: '1px solid var(--jk-s4)' }}
        />

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* 用户名 */}
          <div>
            <label
              className="block text-xs mb-1"
              style={{ color: 'var(--jk-text-mid)', fontFamily: "'IBM Plex Mono', monospace" }}
            >
              用户名
            </label>
            <div className="relative">
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2">
                <User size={14} style={{ color: 'var(--jk-text-dim)' }} />
              </div>
              <input
                type="text"
                value={username}
                onChange={e => { setUsername(e.target.value); setError(null); }}
                placeholder="请输入用户名"
                className="w-full pl-8 pr-3 py-2 text-sm font-mono rounded outline-none transition-colors"
                style={{
                  background: 'var(--jk-s3)',
                  border: `1px solid ${error ? 'color-mix(in srgb, var(--jk-danger) 50%, transparent)' : 'var(--jk-line-2)'}`,
                  color: 'var(--jk-text-strong)',
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
                autoComplete="username"
              />
            </div>
          </div>

          {/* 密码 */}
          <div>
            <label
              className="block text-xs mb-1"
              style={{ color: 'var(--jk-text-mid)', fontFamily: "'IBM Plex Mono', monospace" }}
            >
              密码
            </label>
            <div className="relative">
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2">
                <Key size={14} style={{ color: 'var(--jk-text-dim)' }} />
              </div>
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(null); }}
                placeholder="请输入密码"
                className="w-full pl-8 pr-3 py-2 text-sm font-mono rounded outline-none transition-colors"
                style={{
                  background: 'var(--jk-s3)',
                  border: `1px solid ${error ? 'color-mix(in srgb, var(--jk-danger) 50%, transparent)' : 'var(--jk-line-2)'}`,
                  color: 'var(--jk-text-strong)',
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
                autoComplete="current-password"
                onKeyDown={e => { if (e.key === 'Enter') handleSubmit(e); }}
              />
            </div>
          </div>

          {/* 错误提示 */}
          {error && (
            <p
              className="text-xs py-1 px-2 rounded"
              style={{
                color: 'var(--jk-danger)',
                background: 'color-mix(in srgb, var(--jk-danger) 8%, transparent)',
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            >
              {error}
            </p>
          )}

          {/* 记住登录状态 */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
              className="w-3.5 h-3.5 rounded cursor-pointer"
              style={{
                accentColor: 'var(--jk-ok)',
              }}
            />
            <span
              className="text-xs"
              style={{ color: 'var(--jk-text-mid)', fontFamily: "'IBM Plex Mono', monospace" }}
            >
              记住登录状态
            </span>
          </label>

          {/* 登录按钮 */}
          <button
            type="submit"
            disabled={!username.trim() || !password.trim()}
            className="w-full py-2.5 rounded-lg text-sm font-bold transition-all mt-2"
            style={{
              background: (username.trim() && password.trim())
                ? 'color-mix(in srgb, var(--jk-ok) 85%, transparent)'
                : 'var(--jk-line-1)',
              color: (username.trim() && password.trim()) ? 'var(--jk-on-primary)' : 'var(--jk-text-dim)',
              cursor: (username.trim() && password.trim()) ? 'pointer' : 'not-allowed',
              opacity: (username.trim() && password.trim()) ? 1 : 0.5,
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            登录
          </button>
        </form>

        <div className="mt-4 text-center">
          <p className="text-xs" style={{ color: 'var(--jk-text-faint)', fontFamily: "'IBM Plex Mono', monospace" }}>
            {APP_VERSION} · Web Serial API
          </p>
        </div>
      </div>
    </div>
  );
}
