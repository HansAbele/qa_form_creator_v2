"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  Settings as SettingsIcon,
  User,
  Target,
  KeyRound,
  Mail,
  Shield,
  Building2,
  CalendarDays,
  Save,
  RotateCcw,
  Loader2,
  Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { updateMyName, changeMyPassword, type ProfileInfo } from "@/server/actions/profile";
import {
  updateSettings,
  resetSettings,
} from "@/server/actions/settings";
import type { AppSettings } from "@/lib/settings";

interface SettingsClientProps {
  profile: ProfileInfo;
  settings: AppSettings;
  isAdmin: boolean;
}

export function SettingsClient({ profile, settings, isAdmin }: SettingsClientProps) {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
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
          Gestiona tu cuenta{isAdmin ? " y los parámetros globales de scoring." : "."}
        </p>
      </motion.div>

      {/* Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
      >
        <Tabs defaultValue="account" className="gap-6">
          <TabsList variant="line" className="w-full justify-start gap-4 border-b border-border/60">
            <TabsTrigger value="account" className="gap-2">
              <User className="h-4 w-4" />
              Mi Cuenta
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="scoring" className="gap-2">
                <Target className="h-4 w-4" />
                Scoring
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="account">
            <AccountTab profile={profile} />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="scoring">
              <ScoringTab settings={settings} />
            </TabsContent>
          )}
        </Tabs>
      </motion.div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
//   My Account tab
// ══════════════════════════════════════════════════════════════════════════
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
                  {profile.role === "ADMIN" ? "Administrador" : "QA"}
                </Badge>
              }
            />
            <InfoRow
              icon={<Building2 className="h-3.5 w-3.5" />}
              label="Campañas asignadas"
              value={<span className="tabular-nums">{profile.campaignCount}</span>}
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
