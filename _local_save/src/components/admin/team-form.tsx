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
import { createTeam, updateTeam } from "@/server/actions/teams";

interface TeamFormProps {
  team?: {
    id: string;
    name: string;
    campaignId: string;
    active: boolean;
  };
  campaigns: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TeamForm({ team, campaigns, open, onOpenChange }: TeamFormProps) {
  const router = useRouter();
  const isEdit = !!team;
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(team?.name ?? "");
  const [campaignId, setCampaignId] = useState(team?.campaignId ?? "");
  const [active, setActive] = useState(team?.active ?? true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("El nombre es obligatorio");
      return;
    }
    if (!isEdit && !campaignId) {
      toast.error("Selecciona una campaña");
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await updateTeam(team.id, { name: name.trim(), active });
        toast.success("Equipo actualizado");
      } else {
        await createTeam({ name: name.trim(), campaignId });
        toast.success("Equipo creado");
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
          <DialogTitle>{isEdit ? "Editar equipo" : "Nuevo equipo"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="team-name">Nombre</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Equipo Alpha"
            />
          </div>
          {!isEdit && (
            <div className="space-y-2">
              <Label>Campaña</Label>
              <Select value={campaignId} onValueChange={(v) => v && setCampaignId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccionar campaña">
                    {(value: string | null) => {
                      if (!value) return "Seleccionar campaña";
                      return campaigns.find((c) => c.id === value)?.name ?? "Seleccionar campaña";
                    }}
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
          )}
          {isEdit && (
            <div className="flex items-center gap-2">
              <Switch checked={active} onCheckedChange={(v) => setActive(Boolean(v))} />
              <Label>Activo</Label>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
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
