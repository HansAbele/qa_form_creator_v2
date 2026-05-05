"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { TeamForm } from "@/components/admin/team-form";
import { deleteTeam } from "@/server/actions/teams";

interface TeamItem {
  id: string;
  name: string;
  campaignId: string;
  campaignName: string;
  agentCount: number;
}

interface TeamsClientProps {
  teams: TeamItem[];
  campaigns: { id: string; name: string }[];
}

export function TeamsClient({ teams, campaigns }: TeamsClientProps) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<TeamItem | null>(null);
  const [filterCampaign, setFilterCampaign] = useState("all");

  const filtered =
    filterCampaign === "all"
      ? teams
      : teams.filter((t) => t.campaignId === filterCampaign);

  const handleCreate = () => {
    setEditItem(null);
    setFormOpen(true);
  };

  const handleEdit = (team: TeamItem) => {
    setEditItem(team);
    setFormOpen(true);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar el equipo "${name}"? Los agentes serán desvinculados.`))
      return;
    try {
      await deleteTeam(id);
      toast.success("Equipo eliminado");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Gestión de Equipos</h1>
        <Button onClick={handleCreate}>
          <Plus className="mr-1 h-4 w-4" />
          Nuevo equipo
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
            <TableHead>Campaña</TableHead>
            <TableHead className="text-center">Agentes</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-24">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  {t.name}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{t.campaignName}</Badge>
              </TableCell>
              <TableCell className="text-center">{t.agentCount}</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon-xs" onClick={() => handleEdit(t)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleDelete(t.id, t.name)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No hay equipos registrados
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <TeamForm
        team={
          editItem
            ? {
                id: editItem.id,
                name: editItem.name,
                campaignId: editItem.campaignId,
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
