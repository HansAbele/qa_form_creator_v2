"use client";

import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface FilterSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface FilterSelectProps {
  id: string;
  label: string;
  value: string;
  options: readonly FilterSelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  icon?: LucideIcon;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
}

export function FilterSelect({
  id,
  label,
  value,
  options,
  onValueChange,
  placeholder: placeholderProp,
  icon: Icon,
  disabled = false,
  className,
  triggerClassName,
  contentClassName,
}: FilterSelectProps) {
  const { t } = useI18n();
  const placeholder = placeholderProp ?? t("Select");
  const selected = options.find((option) => option.value === value);

  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Label htmlFor={id} className="text-xs font-medium text-foreground/80">
        {label}
      </Label>
      <Select
        value={value}
        onValueChange={(next) => {
          if (typeof next === "string") onValueChange(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className={cn(
            "h-10 w-full min-w-0 rounded-[11px] border-border bg-card px-3 shadow-sm hover:border-primary data-[size=default]:h-10 dark:bg-card",
            triggerClassName,
          )}
        >
          {Icon ? <Icon className="h-4 w-4 shrink-0 text-primary" /> : null}
          <SelectValue placeholder={placeholder}>
            {() => selected?.label ?? placeholder}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className={cn("min-w-[var(--anchor-width)]", contentClassName)}>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface FilterCheckboxProps {
  id: string;
  fieldLabel: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  icon?: LucideIcon;
  className?: string;
}

export function FilterCheckbox({
  id,
  fieldLabel,
  label,
  checked,
  onCheckedChange,
  icon: Icon,
  className,
}: FilterCheckboxProps) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <span className="block text-xs font-medium text-foreground/80">{fieldLabel}</span>
      <Label
        htmlFor={id}
        className="flex h-10 cursor-pointer items-center gap-2 rounded-[11px] border border-border bg-card px-3 text-sm font-medium shadow-sm transition-colors hover:border-primary"
      >
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(next) => onCheckedChange(next === true)}
        />
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-primary" /> : null}
        <span className="truncate">{label}</span>
      </Label>
    </div>
  );
}
