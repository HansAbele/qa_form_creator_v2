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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "@/server/actions/settings";
import type { AppSettings } from "@/lib/settings";
import {
  CAMPAIGN_ACCESS_LABELS,
  CAMPAIGN_PERMISSION_KEYS,
  CAMPAIGN_PERMISSION_LABELS,
  getCampaignAccessPreset,
  type CampaignAccessLevel,
  type CampaignPermissionKey,
  type CampaignPermissionState,
} from "@/lib/campaign-permissions";

interface SettingsClientProps {
  profile: ProfileInfo;
  settings: AppSettings;
  isAdmin: boolean;
  accessUsers: AccessUser[];
  accessCampaigns: { id: string; name: string }[];
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
    keys: [
      "canExport",
      "canManageAgents",
      "canManageDispositions",
      "canManageCampaignScoring",
    ],
  },
];

export function SettingsClient({
  profile,
  settings,
  isAdmin,
  accessUsers,
  accessCampaigns,
}: SettingsClientProps) {
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
          <h1 className="font-heading text-3xl font-bold tracking-tight">
            Configuración
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Centro operativo para cuenta, accesos por campaña y parámetros QA.
        </p>
      </motion.div>

      {/* Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
      >
        <Tabs defaultValue="account" className="gap-6">
          <TabsList variant="line" className="w-full justify-start gap-4 overflow-x-auto border-b border-border/60">
            <TabsTrigger value="account" className="gap-2">
              <User className="h-4 w-4" />
              Mi Cuenta
            </TabsTrigger>
            {isAdmin && (
              <>
                <TabsTrigger value="access" className="gap-2">
                  <UserCog className="h-4 w-4" />
                  Accesos y permisos
                </TabsTrigger>
                <TabsTrigger value="scoring" className="gap-2">
                  <Target className="h-4 w-4" />
                  Scoring global
                </TabsTrigger>
              </>
            )}
          </TabsList>

          <TabsContent value="account">
            <AccountTab profile={profile} />
          </TabsContent>

          {isAdmin && (
            <>
              <TabsContent value="access">
                <AccessTab users={accessUsers} campaigns={accessCampaigns} />
              </TabsContent>

              <TabsContent value="scoring">
                <ScoringTab settings={settings} />
              </TabsContent>
            </>
          )}
        </Tabs>
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
  const configurableUsers = users.filter(
    (user) => user.role === "QA" && user.campaigns.length > 0,
  );
  const [selectedUserId, setSelectedUserId] = useState(
    configurableUsers[0]?.id ?? "",
  );
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
    configurableUsers.find((user) => user.id === selectedUserId) ??
    configurableUsers[0] ??
    null;
  const selectedAccess =
    selectedUser?.campaigns.find(
      (access) => access.campaign.id === selectedCampaignId,
    ) ??
    selectedUser?.campaigns[0] ??
    null;
  const selectedKey =
    selectedUser && selectedAccess
      ? `${selectedUser.id}:${selectedAccess.campaign.id}`
      : "";
  const permissionState =
    draft?.key === selectedKey && draft.permissions
      ? draft.permissions
      : selectedAccess
        ? getPermissionStateFromAccess(selectedAccess)
        : null;
  const roleInCampaign =
    draft?.key === selectedKey && draft.roleInCampaign
      ? draft.roleInCampaign
      : selectedAccess?.roleInCampaign ?? "EVALUATOR";
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
                      <div className="text-xs text-muted-foreground">
                        {user.email}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={user.role === "ADMIN" ? "default" : "secondary"}
                      >
                        {user.role === "ADMIN" ? "QA Manager" : "QA campaña"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[260px] flex-wrap gap-1">
                        {user.role === "ADMIN" ? (
                          <Badge variant="outline">Todas</Badge>
                        ) : user.campaigns.length > 0 ? (
                          user.campaigns.map(({ campaign }) => (
                            <Badge
                              key={campaign.id}
                              variant="outline"
                              className="text-xs"
                            >
                              {campaign.name}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Sin campañas
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {getAccessLevelLabelV2(user)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[360px] flex-wrap gap-1">
                        {getEffectivePermissionsV2(user).map((permission) => (
                          <Badge
                            key={permission}
                            variant="secondary"
                            className="text-xs"
                          >
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
                        <SelectItem
                          key={access.campaign.id}
                          value={access.campaign.id}
                        >
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
                      setPermissionDraft(
                        nextRole,
                        getCampaignAccessPreset(nextRole),
                      );
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Nivel" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CAMPAIGN_ACCESS_LABELS).map(
                        ([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                {PERMISSION_GROUPS.map((group) => (
                  <div key={group.title} className="rounded-lg border p-3">
                    <div className="mb-3 text-sm font-medium">{group.title}</div>
                    <div className="space-y-2">
                      {group.keys.map((permissionKey) => (
                        <label
                          key={permissionKey}
                          className="flex items-center gap-2 text-sm"
                        >
                          <Checkbox
                            checked={permissionState[permissionKey]}
                            onCheckedChange={(checked) =>
                              setPermissionDraft(roleInCampaign, {
                                ...permissionState,
                                [permissionKey]: Boolean(checked),
                              })
                            }
                          />
                          <span>{CAMPAIGN_PERMISSION_LABELS[permissionKey]}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-muted-foreground">
                  {hasDraft
                    ? "Hay cambios pendientes para esta campaña."
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
                  <span className="truncate text-sm font-medium">
                    {campaign.name}
                  </span>
                  <Badge variant="outline">
                    {campaign.assignedUsers} asignados
                  </Badge>
                </div>
              ))}
              {campaignStats.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No hay campañas registradas.
                </p>
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
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {text}
      </p>
    </div>
  );
}

function getAccessLevelLabel(user: AccessUser): string {
  if (user.role === "ADMIN") return "Global";
  if (user.campaigns.length === 0) return "Sin campaña";
  return "Admin campaña";
}

function getEffectivePermissions(user: AccessUser): string[] {
  if (!user.active) return ["Sin acceso activo"];
  if (user.role === "ADMIN") {
    return ["Usuarios", "Todas las campañas", "Scoring global", "Exportación"];
  }
  if (user.campaigns.length === 0) return ["Sin campaña asignada"];
  return ["Dashboard/KPIs", "Formularios", "Evaluaciones", "Reportes"];
}

function getAccessLevelLabelV2(user: AccessUser): string {
  if (user.role === "ADMIN") return "Global";
  if (user.campaigns.length === 0) return "Sin campaña";

  const labels = [
    ...new Set(
      user.campaigns.map(
        (access) => CAMPAIGN_ACCESS_LABELS[access.roleInCampaign],
      ),
    ),
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

  return permissions.length > 0 ? permissions : ["Solo asignación"];
}

function getPermissionStateFromAccess(
  access: AccessCampaign,
): CampaignPermissionState {
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
        toast.error(e instanceof Error ? e.message : "Error al cambiar contraseña");
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
            <InfoRow
              icon={<Mail className="h-3.5 w-3.5" />}
              label="Email"
              value={profile.email}
            />
            <InfoRow
              icon={<Shield className="h-3.5 w-3.5" />}
              label="Rol"
              value={
                <Badge variant={profile.role === "ADMIN" ? "default" : "secondary"}>
                  {profile.role === "ADMIN" ? "QA Manager" : "QA campaña"}
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
              <Button
                onClick={handleSaveName}
                disabled={!nameChanged || savingName}
                size="sm"
              >
                {savingName ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Guardar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Entre 2 y 100 caracteres.
            </p>
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
              <p>
                Esta cuenta usa inicio de sesión externo (SSO) y no tiene contraseña.
              </p>
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
            Los cambios se aplican inmediatamente en Dashboard, Reports y KPIs.
            Las evaluaciones anteriores no se recalculan — el umbral solo afecta a cómo se cuentan de ahora en adelante.
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
          <p className="text-xs text-muted-foreground">
            Por defecto: 70%. Rango válido: 0–100.
          </p>
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
                  setTargetDailyRate(
                    Math.max(0, Math.min(10000, Number(e.target.value) || 0)),
                  )
                }
                className="w-28 text-right tabular-nums"
              />
              <span className="text-sm text-muted-foreground">/ día</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Por defecto: 20. Número mínimo de evaluaciones que el equipo debe realizar diariamente.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          disabled={resetting || saving}
        >
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
