"use client";

import * as React from "react";
import { toast } from "sonner";
import { updateWorkspaceTheme } from "@/app/actions/workspace";

export interface ThemeContextType {
  appearanceMode: "light" | "dark" | "auto";
  cancelThemeSettings: () => void;
  currentTheme: string;
  savedAppearance: "light" | "dark" | "auto";
  savedTheme: string;
  saveThemeSettings: () => Promise<void>;
  setAppearance: (mode: "light" | "dark" | "auto") => void;
  setTheme: (theme: string) => void;
}

const ThemeContext = React.createContext<ThemeContextType | undefined>(
  undefined
);

interface ThemeProviderProps {
  children: React.ReactNode;
  initialAppearanceMode: "light" | "dark" | "auto";
  initialTheme: string;
  workspaceId: string;
}

// CSS custom properties overridden per theme. Empty = use `:root` defaults.
type ThemeVars = Record<string, string>;

const LIGHT_THEME_VARS: Record<string, ThemeVars> = {
  indigo: {},
  black: {
    "--primary": "oklch(0.18 0.018 277)",
    "--primary-foreground": "oklch(0.99 0.002 277)",
    "--ring": "oklch(0.52 0.028 277)",
    "--sidebar": "oklch(0.15 0 0)",
    "--sidebar-accent": "oklch(0.20 0 0)",
    "--sidebar-border": "oklch(0.22 0 0)",
    "--sidebar-primary": "oklch(0.52 0.028 277)",
    "--accent": "oklch(0.94 0.01 277)",
    "--accent-foreground": "oklch(0.18 0.018 277)",
    "--secondary": "oklch(0.95 0.01 277)",
    "--secondary-foreground": "oklch(0.18 0.018 277)",
  },
  purple: {
    "--primary": "oklch(0.58 0.23 295)",
    "--primary-foreground": "oklch(0.99 0.002 277)",
    "--ring": "oklch(0.68 0.20 295)",
    "--sidebar": "oklch(0.18 0.04 295)",
    "--sidebar-accent": "oklch(0.23 0.05 295)",
    "--sidebar-border": "oklch(0.25 0.05 295)",
    "--sidebar-primary": "oklch(0.68 0.20 295)",
    "--accent": "oklch(0.96 0.025 295)",
    "--accent-foreground": "oklch(0.40 0.15 295)",
    "--secondary": "oklch(0.97 0.02 295)",
    "--secondary-foreground": "oklch(0.40 0.15 295)",
  },
  blue: {
    "--primary": "oklch(0.56 0.21 250)",
    "--primary-foreground": "oklch(0.99 0.002 277)",
    "--ring": "oklch(0.66 0.18 250)",
    "--sidebar": "oklch(0.16 0.04 250)",
    "--sidebar-accent": "oklch(0.21 0.05 250)",
    "--sidebar-border": "oklch(0.23 0.05 250)",
    "--sidebar-primary": "oklch(0.66 0.18 250)",
    "--accent": "oklch(0.95 0.025 250)",
    "--accent-foreground": "oklch(0.38 0.12 250)",
    "--secondary": "oklch(0.96 0.02 250)",
    "--secondary-foreground": "oklch(0.38 0.12 250)",
  },
  pink: {
    "--primary": "oklch(0.61 0.22 350)",
    "--primary-foreground": "oklch(0.99 0.002 277)",
    "--ring": "oklch(0.71 0.18 350)",
    "--sidebar": "oklch(0.18 0.04 350)",
    "--sidebar-accent": "oklch(0.23 0.05 350)",
    "--sidebar-border": "oklch(0.25 0.05 350)",
    "--sidebar-primary": "oklch(0.71 0.18 350)",
    "--accent": "oklch(0.96 0.03 350)",
    "--accent-foreground": "oklch(0.42 0.14 350)",
    "--secondary": "oklch(0.97 0.02 350)",
    "--secondary-foreground": "oklch(0.42 0.14 350)",
  },
  violet: {
    "--primary": "oklch(0.53 0.23 280)",
    "--primary-foreground": "oklch(0.99 0.002 277)",
    "--ring": "oklch(0.63 0.19 280)",
    "--sidebar": "oklch(0.18 0.04 280)",
    "--sidebar-accent": "oklch(0.23 0.05 280)",
    "--sidebar-border": "oklch(0.25 0.05 280)",
    "--sidebar-primary": "oklch(0.63 0.19 280)",
    "--accent": "oklch(0.95 0.03 280)",
    "--accent-foreground": "oklch(0.36 0.14 280)",
    "--secondary": "oklch(0.96 0.02 280)",
    "--secondary-foreground": "oklch(0.36 0.14 280)",
  },
  orange: {
    "--primary": "oklch(0.62 0.21 45)",
    "--primary-foreground": "oklch(0.99 0.002 277)",
    "--ring": "oklch(0.72 0.17 45)",
    "--sidebar": "oklch(0.18 0.03 45)",
    "--sidebar-accent": "oklch(0.23 0.04 45)",
    "--sidebar-border": "oklch(0.25 0.04 45)",
    "--sidebar-primary": "oklch(0.72 0.17 45)",
    "--accent": "oklch(0.96 0.02 45)",
    "--accent-foreground": "oklch(0.42 0.12 45)",
    "--secondary": "oklch(0.97 0.01 45)",
    "--secondary-foreground": "oklch(0.42 0.12 45)",
  },
  teal: {
    "--primary": "oklch(0.52 0.16 180)",
    "--primary-foreground": "oklch(0.99 0.002 277)",
    "--ring": "oklch(0.62 0.13 180)",
    "--sidebar": "oklch(0.16 0.03 180)",
    "--sidebar-accent": "oklch(0.21 0.04 180)",
    "--sidebar-border": "oklch(0.23 0.04 180)",
    "--sidebar-primary": "oklch(0.62 0.13 180)",
    "--accent": "oklch(0.95 0.02 180)",
    "--accent-foreground": "oklch(0.35 0.10 180)",
    "--secondary": "oklch(0.96 0.01 180)",
    "--secondary-foreground": "oklch(0.35 0.10 180)",
  },
  bronze: {
    "--primary": "oklch(0.54 0.11 60)",
    "--primary-foreground": "oklch(0.99 0.002 277)",
    "--ring": "oklch(0.64 0.09 60)",
    "--sidebar": "oklch(0.18 0.03 60)",
    "--sidebar-accent": "oklch(0.23 0.04 60)",
    "--sidebar-border": "oklch(0.25 0.04 60)",
    "--sidebar-primary": "oklch(0.64 0.09 60)",
    "--accent": "oklch(0.95 0.02 60)",
    "--accent-foreground": "oklch(0.38 0.08 60)",
    "--secondary": "oklch(0.96 0.01 60)",
    "--secondary-foreground": "oklch(0.38 0.08 60)",
  },
  mint: {
    "--primary": "oklch(0.54 0.15 160)",
    "--primary-foreground": "oklch(0.99 0.002 277)",
    "--ring": "oklch(0.64 0.13 160)",
    "--sidebar": "oklch(0.16 0.03 160)",
    "--sidebar-accent": "oklch(0.21 0.04 160)",
    "--sidebar-border": "oklch(0.23 0.04 160)",
    "--sidebar-primary": "oklch(0.64 0.13 160)",
    "--accent": "oklch(0.95 0.02 160)",
    "--accent-foreground": "oklch(0.36 0.08 160)",
    "--secondary": "oklch(0.96 0.01 160)",
    "--secondary-foreground": "oklch(0.36 0.08 160)",
  },
};

