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
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/providers/i18n-provider";
import {
  DISPOSITION_OUTCOMES,
  type DispositionOutcomeValue,
  OUTCOME_LABELS_EN,
} from "@/lib/disposition-outcome";
import { createDisposition, updateDisposition } from "@/server/actions/dispositions";

interface DispositionFormProps {
  disposition?: {
    id: string;
    name: string;
    code: string | null;
    categoryId: string | null;
    campaignId: string;
    active: boolean;
    outcomeType?: string | null;
  };
  categories: { id: string; name: string }[];
  campaignId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DispositionForm({
  disposition,
  categories,
  campaignId,
  open,
  onOpenChange,
}: DispositionFormProps) {
  const router = useRouter();
  const { t } = useI18n();
  const isEdit = !!disposition;
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(disposition?.name ?? "");
  const [code, setCode] = useState(disposition?.code ?? "");
  const [categoryId, setCategoryId] = useState(disposition?.categoryId ?? "none");
  const [outcomeType, setOutcomeType] = useState(disposition?.outcomeType ?? "none");
  const [active, setActive] = useState(disposition?.active ?? true);
  const formIdentity = disposition?.id ?? `__new__:${campaignId}`;
  const previousOpen = useRef(false);
  const previousFormIdentity = useRef(formIdentity);

  useEffect(() => {
    const justOpened = open && !previousOpen.current;
    const entityChanged = open && previousFormIdentity.current !== formIdentity;

    if (justOpened || entityChanged) {
      setName(disposition?.name ?? "");
      setCode(disposition?.code ?? "");
      setCategoryId(disposition?.categoryId ?? "none");
      setOutcomeType(disposition?.outcomeType ?? "none");
      setActive(disposition?.active ?? true);
    }

    previousOpen.current = open;
    previousFormIdentity.current = formIdentity;
  }, [
    open,
    formIdentity,
    disposition?.name,
    disposition?.code,
    disposition?.categoryId,
    disposition?.outcomeType,
    disposition?.active,
  ]);

  const outcomeValue = outcomeType === "none" ? null : (outcomeType as DispositionOutcomeValue);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t("Name is required"));
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await updateDisposition(disposition.id, {
          name: name.trim(),
          code: code.trim() || undefined,
          categoryId: categoryId === "none" ? null : categoryId,
          active,
          outcomeType: outcomeValue,
        });
        toast.success(t("Disposition updated"));
      } else {
        await createDisposition({
          name: name.trim(),
          code: code.trim() || undefined,
          categoryId: categoryId === "none" ? undefined : categoryId,
          campaignId,
          outcomeType: outcomeValue,
        });
        toast.success(t("Disposition created"));
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
          <DialogTitle>{isEdit ? t("Edit disposition") : t("New disposition")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="disp-name">{t("Name")}</Label>
            <Input
              id="disp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("Example: Closed Sale")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="disp-code">{t("Code (optional)")}</Label>
            <Input
              id="disp-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("Example: CS-01")}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("Category")}</Label>
            <Select value={categoryId} onValueChange={(v) => v && setCategoryId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string | null) => {
                    if (!value || value === "none") return t("No category");
                    return (
                      categories.find((category) => category.id === value)?.name ?? t("No category")
                    );
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
          <div className="space-y-2">
            <Label>{t("Call outcome")}</Label>
            <Select value={outcomeType} onValueChange={(v) => v && setOutcomeType(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string | null) => {
                    if (!value || value === "none") return t("Unclassified");
                    return t(OUTCOME_LABELS_EN[value as DispositionOutcomeValue] ?? value);
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("Unclassified")}</SelectItem>
                {DISPOSITION_OUTCOMES.map((outcome) => (
                  <SelectItem key={outcome} value={outcome}>
                    {t(OUTCOME_LABELS_EN[outcome])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("Used by Dashboard resolution (FCR) and escalation KPIs.")}
            </p>
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
