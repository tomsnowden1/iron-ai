import { useEffect, useState } from "react";

const STORAGE_KEY = "ironai.theme";
const VALID_MODES = ["light", "dark", "system"];

const getStoredMode = () => {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return VALID_MODES.includes(stored) ? stored : "system";
};

const getSystemTheme = () => {
  if (typeof window === "undefined") return "light";
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const resolveTheme = (mode) => (mode === "system" ? getSystemTheme() : mode);

export default function useTheme() {
  const [themeMode, setThemeMode] = useState(getStoredMode);
  const [resolvedTheme, setResolvedTheme] = useState(() =>
    resolveTheme(getStoredMode())
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = () => {
      const resolved = resolveTheme(themeMode);
      setResolvedTheme(resolved);
      root.dataset.theme = resolved;
    };

    applyTheme();

    if (themeMode !== "system") return undefined;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme();

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
    } else {
      mediaQuery.addListener(handleChange);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
    };
  }, [themeMode]);

  return {
    themeMode,
    resolvedTheme,
    setThemeMode,
  };
}
