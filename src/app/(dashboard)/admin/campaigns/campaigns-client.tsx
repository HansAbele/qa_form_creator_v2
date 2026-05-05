"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Users,
  Tag,
  FolderPlus,
  Upload,
  UserMinus,
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
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CampaignForm } from "@/components/admin/campaign-form";
import { TeamForm } from "@/components/admin/team-form";
import { DispositionForm } from "@/components/admin/disposition-form";
import { deleteCampaign } from "@/server/actions/campaigns";
import {
  getTeams,
  deleteTeam,
  assignAgentsToTeam,
  removeAgentFromTeam,
} from "@/server/actions/teams";
import { getAgents } from "@/server/actions/agents";
import {
  getDispositions,
  getDispositionCategories,
  createDispositionCategory,
  updateDispositionCategory,
  deleteDispositionCategory,
  deleteDisposition,
  bulkImportDispositions,
} from "@/server/actions/dispositions";

// ─── Types ─────────────────────────────────────────────

interface CampaignItem {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  userCount: number;
  formCount: number;
  agentCount: number;
}

interface TeamItem {
  id: string;
  name: string;
  campaignId: string;
  agentCount: number;
}

interface AgentItem {
  id: string;
  name: string;
  agentCode: string | null;
  team: { id: string; name: string } | null;
}

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

// ─── Main Component ────────────────────────────────────

