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
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/providers/i18n-provider";
import { getPasswordPolicyError, MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { createUser, updateUser } from "@/server/actions/users";
import type { Role } from "@prisma/client";

interface UserFormProps {
  user?: {
    id: string;
    email: string;
    name: string;
    role: Role;
    active: boolean;
    campaigns: { campaign: { id: string; name: string } }[];
  };
  campaigns: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserForm({ user, campaigns, open, onOpenChange }: UserFormProps) {
  const router = useRouter();
  const { t } = useI18n();
  const isEdit = !!user;
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(user?.role ?? "QA");
  const [active, setActive] = useState(user?.active ?? true);
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>(
    user?.campaigns.map((c) => c.campaign.id) ?? [],
  );
  const formIdentity = user?.id ?? "__new__";
  const previousOpen = useRef(false);
  const previousFormIdentity = useRef(formIdentity);

  useEffect(() => {
    const justOpened = open && !previousOpen.current;
    const entityChanged = open && previousFormIdentity.current !== formIdentity;

    if (justOpened || entityChanged) {
      setName(user?.name ?? "");
      setEmail(user?.email ?? "");
      setPassword("");
      setRole(user?.role ?? "QA");
      setActive(user?.active ?? true);
      setSelectedCampaigns(user?.campaigns.map((c) => c.campaign.id) ?? []);
    }

    previousOpen.current = open;
    previousFormIdentity.current = formIdentity;
  }, [open, formIdentity, user?.name, user?.email, user?.role, user?.active, user?.campaigns]);

  const toggleCampaign = (campaignId: string) => {
    setSelectedCampaigns((prev) =>
      prev.includes(campaignId) ? prev.filter((id) => id !== campaignId) : [...prev, campaignId],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      toast.error(t("Name and email are required"));
      return;
    }
    const passwordPolicyError = !isEdit || password ? getPasswordPolicyError(password) : null;
    if (passwordPolicyError) {
      toast.error(t(passwordPolicyError));
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await updateUser(user.id, {
          email: email.trim(),
          name: name.trim(),
          password: password || undefined,
          role,
          active,
          campaignIds: selectedCampaigns,
        });
        toast.success(t("User updated"));
      } else {
        await createUser({
          email: email.trim(),
          name: name.trim(),
          password,
          role,
          campaignIds: selectedCampaigns,
        });
        toast.success(t("User created"));
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
          <DialogTitle>{isEdit ? t("Edit user") : t("New user")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="user-name">{t("Name")}</Label>
            <Input id="user-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-email">Email</Label>
            <Input
              id="user-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-password">
              {t("Password")} {isEdit && t("(leave blank to keep current password)")}
            </Label>
            <Input
              id="user-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={isEdit ? undefined : MIN_PASSWORD_LENGTH}
              maxLength={128}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              {t(
                "{count}+ characters and at least three character types: uppercase, lowercase, numbers, and symbols.",
                { count: MIN_PASSWORD_LENGTH },
              )}
            </p>
          </div>
          <div className="space-y-2">
            <Label>{t("Role")}</Label>
            <Select value={role} onValueChange={(v) => v && setRole(v as Role)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string | null) => {
                    if (value === "ADMIN") return "QA Manager";
                    if (value === "QA") return "QA";
                    if (value === "SUPERVISOR") return "Supervisor";
                    return t("Select role");
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">QA Manager</SelectItem>
                <SelectItem value="QA">QA</SelectItem>
                <SelectItem value="SUPERVISOR">Supervisor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("Assigned campaigns")}</Label>
            <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-3">
              {campaigns.map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={`campaign-${c.id}`}
                    checked={selectedCampaigns.includes(c.id)}
                    onCheckedChange={() => toggleCampaign(c.id)}
                  />
                  <label htmlFor={`campaign-${c.id}`}>{c.name}</label>
                </div>
              ))}
              {campaigns.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("No campaigns")}</p>
              )}
            </div>
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
