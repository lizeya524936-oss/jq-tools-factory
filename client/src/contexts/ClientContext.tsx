/**
 * ClientContext — 当前登录客户状态管理
 * 持久化到 localStorage，刷新后保持登录
 */

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { ClientAccount } from '@/config/clients';
import { getClient, authenticateClient } from '@/config/clients';

const STORAGE_KEY = 'jq_client_id';

interface ClientContextValue {
  client: ClientAccount | null;
  /** 用户名密码登录，remember 控制是否持久化，返回错误信息或 null（成功） */
  login: (username: string, password: string, remember: boolean) => string | null;
  logout: () => void;
  isLoggedIn: boolean;
}

const ClientCtx = createContext<ClientContextValue | null>(null);

export function ClientProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<ClientAccount | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    try {
      const { id } = JSON.parse(saved);
      return id ? (getClient(id) ?? null) : null;
    } catch {
      return null;
    }
  });

  const login = useCallback((username: string, password: string, remember: boolean): string | null => {
    const c = authenticateClient(username, password);
    if (c) {
      setClient(c);
      if (remember) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: c.id }));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
      return null; // 成功
    }
    return '用户名或密码错误';
  }, []);

  const logout = useCallback(() => {
    setClient(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  // 同步 localStorage 变化（多标签页）
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        if (e.newValue) {
          const c = getClient(e.newValue);
          if (c) setClient(c);
        } else {
          setClient(null);
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <ClientCtx.Provider value={{ client, login, logout, isLoggedIn: client !== null }}>
      {children}
    </ClientCtx.Provider>
  );
}

export function useClient(): ClientContextValue {
  const ctx = useContext(ClientCtx);
  if (!ctx) {
    return { client: null, login: () => '无法登录', logout: () => {}, isLoggedIn: false };
  }
  return ctx;
}

export default ClientCtx;
