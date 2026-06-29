export const RESPONSE_STATUS = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  CANCELLED: "CANCELLED",
} as const;

export type ResponseStatus = (typeof RESPONSE_STATUS)[keyof typeof RESPONSE_STATUS];

export function submittedResponseWhere() {
  return { status: RESPONSE_STATUS.SUBMITTED };
}
