/**
 * LoginPage — 客户登录页面
 */

import { useState } from 'react';
import { useClient } from '@/contexts/ClientContext';
import { CLIENTS } from '@/config/clients';

export default function LoginPage() {
  const { login } = useClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleLogin = () => {
    if (selectedId) login(selectedId);
  };

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen"
      style={{ background: 'oklch(0.13 0.03 265)' }}
    >
      {/* 卡片 */}
      <div
        className="rounded-2xl p-8 w-full max-w-md"
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

        {/* 分隔线 */}
        <div
          className="mb-5"
          style={{ borderTop: '1px solid oklch(0.22 0.03 265)' }}
        />

        <p
          className="text-xs mb-3 text-center"
          style={{ color: 'oklch(0.45 0.02 240)', fontFamily: "'IBM Plex Mono', monospace" }}
        >
          选择客户账号进入系统
        </p>

        {/* 客户列表 */}
        <div className="flex flex-col gap-2 mb-6">
          {CLIENTS.map(c => {
            const isActive = selectedId === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className="w-full text-left px-4 py-3 rounded-lg transition-all text-sm"
                style={{
                  background: isActive
                    ? 'oklch(0.72 0.20 145 / 0.12)'
                    : 'oklch(0.20 0.025 265)',
                  border: `1px solid ${
                    isActive
                      ? 'oklch(0.72 0.20 145 / 0.35)'
                      : 'oklch(0.28 0.03 265)'
                  }`,
                  color: isActive ? 'oklch(0.72 0.20 145)' : 'oklch(0.60 0.02 240)',
                  fontFamily: "'IBM Plex Mono', monospace",
                }}
              >
                <div className="font-medium">{c.name}</div>
                <div
                  className="text-xs mt-0.5"
                  style={{ color: 'oklch(0.40 0.02 240)' }}
                >
                  {c.allowedProducts.length} 个可用产品
                </div>
              </button>
            );
          })}
        </div>

        {/* 登录按钮 */}
        <button
          onClick={handleLogin}
          disabled={!selectedId}
          className="w-full py-2.5 rounded-lg text-sm font-bold transition-all"
          style={{
            background: selectedId
              ? 'oklch(0.72 0.20 145 / 0.85)'
              : 'oklch(0.25 0.03 265)',
            color: selectedId ? '#0a0e1a' : 'oklch(0.40 0.02 240)',
            cursor: selectedId ? 'pointer' : 'not-allowed',
            fontFamily: "'IBM Plex Mono', monospace",
            opacity: selectedId ? 1 : 0.5,
          }}
        >
          进入系统
        </button>

        <div className="mt-4 text-center">
          <p className="text-xs" style={{ color: 'oklch(0.30 0.02 240)', fontFamily: "'IBM Plex Mono', monospace" }}>
            v1.9.17 · Web Serial API
          </p>
        </div>
      </div>
    </div>
  );
}
