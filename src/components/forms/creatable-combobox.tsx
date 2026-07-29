"use client";

import { ChevronsUpDown, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function CreatableCombobox({
  id,
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder,
  customLabel,
}: {
  id: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  customLabel: (value: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();
  const sortedOptions = useMemo(
    () => [...new Set(options)].sort((left, right) => left.localeCompare(right)),
    [options],
  );
  const hasExactOption = sortedOptions.some(
    (option) => option.toLocaleLowerCase() === normalizedQuery.toLocaleLowerCase(),
  );

  const selectValue = (nextValue: string) => {
    onChange(nextValue);
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        type="button"
        aria-expanded={open}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-[11px] border border-border bg-card px-3 text-left text-sm shadow-sm outline-none transition-colors hover:border-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          !value && "text-muted-foreground",
        )}
      >
        <span className="truncate">{value || placeholder}</span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--anchor-width)] min-w-72 p-1">
        <Command shouldFilter>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder}
            maxLength={120}
          />
          <CommandList>
            <CommandEmpty>
              {normalizedQuery && !hasExactOption ? (
                <button
                  type="button"
                  className="mx-auto inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"
                  onClick={() => selectValue(normalizedQuery)}
                >
                  <Plus className="size-4" />
                  {customLabel(normalizedQuery)}
                </button>
              ) : (
                placeholder
              )}
            </CommandEmpty>
            <CommandGroup>
              {sortedOptions.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  data-checked={value === option}
                  onSelect={() => selectValue(option)}
                >
                  <span className="min-w-0 flex-1 truncate">{option}</span>
                </CommandItem>
              ))}
              {normalizedQuery && !hasExactOption ? (
                <CommandItem
                  value={`${normalizedQuery} custom`}
                  onSelect={() => selectValue(normalizedQuery)}
                >
                  <Plus className="size-4" />
                  <span className="min-w-0 flex-1 truncate">{customLabel(normalizedQuery)}</span>
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
