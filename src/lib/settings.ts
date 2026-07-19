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

/** COPC 2.7.1.d default Critical Error Accuracy benchmarks (%). */
export const DEFAULT_CEA_TARGETS = {
  customerCeaTarget: 95,
  businessCeaTarget: 90,
  complianceCeaTarget: 99.5,
} as const;

export type SettingKey = keyof AppSettings;

export interface CampaignScoringSettings extends AppSettings {
  campaignId: string;
  usesGlobalDefaults: boolean;
  fatalFailuresAllowed: number;
  /** When a critical/fatal question fails: true → force score to 0; false → keep score, mark FAIL. */
  fatalZeroesScore: boolean;
  /** COPC 2.7.1.d Critical Error Accuracy benchmarks (%) per family. */
  customerCeaTarget: number;
  businessCeaTarget: number;
  complianceCeaTarget: number;
}

export type CampaignScoringPatch = Partial<
  AppSettings & {
    usesGlobalDefaults: boolean;
    fatalFailuresAllowed: number;
    fatalZeroesScore: boolean;
    customerCeaTarget: number;
    businessCeaTarget: number;
    complianceCeaTarget: number;
  }
>;

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
    throw new Error(`${key}: invalid value; a number is required`);
  }
  return n;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Validate + coerce a raw input to the typed shape. */
export function validateSetting(key: SettingKey, value: unknown): number {
  const validator = VALIDATORS[key];
  if (!validator) throw new Error(`Unknown setting key: ${key}`);
  return validator(value);
}

export function validateCampaignScoringPatch(patch: CampaignScoringPatch): CampaignScoringPatch {
  const validated: CampaignScoringPatch = {};

  if (patch.usesGlobalDefaults !== undefined) {
    validated.usesGlobalDefaults = Boolean(patch.usesGlobalDefaults);
  }

  for (const key of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) {
    if (patch[key] !== undefined) {
      validated[key] = validateSetting(key, patch[key]);
    }
  }

  if (patch.fatalFailuresAllowed !== undefined) {
    validated.fatalFailuresAllowed = clamp(
      num(patch.fatalFailuresAllowed, "fatalFailuresAllowed"),
      0,
      100,
    );
  }

  if (patch.fatalZeroesScore !== undefined) {
    validated.fatalZeroesScore = Boolean(patch.fatalZeroesScore);
  }

  for (const key of ["customerCeaTarget", "businessCeaTarget", "complianceCeaTarget"] as const) {
    if (patch[key] !== undefined) {
      validated[key] = clamp(num(patch[key], key), 0, 100);
    }
  }

  return validated;
}

// ─── Cached reader ─────────────────────────────────────
// We cache for 60s with a tag so `updateTag("settings")` after an update
// forces re-read on next request.

async function loadSettingsFromDb(): Promise<AppSettings> {
  const rows = await prisma.appSetting.findMany();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    merged[row.key] = row.value;
  }

  const settings: AppSettings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) {
    settings[key] = validateSetting(key, merged[key]);
  }
  return settings;
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

type CampaignScoringRow = {
  campaignId: string;
  usesGlobalDefaults: boolean;
  passThreshold: number;
  targetPassRate: number;
  targetAvgScore: number;
  targetDailyRate: number;
  fatalFailuresAllowed: number;
  fatalZeroesScore: boolean;
  customerCeaTarget?: number | null;
  businessCeaTarget?: number | null;
  complianceCeaTarget?: number | null;
};

function mergeCampaignScoring(
  campaignId: string,
  globalSettings: AppSettings,
  row?: CampaignScoringRow | null,
): CampaignScoringSettings {
  if (!row || row.usesGlobalDefaults) {
    return {
      campaignId,
      ...globalSettings,
      usesGlobalDefaults: true,
      fatalFailuresAllowed: row?.fatalFailuresAllowed ?? 0,
      fatalZeroesScore: row?.fatalZeroesScore ?? false,
      customerCeaTarget: row?.customerCeaTarget ?? DEFAULT_CEA_TARGETS.customerCeaTarget,
      businessCeaTarget: row?.businessCeaTarget ?? DEFAULT_CEA_TARGETS.businessCeaTarget,
      complianceCeaTarget: row?.complianceCeaTarget ?? DEFAULT_CEA_TARGETS.complianceCeaTarget,
    };
  }

  return {
    campaignId,
    usesGlobalDefaults: false,
    passThreshold: row.passThreshold,
    targetPassRate: row.targetPassRate,
    targetAvgScore: row.targetAvgScore,
    targetDailyRate: row.targetDailyRate,
    fatalFailuresAllowed: row.fatalFailuresAllowed,
    fatalZeroesScore: row.fatalZeroesScore ?? false,
    customerCeaTarget: row.customerCeaTarget ?? DEFAULT_CEA_TARGETS.customerCeaTarget,
    businessCeaTarget: row.businessCeaTarget ?? DEFAULT_CEA_TARGETS.businessCeaTarget,
    complianceCeaTarget: row.complianceCeaTarget ?? DEFAULT_CEA_TARGETS.complianceCeaTarget,
  };
}

export async function getCampaignScoringSettings(
  campaignId: string,
): Promise<CampaignScoringSettings> {
  const globalSettings = await getSettings();
  const row = await prisma.campaignScoringSettings.findUnique({ where: { campaignId } });
  return mergeCampaignScoring(campaignId, globalSettings, row);
}

export async function getCampaignScoringSettingsMap(campaignIds: string[]) {
  const uniqueCampaignIds = [...new Set(campaignIds.filter(Boolean))];
  if (uniqueCampaignIds.length === 0) return new Map<string, CampaignScoringSettings>();

  const [globalSettings, rows] = await Promise.all([
    getSettings(),
    prisma.campaignScoringSettings.findMany({
      where: { campaignId: { in: uniqueCampaignIds } },
    }),
  ]);
  const rowsByCampaign = new Map(rows.map((row) => [row.campaignId, row]));

  return new Map(
    uniqueCampaignIds.map((campaignId) => [
      campaignId,
      mergeCampaignScoring(campaignId, globalSettings, rowsByCampaign.get(campaignId)),
    ]),
  );
}

export async function getEffectiveSettingsForCampaign(campaignId?: string): Promise<AppSettings> {
  if (!campaignId) return getSettings();
  const settings = await getCampaignScoringSettings(campaignId);
  return {
    passThreshold: settings.passThreshold,
    targetPassRate: settings.targetPassRate,
    targetAvgScore: settings.targetAvgScore,
    targetDailyRate: settings.targetDailyRate,
  };
}

export async function getPassThresholdForCampaign(campaignId?: string): Promise<number> {
  const settings = await getEffectiveSettingsForCampaign(campaignId);
  return settings.passThreshold;
}
