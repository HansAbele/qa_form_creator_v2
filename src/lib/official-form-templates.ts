import type { CriticalType, QuestionType } from "@prisma/client";

export const PARKER_DAVIS_SCORECARD_KEY = "PARKER_DAVIS_QA_SCORECARD";
export const PARKER_DAVIS_SCORECARD_VERSION = "PD-QA-SCORECARD-2026-08-R3";
export const HAPUSA_SCORECARD_KEY = "HAPUSA_QA_SCORECARD";
export const HAPUSA_SCORECARD_VERSION = "HAPUSA-QA-SCORECARD-2026-07";

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

export type OfficialScorecardManifestQuestion = Omit<OfficialScorecardQuestion, "qaCategoryId"> & {
  qaCategoryName: string;
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
  questions: (
    [
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
      checkpoint(
        "qa_pd_correct_information",
        "• 45-day window confirmed before submitting return.",
      ),
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
    ] satisfies OfficialScorecardQuestion[]
  ).filter((question) => question.weight > 0),
} as const;

export const HAPUSA_GRADING_SCALE: ScorecardGradingBand[] = [
  { min: 95, max: 100, label: "Pass", result: "PASS" },
  { min: 0, max: 94.99, label: "Fail (Needs Improvement)", result: "FAIL" },
];

export const HAPUSA_CATEGORIES = [
  {
    name: "Greeting",
    description: "Official HAPUSA greeting and introduction criteria.",
    systemColor: "#0F766E",
    systemIcon: "hand",
    sortOrder: 210,
  },
  {
    name: "Account Verification",
    description: "Official HAPUSA patient identity, account, and authorization checks.",
    systemColor: "#0E7490",
    systemIcon: "badge-check",
    sortOrder: 220,
  },
  {
    name: "Listen to the reason of the call",
    description: "Official HAPUSA listening, understanding, and empathy criteria.",
    systemColor: "#2563EB",
    systemIcon: "headphones",
    sortOrder: 230,
  },
  {
    name: "Problem Solving an account and Working the Account",
    description: "Official HAPUSA ownership, problem-solving, and account-work criteria.",
    systemColor: "#7C3AED",
    systemIcon: "circle-check-big",
    sortOrder: 240,
  },
  {
    name: "Ending the Call",
    description: "Official HAPUSA closing and call-documentation criteria.",
    systemColor: "#C2410C",
    systemIcon: "phone-off",
    sortOrder: 250,
  },
] as const;

function completeScoreOptions(points: number) {
  const optionPoints = Array.from({ length: points + 1 }, (_, index) => points - index);
  return {
    options: optionPoints.map((value) => `${value} / ${points} points`),
    optionPoints,
  };
}

function hapusaQuestion(
  qaCategoryName: string,
  label: string,
  weight: number,
): OfficialScorecardManifestQuestion {
  return {
    type: "SELECT",
    label,
    ...completeScoreOptions(weight),
    required: true,
    qaCategoryName,
    weight,
    fatal: false,
    requiresCommentOnFail: false,
  };
}

export const HAPUSA_SCORECARD = {
  key: HAPUSA_SCORECARD_KEY,
  version: HAPUSA_SCORECARD_VERSION,
  title: "HAPUSA Call Monitoring Score Card",
  description:
    "Official HAPUSA call-monitoring scorecard: 27 scored criteria, 100 total points, exact partial-point choices, and a 95% quality threshold.",
  passThreshold: 95,
  gradingScale: HAPUSA_GRADING_SCALE,
  categories: HAPUSA_CATEGORIES,
  questions: [
    hapusaQuestion("Greeting", "The agent identified themselves to the patient", 2),
    hapusaQuestion("Greeting", "The agent asked for the caller's name", 2),
    hapusaQuestion("Greeting", "The agent thanked the customer for calling", 2),
    hapusaQuestion("Greeting", "Was the agent friendly and welcoming?", 2),
    hapusaQuestion("Greeting", "The agent offered assistance", 2),
    hapusaQuestion("Account Verification", "The agent verified the patient's name and DOB", 10),
    hapusaQuestion("Account Verification", "The agent verified the address on the account", 2),
    hapusaQuestion("Account Verification", "The agent verified the phone number on the account", 2),
    hapusaQuestion(
      "Account Verification",
      "The agent verified the email address on the account",
      2,
    ),
    hapusaQuestion(
      "Account Verification",
      "If speaking to someone other than the patient, the agent verified that a HIPAA release was on file or obtained verbal permission from the patient to speak to the caller",
      4,
    ),
    hapusaQuestion("Listen to the reason of the call", "Is the agent being attentive?", 2),
    hapusaQuestion(
      "Listen to the reason of the call",
      "Is the agent showing interest in the caller's needs?",
      2,
    ),
    hapusaQuestion(
      "Listen to the reason of the call",
      "Did the agent paraphrase the issue by summarizing the patient's main points before troubleshooting or offering a solution?",
      2,
    ),
    hapusaQuestion(
      "Listen to the reason of the call",
      "Did the agent demonstrate active listening skills?",
      2,
    ),
    hapusaQuestion(
      "Listen to the reason of the call",
      "Is the agent showing empathy appropriately for the caller's situation?",
      2,
    ),
    hapusaQuestion(
      "Problem Solving an account and Working the Account",
      "Did the agent take ownership of the account?",
      3,
    ),
    hapusaQuestion(
      "Problem Solving an account and Working the Account",
      "Did the agent ask probing questions to accurately diagnose the problem?",
      5,
    ),
    hapusaQuestion(
      "Problem Solving an account and Working the Account",
      "Did the agent use the appropriate resources to address the problem (for example, ARF'ing a call or using the documentation)?",
      10,
    ),
    hapusaQuestion(
      "Problem Solving an account and Working the Account",
      "Did the agent provide appropriate time-frame expectations to the patient for issues that need additional support?",
      5,
    ),
    hapusaQuestion(
      "Problem Solving an account and Working the Account",
      "Did the agent inform the patient of relevant supporting information regarding the patient's issue?",
      5,
    ),
    hapusaQuestion(
      "Problem Solving an account and Working the Account",
      "Did the agent obtain permission from a supervisor to make exceptions on an account (for example, creating a payment plan below the monthly payment guidelines)?",
      2,
    ),
    hapusaQuestion(
      "Problem Solving an account and Working the Account",
      "Did the agent confirm that the issue was resolved?",
      5,
    ),
    hapusaQuestion(
      "Problem Solving an account and Working the Account",
      "Did the agent take the proper action on the account?",
      15,
    ),
    hapusaQuestion("Ending the Call", "Did the agent thank the patient for calling?", 2),
    hapusaQuestion(
      "Ending the Call",
      "Did the agent ask the patient if there were any additional questions before ending the call?",
      2,
    ),
    hapusaQuestion(
      "Ending the Call",
      "Did the agent document the important information in the call notes (charge lines, actions taken, who they spoke to, and the caller's phone number)?",
      4,
    ),
    hapusaQuestion(
      "Ending the Call",
      "Did the representative mention that a survey would be given?",
      2,
    ),
  ] satisfies OfficialScorecardManifestQuestion[],
} as const;

const OFFICIAL_SCORECARD_KEYS = new Set<string>([PARKER_DAVIS_SCORECARD_KEY, HAPUSA_SCORECARD_KEY]);

export function isOfficialScorecardKey(templateKey: string | null | undefined) {
  return Boolean(templateKey && OFFICIAL_SCORECARD_KEYS.has(templateKey));
}

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
