/**
 * LoginPage — 客户登录页面（用户名 + 密码）
 */

import { useState, type FormEvent } from 'react';
import { useClient } from '@/contexts/ClientContext';
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
      style={{ background: 'oklch(0.13 0.03 265)' }}
    >
      {/* 卡片 */}
      <div
        className="rounded-2xl p-8 w-full max-w-sm"
        style={{
          background: 'oklch(0.17 0.025 265)',
          border: '1px solid oklch(0.25 0.03 265)',
          boxShadow: '0 0 60px oklch(0.15 0.04 265 / 0.4)',
        }}
      >
        {/* 标题 */}
        <div className="text-center mb-6">
          <h1
            className="text-xl font-bold mb-1"
            style={{ color: 'oklch(0.72 0.20 145)', fontFamily: "'IBM Plex Mono', monospace" }}
          >
            JQ Tools Factory
          </h1>
          <p
            className="text-xs"
            style={{ color: 'oklch(0.50 0.02 240)', fontFamily: "'IBM Plex Mono', monospace" }}
          >
            产品出厂检测工具
          </p>
        </div>

        <div
          className="mb-6"
          style={{ borderTop: '1px solid oklch(0.22 0.03 265)' }}
        />

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* 用户名 */}
          <div>
            <label
              className="block text-xs mb-1"
              style={{ color: 'oklch(0.50 0.02 240)', fontFamily: "'IBM Plex Mono', monospace" }}
            >
              用户名
            </label>
            <div className="relative">
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2">
                <User size={14} style={{ color: 'oklch(0.40 0.02 240)' }} />
              </div>
              <input
                type="text"
                value={username}
                onChange={e => { setUsername(e.target.value); setError(null); }}
                placeholder="请输入用户名"
                className="w-full pl-8 pr-3 py-2 text-sm font-mono rounded outline-none transition-colors"
                style={{
                  background: 'oklch(0.20 0.025 265)',
                  border: `1px solid ${error ? 'oklch(0.65 0.22 25 / 0.5)' : 'oklch(0.28 0.03 265)'}`,
                  color: 'oklch(0.70 0.02 240)',
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
              style={{ color: 'oklch(0.50 0.02 240)', fontFamily: "'IBM Plex Mono', monospace" }}
            >
              密码
            </label>
            <div className="relative">
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2">
                <Key size={14} style={{ color: 'oklch(0.40 0.02 240)' }} />
              </div>
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(null); }}
                placeholder="请输入密码"
                className="w-full pl-8 pr-3 py-2 text-sm font-mono rounded outline-none transition-colors"
                style={{
                  background: 'oklch(0.20 0.025 265)',
                  border: `1px solid ${error ? 'oklch(0.65 0.22 25 / 0.5)' : 'oklch(0.28 0.03 265)'}`,
                  color: 'oklch(0.70 0.02 240)',
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
                color: 'oklch(0.70 0.22 25)',
                background: 'oklch(0.65 0.22 25 / 0.08)',
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
                accentColor: 'oklch(0.72 0.20 145)',
              }}
            />
            <span
              className="text-xs"
              style={{ color: 'oklch(0.50 0.02 240)', fontFamily: "'IBM Plex Mono', monospace" }}
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
                ? 'oklch(0.72 0.20 145 / 0.85)'
                : 'oklch(0.25 0.03 265)',
              color: (username.trim() && password.trim()) ? '#0a0e1a' : 'oklch(0.40 0.02 240)',
              cursor: (username.trim() && password.trim()) ? 'pointer' : 'not-allowed',
              opacity: (username.trim() && password.trim()) ? 1 : 0.5,
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            登录
          </button>
        </form>

        <div className="mt-4 text-center">
          <p className="text-xs" style={{ color: 'oklch(0.30 0.02 240)', fontFamily: "'IBM Plex Mono', monospace" }}>
            v1.9.18 · Web Serial API
          </p>
        </div>
      </div>
    </div>
  );
}
