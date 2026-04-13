"use server";

import { updateTag, revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
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

  return getSettings();
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
