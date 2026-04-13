"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { createAgent, updateAgent } from "@/server/actions/agents";

interface AgentFormProps {
  agent?: {
    id: string;
    name: string;
    agentCode: string | null;
    campaignId: string;
    active: boolean;
  };
  campaigns: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgentForm({ agent, campaigns, open, onOpenChange }: AgentFormProps) {
  const router = useRouter();
  const isEdit = !!agent;
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(agent?.name ?? "");
  const [agentCode, setAgentCode] = useState(agent?.agentCode ?? "");
  const [campaignId, setCampaignId] = useState(agent?.campaignId ?? "");
  const [active, setActive] = useState(agent?.active ?? true);

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
        await updateAgent(agent.id, {
          name: name.trim(),
          agentCode: agentCode.trim() || undefined,
          active,
        });
        toast.success("Agente actualizado");
      } else {
        await createAgent({
          name: name.trim(),
          agentCode: agentCode.trim() || undefined,
          campaignId,
        });
        toast.success("Agente creado");
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
          <DialogTitle>{isEdit ? "Editar agente" : "Nuevo agente"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agent-name">Nombre</Label>
            <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-code">Código (opcional)</Label>
            <Input
              id="agent-code"
              value={agentCode}
              onChange={(e) => setAgentCode(e.target.value)}
              placeholder="Ej: AG001"
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
                      return (
                        campaigns.find((c) => c.id === value)?.name ??
                        "Seleccionar campaña"
                      );
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
