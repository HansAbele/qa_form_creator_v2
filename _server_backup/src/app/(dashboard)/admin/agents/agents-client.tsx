"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AgentForm } from "@/components/admin/agent-form";
import { deleteAgent } from "@/server/actions/agents";

interface AgentItem {
  id: string;
  name: string;
  agentCode: string | null;
  campaignId: string;
  campaignName: string;
  active: boolean;
  responseCount: number;
}

interface AgentsClientProps {
  agents: AgentItem[];
  campaigns: { id: string; name: string }[];
}

export function AgentsClient({ agents, campaigns }: AgentsClientProps) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<AgentItem | null>(null);
  const [filterCampaign, setFilterCampaign] = useState("all");

  const filtered =
    filterCampaign === "all"
      ? agents
      : agents.filter((a) => a.campaignId === filterCampaign);

  const handleEdit = (agent: AgentItem) => {
    setEditItem(agent);
    setFormOpen(true);
  };

  const handleCreate = () => {
    setEditItem(null);
    setFormOpen(true);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Desactivar al agente "${name}"?`)) return;
    try {
      await deleteAgent(id);
      toast.success("Agente desactivado");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Gestión de Agentes</h1>
        <Button onClick={handleCreate}>
          <Plus className="mr-1 h-4 w-4" />
          Nuevo agente
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Filtrar por campaña:</span>
        <Select value={filterCampaign} onValueChange={(v) => v && setFilterCampaign(v)}>
          <SelectTrigger className="w-48">
            <SelectValue>
              {(value: string | null) => {
                if (!value || value === "all") return "Todas";
                return campaigns.find((c) => c.id === value)?.name ?? "";
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {campaigns.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Código</TableHead>
            <TableHead>Campaña</TableHead>
            <TableHead className="text-center">Evaluaciones</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-24">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-medium">{a.name}</TableCell>
              <TableCell className="font-mono text-muted-foreground">
                {a.agentCode || "—"}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{a.campaignName}</Badge>
              </TableCell>
              <TableCell className="text-center">{a.responseCount}</TableCell>
              <TableCell>
                <Badge variant={a.active ? "default" : "secondary"}>
                  {a.active ? "Activo" : "Inactivo"}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon-xs" onClick={() => handleEdit(a)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(a.id, a.name)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No hay agentes registrados
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <AgentForm
        agent={
          editItem
            ? {
                id: editItem.id,
                name: editItem.name,
                agentCode: editItem.agentCode,
                campaignId: editItem.campaignId,
                active: editItem.active,
              }
            : undefined
        }
        campaigns={campaigns}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditItem(null);
        }}
      />
    </div>
  );
}
