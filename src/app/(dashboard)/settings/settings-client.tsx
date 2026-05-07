"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  Settings as SettingsIcon,
  User,
  UserCog,
  Target,
  KeyRound,
  Mail,
  Shield,
  ShieldCheck,
  Building2,
  CalendarDays,
  Save,
  RotateCcw,
  Loader2,
  Info,
  Search,
  Users,
  BarChart3,
  ClipboardCheck,
  FileSpreadsheet,
  History,
  ListChecks,
  MessageSquareWarning,
  Eye,
  Filter,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { updateMyName, changeMyPassword, type ProfileInfo } from "@/server/actions/profile";
import { updateCampaignAccess } from "@/server/actions/users";
import {
  updateSettings,
  resetSettings,
  updateOperationalSettings,
} from "@/server/actions/settings";
import { updateCampaignScoringSettings } from "@/server/actions/campaign-scoring";
import {
  readOperationalAudit,
  type OperationalAuditEvent,
  type OperationalAuditPage,
} from "@/server/actions/audit";
import type { QACategorySummary } from "@/server/actions/qa-categories";
import type {
  AppSettings,
  CampaignScoringSettings,
  OperationalSettings,
  OperationalSettingsPatch,
} from "@/lib/settings";
import { DEFAULT_OPERATIONAL_SETTINGS } from "@/lib/settings";
import {
  CAMPAIGN_ACCESS_LABELS,
  CAMPAIGN_PERMISSION_KEYS,
  CAMPAIGN_PERMISSION_LABELS,
  getCampaignAccessPreset,
  type CampaignAccessLevel,
  type CampaignPermissionKey,
  type CampaignPermissionState,
} from "@/lib/campaign-permissions";
import { cn } from "@/lib/utils";

interface SettingsClientProps {
  profile: ProfileInfo;
  settings: AppSettings;
  operationalSettings: OperationalSettings | null;
  isAdmin: boolean;
  accessUsers: AccessUser[];
  accessCampaigns: { id: string; name: string }[];
  campaignScoring: CampaignScoringSettings[];
  auditPage: OperationalAuditPage;
  qaCategories: QACategorySummary[];
}

interface AccessUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "QA";
  active: boolean;
  campaigns: AccessCampaign[];
}

type AccessCampaign = {
  campaign: { id: string; name: string };
  roleInCampaign: CampaignAccessLevel;
} & CampaignPermissionState;

type SettingsSectionId =
  | "account"
  | "access"
  | "scoring"
  | "campaign-scoring"
  | "categories"
  | "evaluations"
  | "forms-config"
  | "dashboard-kpis"
  | "reports-export"
  | "audit"
  | "notifications";

const SETTINGS_SECTIONS: {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}[] = [
  {
    id: "account",
    label: "Mi cuenta",
    description: "Perfil, rol y seguridad personal",
    icon: User,
  },
  {
    id: "access",
    label: "Accesos y permisos",
    description: "Usuarios, campañas y permisos efectivos",
    icon: UserCog,
    adminOnly: true,
  },
  {
    id: "scoring",
    label: "Scoring global",
    description: "Defaults operativos de calidad",
    icon: Target,
    adminOnly: true,
  },
  {
    id: "campaign-scoring",
    label: "Scoring por campaña",
    description: "Overrides y metas por operación",
    icon: Building2,
    adminOnly: true,
  },
  {
    id: "categories",
    label: "Categorías QA",
    description: "Catálogo para formularios y KPIs",
    icon: ListChecks,
    adminOnly: true,
  },
  {
    id: "evaluations",
    label: "Evaluaciones",
    description: "Reglas de captura y validación",
    icon: ClipboardCheck,
    adminOnly: true,
  },
  {
    id: "forms-config",
    label: "Formularios",
    description: "Publicación, versionado y reglas QA",
    icon: ClipboardCheck,
    adminOnly: true,
  },
  {
    id: "dashboard-kpis",
    label: "Dashboard & KPIs",
    description: "Visibilidad operacional por rol",
    icon: BarChart3,
    adminOnly: true,
  },
  {
    id: "reports-export",
    label: "Reportes & Exportación",
    description: "Privacidad y trazabilidad de salidas",
    icon: FileSpreadsheet,
    adminOnly: true,
  },
  {
    id: "audit",
    label: "Auditoría operativa",
    description: "Eventos sensibles del sistema",
    icon: History,
    adminOnly: true,
  },
  {
    id: "notifications",
    label: "Notificaciones",
    description: "Alertas de riesgo QA",
    icon: MessageSquareWarning,
    adminOnly: true,
  },
];

