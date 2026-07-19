"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  PowerOff,
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
import { useI18n } from "@/components/providers/i18n-provider";
import { deactivateCampaign } from "@/server/actions/campaigns";
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
  const { t } = useI18n();

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

  const handleDeactivate = async (id: string, name: string) => {
    if (!confirm(t('Deactivate campaign "{name}"? Its history will be preserved.', { name })))
      return;
    try {
      await deactivateCampaign(id);
      toast.success(t("Campaign deactivated"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Unable to deactivate campaign"));
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{t("Campaign Management")}</h1>

      <Tabs defaultValue="campaigns" className="gap-4">
        <TabsList variant="line">
          <TabsTrigger value="campaigns">{t("Campaigns")}</TabsTrigger>
          <TabsTrigger value="teams">{t("Teams")}</TabsTrigger>
          <TabsTrigger value="dispositions">{t("Dispositions")}</TabsTrigger>
        </TabsList>

        {/* ─── Campaigns Tab ───────────────────────────── */}
        <TabsContent value="campaigns">
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button onClick={handleCreate}>
                <Plus className="mr-1 h-4 w-4" />
                {t("New campaign")}
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Name")}</TableHead>
                  <TableHead>{t("Description")}</TableHead>
                  <TableHead className="text-center">{t("Users")}</TableHead>
                  <TableHead className="text-center">{t("Forms")}</TableHead>
                  <TableHead className="text-center">{t("Agents")}</TableHead>
                  <TableHead>{t("Status")}</TableHead>
                  <TableHead className="w-24">{t("Actions")}</TableHead>
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
                        {c.active ? t("Active") : t("Inactive")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t("Edit {name}", { name: c.name })}
                          onClick={() => handleEdit(c)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {c.active && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t("Deactivate {name}", { name: c.name })}
                            onClick={() => handleDeactivate(c.id, c.name)}
                          >
                            <PowerOff className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {campaigns.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      {t("No campaigns registered")}
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
  const { t } = useI18n();
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
  const loadData = useCallback(
    async (campaignId: string) => {
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
        toast.error(t("Unable to load team data"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

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
    if (!confirm(t('Delete team "{name}"? Its agents will be unassigned.', { name }))) return;
    try {
      await deleteTeam(id);
      toast.success(t("Team deleted"));
      loadData(selectedCampaign);
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Unexpected error"));
    }
  };

  const handleAssignAgent = async (agentId: string, teamId: string) => {
    setAssigningAgent(agentId);
    try {
      if (teamId === "none") {
        await removeAgentFromTeam(agentId);
        toast.success(t("Agent removed from team"));
      } else {
        await assignAgentsToTeam(teamId, [agentId]);
        toast.success(t("Agent assigned to team"));
      }
      loadData(selectedCampaign);
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Unable to assign agent"));
    } finally {
      setAssigningAgent(null);
    }
  };

  if (campaigns.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        {t("No campaigns are available. Create a campaign first.")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with campaign selector */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t("Campaign:")}</span>
          <Select value={selectedCampaign} onValueChange={(v) => v && handleCampaignChange(v)}>
            <SelectTrigger className="w-52">
              <SelectValue>
                {(value: string | null) => campaigns.find((c) => c.id === value)?.name ?? ""}
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
          {t("New team")}
        </Button>
      </div>

      {/* Teams table */}
      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          {t("Loading...")}
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Name")}</TableHead>
                <TableHead className="text-center">{t("Agents")}</TableHead>
                <TableHead className="w-24">{t("Actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((team) => (
                <TableRow key={team.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      {team.name}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">{team.agentCount}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("Edit {name}", { name: team.name })}
                        onClick={() => handleEditTeam(team)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("Delete {name}", { name: team.name })}
                        onClick={() => handleDeleteTeam(team.id, team.name)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {teams.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    {t("No teams in this campaign")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {/* Agent assignment section */}
          {agents.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium">{t("Agent team assignments")}</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Agent")}</TableHead>
                    <TableHead>{t("Code")}</TableHead>
                    <TableHead>{t("Current team")}</TableHead>
                    <TableHead className="w-56">{t("Assign team")}</TableHead>
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
                          <span className="text-xs text-muted-foreground">{t("No team")}</span>
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
                                  if (!value || value === "none") return t("No team");
                                  return (
                                    teams.find((team) => team.id === value)?.name ?? t("No team")
                                  );
                                }}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">{t("No team")}</SelectItem>
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
                              aria-label={t("Remove {name} from team", { name: agent.name })}
                              title={t("Remove from team")}
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
  const { t } = useI18n();
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
        toast.error(t("Unable to load data"));
      } finally {
        setLoadingData(false);
      }
    },
    [t],
  );

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
    if (!confirm(t('Delete or deactivate disposition "{name}"?', { name }))) return;
    try {
      await deleteDisposition(id);
      toast.success(t("Disposition deleted"));
      loadCampaignData(selectedCampaign);
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Unexpected error"));
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
      toast.error(t("Name is required"));
      return;
    }
    setSavingCategory(true);
    try {
      if (editCategoryId) {
        await updateDispositionCategory(editCategoryId, { name: categoryName.trim() });
        toast.success(t("Category updated"));
      } else {
        await createDispositionCategory({
          name: categoryName.trim(),
          campaignId: selectedCampaign,
        });
        toast.success(t("Category created"));
      }
      setCategoryDialogOpen(false);
      loadCampaignData(selectedCampaign);
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Unexpected error"));
    } finally {
      setSavingCategory(false);
    }
  };

  const handleDeleteCategory = async (id: string, name: string) => {
    if (
      !confirm(
        t('Delete category "{name}"? Dispositions will be unassigned but not deleted.', { name }),
      )
    )
      return;
    try {
      await deleteDispositionCategory(id);
      toast.success(t("Category deleted"));
      loadCampaignData(selectedCampaign);
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Unexpected error"));
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
      toast.error(t("Paste at least one name per line"));
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
        t("{created} created, {skipped} duplicates skipped", {
          created: result.created,
          skipped: result.skipped,
        }),
      );
      setBulkDialogOpen(false);
      setBulkText("");
      loadCampaignData(selectedCampaign);
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Import failed"));
    } finally {
      setImporting(false);
    }
  };

  if (campaigns.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        {t("No campaigns are available. Create a campaign first.")}
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
            <span className="text-sm text-muted-foreground">{t("Campaign:")}</span>
            <Select value={selectedCampaign} onValueChange={(v) => v && handleCampaignChange(v)}>
              <SelectTrigger className="w-52">
                <SelectValue>
                  {(value: string | null) => campaigns.find((c) => c.id === value)?.name ?? ""}
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
            <span className="text-sm text-muted-foreground">{t("Category:")}</span>
            <Select value={filterCategory} onValueChange={(v) => v && setFilterCategory(v)}>
              <SelectTrigger className="w-48">
                <SelectValue>
                  {(value: string | null) => {
                    if (!value || value === "all") return t("All");
                    if (value === "uncategorized") return t("No category");
                    return categories.find((c) => c.id === value)?.name ?? "";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("All")}</SelectItem>
                <SelectItem value="uncategorized">{t("No category")}</SelectItem>
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
            {t("Import")}
          </Button>
          <Button variant="outline" onClick={() => openCategoryDialog()}>
            <FolderPlus className="mr-1 h-4 w-4" />
            {t("New category")}
          </Button>
          <Button onClick={handleCreateDisposition}>
            <Plus className="mr-1 h-4 w-4" />
            {t("New disposition")}
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
                    {t("{count} dispositions", { count: cat._count.dispositions })}
                  </p>
                </div>
                <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("Edit {name}", { name: cat.name })}
                    onClick={() => openCategoryDialog(cat)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("Delete {name}", { name: cat.name })}
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
          {t("Loading...")}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Name")}</TableHead>
              <TableHead>{t("Code")}</TableHead>
              <TableHead>{t("Category")}</TableHead>
              <TableHead className="text-center">{t("Uses")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead className="w-24">{t("Actions")}</TableHead>
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
                <TableCell className="font-mono text-muted-foreground">{d.code || "—"}</TableCell>
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
                    {d.active ? t("Active") : t("Inactive")}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("Edit {name}", { name: d.name })}
                      onClick={() => handleEditDisposition(d)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("Delete {name}", { name: d.name })}
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
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {t("No dispositions in this campaign")}
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
            <DialogTitle>{editCategoryId ? t("Edit category") : t("New category")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveCategory} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cat-name">{t("Name")}</Label>
              <Input
                id="cat-name"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder={t("Example: Sales")}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCategoryDialogOpen(false)}>
                {t("Cancel")}
              </Button>
              <Button type="submit" disabled={savingCategory}>
                {savingCategory ? t("Saving...") : editCategoryId ? t("Update") : t("Create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bulk Import Dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Import dispositions")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleBulkImport} className="space-y-4">
            <div className="space-y-2">
              <Label>{t("Paste one name per line from Excel, CSV, or plain text")}</Label>
              <Textarea
                rows={10}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={t(
                  "Closed Sale\nCustomer Not Interested\nEscalation\nIssue Resolved\n...",
                )}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {t("Duplicate names are skipped automatically.")}
              </p>
            </div>
            <div className="space-y-2">
              <Label>{t("Assign to category (optional)")}</Label>
              <Select value={bulkCategoryId} onValueChange={(v) => v && setBulkCategoryId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string | null) => {
                      if (!value || value === "none") return t("No category");
                      return categories.find((c) => c.id === value)?.name ?? "";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("No category")}</SelectItem>
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
                {t("Cancel")}
              </Button>
              <Button type="submit" disabled={importing}>
                {importing
                  ? t("Importing...")
                  : t("Import ({count} lines)", {
                      count: bulkText.split("\n").filter((line) => line.trim()).length,
                    })}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
