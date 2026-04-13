import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";

// ─── Default values ────────────────────────────────────
// Source of truth for settings when nothing exists in DB.
// These match the values hardcoded previously across the codebase.

export interface AppSettings {
  /** Score % a partir del cual una evaluación se considera "Pass". */
  passThreshold: number;
  /** Target global de % Pass Rate que dispara badge verde en el dashboard. */
  targetPassRate: number;
  /** Target global de score promedio. */
  targetAvgScore: number;
  /** Target global de evaluaciones por día. */
  targetDailyRate: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  passThreshold: 70,
  targetPassRate: 85,
  targetAvgScore: 80,
  targetDailyRate: 20,
};

export type SettingKey = keyof AppSettings;

// ─── Zod-like runtime validation ──────────────────────
// Keeping it lightweight (no zod dep here) — enforce type + range.

const VALIDATORS: Record<SettingKey, (v: unknown) => number> = {
  passThreshold: (v) => clamp(num(v, "passThreshold"), 0, 100),
  targetPassRate: (v) => clamp(num(v, "targetPassRate"), 0, 100),
  targetAvgScore: (v) => clamp(num(v, "targetAvgScore"), 0, 100),
  targetDailyRate: (v) => clamp(num(v, "targetDailyRate"), 0, 10_000),
};

function num(v: unknown, key: string): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (typeof n !== "number" || Number.isNaN(n)) {
    throw new Error(`${key}: valor inválido, debe ser un número`);
  }
  return n;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Validate + coerce a raw input to the typed shape. */
export function validateSetting(key: SettingKey, value: unknown): number {
  const validator = VALIDATORS[key];
  if (!validator) throw new Error(`Setting key desconocido: ${key}`);
  return validator(value);
}

// ─── Cached reader ─────────────────────────────────────
// We cache for 60s with a tag so `updateTag("settings")` after an update
// forces re-read on next request.

async function loadSettingsFromDb(): Promise<AppSettings> {
  try {
    const rows = await prisma.appSetting.findMany();
    const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of rows) {
      // Prisma JSON field -> unknown
      merged[r.key] = r.value;
    }
    // Re-validate to guarantee shape (defaults are already valid)
    const out: AppSettings = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) {
      try {
        out[k] = validateSetting(k, merged[k]);
      } catch {
        out[k] = DEFAULT_SETTINGS[k];
      }
    }
    return out;
  } catch {
    // Table might not exist yet before migration — fallback to defaults.
    return { ...DEFAULT_SETTINGS };
  }
}

export const getSettings = unstable_cache(loadSettingsFromDb, ["app-settings"], {
  tags: ["settings"],
  revalidate: 60,
});

/** Convenience: read just the pass threshold (hot path in analytics queries). */
export async function getPassThreshold(): Promise<number> {
  const s = await getSettings();
  return s.passThreshold;
}
