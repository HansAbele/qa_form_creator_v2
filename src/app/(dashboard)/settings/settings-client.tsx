"use client";

import {
  BarChart3,
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Eye,
  FileSpreadsheet,
  Filter,
  History,
  Info,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  PowerOff,
  RotateCcw,
  Save,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Target,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { DateRangeFilter } from "@/components/filters/date-range-filter";
import { useI18n } from "@/components/providers/i18n-provider";
import { useOperationalTimeZone } from "@/components/providers/operational-time-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  CAMPAIGN_ACCESS_LABELS,
  CAMPAIGN_PERMISSION_GROUPS,
  CAMPAIGN_PERMISSION_KEYS,
  CAMPAIGN_PERMISSION_LABELS,
  type CampaignAccessLevel,
  type CampaignPermissionKey,
  type CampaignPermissionState,
  getCampaignAccessPreset,
} from "@/lib/campaign-permissions";
import { formatOperationalTimestamp } from "@/lib/date-display";
import type { AppSettings, CampaignScoringSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import {
  type OperationalAuditEvent,
  type OperationalAuditPage,
  readOperationalAudit,
} from "@/server/actions/audit";
import { updateCampaignScoringSettings } from "@/server/actions/campaign-scoring";
import {
  createQACategory,
  deactivateQACategory,
  type QACategoryMutationInput,
  type QACategorySummary,
  updateQACategory,
} from "@/server/actions/qa-categories";
import { resetSettings, updateSettings } from "@/server/actions/settings";
import { updateCampaignAccess } from "@/server/actions/users";

interface SettingsClientProps {
  settings: AppSettings;
  isAdmin: boolean;
  canViewAudit: boolean;
  accessUsers: AccessUser[];
  accessCampaigns: { id: string; name: string }[];
  campaignScoring: CampaignScoringSettings[];
  auditPage: OperationalAuditPage;
  qaCategories: QACategorySummary[];
  initialSection?: SettingsSectionId;
}

interface AccessUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "QA" | "SUPERVISOR" | "AGENT";
  active: boolean;
  campaigns: AccessCampaign[];
}

type AccessCampaign = {
  campaign: { id: string; name: string };
  roleInCampaign: CampaignAccessLevel;
} & CampaignPermissionState;

export type SettingsSectionId =
  | "access"
  | "scoring"
  | "campaign-scoring"
  | "categories"
  | "evaluations"
  | "forms-config"
  | "dashboard-kpis"
  | "reports-export"
  | "audit";

const SETTINGS_SECTIONS: {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}[] = [
  {
    id: "access",
    label: "Access Control",
    description: "Users, campaigns, and effective permissions",
    icon: UserCog,
    adminOnly: true,
  },
  {
    id: "scoring",
    label: "Scoring & Targets",
    description: "Organization-wide scoring standards",
    icon: Target,
    adminOnly: true,
  },
  {
    id: "campaign-scoring",
    label: "Campaign Scoring",
    description: "Campaign-specific targets and scoring rules",
    icon: Building2,
    adminOnly: true,
  },
  {
    id: "categories",
    label: "QA Categories",
    description: "Quality categories used by forms and KPIs",
    icon: ListChecks,
    adminOnly: true,
  },
  {
    id: "evaluations",
    label: "Evaluation Rules",
    description: "Evaluation capture and validation rules",
    icon: ClipboardCheck,
    adminOnly: true,
  },
  {
    id: "forms-config",
    label: "Form Rules",
    description: "Publishing and quality form controls",
    icon: ClipboardCheck,
    adminOnly: true,
  },
  {
    id: "dashboard-kpis",
    label: "Dashboard & KPIs",
    description: "Operational visibility by role",
    icon: BarChart3,
    adminOnly: true,
  },
  {
    id: "reports-export",
    label: "Reports & Exports",
    description: "Export privacy and traceability",
    icon: FileSpreadsheet,
    adminOnly: true,
  },
  {
    id: "audit",
    label: "Audit Log",
    description: "Security-sensitive system activity",
    icon: History,
    adminOnly: true,
  },
];

export function SettingsClient({
  settings,
  isAdmin,
  canViewAudit,
  accessUsers,
  accessCampaigns,
  campaignScoring,
  auditPage,
  qaCategories,
  initialSection = "access",
}: SettingsClientProps) {
  const { t } = useI18n();
  const visibleSections = SETTINGS_SECTIONS.filter(
    (section) => !section.adminOnly || isAdmin || (section.id === "audit" && canViewAudit),
  );
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  useEffect(() => setActiveSection(initialSection), [initialSection]);
  const currentSection =
    visibleSections.find((section) => section.id === activeSection) ?? visibleSections[0];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col gap-1"
      >
        <div className="flex items-center gap-2">
          <SettingsIcon className="h-5 w-5 text-orange-500" />
          <h1 className="font-heading text-3xl font-bold tracking-tight">{t("Settings")}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("Manage access, scoring, quality rules, and audit controls.")}
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]"
      >
        <aside className="h-fit rounded-lg border bg-card p-2 lg:sticky lg:top-[82px]">
          <div className="px-2 py-2">
            <p className="text-xs font-medium uppercase text-muted-foreground">{t("Sections")}</p>
          </div>
          <nav className="space-y-1">
            {visibleSections.map((section) => {
              const Icon = section.icon;
              const selected = section.id === currentSection.id;

              return (
                <Button
                  key={section.id}
                  type="button"
                  variant="ghost"
                  className={cn(
                    "h-auto w-full justify-start gap-3 px-3 py-2 text-left",
                    selected &&
                      "bg-orange-50 text-orange-950 hover:bg-orange-50 dark:bg-orange-950/30 dark:text-orange-100",
                  )}
                  onClick={() => setActiveSection(section.id)}
                >
                  <Icon
                    className={cn("h-4 w-4 text-muted-foreground", selected && "text-orange-500")}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{t(section.label)}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {t(section.description)}
                    </span>
                  </span>
                </Button>
              );
            })}
          </nav>
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="flex flex-col gap-1 border-b pb-4">
            <h2 className="text-xl font-semibold tracking-tight">{t(currentSection.label)}</h2>
            <p className="text-sm text-muted-foreground">{t(currentSection.description)}</p>
          </div>

          {isAdmin && currentSection.id === "access" && (
            <AccessTab users={accessUsers} campaigns={accessCampaigns} />
          )}
          {isAdmin && currentSection.id === "scoring" && <ScoringTab settings={settings} />}
          {isAdmin && currentSection.id === "campaign-scoring" && (
            <CampaignScoringTab campaigns={accessCampaigns} scoring={campaignScoring} />
          )}
          {isAdmin && currentSection.id === "categories" && (
            <QACategoriesTab categories={qaCategories} />
          )}
          {isAdmin && currentSection.id === "evaluations" && <EvaluationRulesTab />}
          {isAdmin && currentSection.id === "forms-config" && <FormsConfigTab />}
          {isAdmin && currentSection.id === "dashboard-kpis" && <DashboardKpisTab />}
          {isAdmin && currentSection.id === "reports-export" && <ReportsExportTab />}
          {(isAdmin || canViewAudit) && currentSection.id === "audit" && (
            <OperationalAuditTab
              initialPage={auditPage}
              users={accessUsers}
              campaigns={accessCampaigns}
            />
          )}
        </section>
      </motion.div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//   My Account tab