export function CampaignsClient({ campaigns }: { campaigns: CampaignItem[] }) {
  const router = useRouter();

  // Campaign CRUD state
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<CampaignItem | null>(null);

  const campaignOptions = campaigns.map((c) => ({ id: c.id, name: c.name }));

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
      <h1 className="text-3xl font-bold tracking-tight">Gestión de Campañas</h1>

      <Tabs defaultValue="campaigns" className="gap-4">
        <TabsList variant="line">
          <TabsTrigger value="campaigns">Campañas</TabsTrigger>
          <TabsTrigger value="teams">Equipos</TabsTrigger>
          <TabsTrigger value="dispositions">Disposiciones</TabsTrigger>
        </TabsList>

        {/* ─── Campaigns Tab ───────────────────────────── */}
        <TabsContent value="campaigns">
          <div className="space-y-4">
            <div className="flex justify-end">
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
          </div>

          <CampaignForm
            campaign={editItem ?? undefined}
            open={formOpen}
            onOpenChange={(open) => {
              setFormOpen(open);
              if (!open) setEditItem(null);
            }}
          />
        </TabsContent>

        {/* ─── Teams Tab ───────────────────────────────── */}
        <TabsContent value="teams">
          <TeamsTab campaigns={campaignOptions} />
        </TabsContent>

        {/* ─── Dispositions Tab ────────────────────────── */}
        <TabsContent value="dispositions">
          <DispositionsTab campaigns={campaignOptions} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Teams Tab
// ═══════════════════════════════════════════════════════

function TeamsTab({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const [selectedCampaign, setSelectedCampaign] = useState(campaigns[0]?.id ?? "");
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Team form state
  const [teamFormOpen, setTeamFormOpen] = useState(false);
  const [editTeam, setEditTeam] = useState<TeamItem | null>(null);

  // Agent assignment state
  const [assigningAgent, setAssigningAgent] = useState<string | null>(null);

  // ─── Load data when campaign changes ─────────────
  const loadData = useCallback(async (campaignId: string) => {
    if (!campaignId) return;
    setLoading(true);
    try {
      const [teamsData, agentsData] = await Promise.all([
        getTeams(campaignId),
        getAgents(campaignId),
      ]);
      setTeams(
        teamsData.map((t) => ({
          id: t.id,
          name: t.name,
          campaignId: t.campaignId ?? (t.campaign?.id || ""),
          agentCount: t._count.agents,
        })),
      );
      setAgents(
        agentsData.map((a) => ({
          id: a.id,
          name: a.name,
          agentCode: a.agentCode,
          team: a.team,
        })),
      );
    } catch {
      toast.error("Error al cargar datos de equipos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCampaign) loadData(selectedCampaign);
  }, [selectedCampaign, loadData]);

  const handleCampaignChange = (campaignId: string) => {
    setSelectedCampaign(campaignId);
  };

  const handleCreateTeam = () => {
    setEditTeam(null);
    setTeamFormOpen(true);
  };

  const handleEditTeam = (team: TeamItem) => {
    setEditTeam(team);
    setTeamFormOpen(true);
  };

  const handleDeleteTeam = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar el equipo "${name}"? Los agentes serán desvinculados.`)) return;
    try {
      await deleteTeam(id);
      toast.success("Equipo eliminado");
      loadData(selectedCampaign);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error");
    }
  };

  const handleAssignAgent = async (agentId: string, teamId: string) => {
    setAssigningAgent(agentId);
    try {
      if (teamId === "none") {
        await removeAgentFromTeam(agentId);
        toast.success("Agente desvinculado del equipo");
      } else {
        await assignAgentsToTeam(teamId, [agentId]);
        toast.success("Agente asignado al equipo");
      }
      loadData(selectedCampaign);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al asignar");
    } finally {
      setAssigningAgent(null);
    }
  };

  if (campaigns.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No hay campañas disponibles. Crea una campaña primero.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with campaign selector */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Campaña:</span>
          <Select value={selectedCampaign} onValueChange={(v) => v && handleCampaignChange(v)}>
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
        <Button onClick={handleCreateTeam}>
          <Plus className="mr-1 h-4 w-4" />
          Nuevo equipo
        </Button>
      </div>

      {/* Teams table */}
      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          Cargando...
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead className="text-center">Agentes</TableHead>
                <TableHead className="w-24">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      {t.name}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">{t.agentCount}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon-xs" onClick={() => handleEditTeam(t)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon-xs" onClick={() => handleDeleteTeam(t.id, t.name)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {teams.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    No hay equipos en esta campaña
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {/* Agent assignment section */}
          {agents.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Asignación de agentes a equipos</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agente</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead>Equipo actual</TableHead>
                    <TableHead className="w-56">Asignar equipo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agents.map((agent) => (
                    <TableRow key={agent.id}>
                      <TableCell className="font-medium">{agent.name}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">
                        {agent.agentCode || "—"}
                      </TableCell>
                      <TableCell>
                        {agent.team ? (
                          <Badge variant="outline">{agent.team.name}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sin equipo</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Select
                            value={agent.team?.id ?? "none"}
                            onValueChange={(v) => {
                              if (v && v !== (agent.team?.id ?? "none")) {
                                handleAssignAgent(agent.id, v);
                              }
                            }}
                            disabled={assigningAgent === agent.id}
                          >
                            <SelectTrigger className="w-44">
                              <SelectValue>
                                {(value: string | null) => {
                                  if (!value || value === "none") return "Sin equipo";
                                  return teams.find((t) => t.id === value)?.name ?? "Sin equipo";
                                }}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Sin equipo</SelectItem>
                              {teams.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {agent.team && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => handleAssignAgent(agent.id, "none")}
                              disabled={assigningAgent === agent.id}
                              title="Desvincular del equipo"
                            >
                              <UserMinus className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      {/* Team form dialog */}
      <TeamForm
        team={
          editTeam
            ? {
                id: editTeam.id,
                name: editTeam.name,
                campaignId: editTeam.campaignId,
              }
            : undefined
        }
        campaigns={campaigns}
        open={teamFormOpen}
        onOpenChange={(open) => {
          setTeamFormOpen(open);
          if (!open) {
            setEditTeam(null);
            loadData(selectedCampaign);
          }
        }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Dispositions Tab
// ═══════════════════════════════════════════════════════

function DispositionsTab({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  // Campaign selection
  const [selectedCampaign, setSelectedCampaign] = useState(campaigns[0]?.id ?? "");
  const [dispositions, setDispositions] = useState<DispositionItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // Disposition form
  const [formOpen, setFormOpen] = useState(false);
  const [editDisposition, setEditDisposition] = useState<DispositionItem | null>(null);

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

  // ─── Data loading ────────────────────────────────
  const loadCampaignData = useCallback(async (campaignId: string) => {
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
  }, []);

  useEffect(() => {
    if (selectedCampaign) loadCampaignData(selectedCampaign);
  }, [selectedCampaign, loadCampaignData]);

  const handleCampaignChange = (campaignId: string) => {
    setSelectedCampaign(campaignId);
    setFilterCategory("all");
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
        await updateDispositionCategory(editCategoryId, { name: categoryName.trim() });
        toast.success("Categoría actualizada");
      } else {
        await createDispositionCategory({ name: categoryName.trim(), campaignId: selectedCampaign });
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
    if (!confirm(`¿Eliminar la categoría "${name}"? Las disposiciones se desvinculan pero no se borran.`)) return;
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
      toast.success(`${result.created} creadas, ${result.skipped} duplicadas omitidas`);
      setBulkDialogOpen(false);
      setBulkText("");
      loadCampaignData(selectedCampaign);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error en importación");
    } finally {
      setImporting(false);
    }
  };

  if (campaigns.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No hay campañas disponibles. Crea una campaña primero.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Campaign selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Campaña:</span>
            <Select value={selectedCampaign} onValueChange={(v) => v && handleCampaignChange(v)}>
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

          {/* Category filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Categoría:</span>
            <Select value={filterCategory} onValueChange={(v) => v && setFilterCategory(v)}>
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

        {/* Action buttons */}
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
                  <Button variant="ghost" size="icon-xs" onClick={() => openCategoryDialog(cat)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => handleDeleteCategory(cat.id, cat.name)}>
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
                <TableCell className="text-center">{d._count.responses}</TableCell>
                <TableCell>
                  <Badge variant={d.active ? "default" : "secondary"}>
                    {d.active ? "Activa" : "Inactiva"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon-xs" onClick={() => handleEditDisposition(d)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-xs" onClick={() => handleDeleteDisposition(d.id, d.name)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
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
              <Button type="button" variant="outline" onClick={() => setCategoryDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={savingCategory}>
                {savingCategory ? "Guardando..." : editCategoryId ? "Actualizar" : "Crear"}
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
              <Label>Pega un nombre por línea (desde Excel, CSV o texto plano)</Label>
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
              <Select value={bulkCategoryId} onValueChange={(v) => v && setBulkCategoryId(v)}>
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
              <Button type="button" variant="outline" onClick={() => setBulkDialogOpen(false)}>
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
