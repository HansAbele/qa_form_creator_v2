"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CampaignForm } from "@/components/admin/campaign-form";
import { deleteCampaign } from "@/server/actions/campaigns";

interface CampaignItem {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  userCount: number;
  formCount: number;
  agentCount: number;
}

export function CampaignsClient({ campaigns }: { campaigns: CampaignItem[] }) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<CampaignItem | null>(null);

  const handleEdit = (campaign: CampaignItem) => {
    setEditItem(campaign);
    setFormOpen(true);
  };

  const handleCreate = () => {
    setEditItem(null);
    setFormOpen(true);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar la campaña "${name}"?`)) return;
    try {
      await deleteCampaign(id);
      toast.success("Campaña eliminada");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al eliminar");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Gestión de Campañas</h1>
        <Button onClick={handleCreate}>
          <Plus className="mr-1 h-4 w-4" />
          Nueva campaña
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Descripción</TableHead>
            <TableHead className="text-center">Usuarios</TableHead>
            <TableHead className="text-center">Formularios</TableHead>
            <TableHead className="text-center">Agentes</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-24">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {campaigns.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium">{c.name}</TableCell>
              <TableCell className="max-w-48 truncate text-muted-foreground">
                {c.description || "—"}
              </TableCell>
              <TableCell className="text-center">{c.userCount}</TableCell>
              <TableCell className="text-center">{c.formCount}</TableCell>
              <TableCell className="text-center">{c.agentCount}</TableCell>
              <TableCell>
                <Badge variant={c.active ? "default" : "secondary"}>
                  {c.active ? "Activa" : "Inactiva"}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon-xs" onClick={() => handleEdit(c)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(c.id, c.name)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {campaigns.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                No hay campañas registradas
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <CampaignForm
        campaign={editItem ?? undefined}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditItem(null);
        }}
      />
    </div>
  );
}