const DARK_THEME_VARS: Record<string, ThemeVars> = {
  indigo: {},
  black: {
    "--primary": "oklch(0.94 0.012 277)",
    "--primary-foreground": "oklch(0.155 0.018 277)",
    "--ring": "oklch(0.6 0.04 277)",
    "--sidebar": "oklch(0.12 0 0)",
    "--sidebar-accent": "oklch(0.18 0 0)",
    "--sidebar-border": "oklch(0.20 0 0)",
    "--sidebar-primary": "oklch(0.94 0.012 277)",
    "--accent": "oklch(0.23 0.02 277)",
    "--accent-foreground": "oklch(0.94 0.012 277)",
    "--secondary": "oklch(0.22 0.02 277)",
    "--secondary-foreground": "oklch(0.94 0.012 277)",
  },
  purple: {
    "--primary": "oklch(0.68 0.20 295)",
    "--primary-foreground": "oklch(0.155 0.018 277)",
    "--ring": "oklch(0.58 0.23 295)",
    "--sidebar": "oklch(0.13 0.03 295)",
    "--sidebar-accent": "oklch(0.18 0.04 295)",
    "--sidebar-border": "oklch(0.20 0.04 295)",
    "--sidebar-primary": "oklch(0.68 0.20 295)",
    "--accent": "oklch(0.25 0.04 295)",
    "--accent-foreground": "oklch(0.90 0.03 295)",
    "--secondary": "oklch(0.22 0.03 295)",
    "--secondary-foreground": "oklch(0.85 0.04 295)",
  },
  blue: {
    "--primary": "oklch(0.66 0.18 250)",
    "--primary-foreground": "oklch(0.155 0.018 277)",
    "--ring": "oklch(0.56 0.21 250)",
    "--sidebar": "oklch(0.12 0.03 250)",
    "--sidebar-accent": "oklch(0.18 0.04 250)",
    "--sidebar-border": "oklch(0.20 0.04 250)",
    "--sidebar-primary": "oklch(0.66 0.18 250)",
    "--accent": "oklch(0.24 0.04 250)",
    "--accent-foreground": "oklch(0.88 0.03 250)",
    "--secondary": "oklch(0.22 0.03 250)",
    "--secondary-foreground": "oklch(0.84 0.04 250)",
  },
  pink: {
    "--primary": "oklch(0.71 0.18 350)",
    "--primary-foreground": "oklch(0.155 0.018 277)",
    "--ring": "oklch(0.61 0.22 350)",
    "--sidebar": "oklch(0.13 0.03 350)",
    "--sidebar-accent": "oklch(0.18 0.04 350)",
    "--sidebar-border": "oklch(0.20 0.04 350)",
    "--sidebar-primary": "oklch(0.71 0.18 350)",
    "--accent": "oklch(0.25 0.05 350)",
    "--accent-foreground": "oklch(0.92 0.04 350)",
    "--secondary": "oklch(0.22 0.04 350)",
    "--secondary-foreground": "oklch(0.86 0.04 350)",
  },
  violet: {
    "--primary": "oklch(0.63 0.19 280)",
    "--primary-foreground": "oklch(0.155 0.018 277)",
    "--ring": "oklch(0.53 0.23 280)",
    "--sidebar": "oklch(0.13 0.03 280)",
    "--sidebar-accent": "oklch(0.18 0.04 280)",
    "--sidebar-border": "oklch(0.20 0.04 280)",
    "--sidebar-primary": "oklch(0.63 0.19 280)",
    "--accent": "oklch(0.24 0.05 280)",
    "--accent-foreground": "oklch(0.88 0.04 280)",
    "--secondary": "oklch(0.21 0.04 280)",
    "--secondary-foreground": "oklch(0.84 0.04 280)",
  },
  orange: {
    "--primary": "oklch(0.72 0.17 45)",
    "--primary-foreground": "oklch(0.155 0.018 277)",
    "--ring": "oklch(0.62 0.21 45)",
    "--sidebar": "oklch(0.13 0.02 45)",
    "--sidebar-accent": "oklch(0.18 0.03 45)",
    "--sidebar-border": "oklch(0.20 0.03 45)",
    "--sidebar-primary": "oklch(0.72 0.17 45)",
    "--accent": "oklch(0.25 0.04 45)",
    "--accent-foreground": "oklch(0.92 0.03 45)",
    "--secondary": "oklch(0.22 0.03 45)",
    "--secondary-foreground": "oklch(0.86 0.03 45)",
  },
  teal: {
    "--primary": "oklch(0.62 0.13 180)",
    "--primary-foreground": "oklch(0.155 0.018 277)",
    "--ring": "oklch(0.52 0.16 180)",
    "--sidebar": "oklch(0.12 0.02 180)",
    "--sidebar-accent": "oklch(0.18 0.03 180)",
    "--sidebar-border": "oklch(0.20 0.03 180)",
    "--sidebar-primary": "oklch(0.62 0.13 180)",
    "--accent": "oklch(0.23 0.03 180)",
    "--accent-foreground": "oklch(0.88 0.02 180)",
    "--secondary": "oklch(0.21 0.02 180)",
    "--secondary-foreground": "oklch(0.83 0.03 180)",
  },
  bronze: {
    "--primary": "oklch(0.64 0.09 60)",
    "--primary-foreground": "oklch(0.155 0.018 277)",
    "--ring": "oklch(0.54 0.11 60)",
    "--sidebar": "oklch(0.13 0.02 60)",
    "--sidebar-accent": "oklch(0.18 0.03 60)",
    "--sidebar-border": "oklch(0.20 0.03 60)",
    "--sidebar-primary": "oklch(0.64 0.09 60)",
    "--accent": "oklch(0.23 0.02 60)",
    "--accent-foreground": "oklch(0.88 0.02 60)",
    "--secondary": "oklch(0.21 0.02 60)",
    "--secondary-foreground": "oklch(0.84 0.02 60)",
  },
  mint: {
    "--primary": "oklch(0.64 0.13 160)",
    "--primary-foreground": "oklch(0.155 0.018 277)",
    "--ring": "oklch(0.54 0.15 160)",
    "--sidebar": "oklch(0.12 0.02 160)",
    "--sidebar-accent": "oklch(0.18 0.03 160)",
    "--sidebar-border": "oklch(0.20 0.03 160)",
    "--sidebar-primary": "oklch(0.64 0.13 160)",
    "--accent": "oklch(0.23 0.03 160)",
    "--accent-foreground": "oklch(0.88 0.02 160)",
    "--secondary": "oklch(0.21 0.02 160)",
    "--secondary-foreground": "oklch(0.84 0.02 160)",
  },
};

