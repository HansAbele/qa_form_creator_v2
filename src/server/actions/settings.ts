"use server";

import { updateTag, revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { writeAuditLog } from "@/server/audit-log";
import { emitNotification } from "@/server/notifications";
import type { Prisma } from "@prisma/client";
import {
  DEFAULT_SETTINGS,
  DEFAULT_OPERATIONAL_SETTINGS,
  getSettings,
  mergeOperationalSettingsPatch,
  sanitizeOperationalSettings,
  validateSetting,
  type AppSettings,
  type OperationalSettings,
  type OperationalSettingsPatch,
  type SettingKey,
} from "@/lib/settings";

const OPERATIONAL_SETTINGS_KEY = "operationalConfig";

/** Read all settings (for server components). */
export async function readSettings(): Promise<AppSettings> {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");
  return getSettings();
}

/** Update multiple settings at once (ADMIN only). */
export async function updateSettings(
  patch: Partial<Record<SettingKey, number>>,
): Promise<AppSettings> {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("No autorizado");
  }

  const userId = session.user.id;
  const keys = Object.keys(patch) as SettingKey[];

  if (keys.length === 0) return getSettings();
  const beforeSettings = await getSettings();

  // Validate all before writing (all-or-nothing)
  const validated: { key: SettingKey; value: number }[] = [];
  for (const k of keys) {
    if (!(k in DEFAULT_SETTINGS)) {
      throw new Error(`Setting key desconocido: ${k}`);
    }
    const v = validateSetting(k, patch[k]);
    validated.push({ key: k, value: v });
  }

  await prisma.$transaction(
    validated.map(({ key, value }) =>
      prisma.appSetting.upsert({
        where: { key },
        create: { key, value, updatedBy: userId },
        update: { value, updatedBy: userId },
      }),
    ),
  );

  // Bust cache so next read picks up fresh values
  updateTag("settings");
  revalidatePath("/", "layout");

  const afterSettings = await getSettings();
  await writeAuditLog({
    userId,
    module: "settings",
    action: "global_scoring_updated",
    entityType: "app_settings",
    beforeValue: beforeSettings,
    afterValue: afterSettings,
    impact: "Dashboard, KPIs, reportes y evaluaciones futuras usan los nuevos parametros globales.",
  });

  await emitNotification({
    type: "settings_changed",
    severity: "INFO",
    title: "Settings globales actualizados",
    body: "Los targets globales de scoring fueron actualizados.",
    href: "/settings",
    entityType: "app_settings",
    metadata: { beforeSettings, afterSettings },
  });

  return afterSettings;
}

/** Reset all settings back to their defaults (ADMIN only). */
export async function resetSettings(): Promise<AppSettings> {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("No autorizado");
  }

  const patch: Record<SettingKey, number> = { ...DEFAULT_SETTINGS };
  return updateSettings(patch);
}

export async function readOperationalSettings(): Promise<OperationalSettings> {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const row = await prisma.appSetting.findUnique({
    where: { key: OPERATIONAL_SETTINGS_KEY },
    select: { value: true },
  });

  return sanitizeOperationalSettings(row?.value);
}

export async function updateOperationalSettings(
  patch: OperationalSettingsPatch,
): Promise<OperationalSettings> {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("No autorizado");
  }

  const beforeSettings = await readOperationalSettings();
  const afterSettings = mergeOperationalSettingsPatch(beforeSettings, patch);

  await prisma.appSetting.upsert({
    where: { key: OPERATIONAL_SETTINGS_KEY },
    create: {
      key: OPERATIONAL_SETTINGS_KEY,
      value: afterSettings as unknown as Prisma.InputJsonValue,
      updatedBy: session.user.id,
    },
    update: {
      value: afterSettings as unknown as Prisma.InputJsonValue,
      updatedBy: session.user.id,
    },
  });

  updateTag("settings");
  revalidatePath("/settings");

  await writeAuditLog({
    userId: session.user.id,
    module: "settings",
    action: "operational_controls_updated",
    entityType: "app_settings",
    entityId: OPERATIONAL_SETTINGS_KEY,
    beforeValue: beforeSettings,
    afterValue: afterSettings,
    impact:
      "Controles operativos de Settings actualizados para evaluaciones, formularios, KPIs, reportes y notificaciones.",
  });

  await emitNotification({
    type: "settings_changed",
    severity: "INFO",
    title: "Controles operativos actualizados",
    body: "La configuracion operativa de Settings fue actualizada.",
    href: "/settings",
    entityType: "app_settings",
    entityId: OPERATIONAL_SETTINGS_KEY,
    metadata: { beforeSettings, afterSettings },
  });

  return afterSettings;
}

export async function resetOperationalSettings(): Promise<OperationalSettings> {
  return updateOperationalSettings(DEFAULT_OPERATIONAL_SETTINGS);
}