// ══════════════════════════════════════════════════════════════════════════
function AccessTab({
  users,
  campaigns,
}: {
  users: AccessUser[];
  campaigns: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "ADMIN" | "QA" | "SUPERVISOR" | "AGENT">(
    "all",
  );
  const [campaignFilter, setCampaignFilter] = useState("all");
  const configurableUsers = users.filter(
    (user) => (user.role === "QA" || user.role === "SUPERVISOR") && user.campaigns.length > 0,
  );
  const [selectedUserId, setSelectedUserId] = useState(configurableUsers[0]?.id ?? "");
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [draft, setDraft] = useState<{
    key: string;
    roleInCampaign: CampaignAccessLevel;
    permissions: CampaignPermissionState;
  } | null>(null);
  const [savingAccess, startSavingAccess] = useTransition();

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch =
        term.length === 0 ||
        user.name.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term);
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      const matchesCampaign =
        campaignFilter === "all" ||
        user.role === "ADMIN" ||
        user.campaigns.some(({ campaign }) => campaign.id === campaignFilter);

      return matchesSearch && matchesRole && matchesCampaign;
    });
  }, [campaignFilter, roleFilter, search, users]);

  const activeCount = users.filter((user) => user.active).length;
  const adminCount = users.filter((user) => user.role === "ADMIN").length;
  const qaCount = users.filter((user) => user.role === "QA").length;
  const supervisorCount = users.filter((user) => user.role === "SUPERVISOR").length;
  const unassignedCount = users.filter(
    (user) => user.role !== "ADMIN" && user.campaigns.length === 0,
  ).length;

  const campaignStats = campaigns.map((campaign) => ({
    ...campaign,
    assignedUsers: users.filter((user) =>
      user.campaigns.some((access) => access.campaign.id === campaign.id),
    ).length,
  }));

  const selectedUser =
    configurableUsers.find((user) => user.id === selectedUserId) ?? configurableUsers[0] ?? null;
  const selectedAccess =
    selectedUser?.campaigns.find((access) => access.campaign.id === selectedCampaignId) ??
    selectedUser?.campaigns[0] ??
    null;
  const selectedKey =
    selectedUser && selectedAccess ? `${selectedUser.id}:${selectedAccess.campaign.id}` : "";
  const selectedUserIsSupervisor = selectedUser?.role === "SUPERVISOR";
  const permissionState = selectedUserIsSupervisor
    ? getCampaignAccessPreset("SUPERVISOR")
    : draft?.key === selectedKey && draft.permissions
      ? draft.permissions
      : selectedAccess
        ? getPermissionStateFromAccess(selectedAccess)
        : null;
  const roleInCampaign = selectedUserIsSupervisor
    ? "SUPERVISOR"
    : draft?.key === selectedKey && draft.roleInCampaign
      ? draft.roleInCampaign
      : (selectedAccess?.roleInCampaign ?? "EVALUATOR");
  const hasDraft = !selectedUserIsSupervisor && draft?.key === selectedKey;

  const setPermissionDraft = (
    nextRole: CampaignAccessLevel,
    nextPermissions: CampaignPermissionState,
  ) => {
    if (!selectedKey || selectedUserIsSupervisor) return;
    setDraft({
      key: selectedKey,
      roleInCampaign: nextRole,
      permissions: nextPermissions,
    });
  };

  const handleSaveAccess = () => {
    if (!selectedUser || !selectedAccess || !permissionState) return;
    if (selectedUserIsSupervisor) {
      toast.info(t("Supervisors keep read-only campaign permissions."));
      return;
    }

    startSavingAccess(async () => {
      try {
        await updateCampaignAccess({
          userId: selectedUser.id,
          campaignId: selectedAccess.campaign.id,
          roleInCampaign,
          permissions: permissionState,
        });
        toast.success(t("Permissions updated"));
        setDraft(null);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? t(error.message) : t("Unable to save changes"));
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AccessMetricCard
          icon={<Users className="h-4 w-4 text-orange-500" />}
          label={t("Active users")}
          value={activeCount}
          detail={t("{count} registered", { count: users.length })}
        />
        <AccessMetricCard
          icon={<ShieldCheck className="h-4 w-4 text-orange-500" />}
          label={t("QA Manager")}
          value={adminCount}
          detail={t("Global access")}
        />
        <AccessMetricCard
          icon={<UserCog className="h-4 w-4 text-orange-500" />}
          label={t("Campaign QA")}
          value={qaCount}
          detail={t("Campaign scope")}
        />
        <AccessMetricCard
          icon={<Building2 className="h-4 w-4 text-orange-500" />}
          label={t("Supervisors")}
          value={supervisorCount}
          detail={t(
            unassignedCount === 1
              ? "{count} user without a campaign"
              : "{count} users without a campaign",
            { count: unassignedCount },
          )}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCog className="h-4 w-4 text-orange-500" />
              {t("Current access and permissions")}
            </CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push("/admin/users")}
            >
              {t("Manage users")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_180px_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("Search by user or email")}
                className="pl-8"
              />
            </div>
            <Select
              value={roleFilter}
              onValueChange={(value) => {
                if (!value) return;
                setRoleFilter(value as "all" | "ADMIN" | "QA" | "SUPERVISOR" | "AGENT");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("Role")}>
                  {roleFilter === "all"
                    ? t("All roles")
                    : roleFilter === "ADMIN"
                      ? "QA Manager"
                      : roleFilter === "QA"
                        ? t("Campaign QA")
                        : roleFilter === "SUPERVISOR"
                          ? t("Supervisor")
                          : t("Agent")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("All roles")}</SelectItem>
                <SelectItem value="ADMIN">QA Manager</SelectItem>
                <SelectItem value="QA">{t("Campaign QA")}</SelectItem>
                <SelectItem value="SUPERVISOR">{t("Supervisor")}</SelectItem>
                <SelectItem value="AGENT">{t("Agent")}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={campaignFilter}
              onValueChange={(value) => {
                if (!value) return;
                setCampaignFilter(value);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("Campaign")}>
                  {campaignFilter === "all"
                    ? t("All campaigns")
                    : (campaigns.find((campaign) => campaign.id === campaignFilter)?.name ??
                      t("Campaign"))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("All campaigns")}</SelectItem>
                {campaigns.map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("User")}</TableHead>
                  <TableHead>{t("Base role")}</TableHead>
                  <TableHead>{t("Campaigns")}</TableHead>
                  <TableHead>{t("Access level")}</TableHead>
                  <TableHead>{t("Effective permissions")}</TableHead>
                  <TableHead>{t("Status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="font-medium">{user.name}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.role === "ADMIN" ? "default" : "secondary"}>
                        {t(getBaseRoleLabel(user.role))}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[260px] flex-wrap gap-1">
                        {user.role === "ADMIN" ? (
                          <Badge variant="outline">{t("All")}</Badge>
                        ) : user.campaigns.length > 0 ? (
                          user.campaigns.map(({ campaign }) => (
                            <Badge key={campaign.id} variant="outline" className="text-xs">
                              {campaign.name}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">{t("No campaigns")}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{t(getAccessLevelLabelV2(user))}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[360px] flex-wrap gap-1">
                        {getEffectivePermissionsV2(user).map((permission) => (
                          <Badge key={permission} variant="secondary" className="text-xs">
                            {t(permission)}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.active ? "default" : "secondary"}>
                        {user.active ? t("Active") : t("Inactive")}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredUsers.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      {t("No users match these filters.")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-orange-500" />
              {t("Campaign permission details")}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {t("These permissions are stored on the server and enforced on sensitive actions.")}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {configurableUsers.length > 0 && selectedUser && selectedAccess && permissionState ? (
            <>
              <div className="grid gap-3 lg:grid-cols-[1fr_1fr_220px]">
                <div className="space-y-2">
                  <Label>{t("User")}</Label>
                  <Select
                    value={selectedUser.id}
                    onValueChange={(value) => {
                      if (!value) return;
                      setSelectedUserId(value);
                      setSelectedCampaignId("");
                      setDraft(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("Select user")}>{selectedUser.name}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {configurableUsers.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t("Campaign")}</Label>
                  <Select
                    value={selectedAccess.campaign.id}
                    onValueChange={(value) => {
                      if (!value) return;
                      setSelectedCampaignId(value);
                      setDraft(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("Select campaign")}>
                        {selectedAccess.campaign.name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {selectedUser.campaigns.map((access) => (
                        <SelectItem key={access.campaign.id} value={access.campaign.id}>
                          {access.campaign.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t("Operational access level")}</Label>
                  <Select
                    value={roleInCampaign}
                    onValueChange={(value) => {
                      if (!value) return;
                      if (selectedUserIsSupervisor) return;
                      const nextRole = value as CampaignAccessLevel;
                      setPermissionDraft(nextRole, getCampaignAccessPreset(nextRole));
                    }}
                    disabled={selectedUserIsSupervisor}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("Access level")}>
                        {t(CAMPAIGN_ACCESS_LABELS[roleInCampaign])}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CAMPAIGN_ACCESS_LABELS)
                        .filter(([value]) => value !== "AGENT")
                        .map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {t(label)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                {CAMPAIGN_PERMISSION_GROUPS.map((group) => (
                  <div key={group.title} className="rounded-lg border p-3">
                    <div className="mb-3 text-sm font-medium">{t(group.title)}</div>
                    <div className="space-y-2">
                      {group.keys.map((permissionKey) => {
                        const checkboxId = `${selectedUser.id}-${selectedAccess.campaign.id}-${permissionKey}`;
                        return (
                          <div key={permissionKey} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              id={checkboxId}
                              checked={permissionState[permissionKey]}
                              disabled={selectedUserIsSupervisor}
                              onCheckedChange={(checked) =>
                                setPermissionDraft(roleInCampaign, {
                                  ...permissionState,
                                  [permissionKey]: Boolean(checked),
                                })
                              }
                            />
                            <label htmlFor={checkboxId}>
                              {t(CAMPAIGN_PERMISSION_LABELS[permissionKey])}
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-muted-foreground">
                  {selectedUserIsSupervisor
                    ? t(
                        "Supervisors always keep read access to dashboards, KPIs, forms, and reports.",
                      )
                    : hasDraft
                      ? t("This campaign has unsaved permission changes.")
                      : t("The displayed permissions are currently saved.")}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDraft(null)}
                    disabled={!hasDraft || savingAccess}
                  >
                    {t("Discard")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveAccess}
                    disabled={!hasDraft || savingAccess || selectedUserIsSupervisor}
                  >
                    {savingAccess ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    {t("Save permissions")}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              {t("Assign a QA or Supervisor to a campaign to configure granular permissions.")}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-orange-500" />
              {t("Campaign coverage")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {campaignStats.map((campaign) => (
                <div
                  key={campaign.id}
                  className="flex items-center justify-between rounded-lg border px-3 py-2"
                >
                  <span className="truncate text-sm font-medium">{campaign.name}</span>
                  <Badge variant="outline">
                    {t("{count} assigned", { count: campaign.assignedUsers })}
                  </Badge>
                </div>
              ))}
              {campaignStats.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("No campaigns registered.")}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-orange-500" />
              {t("Operational access map")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <PermissionSummary
              icon={<BarChart3 className="h-4 w-4" />}
              title={t("Dashboard & KPIs")}
              text={t("Global for QA Managers; assigned campaigns for QA and Supervisors.")}
            />
            <PermissionSummary
              icon={<ClipboardCheck className="h-4 w-4" />}
              title={t("Evaluations")}
              text={t(
                "QA can evaluate, review history, and prepare coaching only within assigned campaigns.",
              )}
            />
            <PermissionSummary
              icon={<FileSpreadsheet className="h-4 w-4" />}
              title={t("Reports")}
              text={t("Supervisors can view reports for assigned campaigns without exporting.")}
            />
            <PermissionSummary
              icon={<Target className="h-4 w-4" />}
              title={t("Scoring")}
              text={t("Global scoring remains restricted to QA Managers.")}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AccessMetricCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function PermissionSummary({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="text-orange-500">{icon}</span>
        {title}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function getAccessLevelLabelV2(user: AccessUser): string {
  if (user.role === "ADMIN") return "Global";
  if (user.role === "SUPERVISOR") return "Supervisor";
  if (user.role === "AGENT") return "Agent portal";
  if (user.campaigns.length === 0) return "No campaign";

  const labels = [
    ...new Set(user.campaigns.map((access) => CAMPAIGN_ACCESS_LABELS[access.roleInCampaign])),
  ];

  return labels.length === 1 ? labels[0] : "Mixed";
}

function getBaseRoleLabel(role: AccessUser["role"]): string {
  if (role === "ADMIN") return "QA Manager";
  if (role === "SUPERVISOR") return "Supervisor";
  if (role === "AGENT") return "Agent";
  return "Campaign QA";
}

function getEffectivePermissionsV2(user: AccessUser): string[] {
  if (!user.active) return ["No active access"];
  if (user.role === "ADMIN") {
    return ["Users", "All campaigns", "Global scoring", "Exports"];
  }
  if (user.campaigns.length === 0) return ["No assigned campaign"];
  if (user.role === "SUPERVISOR") {
    return ["Dashboard/KPIs", "Read-only forms", "Evaluations", "Reports", "Read only"];
  }
  if (user.role === "AGENT") {
    return ["Personal coaching", "Personal PIP", "Read only"];
  }

  const hasAny = (permission: CampaignPermissionKey) =>
    user.campaigns.some((access) => access[permission]);
  const permissions: string[] = [];

  if (hasAny("canViewDashboard") || hasAny("canViewKPIs")) {
    permissions.push("Dashboard/KPIs");
  }
  if (hasAny("canCreateForms") || hasAny("canEditForms")) {
    permissions.push("Forms");
  }
  if (hasAny("canEvaluate") || hasAny("canViewEvaluations")) {
    permissions.push("Evaluations");
  }
  if (hasAny("canViewReports")) permissions.push("Reports");
  if (hasAny("canExport")) permissions.push("Exports");
  if (hasAny("canManageAgents") || hasAny("canManageDispositions")) {
    permissions.push("Operations");
  }

  return permissions.length > 0 ? permissions : ["Assignment only"];
}

function getPermissionStateFromAccess(access: AccessCampaign): CampaignPermissionState {
  return Object.fromEntries(
    CAMPAIGN_PERMISSION_KEYS.map((key) => [key, access[key]]),
  ) as CampaignPermissionState;
}

function ScoringTab({ settings }: { settings: AppSettings }) {
  const router = useRouter();
  const { t } = useI18n();
  const [passThreshold, setPassThreshold] = useState(settings.passThreshold);
  const [targetPassRate, setTargetPassRate] = useState(settings.targetPassRate);
  const [targetAvgScore, setTargetAvgScore] = useState(settings.targetAvgScore);
  const [targetDailyRate, setTargetDailyRate] = useState(settings.targetDailyRate);
  const [saving, startSaving] = useTransition();
  const [resetting, startResetting] = useTransition();

  const dirty =
    passThreshold !== settings.passThreshold ||
    targetPassRate !== settings.targetPassRate ||
    targetAvgScore !== settings.targetAvgScore ||
    targetDailyRate !== settings.targetDailyRate;

  const handleSave = () => {
    startSaving(async () => {
      try {
        await updateSettings({
          passThreshold,
          targetPassRate,
          targetAvgScore,
          targetDailyRate,
        });
        toast.success(t("Scoring parameters updated"));
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? t(e.message) : t("Unable to save changes"));
      }
    });
  };

  const handleReset = () => {
    startResetting(async () => {
      try {
        const fresh = await resetSettings();
        setPassThreshold(fresh.passThreshold);
        setTargetPassRate(fresh.targetPassRate);
        setTargetAvgScore(fresh.targetAvgScore);
        setTargetDailyRate(fresh.targetDailyRate);
        toast.success(t("Default values restored"));
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? t(e.message) : t("Unable to restore defaults"));
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-200">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium">{t("These values affect the entire application")}</p>
          <p className="text-xs opacity-90">
            {t(
              "Changes apply immediately to Dashboard, Reports, and KPIs. Previous evaluations are not recalculated; the threshold only affects future reporting.",
            )}
          </p>
        </div>
      </div>

      {/* Pass threshold */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-orange-500" />
            {t("Pass Threshold")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="pass-threshold">
                {t("Minimum score required for an evaluation to pass")}
              </Label>
              <div className="flex items-center gap-3">
                <input
                  id="pass-threshold-range"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={passThreshold}
                  onChange={(e) => setPassThreshold(Number(e.target.value))}
                  className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-orange-500"
                />
                <div className="flex items-center gap-1">
                  <Input
                    id="pass-threshold"
                    type="number"
                    min={0}
                    max={100}
                    value={passThreshold}
                    onChange={(e) => setPassThreshold(clampPct(Number(e.target.value)))}
                    className="w-20 text-right tabular-nums"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("Default: 70%. Valid range: 0-100.")}</p>
        </CardContent>
      </Card>

      {/* Targets */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-orange-500" />
            {t("Global targets")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <PctTargetField
            id="target-pass-rate"
            label={t("Target Pass Rate")}
            description={t(
              "Minimum percentage of evaluations that must pass for KPI target status.",
            )}
            value={targetPassRate}
            onChange={setTargetPassRate}
            defaultValue={85}
          />
          <PctTargetField
            id="target-avg-score"
            label={t("Target Average Score")}
            description={t("Minimum expected organization-wide average score.")}
            value={targetAvgScore}
            onChange={setTargetAvgScore}
            defaultValue={80}
          />
          <div className="space-y-2">
            <Label htmlFor="target-daily-rate">{t("Daily evaluation target")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="target-daily-rate"
                type="number"
                min={0}
                max={10000}
                value={targetDailyRate}
                onChange={(e) =>
                  setTargetDailyRate(Math.max(0, Math.min(10000, Number(e.target.value) || 0)))
                }
                className="w-28 text-right tabular-nums"
              />
              <span className="text-sm text-muted-foreground">{t("/ day")}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("Default: 20. Minimum number of evaluations the team should complete each day.")}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={handleReset} disabled={resetting || saving}>
          {resetting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          {t("Restore defaults")}
        </Button>
        <Button onClick={handleSave} disabled={!dirty || saving || resetting}>
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {t("Save changes")}
        </Button>
      </div>
    </div>
  );
}

function CampaignScoringTab({
  campaigns,
  scoring,
}: {
  campaigns: { id: string; name: string }[];
  scoring: CampaignScoringSettings[];
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [selectedCampaignId, setSelectedCampaignId] = useState(campaigns[0]?.id ?? "");
  const [drafts, setDrafts] = useState<Record<string, CampaignScoringSettings>>(() =>
    Object.fromEntries(scoring.map((item) => [item.campaignId, item])),
  );
  const [saving, startSaving] = useTransition();

  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId);
  const original = scoring.find((item) => item.campaignId === selectedCampaignId);
  const draft = selectedCampaignId ? drafts[selectedCampaignId] : null;
  const usesGlobalDefaults = draft?.usesGlobalDefaults ?? true;
  const dirty = Boolean(draft && original) && JSON.stringify(draft) !== JSON.stringify(original);

  const setDraftValue = <K extends keyof CampaignScoringSettings>(
    key: K,
    value: CampaignScoringSettings[K],
  ) => {
    if (!draft || !selectedCampaignId) return;
    setDrafts((current) => ({
      ...current,
      [selectedCampaignId]: { ...draft, [key]: value },
    }));
  };

  const handleSave = () => {
    if (!draft || !selectedCampaignId) return;
    startSaving(async () => {
      try {
        const saved = await updateCampaignScoringSettings(selectedCampaignId, {
          usesGlobalDefaults: draft.usesGlobalDefaults,
          passThreshold: draft.passThreshold,
          targetPassRate: draft.targetPassRate,
          targetAvgScore: draft.targetAvgScore,
          targetDailyRate: draft.targetDailyRate,
          fatalFailuresAllowed: draft.fatalFailuresAllowed,
          fatalZeroesScore: draft.fatalZeroesScore,
          customerCeaTarget: draft.customerCeaTarget,
          businessCeaTarget: draft.businessCeaTarget,
          complianceCeaTarget: draft.complianceCeaTarget,
        });
        setDrafts((current) => ({ ...current, [selectedCampaignId]: saved }));
        toast.success(t("Campaign scoring updated"));
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? t(e.message) : t("Unable to save changes"));
      }
    });
  };

  if (campaigns.length === 0 || !draft) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          {t("No campaigns are available for configuration.")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-200">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="text-xs leading-relaxed">
          {t(
            "Overrides apply only to the selected campaign. When global defaults are enabled, Dashboard, KPIs, and Reports use organization-wide scoring values.",
          )}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-orange-500" />
            {t("Campaign scoring configuration")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="space-y-2">
              <Label>{t("Campaign")}</Label>
              <Select
                value={selectedCampaignId}
                onValueChange={(value) => {
                  if (!value) return;
                  setSelectedCampaignId(value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("Select campaign")}>
                    {selectedCampaign?.name ?? t("Select campaign")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">
                    {selectedCampaign?.name ?? t("Campaign")}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("Controls scoring thresholds and operational targets for this campaign.")}
                  </p>
                </div>
                <Badge variant={usesGlobalDefaults ? "secondary" : "default"}>
                  {usesGlobalDefaults ? t("Uses global defaults") : t("Custom override active")}
                </Badge>
              </div>
              <div className="mt-4 flex items-center gap-2 text-sm">
                <Checkbox
                  id="campaign-custom-scoring"
                  checked={!usesGlobalDefaults}
                  onCheckedChange={(checked) =>
                    setDraftValue("usesGlobalDefaults", checked !== true)
                  }
                />
                <Label htmlFor="campaign-custom-scoring" className="text-sm font-normal">
                  {t("This campaign uses custom scoring values")}
                </Label>
              </div>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <PctTargetField
              id="campaign-pass-threshold"
              label="Pass Threshold"
              description={t("Minimum score required to pass evaluations in this campaign.")}
              value={draft.passThreshold}
              onChange={(value) => setDraftValue("passThreshold", value)}
              defaultValue={70}
            />
            <PctTargetField
              id="campaign-target-score"
              label={t("Target Average Score")}
              description={t("Expected average score for the campaign.")}
              value={draft.targetAvgScore}
              onChange={(value) => setDraftValue("targetAvgScore", value)}
              defaultValue={80}
            />
            <PctTargetField
              id="campaign-target-pass-rate"
              label="Target Pass Rate"
              description={t("Target percentage of evaluations that pass.")}
              value={draft.targetPassRate}
              onChange={(value) => setDraftValue("targetPassRate", value)}
              defaultValue={85}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="campaign-target-daily">{t("Daily evaluations")}</Label>
                <Input
                  id="campaign-target-daily"
                  type="number"
                  min={0}
                  max={10000}
                  value={draft.targetDailyRate}
                  onChange={(event) =>
                    setDraftValue(
                      "targetDailyRate",
                      Math.max(0, Math.min(10000, Number(event.target.value) || 0)),
                    )
                  }
                  className="w-28 text-right tabular-nums"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="campaign-fatal-allowed">{t("Allowed critical failures")}</Label>
                <Input
                  id="campaign-fatal-allowed"
                  type="number"
                  min={0}
                  max={100}
                  value={draft.fatalFailuresAllowed}
                  onChange={(event) =>
                    setDraftValue(
                      "fatalFailuresAllowed",
                      Math.max(0, Math.min(100, Number(event.target.value) || 0)),
                    )
                  }
                  className="w-28 text-right tabular-nums"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="campaign-fatal-zeroes">
                  {t("Critical failure sets the score to 0%")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "When enabled, a failed critical question forces the score to 0. Otherwise, the calculated score is preserved and the evaluation is marked FAIL.",
                  )}
                </p>
              </div>
              <Switch
                id="campaign-fatal-zeroes"
                checked={draft.fatalZeroesScore}
                disabled={usesGlobalDefaults}
                onCheckedChange={(value) => setDraftValue("fatalZeroesScore", Boolean(value))}
              />
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label>{t("Critical Error Accuracy (CEA) targets by family")}</Label>
              <p className="text-xs text-muted-foreground">
                {t(
                  "Percentage targets for Customer, Business, and Compliance CEA dashboard gauges.",
                )}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="cea-customer">Customer CEA</Label>
                <Input
                  id="cea-customer"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={draft.customerCeaTarget}
                  disabled={usesGlobalDefaults}
                  onChange={(event) =>
                    setDraftValue(
                      "customerCeaTarget",
                      Math.max(0, Math.min(100, Number(event.target.value) || 0)),
                    )
                  }
                  className="w-full text-right tabular-nums"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cea-business">Business CEA</Label>
                <Input
                  id="cea-business"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={draft.businessCeaTarget}
                  disabled={usesGlobalDefaults}
                  onChange={(event) =>
                    setDraftValue(
                      "businessCeaTarget",
                      Math.max(0, Math.min(100, Number(event.target.value) || 0)),
                    )
                  }
                  className="w-full text-right tabular-nums"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cea-compliance">Compliance CEA</Label>
                <Input
                  id="cea-compliance"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={draft.complianceCeaTarget}
                  disabled={usesGlobalDefaults}
                  onChange={(event) =>
                    setDraftValue(
                      "complianceCeaTarget",
                      Math.max(0, Math.min(100, Number(event.target.value) || 0)),
                    )
                  }
                  className="w-full text-right tabular-nums"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={!dirty || saving}>
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {t("Save campaign scoring")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function QACategoriesTab({ categories }: { categories: QACategorySummary[] }) {
  const router = useRouter();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<QACategorySummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<QACategoryMutationInput>({
    name: "",
    description: "",
    canBeFatal: false,
    requiresCommentOnFail: false,
    visibleInDashboard: true,
    visibleInKPIs: true,
  });

  const showCreate = () => {
    setEditing(null);
    setDraft({
      name: "",
      description: "",
      canBeFatal: false,
      requiresCommentOnFail: false,
      visibleInDashboard: true,
      visibleInKPIs: true,
    });
    setOpen(true);
  };

  const showEdit = (category: QACategorySummary) => {
    setEditing(category);
    setDraft({
      name: category.name,
      description: category.description ?? "",
      canBeFatal: category.canBeFatal,
      requiresCommentOnFail: category.requiresCommentOnFail,
      visibleInDashboard: category.visibleInDashboard,
      visibleInKPIs: category.visibleInKPIs,
    });
    setOpen(true);
  };

  const saveCategory = async () => {
    setSaving(true);
    try {
      if (editing) {
        await updateQACategory(editing.id, draft);
        toast.success(t("QA category updated"));
      } else {
        await createQACategory(draft);
        toast.success(t("QA category created"));
      }
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Unable to save QA category"));
    } finally {
      setSaving(false);
    }
  };

  const deactivateCategory = async (category: QACategorySummary) => {
    if (!confirm(t('Deactivate QA category "{name}"?', { name: category.name }))) return;
    try {
      await deactivateQACategory(category.id);
      toast.success(t("QA category deactivated"));
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? t(error.message) : t("Unable to deactivate QA category"),
      );
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 text-orange-500" />
              {t("QA Categories")}
            </CardTitle>
            <Button size="sm" onClick={showCreate}>
              <Plus className="h-3.5 w-3.5" />
              {t("New category")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t(
              "Organization-wide categories structure forms, weights, critical failures, and critical KPIs. Colors and icons are managed by the system.",
            )}
          </p>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Category")}</TableHead>
                  <TableHead>{t("Usage")}</TableHead>
                  <TableHead>{t("Rules")}</TableHead>
                  <TableHead>{t("Visibility")}</TableHead>
                  <TableHead>{t("Status")}</TableHead>
                  <TableHead className="w-24">{t("Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: category.systemColor ?? "#f97316" }}
                        />
                        <div>
                          <div className="font-medium">{category.name}</div>
                          <div className="max-w-[360px] text-xs text-muted-foreground">
                            {category.description}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{t("{count} forms", { count: category.usageCount })}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {category.canBeFatal && <Badge variant="destructive">Fatal</Badge>}
                        {category.requiresCommentOnFail && (
                          <Badge variant="secondary">{t("Comment required")}</Badge>
                        )}
                        {!category.canBeFatal && !category.requiresCommentOnFail && (
                          <span className="text-xs text-muted-foreground">{t("Operational")}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {category.visibleInDashboard && <Badge variant="outline">Dashboard</Badge>}
                        {category.visibleInKPIs && <Badge variant="outline">KPIs</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={category.isActive ? "default" : "secondary"}>
                        {category.isActive ? t("Active") : t("Inactive")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t("Edit {name}", { name: category.name })}
                          onClick={() => showEdit(category)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {category.isActive && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            disabled={category.usageCount > 0}
                            aria-label={t("Deactivate {name}", { name: category.name })}
                            title={
                              category.usageCount > 0
                                ? t("Cannot deactivate a category while it is in use")
                                : t("Deactivate category")
                            }
                            onClick={() => deactivateCategory(category)}
                          >
                            <PowerOff className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {categories.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      {t("No QA categories registered.")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t("Edit QA category") : t("New QA category")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="qa-category-name">{t("Name")}</Label>
              <Input
                id="qa-category-name"
                value={draft.name}
                maxLength={80}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qa-category-description">{t("Description")}</Label>
              <Textarea
                id="qa-category-description"
                value={draft.description ?? ""}
                maxLength={500}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </div>
            {[
              ["canBeFatal", "Allows critical failures"],
              ["requiresCommentOnFail", "Requires a comment on failure"],
              ["visibleInDashboard", "Visible in Dashboard"],
              ["visibleInKPIs", "Visible in KPIs"],
            ].map(([key, label]) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4 rounded-lg border p-3"
              >
                <Label>{t(label)}</Label>
                <Switch
                  checked={Boolean(draft[key as keyof QACategoryMutationInput])}
                  onCheckedChange={(checked) => setDraft({ ...draft, [key]: Boolean(checked) })}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              {t("Cancel")}
            </Button>
            <Button onClick={saveCategory} disabled={saving || draft.name.trim().length < 2}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("Save category")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EvaluationRulesTab() {
  return (
    <OperationalConfigSection
      icon={<ClipboardCheck className="h-4 w-4 text-orange-500" />}
      title="Evaluations"
      description="Server-side rules and operational controls that govern evaluation submission."
      items={[
        {
          key: "campaignConsistency",
          label: "Campaign consistency",
          detail: "The form, agent, and disposition must belong to the same campaign.",
          badge: "Enforced",
          locked: true,
        },
        {
          key: "answerValidation",
          label: "Response validation",
          detail:
            "Required questions, valid options, and duplicate submissions are validated on the server.",
          badge: "Enforced",
          locked: true,
        },
        {
          key: "answerScoring",
          label: "Response-level scoring",
          detail:
            "The system stores score, comments, and critical-failure status for each response.",
          badge: "Model ready",
          locked: true,
        },
      ]}
    />
  );
}

function FormsConfigTab() {
  return (
    <OperationalConfigSection
      icon={<ClipboardCheck className="h-4 w-4 text-orange-500" />}
      title="Forms"
      description="Defaults and publishing rules for the form builder."
      items={[
        {
          key: "formStates",
          label: "Form lifecycle",
          detail:
            "The workflow supports drafts, publishing, archiving, and safe evaluation history.",
          badge: "Model ready",
          locked: true,
        },
        {
          key: "qaStructure",
          label: "QA structure",
          detail:
            "Each question can define a QA category, weight, critical rule, and required comment.",
          badge: "Model ready",
          locked: true,
        },
        {
          key: "publishedChanges",
          label: "Published form editing",
          detail: "Changes remain pending until publication and never alter previous evaluations.",
          badge: "Enforced",
        },
        {
          key: "weightValidation",
          label: "Weight validation",
          detail: "Publishing validates complete weights and preview readiness before activation.",
          badge: "Enforced",
        },
      ]}
    />
  );
}

function DashboardKpisTab() {
  return (
    <OperationalConfigSection
      icon={<BarChart3 className="h-4 w-4 text-orange-500" />}
      title="Dashboard & KPIs"
      description="Role-based operational visibility and widgets enforced by the backend."
      items={[
        {
          key: "managerGlobalView",
          label: "QA Manager view",
          detail: "Global access to campaigns, comparisons, and operational alerts.",
          badge: "Enforced",
          locked: true,
        },
        {
          key: "campaignQaView",
          label: "Campaign QA view",
          detail: "Read access limited to assigned campaigns and effective permissions.",
          badge: "Enforced",
          locked: true,
        },
        {
          key: "supervisorView",
          label: "Supervisor view",
          detail: "Read access to trends, coaching, and evaluations within assigned campaigns.",
          badge: "Enforced",
          locked: true,
        },
      ]}
    />
  );
}

function ReportsExportTab() {
  return (
    <OperationalConfigSection
      icon={<FileSpreadsheet className="h-4 w-4 text-orange-500" />}
      title="Reports & Exports"
      description="Privacy and traceability rules for operational reports."
      items={[
        {
          key: "scopedExports",
          label: "Export scope",
          detail: "Users can export only the data allowed by their campaign permissions.",
          badge: "Enforced",
          locked: true,
        },
        {
          key: "exportAudit",
          label: "Export audit trail",
          detail: "CSV, Excel, and JSON exports are recorded in the operational audit log.",
          badge: "Enforced",
          locked: true,
        },
        {
          key: "supervisorExports",
          label: "Supervisor exports",
          detail: "Supervisors can view campaign reports but cannot export data.",
          badge: "Enforced",
          locked: true,
        },
        {
          key: "fieldSelection",
          label: "Exportable fields",
          detail: "Field selection preserves the privacy of agents, evaluators, and comments.",
          badge: "Configurable",
        },
      ]}
    />
  );
}

function OperationalAuditTab({
  initialPage,
  users,
  campaigns,
}: {
  initialPage: OperationalAuditPage;
  users: AccessUser[];
  campaigns: { id: string; name: string }[];
}) {
  const operationalTimeZone = useOperationalTimeZone();
  const { t } = useI18n();
  const [auditPage, setAuditPage] = useState(initialPage);
  const [filters, setFilters] = useState({
    query: "",
    module: "all",
    action: "all",
    campaignId: "all",
    userId: "all",
    dateFrom: "",
    dateTo: "",
    pageSize: initialPage.pageSize,
  });
  const [selectedEvent, setSelectedEvent] = useState<OperationalAuditEvent | null>(null);
  const [loading, startLoading] = useTransition();
  const auditRequestGeneration = useRef(0);

  const moduleOptions = useMemo(
    () => uniqueOptions(auditPage.events.map((event) => event.module)),
    [auditPage.events],
  );
  const actionOptions = useMemo(
    () => uniqueOptions(auditPage.events.map((event) => event.action)),
    [auditPage.events],
  );

  const loadPage = (page: number) => {
    const generation = ++auditRequestGeneration.current;
    startLoading(async () => {
      try {
        const nextPage = await readOperationalAudit({
          ...filters,
          page,
          pageSize: filters.pageSize,
        });
        if (generation === auditRequestGeneration.current) setAuditPage(nextPage);
      } catch (error) {
        if (generation === auditRequestGeneration.current) {
          toast.error(error instanceof Error ? t(error.message) : t("Unable to load audit log"));
        }
      }
    });
  };

  const resetFilters = () => {
    const nextFilters = {
      query: "",
      module: "all",
      action: "all",
      campaignId: "all",
      userId: "all",
      dateFrom: "",
      dateTo: "",
      pageSize: filters.pageSize,
    };
    setFilters(nextFilters);
    const generation = ++auditRequestGeneration.current;
    startLoading(async () => {
      try {
        const nextPage = await readOperationalAudit({
          ...nextFilters,
          page: 1,
          pageSize: nextFilters.pageSize,
        });
        if (generation === auditRequestGeneration.current) setAuditPage(nextPage);
      } catch (error) {
        if (generation === auditRequestGeneration.current) {
          toast.error(error instanceof Error ? t(error.message) : t("Unable to load audit log"));
        }
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-orange-500" />
          {t("Operational audit")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t(
            "Sensitive server-recorded events: permissions, scoring, forms, evaluations, exports, and campaign operations.",
          )}
        </p>

        <div className="grid gap-3 rounded-lg border p-3 lg:grid-cols-[1.2fr_150px_150px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              value={filters.query}
              onChange={(event) =>
                setFilters((current) => ({ ...current, query: event.target.value }))
              }
              placeholder={t("Search user, campaign, entity, or impact")}
              className="pl-8"
            />
          </div>
          <Select
            value={filters.module}
            onValueChange={(value) =>
              value && setFilters((current) => ({ ...current, module: value }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={t("Module")}>
                {filters.module === "all" ? t("All modules") : filters.module}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All modules")}</SelectItem>
              {moduleOptions.map((module) => (
                <SelectItem key={module} value={module}>
                  {module}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.action}
            onValueChange={(value) =>
              value && setFilters((current) => ({ ...current, action: value }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={t("Action")}>
                {filters.action === "all" ? t("All actions") : filters.action}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All actions")}</SelectItem>
              {actionOptions.map((action) => (
                <SelectItem key={action} value={action}>
                  {action}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.campaignId}
            onValueChange={(value) =>
              value && setFilters((current) => ({ ...current, campaignId: value }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={t("Campaign")}>
                {filters.campaignId === "all"
                  ? t("All campaigns")
                  : (campaigns.find((campaign) => campaign.id === filters.campaignId)?.name ??
                    t("Campaign"))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All campaigns")}</SelectItem>
              {campaigns.map((campaign) => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.userId}
            onValueChange={(value) =>
              value && setFilters((current) => ({ ...current, userId: value }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={t("User")}>
                {filters.userId === "all"
                  ? t("All users")
                  : (users.find((user) => user.id === filters.userId)?.name ?? t("User"))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All users")}</SelectItem>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DateRangeFilter
            id="audit-period"
            label={t("Period")}
            from={filters.dateFrom}
            to={filters.dateTo}
            onApply={(dateFrom, dateTo) =>
              setFilters((current) => ({ ...current, dateFrom, dateTo }))
            }
            align="start"
          />
          <div className="flex flex-wrap gap-2 lg:col-span-3">
            <Button type="button" onClick={() => loadPage(1)} disabled={loading}>
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Filter className="h-3.5 w-3.5" />
              )}
              {t("Apply filters")}
            </Button>
            <Button type="button" variant="outline" onClick={resetFilters}>
              <X className="h-3.5 w-3.5" />
              {t("Clear")}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Date")}</TableHead>
                <TableHead>{t("User")}</TableHead>
                <TableHead>{t("Campaign")}</TableHead>
                <TableHead>{t("Module")}</TableHead>
                <TableHead>{t("Action")}</TableHead>
                <TableHead>{t("Impact")}</TableHead>
                <TableHead className="text-right">{t("Details")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditPage.events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatAuditDate(event.createdAt, operationalTimeZone)}
                  </TableCell>
                  <TableCell>{event.userName ?? t("System")}</TableCell>
                  <TableCell>{event.campaignName ?? "Global"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{event.module}</Badge>
                  </TableCell>
                  <TableCell>{event.action}</TableCell>
                  <TableCell className="max-w-[300px] text-xs text-muted-foreground">
                    {event.impact ?? "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedEvent(event)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {t("View")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {auditPage.events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    {t("No events match the selected filters.")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            {t("Page {page} of {pageCount} · {count} events", {
              page: auditPage.page,
              pageCount: auditPage.pageCount,
              count: auditPage.total,
            })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={auditPage.page <= 1 || loading}
              onClick={() => loadPage(auditPage.page - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {t("Previous")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={auditPage.page >= auditPage.pageCount || loading}
              onClick={() => loadPage(auditPage.page + 1)}
            >
              {t("Next")}
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <Dialog open={Boolean(selectedEvent)} onOpenChange={() => setSelectedEvent(null)}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>{t("Audit event details")}</DialogTitle>
            </DialogHeader>
            {selectedEvent && (
              <AuditEventDetail event={selectedEvent} timeZone={operationalTimeZone} />
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

interface OperationalConfigItem {
  key: string;
  label: string;
  detail: string;
  badge: string;
  locked?: boolean;
}

function OperationalConfigSection({
  icon,
  title,
  description,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  items: OperationalConfigItem[];
}) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {t(title)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t(description)}</p>
        <div className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {t(
              "Inventory of active controls. Their status comes from verified server and database behavior; these are not decorative preferences.",
            )}
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((item) => (
            <div key={item.key} className="rounded-lg border p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-medium">{t(item.label)}</div>
                <Badge variant="secondary">{t(item.badge)}</Badge>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{t(item.detail)}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AuditEventDetail({ event, timeZone }: { event: OperationalAuditEvent; timeZone: string }) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <DetailItem label={t("Date")} value={formatAuditDate(event.createdAt, timeZone)} />
        <DetailItem label={t("User")} value={event.userName ?? t("System")} />
        <DetailItem label={t("Campaign")} value={event.campaignName ?? "Global"} />
        <DetailItem label={t("Entity")} value={event.entityType ?? "-"} />
      </div>
      <div className="rounded-lg border p-3">
        <div className="text-xs font-medium uppercase text-muted-foreground">{t("Impact")}</div>
        <p className="mt-1 text-sm">{event.impact ?? t("No impact recorded.")}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <JsonPanel title={t("Before")} value={event.beforeValue} />
        <JsonPanel title={t("After")} value={event.afterValue} />
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function JsonPanel({ title, value }: { title: string; value: unknown }) {
  const text = value === null || value === undefined ? "" : JSON.stringify(value, null, 2);
  const { t } = useI18n();

  return (
    <div className="min-w-0 rounded-lg border">
      <div className="border-b px-3 py-2 text-sm font-medium">{title}</div>
      {text ? (
        <pre className="max-h-80 overflow-auto p-3 text-xs leading-relaxed">{text}</pre>
      ) : (
        <div className="p-3 text-sm text-muted-foreground">{t("No recorded data.")}</div>
      )}
    </div>
  );
}

function formatAuditDate(value: string, timeZone: string) {
  return formatOperationalTimestamp(value, timeZone, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function uniqueOptions(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function PctTargetField({
  id,
  label,
  description,
  value,
  onChange,
  defaultValue,
}: {
  id: string;
  label: string;
  description: string;
  value: number;
  onChange: (v: number) => void;
  defaultValue: number;
}) {
  const { t } = useI18n();

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-orange-500"
        />
        <div className="flex items-center gap-1">
          <Input
            id={id}
            type="number"
            min={0}
            max={100}
            value={value}
            onChange={(e) => onChange(clampPct(Number(e.target.value)))}
            className="w-20 text-right tabular-nums"
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {description} {t("Default: {value}%.", { value: defaultValue })}
      </p>
    </div>
  );
}

function clampPct(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