const PERMISSION_GROUPS: {
  title: string;
  keys: CampaignPermissionKey[];
}[] = [
  {
    title: "Lectura y analítica",
    keys: ["canViewDashboard", "canViewKPIs", "canViewForms", "canViewReports"],
  },
  {
    title: "Formularios y evaluaciones",
    keys: [
      "canCreateForms",
      "canEditForms",
      "canPublishForms",
      "canEvaluate",
      "canEditEvaluations",
    ],
  },
  {
    title: "Operación y datos",
    keys: ["canExport", "canManageAgents", "canManageDispositions", "canManageCampaignScoring"],
  },
];

export function SettingsClient({
  profile,
  settings,
  operationalSettings,
  isAdmin,
  accessUsers,
  accessCampaigns,
  campaignScoring,
  auditPage,
  qaCategories,
}: SettingsClientProps) {
  const visibleSections = SETTINGS_SECTIONS.filter((section) => !section.adminOnly || isAdmin);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("account");
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
          <h1 className="font-heading text-3xl font-bold tracking-tight">Configuración</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Centro operativo para cuenta, accesos por campaña y parámetros QA.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]"
      >
        <aside className="h-fit rounded-lg border bg-card p-2 lg:sticky lg:top-6">
          <div className="px-2 py-2">
            <p className="text-xs font-medium uppercase text-muted-foreground">Secciones</p>
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
                    <span className="block truncate text-sm font-medium">{section.label}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {section.description}
                    </span>
                  </span>
                </Button>
              );
            })}
          </nav>
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="flex flex-col gap-1 border-b pb-4">
            <h2 className="text-xl font-semibold tracking-tight">{currentSection.label}</h2>
            <p className="text-sm text-muted-foreground">{currentSection.description}</p>
          </div>

          {currentSection.id === "account" && <AccountTab profile={profile} />}
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
          {isAdmin && currentSection.id === "evaluations" && (
            <EvaluationRulesTab settings={operationalSettings} />
          )}
          {isAdmin && currentSection.id === "forms-config" && (
            <FormsConfigTab settings={operationalSettings} />
          )}
          {isAdmin && currentSection.id === "dashboard-kpis" && (
            <DashboardKpisTab settings={operationalSettings} />
          )}
          {isAdmin && currentSection.id === "reports-export" && (
            <ReportsExportTab settings={operationalSettings} />
          )}
          {isAdmin && currentSection.id === "audit" && (
            <OperationalAuditTab
              initialPage={auditPage}
              users={accessUsers}
              campaigns={accessCampaigns}
            />
          )}
          {isAdmin && currentSection.id === "notifications" && (
            <NotificationsTab settings={operationalSettings} />
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
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "ADMIN" | "QA">("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const configurableUsers = users.filter((user) => user.role === "QA" && user.campaigns.length > 0);
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
  const unassignedCount = users.filter(
    (user) => user.role === "QA" && user.campaigns.length === 0,
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
  const permissionState =
    draft?.key === selectedKey && draft.permissions
      ? draft.permissions
      : selectedAccess
        ? getPermissionStateFromAccess(selectedAccess)
        : null;
  const roleInCampaign =
    draft?.key === selectedKey && draft.roleInCampaign
      ? draft.roleInCampaign
      : (selectedAccess?.roleInCampaign ?? "EVALUATOR");
  const hasDraft = draft?.key === selectedKey;

  const setPermissionDraft = (
    nextRole: CampaignAccessLevel,
    nextPermissions: CampaignPermissionState,
  ) => {
    if (!selectedKey) return;
    setDraft({
      key: selectedKey,
      roleInCampaign: nextRole,
      permissions: nextPermissions,
    });
  };

  const handleSaveAccess = () => {
    if (!selectedUser || !selectedAccess || !permissionState) return;

    startSavingAccess(async () => {
      try {
        await updateCampaignAccess({
          userId: selectedUser.id,
          campaignId: selectedAccess.campaign.id,
          roleInCampaign,
          permissions: permissionState,
        });
        toast.success("Permisos actualizados");
        setDraft(null);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Error al guardar");
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AccessMetricCard
          icon={<Users className="h-4 w-4 text-orange-500" />}
          label="Usuarios activos"
          value={activeCount}
          detail={`${users.length} registrados`}
        />
        <AccessMetricCard
          icon={<ShieldCheck className="h-4 w-4 text-orange-500" />}
          label="QA Manager"
          value={adminCount}
          detail="Acceso global"
        />
        <AccessMetricCard
          icon={<UserCog className="h-4 w-4 text-orange-500" />}
          label="QA campaña"
          value={qaCount}
          detail="Scope por campaña"
        />
        <AccessMetricCard
          icon={<Building2 className="h-4 w-4 text-orange-500" />}
          label="Sin campaña"
          value={unassignedCount}
          detail="Requiere asignación"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCog className="h-4 w-4 text-orange-500" />
              Accesos y permisos actuales
            </CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push("/admin/users")}
            >
              Administrar usuarios
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
                placeholder="Buscar usuario o email"
                className="pl-8"
              />
            </div>
            <Select
              value={roleFilter}
              onValueChange={(value) => {
                if (!value) return;
                setRoleFilter(value as "all" | "ADMIN" | "QA");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Rol" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los roles</SelectItem>
                <SelectItem value="ADMIN">QA Manager</SelectItem>
                <SelectItem value="QA">QA campaña</SelectItem>
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
                <SelectValue placeholder="Campaña" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las campañas</SelectItem>
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
                  <TableHead>Usuario</TableHead>
                  <TableHead>Rol base</TableHead>
                  <TableHead>Campañas</TableHead>
                  <TableHead>Nivel</TableHead>
                  <TableHead>Permisos efectivos</TableHead>
                  <TableHead>Estado</TableHead>
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
                        {user.role === "ADMIN" ? "QA Manager" : "QA campa�a"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[260px] flex-wrap gap-1">
                        {user.role === "ADMIN" ? (
                          <Badge variant="outline">Todas</Badge>
                        ) : user.campaigns.length > 0 ? (
                          user.campaigns.map(({ campaign }) => (
                            <Badge key={campaign.id} variant="outline" className="text-xs">
                              {campaign.name}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">Sin campañas</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{getAccessLevelLabelV2(user)}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[360px] flex-wrap gap-1">
                        {getEffectivePermissionsV2(user).map((permission) => (
                          <Badge key={permission} variant="secondary" className="text-xs">
                            {permission}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.active ? "default" : "secondary"}>
                        {user.active ? "Activo" : "Inactivo"}
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
                      No hay usuarios con esos filtros.
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
              Detalle de permisos por campaña
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Estos permisos se guardan en servidor y se aplican en acciones críticas.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {configurableUsers.length > 0 && selectedUser && selectedAccess && permissionState ? (
            <>
              <div className="grid gap-3 lg:grid-cols-[1fr_1fr_220px]">
                <div className="space-y-2">
                  <Label>Usuario</Label>
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
                      <SelectValue placeholder="Seleccionar usuario" />
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
                  <Label>Campaña</Label>
                  <Select
                    value={selectedAccess.campaign.id}
                    onValueChange={(value) => {
                      if (!value) return;
                      setSelectedCampaignId(value);
                      setDraft(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar campaña" />
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
                  <Label>Nivel operativo</Label>
                  <Select
                    value={roleInCampaign}
                    onValueChange={(value) => {
                      if (!value) return;
                      const nextRole = value as CampaignAccessLevel;
                      setPermissionDraft(nextRole, getCampaignAccessPreset(nextRole));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Nivel" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CAMPAIGN_ACCESS_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                {PERMISSION_GROUPS.map((group) => (
                  <div key={group.title} className="rounded-lg border p-3">
                    <div className="mb-3 text-sm font-medium">{group.title}</div>
                    <div className="space-y-2">
                      {group.keys.map((permissionKey) => {
                        const checkboxId = `${selectedUser.id}-${selectedAccess.campaign.id}-${permissionKey}`;
                        return (
                          <div key={permissionKey} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              id={checkboxId}
                              checked={permissionState[permissionKey]}
                              onCheckedChange={(checked) =>
                                setPermissionDraft(roleInCampaign, {
                                  ...permissionState,
                                  [permissionKey]: Boolean(checked),
                                })
                              }
                            />
                            <label htmlFor={checkboxId}>
                              {CAMPAIGN_PERMISSION_LABELS[permissionKey]}
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
                  {hasDraft
                    ? "Hay cambios pendientes para esta campa�a."
                    : "Los permisos mostrados son los guardados actualmente."}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDraft(null)}
                    disabled={!hasDraft || savingAccess}
                  >
                    Descartar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveAccess}
                    disabled={!hasDraft || savingAccess}
                  >
                    {savingAccess ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    Guardar permisos
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              Asigna un usuario QA a una campaña para configurar permisos granulares.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-orange-500" />
              Cobertura por campaña
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
                  <Badge variant="outline">{campaign.assignedUsers} asignados</Badge>
                </div>
              ))}
              {campaignStats.length === 0 && (
                <p className="text-sm text-muted-foreground">No hay campañas registradas.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-orange-500" />
              Mapa operativo
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <PermissionSummary
              icon={<BarChart3 className="h-4 w-4" />}
              title="Dashboard & KPIs"
              text="Global para QA Manager; campañas asignadas para QA."
            />
            <PermissionSummary
              icon={<ClipboardCheck className="h-4 w-4" />}
              title="Evaluaciones"
              text="QA puede evaluar agentes solo dentro de su campaña."
            />
            <PermissionSummary
              icon={<FileSpreadsheet className="h-4 w-4" />}
              title="Reportes"
              text="La exportación queda limitada al scope visible."
            />
            <PermissionSummary
              icon={<Target className="h-4 w-4" />}
              title="Scoring"
              text="El scoring global permanece reservado a QA Manager."
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
  if (user.campaigns.length === 0) return "Sin campaña";

  const labels = [
    ...new Set(user.campaigns.map((access) => CAMPAIGN_ACCESS_LABELS[access.roleInCampaign])),
  ];

  return labels.length === 1 ? labels[0] : "Mixto";
}

function getEffectivePermissionsV2(user: AccessUser): string[] {
  if (!user.active) return ["Sin acceso activo"];
  if (user.role === "ADMIN") {
    return ["Usuarios", "Todas las campañas", "Scoring global", "Exportación"];
  }
  if (user.campaigns.length === 0) return ["Sin campaña asignada"];

  const hasAny = (permission: CampaignPermissionKey) =>
    user.campaigns.some((access) => access[permission]);
  const permissions: string[] = [];

  if (hasAny("canViewDashboard") || hasAny("canViewKPIs")) {
    permissions.push("Dashboard/KPIs");
  }
  if (hasAny("canCreateForms") || hasAny("canEditForms")) {
    permissions.push("Formularios");
  }
  if (hasAny("canEvaluate")) permissions.push("Evaluaciones");
  if (hasAny("canViewReports")) permissions.push("Reportes");
  if (hasAny("canExport")) permissions.push("Exportación");
  if (hasAny("canManageAgents") || hasAny("canManageDispositions")) {
    permissions.push("Operación");
  }

  return permissions.length > 0 ? permissions : ["Solo asignaci�n"];
}

function getPermissionStateFromAccess(access: AccessCampaign): CampaignPermissionState {
  return Object.fromEntries(
    CAMPAIGN_PERMISSION_KEYS.map((key) => [key, access[key]]),
  ) as CampaignPermissionState;
}

function AccountTab({ profile }: { profile: ProfileInfo }) {
  const router = useRouter();
  const [name, setName] = useState(profile.name);
  const [savingName, startSaveName] = useTransition();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, startSavePassword] = useTransition();

  const nameChanged = name.trim() !== profile.name && name.trim().length >= 2;
  const createdAtDate = new Date(profile.createdAt);

  const handleSaveName = () => {
    if (!nameChanged) return;
    startSaveName(async () => {
      try {
        await updateMyName(name);
        toast.success("Nombre actualizado");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al actualizar");
      }
    });
  };

  const handleChangePassword = () => {
    if (!currentPassword) {
      toast.error("Ingresa tu contraseña actual");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("La nueva contraseña debe tener al menos 8 caracteres");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Las contraseñas no coinciden");
      return;
    }
    startSavePassword(async () => {
      try {
        await changeMyPassword(currentPassword, newPassword);
        toast.success("Contraseña actualizada");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al cambiar contrase�a");
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Profile overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4 text-orange-500" />
            Información personal
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Read-only identity row */}
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoRow icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={profile.email} />
            <InfoRow
              icon={<Shield className="h-3.5 w-3.5" />}
              label="Rol"
              value={
                <Badge variant={profile.role === "ADMIN" ? "default" : "secondary"}>
                  {profile.role === "ADMIN" ? "QA Manager" : "QA campa�a"}
                </Badge>
              }
            />
            <InfoRow
              icon={<Building2 className="h-3.5 w-3.5" />}
              label="Campañas asignadas"
              value={
                profile.role === "ADMIN" ? (
                  <Badge variant="outline">Todas las campañas</Badge>
                ) : profile.campaigns.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {profile.campaigns.map((campaign) => (
                      <Badge key={campaign.id} variant="outline" className="text-xs">
                        {campaign.name}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">Sin campañas</span>
                )
              }
            />
            <InfoRow
              icon={<CalendarDays className="h-3.5 w-3.5" />}
              label="Miembro desde"
              value={createdAtDate.toLocaleDateString("es-ES", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            />
          </div>

          <Separator />

          {/* Editable name */}
          <div className="space-y-2">
            <Label htmlFor="profile-name">Nombre completo</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                className="sm:max-w-sm"
              />
              <Button onClick={handleSaveName} disabled={!nameChanged || savingName} size="sm">
                {savingName ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Guardar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Entre 2 y 100 caracteres.</p>
          </div>
        </CardContent>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-orange-500" />
            Cambiar contraseña
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!profile.hasPassword ? (
            <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Esta cuenta usa inicio de sesión externo (SSO) y no tiene contraseña.</p>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2 sm:max-w-sm">
                  <Label htmlFor="current-password">Contraseña actual</Label>
                  <Input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">Nueva contraseña</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirmar contraseña</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Mínimo 8 caracteres. No compartas tu contraseña con nadie.
              </p>
              <div className="flex justify-end">
                <Button
                  onClick={handleChangePassword}
                  disabled={
                    savingPassword ||
                    !currentPassword ||
                    newPassword.length < 8 ||
                    newPassword !== confirmPassword
                  }
                  size="sm"
                >
                  {savingPassword ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <KeyRound className="h-3.5 w-3.5" />
                  )}
                  Actualizar contraseña
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//   Scoring tab (admin only)
// ══════════════════════════════════════════════════════════════════════════
function ScoringTab({ settings }: { settings: AppSettings }) {
  const router = useRouter();
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
        toast.success("Parámetros de scoring actualizados");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al guardar");
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
        toast.success("Valores restaurados a los predeterminados");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al restaurar");
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-200">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium">Estos valores afectan a toda la aplicación</p>
          <p className="text-xs opacity-90">
            Los cambios se aplican inmediatamente en Dashboard, Reports y KPIs. Las evaluaciones
            anteriores no se recalculan - el umbral solo afecta a cómo se cuentan de ahora en
            adelante.
          </p>
        </div>
      </div>

      {/* Pass threshold */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-orange-500" />
            Umbral de aprobación (Pass Threshold)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="pass-threshold">
                Score mínimo para considerar una evaluación como <b>Pass</b>
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
          <p className="text-xs text-muted-foreground">Por defecto: 70%. Rango válido: 0-100.</p>
        </CardContent>
      </Card>

      {/* Targets */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-orange-500" />
            Targets globales
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <PctTargetField
            id="target-pass-rate"
            label="Target Pass Rate"
            description="% mínimo de evaluaciones que deben ser Pass. Dispara badge verde en KPIs."
            value={targetPassRate}
            onChange={setTargetPassRate}
            defaultValue={85}
          />
          <PctTargetField
            id="target-avg-score"
            label="Target Score Promedio"
            description="Score promedio global mínimo esperado."
            value={targetAvgScore}
            onChange={setTargetAvgScore}
            defaultValue={80}
          />
          <div className="space-y-2">
            <Label htmlFor="target-daily-rate">Target evaluaciones diarias</Label>
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
              <span className="text-sm text-muted-foreground">/ día</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Por defecto: 20. Número mínimo de evaluaciones que el equipo debe realizar
              diariamente.
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
          Restaurar valores por defecto
        </Button>
        <Button onClick={handleSave} disabled={!dirty || saving || resetting}>
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Guardar cambios
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
        });
        setDrafts((current) => ({ ...current, [selectedCampaignId]: saved }));
        toast.success("Scoring de campaña actualizado");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al guardar");
      }
    });
  };

  if (campaigns.length === 0 || !draft) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          No hay campañas disponibles para configurar.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-200">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="text-xs leading-relaxed">
          Los overrides aplican solo a la campaña seleccionada. Si usa defaults globales, Dashboard,
          KPIs y reportes toman los valores del scoring global.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-orange-500" />
            Configuración por campaña
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="space-y-2">
              <Label>Campaña</Label>
              <Select
                value={selectedCampaignId}
                onValueChange={(value) => {
                  if (!value) return;
                  setSelectedCampaignId(value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar campaña" />
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
                  <div className="text-sm font-medium">{selectedCampaign?.name ?? "Campa�a"}</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Controla thresholds y metas operativas para esta campaña.
                  </p>
                </div>
                <Badge variant={usesGlobalDefaults ? "secondary" : "default"}>
                  {usesGlobalDefaults ? "Usa global" : "Override activo"}
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
                  Esta campaña usa valores personalizados
                </Label>
              </div>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <PctTargetField
              id="campaign-pass-threshold"
              label="Pass Threshold"
              description="Score mínimo para aprobar evaluaciones de esta campaña."
              value={draft.passThreshold}
              onChange={(value) => setDraftValue("passThreshold", value)}
              defaultValue={70}
            />
            <PctTargetField
              id="campaign-target-score"
              label="Target Score Promedio"
              description="Score promedio esperado para la campaña."
              value={draft.targetAvgScore}
              onChange={(value) => setDraftValue("targetAvgScore", value)}
              defaultValue={80}
            />
            <PctTargetField
              id="campaign-target-pass-rate"
              label="Target Pass Rate"
              description="Porcentaje objetivo de evaluaciones aprobadas."
              value={draft.targetPassRate}
              onChange={(value) => setDraftValue("targetPassRate", value)}
              defaultValue={85}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="campaign-target-daily">Evaluaciones diarias</Label>
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
                <Label htmlFor="campaign-fatal-allowed">Fallas fatales permitidas</Label>
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
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={!dirty || saving}>
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Guardar scoring de campaña
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function QACategoriesTab({ categories }: { categories: QACategorySummary[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="h-4 w-4 text-orange-500" />
          Categorías QA
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Categorías globales para estructurar formularios, pesos, fallas fatales y KPIs críticos.
          El color e icono quedan controlados por sistema.
        </p>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Categoría</TableHead>
                <TableHead>Uso</TableHead>
                <TableHead>Reglas</TableHead>
                <TableHead>Visibilidad</TableHead>
                <TableHead>Estado</TableHead>
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
                  <TableCell>{category.usageCount} formularios</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {category.canBeFatal && <Badge variant="destructive">Fatal</Badge>}
                      {category.requiresCommentOnFail && (
                        <Badge variant="secondary">Comentario requerido</Badge>
                      )}
                      {!category.canBeFatal && !category.requiresCommentOnFail && (
                        <span className="text-xs text-muted-foreground">Operativa</span>
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
                      {category.isActive ? "Activa" : "Inactiva"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {categories.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                    Aplica la migración de categorías QA para ver el catálogo base.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function EvaluationRulesTab({ settings }: { settings: OperationalSettings | null }) {
  return (
    <OperationalConfigSection
      sectionKey="evaluations"
      settings={settings}
      icon={<ClipboardCheck className="h-4 w-4 text-orange-500" />}
      title="Evaluaciones"
      description="Reglas server-side y controles operativos que gobiernan el envío de evaluaciones."
      items={[
        {
          key: "campaignConsistency",
          label: "Consistencia de campaña",
          detail: "Formulario, agente y disposición deben pertenecer a la misma campaña.",
          badge: "Enforced",
          locked: true,
        },
        {
          key: "answerValidation",
          label: "Validación de respuestas",
          detail: "Preguntas requeridas, opciones válidas y duplicados se validan en servidor.",
          badge: "Enforced",
          locked: true,
        },
        {
          key: "answerScoring",
          label: "Score por respuesta",
          detail: "El modelo guarda score, comentario y falla fatal por respuesta.",
          badge: "Modelo listo",
          locked: true,
        },
        {
          key: "advancedEvaluationFlow",
          label: "Flujo avanzado de evaluación",
          detail:
            "Habilita la preparación operativa para borradores, resumen por categoría y comentarios por falla.",
          badge: "Configurable",
        },
      ]}
    />
  );
}

function FormsConfigTab({ settings }: { settings: OperationalSettings | null }) {
  return (
    <OperationalConfigSection
      sectionKey="forms"
      settings={settings}
      icon={<ClipboardCheck className="h-4 w-4 text-orange-500" />}
      title="Formularios"
      description="Defaults y reglas de publicación para el builder de formularios."
      items={[
        {
          key: "formStates",
          label: "Estados de formulario",
          detail: "La base de datos soporta borrador, publicación, archivo y versión.",
          badge: "Modelo listo",
          locked: true,
        },
        {
          key: "qaStructure",
          label: "Estructura QA",
          detail:
            "Cada pregunta puede ligar categoría QA, peso, regla fatal y comentario requerido.",
          badge: "Modelo listo",
          locked: true,
        },
        {
          key: "publishedRevision",
          label: "Edición de publicados",
          detail: "Los formularios publicados conservan historial creando una nueva versión.",
          badge: "Configurable",
        },
        {
          key: "weightValidation",
          label: "Validación de pesos",
          detail:
            "La publicación valida pesos completos y vista previa antes de activar el formulario.",
          badge: "Configurable",
        },
      ]}
    />
  );
}

function DashboardKpisTab({ settings }: { settings: OperationalSettings | null }) {
  return (
    <OperationalConfigSection
      sectionKey="dashboardKpis"
      settings={settings}
      icon={<BarChart3 className="h-4 w-4 text-orange-500" />}
      title="Dashboard & KPIs"
      description="Visibilidad operativa por rol y widgets que deben mantenerse bajo control de backend."
      items={[
        {
          key: "managerGlobalView",
          label: "Vista QA Manager",
          detail: "Acceso global a campañas, comparativos y alertas operativas.",
          badge: "Enforced",
          locked: true,
        },
        {
          key: "campaignQaView",
          label: "Vista QA de campaña",
          detail: "Lectura limitada a campañas asignadas y permisos efectivos.",
          badge: "Enforced",
          locked: true,
        },
        {
          key: "supervisorView",
          label: "Vista Supervisor",
          detail: "Lectura de tendencias, coaching y evaluaciones dentro de su campaña.",
          badge: "Configurable",
        },
        {
          key: "widgetPreferences",
          label: "Preferencias por widget",
          detail: "Persistencia de preferencias por rol y campaña cuando se habilite la matriz.",
          badge: "Configurable",
        },
      ]}
    />
  );
}

function ReportsExportTab({ settings }: { settings: OperationalSettings | null }) {
  return (
    <OperationalConfigSection
      sectionKey="reportsExport"
      settings={settings}
      icon={<FileSpreadsheet className="h-4 w-4 text-orange-500" />}
      title="Reportes & Exportación"
      description="Reglas de privacidad y trazabilidad para reportes operativos."
      items={[
        {
          key: "scopedExports",
          label: "Scope de exportación",
          detail: "Un usuario solo exporta lo que puede ver según permisos de campaña.",
          badge: "Enforced",
          locked: true,
        },
        {
          key: "exportAudit",
          label: "Auditoría de salidas",
          detail: "Exportaciones CSV, Excel y JSON quedan registradas en auditoría operativa.",
          badge: "Enforced",
          locked: true,
        },
        {
          key: "supervisorExports",
          label: "Exportación supervisor",
          detail: "Supervisor no exporta por defecto salvo permiso especial por campaña.",
          badge: "Configurable",
        },
        {
          key: "fieldSelection",
          label: "Campos exportables",
          detail: "La selección de campos respeta privacidad de agente, evaluador y comentarios.",
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

  const moduleOptions = useMemo(
    () => uniqueOptions(auditPage.events.map((event) => event.module)),
    [auditPage.events],
  );
  const actionOptions = useMemo(
    () => uniqueOptions(auditPage.events.map((event) => event.action)),
    [auditPage.events],
  );

  const loadPage = (page: number) => {
    startLoading(async () => {
      try {
        const nextPage = await readOperationalAudit({
          ...filters,
          page,
          pageSize: filters.pageSize,
        });
        setAuditPage(nextPage);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Error al leer auditoría");
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
    startLoading(async () => {
      const nextPage = await readOperationalAudit({
        ...nextFilters,
        page: 1,
        pageSize: nextFilters.pageSize,
      });
      setAuditPage(nextPage);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-orange-500" />
          Auditoría operativa
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Eventos sensibles registrados desde servidor: permisos, scoring, formularios,
          evaluaciones, exportaciones y operación de campaña.
        </p>

        <div className="grid gap-3 rounded-lg border p-3 lg:grid-cols-[1.2fr_150px_150px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              value={filters.query}
              onChange={(event) =>
                setFilters((current) => ({ ...current, query: event.target.value }))
              }
              placeholder="Buscar usuario, campaña, entidad o impacto"
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
              <SelectValue placeholder="Módulo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los módulos</SelectItem>
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
              <SelectValue placeholder="Acción" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las acciones</SelectItem>
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
              <SelectValue placeholder="Campaña" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las campañas</SelectItem>
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
              <SelectValue placeholder="Usuario" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los usuarios</SelectItem>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              type="date"
              value={filters.dateFrom}
              onChange={(event) =>
                setFilters((current) => ({ ...current, dateFrom: event.target.value }))
              }
              aria-label="Fecha desde"
            />
            <Input
              type="date"
              value={filters.dateTo}
              onChange={(event) =>
                setFilters((current) => ({ ...current, dateTo: event.target.value }))
              }
              aria-label="Fecha hasta"
            />
          </div>
          <div className="flex flex-wrap gap-2 lg:col-span-3">
            <Button type="button" onClick={() => loadPage(1)} disabled={loading}>
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Filter className="h-3.5 w-3.5" />
              )}
              Aplicar filtros
            </Button>
            <Button type="button" variant="outline" onClick={resetFilters}>
              <X className="h-3.5 w-3.5" />
              Limpiar
            </Button>
          </div>
        </div>

        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Usuario</TableHead>
                <TableHead>Campaña</TableHead>
                <TableHead>Módulo</TableHead>
                <TableHead>Acción</TableHead>
                <TableHead>Impacto</TableHead>
                <TableHead className="text-right">Detalle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {auditPage.events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatAuditDate(event.createdAt)}
                  </TableCell>
                  <TableCell>{event.userName ?? "Sistema"}</TableCell>
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
                      Ver
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {auditPage.events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    No hay eventos para los filtros seleccionados.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            Página {auditPage.page} de {auditPage.pageCount} · {auditPage.total} evento(s)
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
              Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={auditPage.page >= auditPage.pageCount || loading}
              onClick={() => loadPage(auditPage.page + 1)}
            >
              Siguiente
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <Dialog open={Boolean(selectedEvent)} onOpenChange={() => setSelectedEvent(null)}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Detalle de auditoría</DialogTitle>
            </DialogHeader>
            {selectedEvent && <AuditEventDetail event={selectedEvent} />}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function NotificationsTab({ settings }: { settings: OperationalSettings | null }) {
  return (
    <OperationalConfigSection
      sectionKey="notifications"
      settings={settings}
      icon={<MessageSquareWarning className="h-4 w-4 text-orange-500" />}
      title="Notificaciones"
      description="Alertas operativas para riesgos de calidad por campaña."
      items={[
        {
          key: "criticalEvaluation",
          label: "Criticidad de evaluación",
          detail: "Customer Critical o Compliance Critical fallido.",
          badge: "In-app",
        },
        {
          key: "agentRisk",
          label: "Riesgo por agente",
          detail: "Agente debajo del threshold o categoría crítica bajo target.",
          badge: "In-app",
        },
        {
          key: "campaignRisk",
          label: "Riesgo por campaña",
          detail: "Campaña debajo de target pass rate o QA bajo meta diaria.",
          badge: "In-app",
        },
        {
          key: "recipientMatrix",
          label: "Destinatarios",
          detail: "Matriz de QA Manager, QA de campaña y Supervisor con scope por campaña.",
          badge: "Gobernado",
        },
      ]}
    />
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
  sectionKey,
  settings,
  icon,
  title,
  description,
  items,
}: {
  sectionKey: keyof OperationalSettings;
  settings: OperationalSettings | null;
  icon: React.ReactNode;
  title: string;
  description: string;
  items: OperationalConfigItem[];
}) {
  const router = useRouter();
  const effectiveSettings = settings ?? DEFAULT_OPERATIONAL_SETTINGS;
  const initialSection = effectiveSettings[sectionKey] as unknown as Record<string, boolean>;
  const [baseline, setBaseline] = useState<Record<string, boolean>>(initialSection);
  const [draft, setDraft] = useState<Record<string, boolean>>(initialSection);
  const [saving, startSaving] = useTransition();
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  const updateDraft = (key: string, value: boolean) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const saveSection = (nextDraft = draft) => {
    startSaving(async () => {
      try {
        const saved = await updateOperationalSettings({
          [sectionKey]: nextDraft,
        } as OperationalSettingsPatch);
        const savedSection = saved[sectionKey] as unknown as Record<string, boolean>;
        setBaseline(savedSection);
        setDraft(savedSection);
        toast.success("Controles operativos guardados");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Error al guardar");
      }
    });
  };

  const resetSection = () => {
    const defaults = DEFAULT_OPERATIONAL_SETTINGS[sectionKey] as unknown as Record<string, boolean>;
    setDraft(defaults);
    saveSection(defaults);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((item) => {
            const enabled = Boolean(draft[item.key]);

            return (
              <div key={item.key} className="rounded-lg border p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <Switch
                    size="sm"
                    checked={enabled}
                    disabled={item.locked}
                    aria-label={item.label}
                    onCheckedChange={(checked) => updateDraft(item.key, Boolean(checked))}
                  />
                  <Badge variant={enabled ? "default" : "secondary"}>
                    {item.locked ? item.badge : enabled ? "Activo" : item.badge}
                  </Badge>
                </div>
                <div className="text-sm font-medium">{item.label}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={resetSection} disabled={saving}>
            <RotateCcw className="h-3.5 w-3.5" />
            Restaurar sección
          </Button>
          <Button type="button" onClick={() => saveSection()} disabled={!dirty || saving}>
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Guardar controles
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AuditEventDetail({ event }: { event: OperationalAuditEvent }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <DetailItem label="Fecha" value={formatAuditDate(event.createdAt)} />
        <DetailItem label="Usuario" value={event.userName ?? "Sistema"} />
        <DetailItem label="Campaña" value={event.campaignName ?? "Global"} />
        <DetailItem label="Entidad" value={event.entityType ?? "-"} />
      </div>
      <div className="rounded-lg border p-3">
        <div className="text-xs font-medium uppercase text-muted-foreground">Impacto</div>
        <p className="mt-1 text-sm">{event.impact ?? "Sin impacto registrado."}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <JsonPanel title="Antes" value={event.beforeValue} />
        <JsonPanel title="Después" value={event.afterValue} />
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

  return (
    <div className="min-w-0 rounded-lg border">
      <div className="border-b px-3 py-2 text-sm font-medium">{title}</div>
      {text ? (
        <pre className="max-h-80 overflow-auto p-3 text-xs leading-relaxed">{text}</pre>
      ) : (
        <div className="p-3 text-sm text-muted-foreground">Sin datos registrados.</div>
      )}
    </div>
  );
}

function formatAuditDate(value: string) {
  return new Date(value).toLocaleString("es-ES", {
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
        {description} Por defecto: {defaultValue}%.
      </p>
    </div>
  );
}

function clampPct(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
