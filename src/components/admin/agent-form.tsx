"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/providers/i18n-provider";
import { createAgent, updateAgent } from "@/server/actions/agents";

interface AgentFormProps {
  agent?: {
    id: string;
    name: string;
    agentCode: string | null;
    campaignId: string;
    teamId: string | null;
    active: boolean;
  };
  campaigns: { id: string; name: string }[];
  teams: { id: string; name: string; campaignId: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NONE = "__none__";

export function AgentForm({ agent, campaigns, teams, open, onOpenChange }: AgentFormProps) {
  const router = useRouter();
  const { t } = useI18n();
  const isEdit = !!agent;
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(agent?.name ?? "");
  const [agentCode, setAgentCode] = useState(agent?.agentCode ?? "");
  const [campaignId, setCampaignId] = useState(agent?.campaignId ?? "");
  const [teamId, setTeamId] = useState(agent?.teamId ?? "");
  const [active, setActive] = useState(agent?.active ?? true);
  const formIdentity = agent?.id ?? "__new__";
  const previousOpen = useRef(false);
  const previousFormIdentity = useRef(formIdentity);

  useEffect(() => {
    const justOpened = open && !previousOpen.current;
    const entityChanged = open && previousFormIdentity.current !== formIdentity;

    if (justOpened || entityChanged) {
      setName(agent?.name ?? "");
      setAgentCode(agent?.agentCode ?? "");
      setCampaignId(agent?.campaignId ?? "");
      setTeamId(agent?.teamId ?? "");
      setActive(agent?.active ?? true);
    }

    previousOpen.current = open;
    previousFormIdentity.current = formIdentity;
  }, [
    open,
    formIdentity,
    agent?.name,
    agent?.agentCode,
    agent?.campaignId,
    agent?.teamId,
    agent?.active,
  ]);

  const availableTeams = useMemo(
    () => (campaignId ? teams.filter((t) => t.campaignId === campaignId) : []),
    [teams, campaignId],
  );

  // Clear team selection if the picked team doesn't belong to the selected campaign
  useEffect(() => {
    if (teamId && !availableTeams.some((t) => t.id === teamId)) {
      setTeamId("");
    }
  }, [availableTeams, teamId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t("Name is required"));
      return;
    }
    if (!isEdit && !campaignId) {
      toast.error(t("Select a campaign"));
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await updateAgent(agent.id, {
          name: name.trim(),
          agentCode: agentCode.trim() || undefined,
          teamId: teamId || undefined,
          active,
        });
        toast.success(t("Agent updated"));
      } else {
        await createAgent({
          name: name.trim(),
          agentCode: agentCode.trim() || undefined,
          campaignId,
          teamId: teamId || undefined,
        });
        toast.success(t("Agent created"));
      }
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Unable to save changes"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("Edit agent") : t("New agent")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agent-name">{t("Name")}</Label>
            <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-code">{t("Code (optional)")}</Label>
            <Input
              id="agent-code"
              value={agentCode}
              onChange={(e) => setAgentCode(e.target.value)}
              placeholder={t("Example: AG001")}
            />
          </div>
          {!isEdit && (
            <div className="space-y-2">
              <Label>{t("Campaign")}</Label>
              <Select value={campaignId} onValueChange={(v) => v && setCampaignId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("Select campaign")}>
                    {(value: string | null) => {
                      if (!value) return t("Select campaign");
                      return campaigns.find((c) => c.id === value)?.name ?? t("Select campaign");
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
          <div className="space-y-2">
            <Label>{t("Team (optional)")}</Label>
            <Select
              value={teamId || NONE}
              onValueChange={(v) => setTeamId(v === NONE || !v ? "" : v)}
              disabled={!campaignId}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string | null) => {
                    if (!campaignId) return t("Select a campaign first");
                    if (!value || value === NONE) return t("No team");
                    return availableTeams.find((team) => team.id === value)?.name ?? t("No team");
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t("No team")}</SelectItem>
                {availableTeams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {campaignId && availableTeams.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t("This campaign has no teams. Create one in Administration → Teams.")}
              </p>
            )}
          </div>
          {isEdit && (
            <div className="flex items-center gap-2">
              <Switch checked={active} onCheckedChange={(v) => setActive(Boolean(v))} />
              <Label>{t("Active")}</Label>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t("Saving...") : isEdit ? t("Update") : t("Create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
