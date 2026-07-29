import type { CriticalType, QuestionType } from "@prisma/client";

export const PARKER_DAVIS_SCORECARD_KEY = "PARKER_DAVIS_QA_SCORECARD";
export const PARKER_DAVIS_SCORECARD_VERSION = "PD-QA-SCORECARD-2026-07";

export type ScorecardGradingBand = {
  min: number;
  max: number;
  label: string;
  result: "PASS" | "FAIL";
};

export type OfficialScorecardQuestion = {
  type: QuestionType;
  label: string;
  options: string[];
  optionPoints: number[];
  required: boolean;
  qaCategoryId: string;
  weight: number;
  fatal: boolean;
  fatalOptions?: string[];
  criticalType?: CriticalType;
  requiresCommentOnFail: boolean;
};

export const PARKER_DAVIS_GRADING_SCALE: ScorecardGradingBand[] = [
  { min: 95, max: 100, label: "Pass (Excellent)", result: "PASS" },
  { min: 90, max: 94.99, label: "Acceptable", result: "FAIL" },
  { min: 80, max: 89.99, label: "Fail (Needs Improvement)", result: "FAIL" },
  { min: 70, max: 79.99, label: "Fail (Below Standard)", result: "FAIL" },
  { min: 0, max: 69.99, label: "Fail (Unsatisfactory)", result: "FAIL" },
];

export const PARKER_DAVIS_CATEGORIES = [
  {
    id: "qa_pd_opening_verification",
    name: "SECTION 1 — Opening/Greeting & Verification",
    description: "Official Parker Davis opening, greeting, and verification criteria.",
    systemColor: "#003366",
    systemIcon: "badge-check",
    canBeFatal: false,
    sortOrder: 110,
  },
  {
    id: "qa_pd_communication_control",
    name: "SECTION 2 — Communication & Call Control",
    description: "Official Parker Davis communication and call-control criteria.",
    systemColor: "#0B4F7A",
    systemIcon: "messages-square",
    canBeFatal: false,
    sortOrder: 120,
  },
  {
    id: "qa_pd_problem_resolution",
    name: "SECTION 3 — Problem Resolution*",
    description: "Official Parker Davis problem-resolution criteria and supporting checks.",
    systemColor: "#176A96",
    systemIcon: "circle-check-big",
    canBeFatal: false,
    sortOrder: 130,
  },
  {
    id: "qa_pd_policy_compliance",
    name: "SECTION 4 — Policy & Compliance/Procedures*",
    description: "Official Parker Davis policy, compliance, and critical-failure controls.",
    systemColor: "#003366",
    systemIcon: "shield-check",
    canBeFatal: true,
    sortOrder: 140,
  },
  {
    id: "qa_pd_correct_information",
    name: "SECTION 5 — Correct Information*",
    description: "Official Parker Davis information-accuracy and probing criteria.",
    systemColor: "#0B4F7A",
    systemIcon: "info",
    canBeFatal: true,
    sortOrder: 150,
  },
  {
    id: "qa_pd_documentation",
    name: "SECTION 6 — Documentation*",
    description: "Official Parker Davis case-note and documentation criteria.",
    systemColor: "#176A96",
    systemIcon: "file-check-2",
    canBeFatal: true,
    sortOrder: 160,
  },
] as const;

const YES_NO_OPTIONS = ["Yes", "No"];
const YES_NO_POINTS = [1, 0];

function scoreOptions(points: number) {
  const half = points / 2;
  return {
    options: [`0 / ${points} points`, `${half} / ${points} points`, `${points} / ${points} points`],
    optionPoints: [0, half, points],
  };
}

function scoredQuestion(
  qaCategoryId: string,
  label: string,
  weight: number,
): OfficialScorecardQuestion {
  return {
    type: "RADIO",
    label,
    ...scoreOptions(weight),
    required: true,
    qaCategoryId,
    weight,
    fatal: false,
    requiresCommentOnFail: false,
  };
}

