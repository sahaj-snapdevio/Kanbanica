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

  // Apply theme & appearance changes to the DOM (data-theme and .dark class)
  const applyThemeToDOM = React.useCallback(
    (theme: string, appearance: "light" | "dark" | "auto") => {
      if (typeof window === "undefined") {
        return;
      }

      const root = document.documentElement;

      // Apply theme attribute
      root.setAttribute("data-theme", theme);

      // Apply appearance mode
      let isDark = false;
      if (appearance === "dark") {
        isDark = true;
      } else if (appearance === "light") {
        isDark = false;
      } else {
        // "auto" (System default)
        isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      }

      if (isDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
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
