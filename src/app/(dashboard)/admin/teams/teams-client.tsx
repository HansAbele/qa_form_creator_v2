"use client";

import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
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
  const { t } = useI18n();
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<TeamItem | null>(null);
  const [filterCampaign, setFilterCampaign] = useState("all");

  const filtered =
    filterCampaign === "all" ? teams : teams.filter((t) => t.campaignId === filterCampaign);

  const handleCreate = () => {
    setEditItem(null);
    setFormOpen(true);
  };

  const handleEdit = (team: TeamItem) => {
    setEditItem(team);
    setFormOpen(true);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(t('Delete team "{name}"? Its agents will be unassigned.', { name }))) return;
    try {
      await deleteTeam(id);
      toast.success(t("Team deleted"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Unexpected error"));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t("Team Management")}</h1>
        <Button onClick={handleCreate}>
          <Plus className="mr-1 h-4 w-4" />
          {t("New team")}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{t("Filter by campaign:")}</span>
        <Select value={filterCampaign} onValueChange={(v) => v && setFilterCampaign(v)}>
          <SelectTrigger className="w-48">
            <SelectValue>
              {(value: string | null) => {
                if (!value || value === "all") return t("All");
                return campaigns.find((c) => c.id === value)?.name ?? "";
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All")}</SelectItem>
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
            <TableHead>{t("Name")}</TableHead>
            <TableHead>{t("Campaign")}</TableHead>
            <TableHead className="text-center">{t("Agents")}</TableHead>
            <TableHead className="w-24">{t("Actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((team) => (
            <TableRow key={team.id}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  {team.name}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{team.campaignName}</Badge>
              </TableCell>
              <TableCell className="text-center">{team.agentCount}</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("Edit {name}", { name: team.name })}
                    onClick={() => handleEdit(team)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("Delete {name}", { name: team.name })}
                    onClick={() => handleDelete(team.id, team.name)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                {t("No teams registered")}
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
