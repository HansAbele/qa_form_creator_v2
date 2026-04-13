"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  FolderPlus,
  Upload,
  Tag,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DispositionForm } from "@/components/admin/disposition-form";
import {
  getDispositions,
  getDispositionCategories,
  createDispositionCategory,
  updateDispositionCategory,
  deleteDispositionCategory,
  deleteDisposition,
  bulkImportDispositions,
} from "@/server/actions/dispositions";

// ─── Types ──────────────────────────────────────────

interface DispositionItem {
  id: string;
  name: string;
  code: string | null;
  categoryId: string | null;
  campaignId: string;
  active: boolean;
  createdAt: Date;
  category: { id: string; name: string } | null;
  createdBy: { name: string } | null;
  _count: { responses: number };
}

interface CategoryItem {
  id: string;
  name: string;
  _count: { dispositions: number };
}

interface DispositionsClientProps {
  initialDispositions: DispositionItem[];
  initialCategories: CategoryItem[];
  campaigns: { id: string; name: string }[];
}

// ─── Component ──────────────────────────────────────

export function DispositionsClient({
  initialDispositions,
  initialCategories,
  campaigns,
}: DispositionsClientProps) {
  const router = useRouter();

  // Campaign filter
  const [selectedCampaign, setSelectedCampaign] = useState(
    campaigns[0]?.id ?? "",
  );
  const [dispositions, setDispositions] =
    useState<DispositionItem[]>(initialDispositions);
  const [categories, setCategories] =
    useState<CategoryItem[]>(initialCategories);
  const [loadingData, setLoadingData] = useState(false);

  // Disposition form
  const [formOpen, setFormOpen] = useState(false);
  const [editDisposition, setEditDisposition] =
    useState<DispositionItem | null>(null);

  // Category dialog
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);

  // Bulk import dialog
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkCategoryId, setBulkCategoryId] = useState("none");
  const [importing, setImporting] = useState(false);

  // Filter
  const [filterCategory, setFilterCategory] = useState("all");

  // ─── Data loading on campaign change ──────────────

  const loadCampaignData = useCallback(
    async (campaignId: string) => {
      if (!campaignId) return;
      setLoadingData(true);
      try {
        const [d, c] = await Promise.all([
          getDispositions(campaignId),
          getDispositionCategories(campaignId),
        ]);
        setDispositions(d);
        setCategories(c);
      } catch {
        toast.error("Error al cargar datos");
      } finally {
        setLoadingData(false);
      }
    },
    [],
  );

  const handleCampaignChange = (campaignId: string) => {
    setSelectedCampaign(campaignId);
    setFilterCategory("all");
    loadCampaignData(campaignId);
  };

  // ─── Filtered dispositions ────────────────────────

  const filtered =
    filterCategory === "all"
      ? dispositions
      : filterCategory === "uncategorized"
        ? dispositions.filter((d) => !d.categoryId)
        : dispositions.filter((d) => d.categoryId === filterCategory);

  // ─── Disposition CRUD ─────────────────────────────

  const handleCreateDisposition = () => {
    setEditDisposition(null);
    setFormOpen(true);
  };

  const handleEditDisposition = (d: DispositionItem) => {
    setEditDisposition(d);
    setFormOpen(true);
  };

  const handleDeleteDisposition = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar/desactivar la disposición "${name}"?`)) return;
    try {
      await deleteDisposition(id);
      toast.success("Disposición eliminada");
      loadCampaignData(selectedCampaign);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error");
    }
  };

  // ─── Category CRUD ────────────────────────────────

  const openCategoryDialog = (category?: CategoryItem) => {
    if (category) {
      setEditCategoryId(category.id);
      setCategoryName(category.name);
    } else {
      setEditCategoryId(null);
      setCategoryName("");
    }
    setCategoryDialogOpen(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryName.trim()) {
      toast.error("El nombre es obligatorio");
      return;
    }
    setSavingCategory(true);
    try {
      if (editCategoryId) {
        await updateDispositionCategory(editCategoryId, {
          name: categoryName.trim(),
        });
        toast.success("Categoría actualizada");
      } else {
        await createDispositionCategory({
          name: categoryName.trim(),
          campaignId: selectedCampaign,
        });
        toast.success("Categoría creada");
      }
      setCategoryDialogOpen(false);
      loadCampaignData(selectedCampaign);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error");
    } finally {
      setSavingCategory(false);
    }
  };

  const handleDeleteCategory = async (id: string, name: string) => {
    if (
      !confirm(
        `¿Eliminar la categoría "${name}"? Las disposiciones se desvinculan pero no se borran.`,
      )
    )
      return;
    try {
      await deleteDispositionCategory(id);
      toast.success("Categoría eliminada");
      loadCampaignData(selectedCampaign);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error");
    }
  };

  // ─── Bulk import ──────────────────────────────────

  const handleBulkImport = async (e: React.FormEvent) => {
    e.preventDefault();
    const names = bulkText
      .split("\n")
      .map((n) => n.trim())
      .filter(Boolean);

    if (names.length === 0) {
      toast.error("Pega al menos un nombre por línea");
      return;
    }

    setImporting(true);
    try {
      const result = await bulkImportDispositions({
        campaignId: selectedCampaign,
        categoryId: bulkCategoryId === "none" ? undefined : bulkCategoryId,
        names,
      });
      toast.success(
        `${result.created} creadas, ${result.skipped} duplicadas omitidas`,
      );
      setBulkDialogOpen(false);
      setBulkText("");
      loadCampaignData(selectedCampaign);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error en importación");
    } finally {
      setImporting(false);
    }
  };

  // ─── Render ───────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">
          Gestión de Disposiciones
        </h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBulkDialogOpen(true)}>
            <Upload className="mr-1 h-4 w-4" />
            Importar
          </Button>
          <Button variant="outline" onClick={() => openCategoryDialog()}>
            <FolderPlus className="mr-1 h-4 w-4" />
            Nueva categoría
          </Button>
          <Button onClick={handleCreateDisposition}>
            <Plus className="mr-1 h-4 w-4" />
            Nueva disposición
          </Button>
        </div>
      </div>

      {/* Campaign + Category filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Campaña:</span>
          <Select
            value={selectedCampaign}
            onValueChange={(v) => v && handleCampaignChange(v)}
          >
            <SelectTrigger className="w-52">
              <SelectValue>
                {(value: string | null) =>
                  campaigns.find((c) => c.id === value)?.name ?? ""
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Categoría:</span>
          <Select
            value={filterCategory}
            onValueChange={(v) => v && setFilterCategory(v)}
          >
            <SelectTrigger className="w-48">
              <SelectValue>
                {(value: string | null) => {
                  if (!value || value === "all") return "Todas";
                  if (value === "uncategorized") return "Sin categoría";
                  return categories.find((c) => c.id === value)?.name ?? "";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="uncategorized">Sin categoría</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} ({c._count.dispositions})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Categories cards */}
      {categories.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          {categories.map((cat) => (
            <Card key={cat.id} className="group relative">
              <CardContent className="flex items-center justify-between p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{cat.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {cat._count.dispositions} disposiciones
                  </p>
                </div>
                <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => openCategoryDialog(cat)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleDeleteCategory(cat.id, cat.name)}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dispositions table */}
      {loadingData ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          Cargando...
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Código</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead className="text-center">Usos</TableHead>
              <TableHead>Creada por</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-24">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                    {d.name}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-muted-foreground">
                  {d.code || "—"}
                </TableCell>
                <TableCell>
                  {d.category ? (
                    <Badge variant="outline">{d.category.name}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {d._count.responses}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {d.createdBy?.name ?? "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={d.active ? "default" : "secondary"}>
                    {d.active ? "Activa" : "Inactiva"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleEditDisposition(d)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleDeleteDisposition(d.id, d.name)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground"
                >
                  No hay disposiciones en esta campaña
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      {/* Disposition Form Dialog */}
      <DispositionForm
        disposition={
          editDisposition
            ? {
                id: editDisposition.id,
                name: editDisposition.name,
                code: editDisposition.code,
                categoryId: editDisposition.categoryId,
                campaignId: editDisposition.campaignId,
                active: editDisposition.active,
              }
            : undefined
        }
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        campaignId={selectedCampaign}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) {
            setEditDisposition(null);
            loadCampaignData(selectedCampaign);
          }
        }}
      />

      {/* Category Dialog */}
      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editCategoryId ? "Editar categoría" : "Nueva categoría"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveCategory} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cat-name">Nombre</Label>
              <Input
                id="cat-name"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="Ej: Ventas"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCategoryDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={savingCategory}>
                {savingCategory
                  ? "Guardando..."
                  : editCategoryId
                    ? "Actualizar"
                    : "Crear"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bulk Import Dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Importar Disposiciones</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleBulkImport} className="space-y-4">
            <div className="space-y-2">
              <Label>
                Pega un nombre por línea (desde Excel, CSV o texto plano)
              </Label>
              <Textarea
                rows={10}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={"Venta Cerrada\nCliente No Interesado\nEscalación\nProblema Resuelto\n..."}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Los nombres duplicados se omiten automáticamente.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Asignar a categoría (opcional)</Label>
              <Select
                value={bulkCategoryId}
                onValueChange={(v) => v && setBulkCategoryId(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string | null) => {
                      if (!value || value === "none") return "Sin categoría";
                      return categories.find((c) => c.id === value)?.name ?? "";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin categoría</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setBulkDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={importing}>
                {importing
                  ? "Importando..."
                  : `Importar (${bulkText.split("\n").filter((l) => l.trim()).length} líneas)`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
