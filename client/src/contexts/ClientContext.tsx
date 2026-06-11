/**
 * ClientContext — 当前登录客户状态管理
 * 持久化到 localStorage，刷新后保持登录
 */

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { ClientAccount } from '@/config/clients';
import { getClient } from '@/config/clients';

const STORAGE_KEY = 'jq_client_id';

interface ClientContextValue {
  client: ClientAccount | null;
  login: (clientId: string) => void;
  logout: () => void;
  isLoggedIn: boolean;
}

const ClientCtx = createContext<ClientContextValue | null>(null);

export function ClientProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<ClientAccount | null>(() => {
    const savedId = localStorage.getItem(STORAGE_KEY);
    return savedId ? (getClient(savedId) ?? null) : null;
  });

  const login = useCallback((clientId: string) => {
    const c = getClient(clientId);
    if (c) {
      setClient(c);
      localStorage.setItem(STORAGE_KEY, c.id);
    }
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
    // 如果没被 Provider 包裹，返回空的 safe default
    return { client: null, login: () => {}, logout: () => {}, isLoggedIn: false };
  }
  return ctx;
}

export default ClientCtx;
