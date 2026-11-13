import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  /** 在 light / dark 之间切换；switchable=false 时为 undefined */
  toggleTheme?: () => void;
  setTheme?: (t: Theme) => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  /** 无历史记录、且不跟随系统时使用的主题 */
  defaultTheme?: Theme;
  /** 是否允许切换（同时决定是否把选择写入 localStorage） */
  switchable?: boolean;
  /** 首次访问跟随系统 prefers-color-scheme */
  respectSystem?: boolean;
}

const STORAGE_KEY = "jq_theme";

function systemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** URL 强制主题：?theme=light|dark —— 便于截图/QA，不写入 localStorage */
function forcedTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search).get("theme");
  return q === "light" || q === "dark" ? q : null;
}

export function ThemeProvider({
  children,
  defaultTheme = "dark",
  switchable = true,
  respectSystem = true,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const forced = forcedTheme();
    if (forced) return forced;
    if (!switchable) return defaultTheme;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") return stored;
    } catch {
      /* localStorage 不可用时忽略 */
    }
    return respectSystem ? systemTheme() : defaultTheme;
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    if (!switchable || forcedTheme()) return;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme, switchable]);

  // 未手动选择过时，跟随系统变化
  useEffect(() => {
    if (!switchable || !respectSystem || !window.matchMedia) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    if (stored === "light" || stored === "dark") return;

    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setThemeState(mq.matches ? "light" : "dark");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [switchable, respectSystem]);

  const toggleTheme = switchable
    ? () => setThemeState(prev => (prev === "light" ? "dark" : "light"))
    : undefined;

  const setTheme = switchable ? (t: Theme) => setThemeState(t) : undefined;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme, switchable }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