// All CSS variable keys that themes can override (used for cleanup)
const THEME_VAR_KEYS = [
  "--primary",
  "--primary-foreground",
  "--ring",
  "--sidebar",
  "--sidebar-accent",
  "--sidebar-border",
  "--sidebar-primary",
  "--accent",
  "--accent-foreground",
  "--secondary",
  "--secondary-foreground",
];

export function ThemeProvider({
  children,
  workspaceId,
  initialTheme,
  initialAppearanceMode,
}: ThemeProviderProps) {
  // Saved baseline values (baseline is localStorage first, then fallback to DB initial)
  const [savedTheme, setSavedTheme] = React.useState<string>(initialTheme);
  const [savedAppearance, setSavedAppearance] = React.useState<
    "light" | "dark" | "auto"
  >(initialAppearanceMode);

  // Actively rendered values (can be previewed immediately)
  const [currentTheme, setCurrentThemeState] =
    React.useState<string>(initialTheme);
  const [appearanceMode, setAppearanceModeState] = React.useState<
    "light" | "dark" | "auto"
  >(initialAppearanceMode);

  // Initialize baseline settings from localStorage on mount
  React.useEffect(() => {
    const localThemeKey = `kanbanica_theme_${workspaceId}`;
    const localAppearanceKey = `kanbanica_appearance_${workspaceId}`;

    const localTheme = localStorage.getItem(localThemeKey);
    const localAppearance = localStorage.getItem(localAppearanceKey) as
      | "light"
      | "dark"
      | "auto"
      | null;

    const resolvedTheme = localTheme ?? initialTheme;
    const resolvedAppearance = localAppearance ?? initialAppearanceMode;

    setSavedTheme(resolvedTheme);
    setSavedAppearance(resolvedAppearance);
    setCurrentThemeState(resolvedTheme);
    setAppearanceModeState(resolvedAppearance);
  }, [workspaceId, initialTheme, initialAppearanceMode]);

  // Apply theme & appearance changes to the DOM
  const applyThemeToDOM = React.useCallback(
    (theme: string, appearance: "light" | "dark" | "auto") => {
      if (typeof window === "undefined") {
        return;
      }

      const root = document.documentElement;

      // Determine dark mode
      let isDark = false;
      if (appearance === "dark") {
        isDark = true;
      } else if (appearance === "light") {
        isDark = false;
      } else {
        isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      }

      if (isDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }

      // Clear all previous theme variable overrides
      for (const key of THEME_VAR_KEYS) {
        root.style.removeProperty(key);
      }

      // Inject theme variables directly via inline style (bypasses CSS compilation)
      const vars = isDark
        ? (DARK_THEME_VARS[theme] ?? {})
        : (LIGHT_THEME_VARS[theme] ?? {});

      for (const [key, value] of Object.entries(vars)) {
        root.style.setProperty(key, value);
      }
    },
    []
  );

  // Update DOM when preview theme/appearance states change
  React.useEffect(() => {
    applyThemeToDOM(currentTheme, appearanceMode);

    // Listen for system appearance changes if currently in auto mode
    if (appearanceMode === "auto") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => {
        applyThemeToDOM(currentTheme, "auto");
      };

      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }
  }, [currentTheme, appearanceMode, applyThemeToDOM]);

  // Immediate preview callbacks
  const setTheme = React.useCallback((theme: string) => {
    setCurrentThemeState(theme);
  }, []);

  const setAppearance = React.useCallback((mode: "light" | "dark" | "auto") => {
    setAppearanceModeState(mode);
  }, []);

  // Permanent save
  const saveThemeSettings = React.useCallback(async () => {
    try {
      const res = await updateWorkspaceTheme({
        workspaceId,
        theme: currentTheme,
        appearanceMode,
      });

      if (res && "error" in res) {
        toast.error(res.error);
        return;
      }

      // Update baseline values
      setSavedTheme(currentTheme);
      setSavedAppearance(appearanceMode);

      // Save to localStorage
      localStorage.setItem(`kanbanica_theme_${workspaceId}`, currentTheme);
      localStorage.setItem(
        `kanbanica_appearance_${workspaceId}`,
        appearanceMode
      );

      toast.success("Theme settings saved successfully");
    } catch (err) {
      console.error(err);
      toast.error("Failed to save theme settings");
    }
  }, [workspaceId, currentTheme, appearanceMode]);

  // Revert preview back to saved baseline values
  const cancelThemeSettings = React.useCallback(() => {
    setCurrentThemeState(savedTheme);
    setAppearanceModeState(savedAppearance);
    toast.info("Changes discarded");
  }, [savedTheme, savedAppearance]);

  return (
    <ThemeContext.Provider
      value={{
        currentTheme,
        appearanceMode,
        setTheme,
        setAppearance,
        saveThemeSettings,
        cancelThemeSettings,
        savedTheme,
        savedAppearance,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
