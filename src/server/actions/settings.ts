"use server";

import { updateTag, revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { writeAuditLog } from "@/server/audit-log";
import {
  DEFAULT_SETTINGS,
  getSettings,
  validateSetting,
  type AppSettings,
  type SettingKey,
} from "@/lib/settings";

/** Read all settings (for server components). */
export async function readSettings(): Promise<AppSettings> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  return getSettings();
}

/** Update multiple settings at once (ADMIN only). */
export async function updateSettings(
  patch: Partial<Record<SettingKey, number>>,
): Promise<AppSettings> {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("Unauthorized");
  }

  const userId = session.user.id;
  const keys = Object.keys(patch) as SettingKey[];

  if (keys.length === 0) return getSettings();
  const beforeSettings = await getSettings();

  // Validate all before writing (all-or-nothing)
  const validated: { key: SettingKey; value: number }[] = [];
  for (const k of keys) {
    if (!(k in DEFAULT_SETTINGS)) {
      throw new Error(`Unknown setting key: ${k}`);
    }
    const v = validateSetting(k, patch[k]);
    validated.push({ key: k, value: v });
  }

  const afterSettings: AppSettings = {
    ...beforeSettings,
    ...Object.fromEntries(validated.map(({ key, value }) => [key, value])),
  };

  await prisma.$transaction(async (tx) => {
    for (const { key, value } of validated) {
      await tx.appSetting.upsert({
        where: { key },
        create: { key, value, updatedBy: userId },
        update: { value, updatedBy: userId },
      });
    }
    await writeAuditLog(
      {
        userId,
        module: "settings",
        action: "global_scoring_updated",
        entityType: "app_settings",
        beforeValue: beforeSettings,
        afterValue: afterSettings,
        impact:
          "Dashboard, KPIs, reports, and future evaluations use the new global parameters.",
      },
      tx,
    );
  });

  // Bust cache so next read picks up fresh values
  updateTag("settings");
  revalidatePath("/", "layout");

  return afterSettings;
}

/** Reset all settings back to their defaults (ADMIN only). */
export async function resetSettings(): Promise<AppSettings> {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("Unauthorized");
  }

  const patch: Record<SettingKey, number> = { ...DEFAULT_SETTINGS };
  return updateSettings(patch);
}
