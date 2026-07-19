"use client";

import { useEffect, useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/providers/i18n-provider";
import { createTeam, updateTeam } from "@/server/actions/teams";

interface TeamFormProps {
  team?: {
    id: string;
    name: string;
    campaignId: string;
  };
  campaigns: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TeamForm({ team, campaigns, open, onOpenChange }: TeamFormProps) {
  const router = useRouter();
  const { t } = useI18n();
  const isEdit = !!team;
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(team?.name ?? "");
  const [campaignId, setCampaignId] = useState(team?.campaignId ?? "");
  const formIdentity = team?.id ?? "__new__";
  const previousOpen = useRef(false);
  const previousFormIdentity = useRef(formIdentity);

  useEffect(() => {
    const justOpened = open && !previousOpen.current;
    const entityChanged = open && previousFormIdentity.current !== formIdentity;

    if (justOpened || entityChanged) {
      setName(team?.name ?? "");
      setCampaignId(team?.campaignId ?? "");
    }

    previousOpen.current = open;
    previousFormIdentity.current = formIdentity;
  }, [open, formIdentity, team?.name, team?.campaignId]);

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
        await updateTeam(team.id, { name: name.trim() });
        toast.success(t("Team updated"));
      } else {
        await createTeam({ name: name.trim(), campaignId });
        toast.success(t("Team created"));
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
          <DialogTitle>{isEdit ? t("Edit team") : t("New team")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="team-name">{t("Name")}</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("Example: Alpha Team")}
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
                      return (
                        campaigns.find((campaign) => campaign.id === value)?.name ??
                        t("Select campaign")
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
