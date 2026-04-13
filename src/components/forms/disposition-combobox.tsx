"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { Check, ChevronsUpDown, Plus, Star, FolderOpen, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  getDispositionsForSelector,
  createDispositionInline,
} from "@/server/actions/dispositions";

// ─── Types ──────────────────────────────────────────

interface DispositionOption {
  id: string;
  name: string;
  code: string | null;
  category: { id: string; name: string; order: number } | null;
  _count: { responses: number };
}

interface CategoryGroup {
  categoryName: string;
  categoryOrder: number;
  items: DispositionOption[];
}

interface DispositionComboboxProps {
  campaignId: string;
  value: string;
  onChange: (dispositionId: string) => void;
  error?: string;
}

// ─── Fuzzy match utility ────────────────────────────

function fuzzyMatch(text: string, query: string): boolean {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t.includes(q)) return true;

  // Simple character-sequence match
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ─── Component ──────────────────────────────────────

export function DispositionCombobox({
  campaignId,
  value,
  onChange,
  error,
}: DispositionComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [similarWarning, setSimilarWarning] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [frequent, setFrequent] = useState<DispositionOption[]>([]);
  const [categories, setCategories] = useState<CategoryGroup[]>([]);
  const [uncategorized, setUncategorized] = useState<DispositionOption[]>([]);
  const [all, setAll] = useState<DispositionOption[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);

  // ─── Load dispositions ────────────────────────────

  useEffect(() => {
    if (!campaignId) return;
    setLoading(true);
    getDispositionsForSelector(campaignId)
      .then((data) => {
        setFrequent(data.frequent);
        setCategories(data.categories);
        setUncategorized(data.uncategorized);
        setAll(data.all);
      })
      .catch(() => toast.error("Error al cargar disposiciones"))
      .finally(() => setLoading(false));
  }, [campaignId]);

  // ─── Filter by search ─────────────────────────────

  const filteredAll = useMemo(() => {
    if (!search.trim()) return [];
    return all.filter(
      (d) =>
        fuzzyMatch(d.name, search) ||
        (d.code && fuzzyMatch(d.code, search)),
    );
  }, [all, search]);

  const hasExactMatch = useMemo(
    () =>
      all.some(
        (d) => d.name.toLowerCase() === search.trim().toLowerCase(),
      ),
    [all, search],
  );

  const showCreateOption =
    search.trim().length >= 2 && !hasExactMatch && !loading;

  // ─── Selected display ─────────────────────────────

  const selectedDisposition = all.find((d) => d.id === value);

  // ─── Create inline ────────────────────────────────

  const handleCreateInline = async () => {
    const trimmed = search.trim();
    if (trimmed.length < 2) return;

    setCreating(true);
    setSimilarWarning(null);

    try {
      const newDisp = await createDispositionInline({
        name: trimmed,
        campaignId,
      });
      onChange(newDisp.id);
      setSearch("");
      setOpen(false);
      toast.success(`Disposición "${trimmed}" creada`);
      // Reload dispositions
      const data = await getDispositionsForSelector(campaignId);
      setFrequent(data.frequent);
      setCategories(data.categories);
      setUncategorized(data.uncategorized);
      setAll(data.all);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      if (msg.startsWith("SIMILAR:")) {
        const [, id, name] = msg.split(":");
        setSimilarWarning({ id, name });
      } else {
        toast.error(msg);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleAcceptSimilar = () => {
    if (similarWarning) {
      onChange(similarWarning.id);
      setSimilarWarning(null);
      setSearch("");
      setOpen(false);
    }
  };

  const handleForceCreate = async () => {
    setSimilarWarning(null);
    // Bypass fuzzy check by calling createDisposition directly
    const { createDisposition } = await import(
      "@/server/actions/dispositions"
    );
    const trimmed = search.trim();
    try {
      const newDisp = await createDisposition({
        name: trimmed,
        campaignId,
      });
      onChange(newDisp.id);
      setSearch("");
      setOpen(false);
      toast.success(`Disposición "${trimmed}" creada`);
      const data = await getDispositionsForSelector(campaignId);
      setFrequent(data.frequent);
      setCategories(data.categories);
      setUncategorized(data.uncategorized);
      setAll(data.all);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  // ─── Select handler ───────────────────────────────

  const handleSelect = (id: string) => {
    onChange(id);
    setSearch("");
    setOpen(false);
    setSimilarWarning(null);
  };

  // ─── Render ───────────────────────────────────────

  return (
    <div className="space-y-2">
      <Label>
        Disposición <span className="text-destructive">*</span>
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between font-normal",
              !value && "text-muted-foreground",
              error && "border-destructive",
            )}
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
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
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
            <div className="border-b bg-amber-50 p-3 dark:bg-amber-950/30">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" />
                Ya existe una disposición similar
              </div>
              <p className="mb-2 text-sm text-amber-600 dark:text-amber-500">
                &quot;{similarWarning.name}&quot;
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={handleAcceptSimilar}
                >
                  Usar existente
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={handleForceCreate}
                >
                  Crear de todas formas
                </Button>
              </div>
            </div>
          )}

          {/* Content */}
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                Cargando...
              </p>
            ) : search.trim() ? (
              /* ── Search results ── */
              <>
                {filteredAll.length > 0 ? (
                  <div className="p-1">
                    {filteredAll.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                          value === d.id && "bg-accent",
                        )}
                        onClick={() => handleSelect(d.id)}
                      >
                        <Check
                          className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            value === d.id ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="flex-1 truncate">
                          {d.code && (
                            <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                              {d.code}
                            </span>
                          )}
                          {d.name}
                        </span>
                        {d.category && (
                          <Badge variant="outline" className="ml-auto text-[10px]">
                            {d.category.name}
                          </Badge>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="px-3 py-3 text-center text-sm text-muted-foreground">
                    No se encontraron disposiciones
                  </p>
                )}
                {showCreateOption && (
                  <>
                    <Separator />
                    <div className="p-1">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-[hsl(var(--tno-orange))] hover:bg-accent"
                        onClick={handleCreateInline}
                        disabled={creating}
                      >
                        <Plus className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          {creating
                            ? "Creando..."
                            : `Crear: "${search.trim()}"`}
                        </span>
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              /* ── Default view: frequent + categories ── */
              <>
                {/* Frequent */}
                {frequent.length > 0 && (
                  <div>
                    <p className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <Star className="h-3 w-3" />
                      Frecuentes
                    </p>
                    <div className="p-1">
                      {frequent.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          className={cn(
                            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                            value === d.id && "bg-accent",
                          )}
                          onClick={() => handleSelect(d.id)}
                        >
                          <Check
                            className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              value === d.id ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <span className="flex-1 truncate">{d.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {d._count.responses}
                          </span>
                        </button>
                      ))}
                    </div>
                    <Separator />
                  </div>
                )}

                {/* By category */}
                {categories.map((cat) => (
                  <div key={cat.categoryName}>
                    <p className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <FolderOpen className="h-3 w-3" />
                      {cat.categoryName}
                    </p>
                    <div className="p-1">
                      {cat.items.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          className={cn(
                            "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                            value === d.id && "bg-accent",
                          )}
                          onClick={() => handleSelect(d.id)}
                        >
                          <Check
                            className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              value === d.id ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <span className="flex-1 truncate">
                            {d.code && (
                              <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                                {d.code}
                              </span>
                            )}
                            {d.name}
                          </span>
                        </button>
                      ))}
                    </div>
                    <Separator />
                  </div>
                ))}

                {/* Uncategorized */}
                {uncategorized.length > 0 && (
                  <div className="p-1">
                    {uncategorized.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                          value === d.id && "bg-accent",
                        )}
                        onClick={() => handleSelect(d.id)}
                      >
                        <Check
                          className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            value === d.id ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="flex-1 truncate">{d.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                {all.length === 0 && (
                  <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                    No hay disposiciones configuradas para esta campaña
                  </p>
                )}
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
