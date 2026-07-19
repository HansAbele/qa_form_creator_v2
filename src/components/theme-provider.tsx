"use client";

import {
  createContext,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type ThemeName = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  theme: ThemeName;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: SetStateAction<ThemeName>) => void;
};

type ThemeProviderProps = {
  children: ReactNode;
  defaultTheme?: ThemeName;
  enableSystem?: boolean;
  disableTransitionOnChange?: boolean;
  storageKey?: string;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => {},
});

function isThemeName(value: string | null): value is ThemeName {
  return value === "light" || value === "dark" || value === "system";
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: ThemeName, enableSystem: boolean): ResolvedTheme {
  if (theme === "system" && enableSystem) return getSystemTheme();
  return theme === "dark" ? "dark" : "light";
}

function suppressTransitions() {
  const style = document.createElement("style");
  style.appendChild(
    document.createTextNode(
      "*,*::before,*::after{transition:none!important;animation-duration:0s!important}",
    ),
  );
  document.head.appendChild(style);

  return () => {
    window.getComputedStyle(document.body);
    setTimeout(() => style.remove(), 1);
  };
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  enableSystem = true,
  disableTransitionOnChange = false,
  storageKey = "theme",
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeName>(defaultTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(storageKey);
    setThemeState(isThemeName(storedTheme) ? storedTheme : defaultTheme);
  }, [defaultTheme, storageKey]);

  useEffect(() => {
    const restoreTransitions = disableTransitionOnChange ? suppressTransitions() : undefined;
    const nextResolvedTheme = resolveTheme(theme, enableSystem);

    document.documentElement.classList.toggle("dark", nextResolvedTheme === "dark");
    document.documentElement.style.colorScheme = nextResolvedTheme;
    setResolvedTheme(nextResolvedTheme);
    restoreTransitions?.();
  }, [disableTransitionOnChange, enableSystem, theme]);

  useEffect(() => {
    if (!enableSystem) return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (theme === "system") {
        setResolvedTheme(getSystemTheme());
        document.documentElement.classList.toggle("dark", media.matches);
        document.documentElement.style.colorScheme = media.matches ? "dark" : "light";
      }
    };

    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [enableSystem, theme]);

  const setTheme = useCallback(
    (nextTheme: SetStateAction<ThemeName>) => {
      setThemeState((currentTheme) => {
        const value = typeof nextTheme === "function" ? nextTheme(currentTheme) : nextTheme;
        window.localStorage.setItem(storageKey, value);
        return value;
      });
    },
    [storageKey],
  );

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [resolvedTheme, setTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
