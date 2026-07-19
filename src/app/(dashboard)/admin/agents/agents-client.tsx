"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
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
import { AgentForm } from "@/components/admin/agent-form";
import { useI18n } from "@/components/providers/i18n-provider";
import { deleteAgent } from "@/server/actions/agents";

interface AgentItem {
  id: string;
  name: string;
  agentCode: string | null;
  campaignId: string;
  campaignName: string;
  teamId: string | null;
  teamName: string | null;
  active: boolean;
  responseCount: number;
}

interface AgentsClientProps {
  agents: AgentItem[];
  campaigns: { id: string; name: string }[];
  teams: { id: string; name: string; campaignId: string }[];
}

export function AgentsClient({ agents, campaigns, teams }: AgentsClientProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<AgentItem | null>(null);
  const [filterCampaign, setFilterCampaign] = useState("all");

  const filtered =
    filterCampaign === "all" ? agents : agents.filter((a) => a.campaignId === filterCampaign);

  const handleEdit = (agent: AgentItem) => {
    setEditItem(agent);
    setFormOpen(true);
  };

  const handleCreate = () => {
    setEditItem(null);
    setFormOpen(true);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(t('Deactivate agent "{name}"?', { name }))) return;
    try {
      await deleteAgent(id);
      toast.success(t("Agent deactivated"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Unexpected error"));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t("Agent Management")}</h1>
        <Button onClick={handleCreate}>
          <Plus className="mr-1 h-4 w-4" />
          {t("New agent")}
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
            <TableHead>{t("Code")}</TableHead>
            <TableHead>{t("Campaign")}</TableHead>
            <TableHead>{t("Team")}</TableHead>
            <TableHead className="text-center">{t("Evaluations")}</TableHead>
            <TableHead>{t("Status")}</TableHead>
            <TableHead className="w-24">{t("Actions")}</TableHead>
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
              <TableCell className="text-muted-foreground">
                {a.teamName ? (
                  <Badge variant="secondary">{a.teamName}</Badge>
                ) : (
                  <span className="text-xs italic">—</span>
                )}
              </TableCell>
              <TableCell className="text-center">{a.responseCount}</TableCell>
              <TableCell>
                <Badge variant={a.active ? "default" : "secondary"}>
                  {a.active ? t("Active") : t("Inactive")}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("Edit {name}", { name: a.name })}
                    onClick={() => handleEdit(a)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("Deactivate {name}", { name: a.name })}
                    onClick={() => handleDelete(a.id, a.name)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                {t("No agents registered")}
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
                teamId: editItem.teamId,
                active: editItem.active,
              }
            : undefined
        }
        campaigns={campaigns}
        teams={teams}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditItem(null);
        }}
      />
    </div>
  );
}
