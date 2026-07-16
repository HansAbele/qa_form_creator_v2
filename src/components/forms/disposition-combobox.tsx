"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { AlertTriangle, Check, ChevronsUpDown, FolderOpen, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { getDispositionsForSelector, createDispositionInline } from "@/server/actions/dispositions";

interface DispositionItem {
  id: string;
  name: string;
  code: string | null;
  category: { id: string; name: string } | null;
}

interface CategoryGroup {
  categoryName: string;
  items: DispositionItem[];
}

interface LoadedDispositionData {
  campaignId: string;
  categories: CategoryGroup[];
  uncategorized: DispositionItem[];
  all: DispositionItem[];
}

const EMPTY_CATEGORIES: CategoryGroup[] = [];
const EMPTY_DISPOSITIONS: DispositionItem[] = [];

interface Props {
  campaignId: string;
  value: string;
  onChange: (dispositionId: string) => void;
  canManageDispositions: boolean;
  initialDisposition?: DispositionItem | null;
  error?: string;
}

function getActionErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function DispositionCombobox({
  campaignId,
  value,
  onChange,
  canManageDispositions,
  initialDisposition = null,
  error,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loadedData, setLoadedData] = useState<LoadedDispositionData>({
    campaignId: "",
    categories: [],
    uncategorized: [],
    all: [],
  });
  const [creating, setCreating] = useState(false);
  const [similarWarning, setSimilarWarning] = useState<{
    campaignId: string;
    id: string;
    name: string;
  } | null>(null);
  const [actionError, setActionError] = useState<{
    campaignId: string;
    message: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeCampaignIdRef = useRef(campaignId);
  const loadRequestIdRef = useRef(0);

  const dataMatchesCampaign = loadedData.campaignId === campaignId;
  const categories = dataMatchesCampaign ? loadedData.categories : EMPTY_CATEGORIES;
  const loadedUncategorized = dataMatchesCampaign ? loadedData.uncategorized : EMPTY_DISPOSITIONS;
  const loadedAll = dataMatchesCampaign ? loadedData.all : EMPTY_DISPOSITIONS;
  const initialIsMissing = Boolean(
    initialDisposition && !loadedAll.some((item) => item.id === initialDisposition.id),
  );
  const uncategorized = initialIsMissing
    ? [...loadedUncategorized, initialDisposition as DispositionItem]
    : loadedUncategorized;
  const all = initialIsMissing ? [...loadedAll, initialDisposition as DispositionItem] : loadedAll;
  const currentSimilarWarning = similarWarning?.campaignId === campaignId ? similarWarning : null;
  const currentActionError = actionError?.campaignId === campaignId ? actionError.message : null;

  const loadDispositions = useCallback(async () => {
    if (!campaignId || activeCampaignIdRef.current !== campaignId) return false;
    const requestId = ++loadRequestIdRef.current;
    try {
      const data = await getDispositionsForSelector(campaignId);
      if (requestId !== loadRequestIdRef.current || activeCampaignIdRef.current !== campaignId) {
        return false;
      }
      setLoadedData({ campaignId, ...data });
      setActionError(null);
      return true;
    } catch (error) {
      if (requestId !== loadRequestIdRef.current || activeCampaignIdRef.current !== campaignId) {
        return false;
      }
      const message = getActionErrorMessage(error, "No se pudieron cargar las disposiciones");
      setActionError({ campaignId, message });
      toast.error(message);
      return false;
    }
  }, [campaignId]);

  useEffect(() => {
    activeCampaignIdRef.current = campaignId;
    void loadDispositions();
    return () => {
      if (activeCampaignIdRef.current === campaignId) {
        activeCampaignIdRef.current = "";
      }
      loadRequestIdRef.current += 1;
    };
  }, [campaignId, loadDispositions]);

  // Focus input when popover opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const selectedDisposition = useMemo(() => all.find((d) => d.id === value), [all, value]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return null; // show default grouped view
    const q = search.toLowerCase();
    return all.filter((d) => d.name.toLowerCase().includes(q) || d.code?.toLowerCase().includes(q));
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

  const handleCreate = async (forceName?: string, allowSimilar = false) => {
    if (!canManageDispositions) return;
    const creationCampaignId = campaignId;
    const name = forceName ?? search.trim();
    if (!name) return;
    setCreating(true);
    setSimilarWarning(null);
    setActionError(null);
    try {
      const result = await createDispositionInline({ name, campaignId, allowSimilar });
      if (activeCampaignIdRef.current !== creationCampaignId) return;
      if (!result.ok) {
        if (result.code === "SIMILAR") {
          setSimilarWarning({
            campaignId: creationCampaignId,
            id: result.existing.id,
            name: result.existing.name,
          });
          return;
        }
        setActionError({ campaignId: creationCampaignId, message: result.message });
        toast.error(result.message);
        return;
      }
      const loaded = await loadDispositions();
      if (!loaded || activeCampaignIdRef.current !== creationCampaignId) return;
      handleSelect(result.disposition.id);
    } catch (err) {
      if (activeCampaignIdRef.current !== creationCampaignId) return;
      const msg = getActionErrorMessage(err, "No se pudo crear la disposicion");
      setActionError({ campaignId: creationCampaignId, message: msg });
      toast.error(msg);
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
              placeholder={
                canManageDispositions ? "Buscar o crear disposición..." : "Buscar disposición..."
              }
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSimilarWarning(null);
                setActionError(null);
              }}
              className="h-8"
            />
          </div>

          {/* Similar warning */}
          {currentSimilarWarning && (
            <div className="border-b bg-amber-50 p-2 dark:bg-amber-950/30">
              <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>Similar a &ldquo;{currentSimilarWarning.name}&rdquo;</span>
              </div>
              <div className="mt-1.5 flex gap-1.5">
                <Button
                  size="xs"
                  variant="outline"
                  className="text-xs"
                  onClick={() => handleSelect(currentSimilarWarning.id)}
                >
                  Usar existente
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-xs"
                  onClick={() => void handleCreate(search.trim(), true)}
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
                  <p className="py-3 text-center text-xs text-muted-foreground">Sin resultados</p>
                )}
              </>
            ) : (
              // Default grouped view
              <>
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
                    {categories.length > 0 && (
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Sin categoría
                      </div>
                    )}
                    {uncategorized.map(renderItem)}
                  </div>
                )}

                {all.length === 0 && (
                  <p className="py-3 text-center text-xs text-muted-foreground">
                    {canManageDispositions
                      ? "No hay disposiciones. Escribe para crear una."
                      : "No hay disposiciones disponibles."}
                  </p>
                )}
              </>
            )}

            {/* Create new option */}
            {canManageDispositions && search.trim() && !hasExactMatch && !currentSimilarWarning && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-primary hover:bg-accent cursor-pointer"
                onClick={() => void handleCreate()}
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
      {currentActionError && <p className="text-xs text-destructive">{currentActionError}</p>}
    </div>
  );
}
