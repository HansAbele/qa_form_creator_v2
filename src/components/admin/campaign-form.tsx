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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/providers/i18n-provider";
import { createCampaign, updateCampaign } from "@/server/actions/campaigns";

interface CampaignFormProps {
  campaign?: {
    id: string;
    name: string;
    description: string | null;
    active: boolean;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CampaignForm({ campaign, open, onOpenChange }: CampaignFormProps) {
  const router = useRouter();
  const { t } = useI18n();
  const isEdit = !!campaign;
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(campaign?.name ?? "");
  const [description, setDescription] = useState(campaign?.description ?? "");
  const [active, setActive] = useState(campaign?.active ?? true);
  const formIdentity = campaign?.id ?? "__new__";
  const previousOpen = useRef(false);
  const previousFormIdentity = useRef(formIdentity);

  useEffect(() => {
    const justOpened = open && !previousOpen.current;
    const entityChanged = open && previousFormIdentity.current !== formIdentity;

    if (justOpened || entityChanged) {
      setName(campaign?.name ?? "");
      setDescription(campaign?.description ?? "");
      setActive(campaign?.active ?? true);
    }

    previousOpen.current = open;
    previousFormIdentity.current = formIdentity;
  }, [open, formIdentity, campaign?.name, campaign?.description, campaign?.active]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t("Name is required"));
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await updateCampaign(campaign.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          active,
        });
        toast.success(t("Campaign updated"));
      } else {
        await createCampaign({
          name: name.trim(),
          description: description.trim() || undefined,
        });
        toast.success(t("Campaign created"));
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
          <DialogTitle>{isEdit ? t("Edit campaign") : t("New campaign")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t("Name")}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("Campaign name")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">{t("Description")}</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("Description (optional)")}
              rows={3}
            />
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
