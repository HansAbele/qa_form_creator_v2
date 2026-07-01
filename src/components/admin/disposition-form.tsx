"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  DISPOSITION_OUTCOMES,
  type DispositionOutcomeValue,
  OUTCOME_LABELS,
} from "@/lib/disposition-outcome";
import {
  createDisposition,
  updateDisposition,
} from "@/server/actions/dispositions";

interface DispositionFormProps {
  disposition?: {
    id: string;
    name: string;
    code: string | null;
    categoryId: string | null;
    campaignId: string;
    active: boolean;
    outcomeType?: string | null;
  };
  categories: { id: string; name: string }[];
  campaignId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DispositionForm({
  disposition,
  categories,
  campaignId,
  open,
  onOpenChange,
}: DispositionFormProps) {
  const router = useRouter();
  const isEdit = !!disposition;
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(disposition?.name ?? "");
  const [code, setCode] = useState(disposition?.code ?? "");
  const [categoryId, setCategoryId] = useState(disposition?.categoryId ?? "none");
  const [outcomeType, setOutcomeType] = useState(disposition?.outcomeType ?? "none");
  const [active, setActive] = useState(disposition?.active ?? true);

  const outcomeValue = outcomeType === "none" ? null : (outcomeType as DispositionOutcomeValue);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("El nombre es obligatorio");
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await updateDisposition(disposition.id, {
          name: name.trim(),
          code: code.trim() || undefined,
          categoryId: categoryId === "none" ? null : categoryId,
          active,
          outcomeType: outcomeValue,
        });
        toast.success("Disposición actualizada");
      } else {
        await createDisposition({
          name: name.trim(),
          code: code.trim() || undefined,
          categoryId: categoryId === "none" ? undefined : categoryId,
          campaignId,
          outcomeType: outcomeValue,
        });
        toast.success("Disposición creada");
      }
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar disposición" : "Nueva disposición"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="disp-name">Nombre</Label>
            <Input
              id="disp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Venta Cerrada"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="disp-code">Código (opcional)</Label>
            <Input
              id="disp-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Ej: VC-01"
            />
          </div>
          <div className="space-y-2">
            <Label>Categoría</Label>
            <Select
              value={categoryId}
              onValueChange={(v) => v && setCategoryId(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string | null) => {
                    if (!value || value === "none") return "Sin categoría";
                    return categories.find((c) => c.id === value)?.name ?? "Sin categoría";
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
          <div className="space-y-2">
            <Label>Resultado de la llamada</Label>
            <Select value={outcomeType} onValueChange={(v) => v && setOutcomeType(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string | null) => {
                    if (!value || value === "none") return "Sin clasificar";
                    return OUTCOME_LABELS[value as DispositionOutcomeValue] ?? value;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin clasificar</SelectItem>
                {DISPOSITION_OUTCOMES.map((outcome) => (
                  <SelectItem key={outcome} value={outcome}>
                    {OUTCOME_LABELS[outcome]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Alimenta los KPIs de resolución (FCR) y escalación del dashboard.
            </p>
          </div>
          {isEdit && (
            <div className="flex items-center gap-2">
              <Switch
                checked={active}
                onCheckedChange={(v) => setActive(Boolean(v))}
              />
              <Label>Activa</Label>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Guardando..." : isEdit ? "Actualizar" : "Crear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
