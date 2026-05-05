"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Check, ChevronsUpDown, Plus, Star, FolderOpen, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  getDispositionsForSelector,
  createDispositionInline,
} from "@/server/actions/dispositions";

interface DispositionItem {
  id: string;
  name: string;
  code: string | null;
  category: { id: string; name: string } | null;
  _count: { responses: number };
}

interface CategoryGroup {
  categoryName: string;
  items: DispositionItem[];
}

interface Props {
  campaignId: string;
  value: string;
  onChange: (dispositionId: string) => void;
  error?: string;
}

export function DispositionCombobox({ campaignId, value, onChange, error }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [frequent, setFrequent] = useState<DispositionItem[]>([]);
  const [categories, setCategories] = useState<CategoryGroup[]>([]);
  const [uncategorized, setUncategorized] = useState<DispositionItem[]>([]);
  const [all, setAll] = useState<DispositionItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [similarWarning, setSimilarWarning] = useState<{ id: string; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadDispositions = useCallback(() => {
    if (!campaignId) return;
    getDispositionsForSelector(campaignId).then((data) => {
      setFrequent(data.frequent);
      setCategories(data.categories);
      setUncategorized(data.uncategorized);
      setAll(data.all);
    });
  }, [campaignId]);

  useEffect(() => {
    loadDispositions();
  }, [loadDispositions]);

  // Focus input when popover opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const selectedDisposition = useMemo(
    () => all.find((d) => d.id === value),
    [all, value],
  );

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return null; // show default grouped view
    const q = search.toLowerCase();
    return all.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.code && d.code.toLowerCase().includes(q)),
    );
  }, [search, all]);

  const hasExactMatch = useMemo(() => {
    if (!search.trim()) return true;
    return all.some((d) => d.name.toLowerCase() === search.trim().toLowerCase());
  }, [search, all]);

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
    setSearch("");
    setSimilarWarning(null);
  };

  const handleCreate = async (forceName?: string) => {
    const name = forceName ?? search.trim();
    if (!name) return;
    setCreating(true);
    setSimilarWarning(null);
    try {
      const disposition = await createDispositionInline({ name, campaignId });
      loadDispositions();
      handleSelect(disposition.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("SIMILAR:")) {
        const [, id, existingName] = msg.split(":");
        setSimilarWarning({ id, name: existingName });
      }
    } finally {
      setCreating(false);
    }
  };

  const renderItem = (d: DispositionItem) => (
    <button
      key={d.id}
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer",
        value === d.id && "bg-accent",
      )}
      onClick={() => handleSelect(d.id)}
    >
      <Check className={cn("h-3.5 w-3.5 shrink-0", value === d.id ? "opacity-100" : "opacity-0")} />
      <span className="truncate">
        {d.code && <span className="mr-1.5 font-mono text-xs text-muted-foreground">{d.code}</span>}
        {d.name}
      </span>
      {d._count.responses > 0 && (
        <Badge variant="secondary" className="ml-auto text-[10px] px-1 py-0">
          {d._count.responses}
        </Badge>
      )}
    </button>
  );

  return (
    <div className="space-y-2">
      <Label>
        Disposición <span className="text-destructive">*</span>
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className={cn(
                "w-full justify-between font-normal",
                !value && "text-muted-foreground",
                error && "border-destructive",
              )}
            />
          }
        >
          {selectedDisposition ? (
            <span className="truncate">
              {selectedDisposition.code && (
                <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                  {selectedDisposition.code}
                </span>
              )}
              {selectedDisposition.name}
            </span>
          ) : (
            "Seleccionar disposición..."
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent className="w-(--anchor-width) p-0" align="start">
          {/* Search input */}
          <div className="border-b p-2">
            <Input
              ref={inputRef}
              placeholder="Buscar o crear disposición..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSimilarWarning(null);
              }}
              className="h-8"
            />
          </div>

          {/* Similar warning */}
          {similarWarning && (
            <div className="border-b bg-amber-50 p-2 dark:bg-amber-950/30">
              <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>Similar a &ldquo;{similarWarning.name}&rdquo;</span>
              </div>
              <div className="mt-1.5 flex gap-1.5">
                <Button
                  size="xs"
                  variant="outline"
                  className="text-xs"
                  onClick={() => handleSelect(similarWarning.id)}
                >
                  Usar existente
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-xs"
                  onClick={() => {
                    setSimilarWarning(null);
                    // Force create bypassing fuzzy check (re-create with exact name)
                    const name = search.trim();
                    setCreating(true);
                    import("@/lib/prisma").catch(() => null); // noop
                    createDispositionInline({ name, campaignId })
                      .then((d) => { loadDispositions(); handleSelect(d.id); })
                      .catch(() => null)
                      .finally(() => setCreating(false));
                  }}
                >
                  Crear de todos modos
                </Button>
              </div>
            </div>
          )}

          {/* Dropdown content */}
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered !== null ? (
              // Search mode
              <>
                {filtered.map(renderItem)}
                {filtered.length === 0 && (
                  <p className="py-3 text-center text-xs text-muted-foreground">
                    Sin resultados
                  </p>
                )}
              </>
            ) : (
              // Default grouped view
              <>
                {/* Frecuentes */}
                {frequent.length > 0 && (
                  <div className="mb-1">
                    <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <Star className="h-3 w-3" />
                      Frecuentes
                    </div>
                    {frequent.map(renderItem)}
                  </div>
                )}

                {/* Categories */}
                {categories.map((cat) => (
                  <div key={cat.categoryName} className="mb-1">
                    <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <FolderOpen className="h-3 w-3" />
                      {cat.categoryName}
                    </div>
                    {cat.items.map(renderItem)}
                  </div>
                ))}

                {/* Uncategorized */}
                {uncategorized.length > 0 && (
                  <div className="mb-1">
                    {(frequent.length > 0 || categories.length > 0) && (
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Sin categoría
                      </div>
                    )}
                    {uncategorized.map(renderItem)}
                  </div>
                )}

                {all.length === 0 && (
                  <p className="py-3 text-center text-xs text-muted-foreground">
                    No hay disposiciones. Escribe para crear una.
                  </p>
                )}
              </>
            )}

            {/* Create new option */}
            {search.trim() && !hasExactMatch && !similarWarning && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-primary hover:bg-accent cursor-pointer"
                onClick={() => handleCreate()}
                disabled={creating}
              >
                <Plus className="h-3.5 w-3.5" />
                {creating ? "Creando..." : `Crear "${search.trim()}"`}
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
