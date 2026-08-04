"use client";

import { Pencil, Plus, PowerOff, Trash2, UserMinus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CampaignForm } from "@/components/admin/campaign-form";
import { TeamForm } from "@/components/admin/team-form";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAgents } from "@/server/actions/agents";
import { deactivateCampaign } from "@/server/actions/campaigns";
import {
  assignAgentsToTeam,
  deleteTeam,
  getTeams,
  removeAgentFromTeam,
} from "@/server/actions/teams";

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