function checkpoint(
  qaCategoryId: string,
  label: string,
  options: { fatal?: boolean; partsWarranty?: boolean } = {},
): OfficialScorecardQuestion {
  const metadata = `[[CHECK]]${options.partsWarranty ? "[[P&W]]" : ""}`;
  return {
    type: "BOOLEAN",
    label: `${metadata}${label}`,
    options: YES_NO_OPTIONS,
    optionPoints: YES_NO_POINTS,
    required: true,
    qaCategoryId,
    weight: 0,
    fatal: Boolean(options.fatal),
    fatalOptions: options.fatal ? ["No"] : undefined,
    criticalType: options.fatal ? "COMPLIANCE" : undefined,
    requiresCommentOnFail: Boolean(options.fatal),
  };
}

export const PARKER_DAVIS_SCORECARD = {
  key: PARKER_DAVIS_SCORECARD_KEY,
  version: PARKER_DAVIS_SCORECARD_VERSION,
  title: "Parker Davis — QA Scorecard",
  description:
    "Customer Service & Parts and Warranty | Items marked P&W apply when the call involves parts, warranty, or a Shopify order",
  passThreshold: 95,
  gradingScale: PARKER_DAVIS_GRADING_SCALE,
  categories: PARKER_DAVIS_CATEGORIES,
  questions: [
    scoredQuestion(
      "qa_pd_opening_verification",
      "1. Properly opened the call and greeted the customer with the branding of the company.",
      5,
    ),
    scoredQuestion(
      "qa_pd_opening_verification",
      "2. Correctly verifies information: name, phone number, order number, invoice number etc.",
      5,
    ),
    scoredQuestion(
      "qa_pd_communication_control",
      "4. Did the agent listen without interrupting, acknowledge concerns, ask clarifying questions?",
      5,
    ),
    scoredQuestion(
      "qa_pd_communication_control",
      "5. Maintained control of the conversation, kept the customer on topic, used appropriate transitions.",
      5,
    ),
    scoredQuestion(
      "qa_pd_communication_control",
      "6. Tone is professional, calm, empathetic and respectful throughout the call.",
      5,
    ),
    scoredQuestion(
      "qa_pd_communication_control",
      "7. Clear speech, grammar, professionalism, empathy, confidence, positive language.",
      5,
    ),
    scoredQuestion(
      "qa_pd_communication_control",
      "8. Did the agent correctly place the customer on hold? Did the agent refreshed the call and/or avoided long periods of dead-air.",
      5,
    ),
    scoredQuestion(
      "qa_pd_communication_control",
      "9. Was the call properly transferred and to the correct department/extension?",
      5,
    ),
    scoredQuestion(
      "qa_pd_problem_resolution",
      "10. Correctly identified the issue, provided the appropriate solution, resolved or escalated when necessary.",
      15,
    ),
    checkpoint(
      "qa_pd_problem_resolution",
      "• Obtains order number and/or invoice number as applicable.",
    ),
    checkpoint(
      "qa_pd_problem_resolution",
      "• Obtains model number and serial number (barcode sticker — not data plate).",
      { partsWarranty: true },
    ),
    checkpoint(
      "qa_pd_problem_resolution",
      "• Obtains registration number and invoice number for warranty calls.",
    ),
    scoredQuestion(
      "qa_pd_policy_compliance",
      "11. Followed company policies, legal requirements, disclosures.",
      15,
    ),
    checkpoint(
      "qa_pd_policy_compliance",
      "• Will (P&W Supervisor) notified via Teams with case number after order is created.",
    ),
    checkpoint(
      "qa_pd_policy_compliance",
      "• Warranty orders set to $0; paid orders use listed pricing from product list.",
    ),
    checkpoint(
      "qa_pd_policy_compliance",
      "• Confirms unit is uninstalled before processing return.",
      { fatal: true },
    ),
    checkpoint(
      "qa_pd_policy_compliance",
      "• Return submitted via correct portal: pdhvac.com/support/returns-refunds/request.",
    ),
    checkpoint(
      "qa_pd_policy_compliance",
      "• Customer informed that returns are inspected; restocking fees may apply if used/damaged.",
    ),
    checkpoint(
      "qa_pd_policy_compliance",
      "• Amazon orders transferred immediately to CS queue (4110) — no attempt to handle independently.",
      { fatal: true },
    ),
    checkpoint(
      "qa_pd_policy_compliance",
      "• Escalation keywords recognized and acted on immediately (Defective, Installed, Replacement, Supervisor, Legal, Chargeback).",
      { fatal: true },
    ),
    checkpoint(
      "qa_pd_policy_compliance",
      "• Does NOT register product for customer over the phone — directs to self-registration portal.",
      { fatal: true },
    ),
    checkpoint(
      "qa_pd_policy_compliance",
      "• Single-call rule enforced — customer asked to report ALL issues on the first call.",
      { fatal: true },
    ),
    checkpoint(
      "qa_pd_policy_compliance",
      "• Photos requested for ALL damaged item claims before any resolution is offered.",
      { fatal: true },
    ),
    checkpoint(
      "qa_pd_policy_compliance",
      "• Grounded compressor rule: main board(s) sent with every compressor replacement.",
      { fatal: true },
    ),
    scoredQuestion(
      "qa_pd_correct_information",
      "12. Was the correct and complete information given to the customer?",
      10,
    ),
    checkpoint("qa_pd_correct_information", "• Invoice sent to correct customer email address."),
    checkpoint("qa_pd_correct_information", "• Customer advised email will come from HighSeer."),
    checkpoint("qa_pd_correct_information", "• 45-day window confirmed before submitting return."),
    checkpoint(
      "qa_pd_correct_information",
      "• Customer informed that returns are inspected; restocking fees may apply if used/damaged.",
    ),
    checkpoint(
      "qa_pd_correct_information",
      "• Customer advised to expect label by email within 24–48 hours.",
    ),
    scoredQuestion(
      "qa_pd_correct_information",
      "13. Were probing and necessary questions asked?",
      10,
    ),
    checkpoint(
      "qa_pd_correct_information",
      "• Confirms unit is uninstalled before processing return",
      { fatal: true },
    ),
    checkpoint("qa_pd_correct_information", "Identified customer’s issue correctly."),
    checkpoint("qa_pd_correct_information", "Provided accurate information or solution."),
    scoredQuestion("qa_pd_documentation", "14. Detailed account notes were provided.", 10),
    checkpoint(
      "qa_pd_documentation",
      "• Correct case type selected: Part/Component, Return, or Claim.",
    ),
    checkpoint(
      "qa_pd_documentation",
      "• Correct case type selected: Part/Component, Return, or Claim.",
    ),
    checkpoint(
      "qa_pd_documentation",
      "• Order type set FIRST before adding parts (warranty / spare parts / open box).",
      { fatal: true },
    ),
  ] satisfies OfficialScorecardQuestion[],
} as const;

export function parseOfficialQuestionLabel(label: string) {
  const checkpoint = label.includes("[[CHECK]]");
  const partsWarranty = label.includes("[[P&W]]");
  return {
    label: label.replaceAll("[[CHECK]]", "").replaceAll("[[P&W]]", ""),
    checkpoint,
    partsWarranty,
  };
}

export function resolveScorecardBand(
  gradingScale: unknown,
  score: number,
  hasFatalFail: boolean,
): ScorecardGradingBand | null {
  if (hasFatalFail) {
    return { min: 0, max: 100, label: "Fail — Critical Failure", result: "FAIL" };
  }
  if (!Array.isArray(gradingScale)) return null;

  for (const candidate of gradingScale) {
    if (!candidate || typeof candidate !== "object") continue;
    const band = candidate as Partial<ScorecardGradingBand>;
    if (
      typeof band.min === "number" &&
      typeof band.max === "number" &&
      typeof band.label === "string" &&
      (band.result === "PASS" || band.result === "FAIL") &&
      score >= band.min &&
      score <= band.max
    ) {
      return band as ScorecardGradingBand;
    }
  }
  return null;
}
