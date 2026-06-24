"use client";

import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import * as React from "react";
import { useTheme } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ThemeOption {
  bgPreview: string; // CSS style color
  colorClass: string;
  id: string;
  name: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "forest",
    name: "Forest",
    colorClass: "bg-[#174D38]",
    bgPreview: "#174D38",
  },
  {
    id: "indigo",
    name: "Indigo",
    colorClass: "bg-indigo-600",
    bgPreview: "oklch(0.513 0.234 278)",
  },
  {
    id: "black",
    name: "Black",
    colorClass: "bg-zinc-800 dark:bg-zinc-100",
    bgPreview: "oklch(0.18 0.018 277)",
  },
  {
    id: "purple",
    name: "Purple",
    colorClass: "bg-purple-600",
    bgPreview: "oklch(0.58 0.23 295)",
  },
  {
    id: "blue",
    name: "Blue",
    colorClass: "bg-blue-600",
    bgPreview: "oklch(0.56 0.21 250)",
  },
  {
    id: "pink",
    name: "Pink",
    colorClass: "bg-pink-600",
    bgPreview: "oklch(0.61 0.22 350)",
  },
  {
    id: "violet",
    name: "Violet",
    colorClass: "bg-violet-600",
    bgPreview: "oklch(0.53 0.23 280)",
  },
  {
    id: "orange",
    name: "Orange",
    colorClass: "bg-orange-600",
    bgPreview: "oklch(0.62 0.21 45)",
  },
  {
    id: "teal",
    name: "Teal",
    colorClass: "bg-teal-600",
    bgPreview: "oklch(0.52 0.16 180)",
  },
  {
    id: "bronze",
    name: "Bronze",
    colorClass: "bg-amber-800",
    bgPreview: "oklch(0.54 0.11 60)",
  },
  {
    id: "mint",
    name: "Mint",
    colorClass: "bg-emerald-500",
    bgPreview: "oklch(0.54 0.15 160)",
  },
];

export function ThemeSettingsForm() {
  const {
    currentTheme,
    appearanceMode,
    setTheme,
    setAppearance,
    saveThemeSettings,
    cancelThemeSettings,
    savedTheme,
    savedAppearance,
  } = useTheme();

  const [saving, setSaving] = React.useState(false);
  const hasChanges =
    currentTheme !== savedTheme || appearanceMode !== savedAppearance;

  async function handleSave() {
    setSaving(true);
    await saveThemeSettings();
    setSaving(false);
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h2 className="text-base font-semibold leading-7">Workspace Themes</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Customize the color scheme and appearance mode of your workspace.
          Changes apply instantly as a preview.
        </p>
      </div>

      <div className="border-t border-border pt-6 space-y-6">
        {/* Appearance Mode */}
        <div>
          <h3 className="text-sm font-medium mb-3">Appearance</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {/* Light Mode Card */}
            <button
              className={cn(
                "flex items-center gap-3 rounded-xl border p-4 text-left hover:bg-accent/50 transition-all focus:outline-none cursor-pointer",
                appearanceMode === "light"
                  ? "border-primary ring-2 ring-primary/20 bg-accent"
                  : "border-border bg-card"
              )}
              onClick={() => setAppearance("light")}
              type="button"
            >
              <div className="p-2 bg-yellow-500/10 text-yellow-500 rounded-lg">
                <SunIcon className="size-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Light</p>
                <p className="text-xs text-muted-foreground truncate">
                  Clean light interface
                </p>
              </div>
              {appearanceMode === "light" && (
                <CheckIcon className="size-4 text-primary shrink-0" />
              )}
            </button>

            {/* Dark Mode Card */}
            <button
              className={cn(
                "flex items-center gap-3 rounded-xl border p-4 text-left hover:bg-accent/50 transition-all focus:outline-none cursor-pointer",
                appearanceMode === "dark"
                  ? "border-primary ring-2 ring-primary/20 bg-accent"
                  : "border-border bg-card"
              )}
              onClick={() => setAppearance("dark")}
              type="button"
            >
              <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
                <MoonIcon className="size-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Dark</p>
                <p className="text-xs text-muted-foreground truncate font-normal">
                  Sleek dark interface
                </p>
              </div>
              {appearanceMode === "dark" && (
                <CheckIcon className="size-4 text-primary shrink-0" />
              )}
            </button>

            {/* Auto / System Mode Card */}
            <button
              className={cn(
                "flex items-center gap-3 rounded-xl border p-4 text-left hover:bg-accent/50 transition-all focus:outline-none cursor-pointer",
                appearanceMode === "auto"
                  ? "border-primary ring-2 ring-primary/20 bg-accent"
                  : "border-border bg-card"
              )}
              onClick={() => setAppearance("auto")}
              type="button"
            >
              <div className="p-2 bg-muted text-muted-foreground rounded-lg">
                <MonitorIcon className="size-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">System</p>
                <p className="text-xs text-muted-foreground truncate font-normal">
                  Sync with OS preferences
                </p>
              </div>
              {appearanceMode === "auto" && (
                <CheckIcon className="size-4 text-primary shrink-0" />
              )}
            </button>
          </div>
        </div>

        {/* Accent Themes */}
        <div>
          <h3 className="text-sm font-medium mb-3">Accent Theme Color</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {THEME_OPTIONS.map((theme) => {
              const isSelected = currentTheme === theme.id;
              return (
                <button
                  className={cn(
                    "flex flex-col items-center justify-center p-4 rounded-xl border text-center hover:bg-accent/50 transition-all focus:outline-none cursor-pointer gap-2",
                    isSelected
                      ? "border-primary ring-2 ring-primary/20 bg-accent"
                      : "border-border bg-card"
                  )}
                  key={theme.id}
                  onClick={() => setTheme(theme.id)}
                  type="button"
                >
                  <div
                    className="size-8 rounded-full shadow-inner flex items-center justify-center border border-black/5"
                    style={{ backgroundColor: theme.bgPreview }}
                  >
                    {isSelected && (
                      <CheckIcon className="size-4 text-white drop-shadow" />
                    )}
                  </div>
                  <span className="text-xs font-semibold">{theme.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Floating/Bottom Action Bar */}
      <div
        className={cn(
          "flex items-center justify-end gap-3 border-t border-border pt-4 transition-all duration-300",
          hasChanges
            ? "opacity-100 translate-y-0"
            : "opacity-60 pointer-events-none"
        )}
      >
        <span className="text-xs text-muted-foreground mr-auto">
          {hasChanges ? "You have unsaved changes" : "All changes saved"}
        </span>
        <Button
          className="text-xs"
          disabled={!hasChanges || saving}
          onClick={cancelThemeSettings}
          size="sm"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button
          className="text-xs"
          disabled={!hasChanges || saving}
          onClick={handleSave}
          size="sm"
          variant="default"
        >
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
