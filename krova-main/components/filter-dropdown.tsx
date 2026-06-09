import { CaretDownIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface FilterDropdownProps {
  className?: string;
  label: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  value: string;
}

export function FilterDropdown({
  label,
  options,
  value,
  onChange,
  className = "w-40",
}: FilterDropdownProps) {
  const selectedLabel = options.find((o) => o.value === value)?.label ?? label;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Filter by ${label.toLowerCase()}`}
          className={`${className} justify-between font-normal`}
          variant="outline"
        >
          {selectedLabel}
          <CaretDownIcon className="size-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className={className}>
        {options.map((opt, i) => (
          <span key={opt.value}>
            {i === 1 && <DropdownMenuSeparator />}
            <DropdownMenuItem onClick={() => onChange(opt.value)}>
              {opt.label}
            </DropdownMenuItem>
          </span>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
