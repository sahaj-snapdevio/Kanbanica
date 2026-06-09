"use client";

import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { RangeConfig } from "@/config/platform";

interface ResourceSliderProps {
  disabled?: boolean;
  formatValue?: (value: number) => string;
  id?: string;
  label: string;
  onChange: (value: number) => void;
  range: RangeConfig;
  value: number;
}

export function ResourceSlider({
  label,
  range,
  value,
  onChange,
  formatValue,
  disabled,
  id,
}: ResourceSliderProps) {
  const display = formatValue ? formatValue(value) : String(value);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-sm font-medium tabular-nums">{display}</span>
      </div>
      <Slider
        disabled={disabled}
        id={id}
        max={range.max}
        min={range.min}
        onValueChange={([v]) => onChange(v)}
        step={range.step}
        value={[value]}
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{formatValue ? formatValue(range.min) : range.min}</span>
        <span>{formatValue ? formatValue(range.max) : range.max}</span>
      </div>
    </div>
  );
}
