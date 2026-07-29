export const QA_ACTIVITY_TYPES = [
  "EVALUATION",
  "COACHING_PREPARATION",
  "COACHING_LIVE",
  "COACHING_DOCUMENTATION",
  "CALIBRATION",
  "DISPUTE_REVIEW",
  "TRAINING",
  "MEETING",
  "ADMINISTRATIVE",
  "SYSTEM_ISSUE",
  "OTHER",
] as const;

export type QaActivityTypeValue = (typeof QA_ACTIVITY_TYPES)[number];

export const COACHING_SOURCES = [
  "MANUAL",
  "EVALUATION",
  "TREND",
  "CRITICAL_FAILURE",
  "CALIBRATION",
  "PIP_REVIEW",
  "OTHER",
] as const;

export type CoachingSourceValue = (typeof COACHING_SOURCES)[number];

export const ACKNOWLEDGEMENT_METHODS = [
  "IN_PERSON",
  "SECURE_LINK",
  "EMAIL",
  "COMPANY_SYSTEM",
  "WITNESSED",
] as const;

export type AcknowledgementMethodValue = (typeof ACKNOWLEDGEMENT_METHODS)[number];

export const PIP_TEMPLATE_KEYS = ["PARKER_DAVIS", "HAPUSA", "CUSTOM"] as const;
export type PipTemplateKey = (typeof PIP_TEMPLATE_KEYS)[number];

export const PIP_REVIEW_FREQUENCIES = [
  "Daily",
  "Every other day",
  "Twice weekly",
  "Weekly",
  "Every two weeks",
  "Monthly",
] as const;

function calendarDayNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(day) ? null : day;
}

export function pipPlanDurationDays(startDate: string, targetEndDate: string): number {
  const start = calendarDayNumber(startDate);
  const end = calendarDayNumber(targetEndDate);
  if (start === null || end === null) return 0;
  return Math.max(0, Math.floor((end - start) / 86_400_000) + 1);
}

export function availablePipReviewFrequencies(
  startDate: string,
  targetEndDate: string,
): readonly (typeof PIP_REVIEW_FREQUENCIES)[number][] {
  const days = pipPlanDurationDays(startDate, targetEndDate);
  if (days <= 1) return ["Daily"];

  return PIP_REVIEW_FREQUENCIES.filter((frequency) => {
    if (frequency === "Every other day") return days >= 3;
    if (frequency === "Twice weekly") return days >= 4;
    if (frequency === "Weekly") return days >= 7;
    if (frequency === "Every two weeks") return days >= 14;
    if (frequency === "Monthly") return days >= 28;
    return true;
  });
}

type CoachingStatusValue =
  | "DRAFT"
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "AWAITING_ACKNOWLEDGEMENT"
  | "COMPLETED"
  | "CANCELLED";

type PipStatusValue =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "ACTIVE"
  | "ON_HOLD"
  | "EXTENDED"
  | "COMPLETED_SUCCESSFULLY"
  | "COMPLETED_UNSUCCESSFULLY"
  | "CANCELLED";

const COACHING_TRANSITIONS: Record<CoachingStatusValue, readonly CoachingStatusValue[]> = {
  DRAFT: ["SCHEDULED", "IN_PROGRESS", "CANCELLED"],
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["AWAITING_ACKNOWLEDGEMENT", "CANCELLED"],
  AWAITING_ACKNOWLEDGEMENT: ["COMPLETED", "IN_PROGRESS", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

const PIP_TRANSITIONS: Record<PipStatusValue, readonly PipStatusValue[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["DRAFT", "ACTIVE", "CANCELLED"],
  ACTIVE: [
    "ON_HOLD",
    "EXTENDED",
    "COMPLETED_SUCCESSFULLY",
    "COMPLETED_UNSUCCESSFULLY",
    "CANCELLED",
  ],
  ON_HOLD: ["ACTIVE", "EXTENDED", "CANCELLED"],
  EXTENDED: [
    "ACTIVE",
    "ON_HOLD",
    "COMPLETED_SUCCESSFULLY",
    "COMPLETED_UNSUCCESSFULLY",
    "CANCELLED",
  ],
  COMPLETED_SUCCESSFULLY: [],
  COMPLETED_UNSUCCESSFULLY: [],
  CANCELLED: [],
};

export function canTransitionCoaching(
  current: CoachingStatusValue,
  next: CoachingStatusValue,
): boolean {
  return COACHING_TRANSITIONS[current].includes(next);
}

export function canTransitionPip(current: PipStatusValue, next: PipStatusValue): boolean {
  return PIP_TRANSITIONS[current].includes(next);
}

export function elapsedSeconds(startedAt: Date, endedAt: Date): number {
  return Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1_000));
}

export function formatTrackedDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const seconds = safeSeconds % 60;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function defaultPipTemplateVersion(templateKey: PipTemplateKey): string {
  if (templateKey === "PARKER_DAVIS") return "PD-HR-FRM-PIP-001-v1";
  if (templateKey === "HAPUSA") return "HAPUSA-INDUSTRY-v1";
  return "CUSTOM-v1";
}
