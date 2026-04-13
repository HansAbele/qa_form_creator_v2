"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { createUser, updateUser } from "@/server/actions/users";
import type { Role } from "@prisma/client";

interface UserFormProps {
  user?: {
    id: string;
    email: string;
    name: string;
    role: Role;
    active: boolean;
    campaigns: { campaign: { id: string; name: string } }[];
  };
  campaigns: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserForm({ user, campaigns, open, onOpenChange }: UserFormProps) {
  const router = useRouter();
  const isEdit = !!user;
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(user?.role ?? "QA");
  const [active, setActive] = useState(user?.active ?? true);
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>(
    user?.campaigns.map((c) => c.campaign.id) ?? [],
  );

  const toggleCampaign = (campaignId: string) => {
    setSelectedCampaigns((prev) =>
      prev.includes(campaignId) ? prev.filter((id) => id !== campaignId) : [...prev, campaignId],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      toast.error("Nombre y email son obligatorios");
      return;
    }
    if (!isEdit && !password) {
      toast.error("La contraseña es obligatoria");
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await updateUser(user.id, {
          email: email.trim(),
          name: name.trim(),
          password: password || undefined,
          role,
          active,
          campaignIds: selectedCampaigns,
        });
        toast.success("Usuario actualizado");
      } else {
        await createUser({
          email: email.trim(),
          name: name.trim(),
          password,
          role,
          campaignIds: selectedCampaigns,
        });
        toast.success("Usuario creado");
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
          <DialogTitle>{isEdit ? "Editar usuario" : "Nuevo usuario"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="user-name">Nombre</Label>
            <Input id="user-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-email">Email</Label>
            <Input id="user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-password">
              Contraseña {isEdit && "(dejar vacío para no cambiar)"}
            </Label>
            <Input
              id="user-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Rol</Label>
            <Select value={role} onValueChange={(v) => v && setRole(v as Role)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string | null) => {
                    if (value === "ADMIN") return "Administrador";
                    if (value === "QA") return "QA";
                    return "Seleccionar rol";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Administrador</SelectItem>
                <SelectItem value="QA">QA</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Campañas asignadas</Label>
            <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-3">
              {campaigns.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selectedCampaigns.includes(c.id)}
                    onCheckedChange={() => toggleCampaign(c.id)}
                  />
                  {c.name}
                </label>
              ))}
              {campaigns.length === 0 && (
                <p className="text-sm text-muted-foreground">No hay campañas</p>
              )}
            </div>
          </div>
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
