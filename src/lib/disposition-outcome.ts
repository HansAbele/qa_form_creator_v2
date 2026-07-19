/**
 * Machine-readable call outcomes. Lets KPIs (FCR, escalation rate) derive from
 * a stable enum instead of matching disposition names.
 */
export const DISPOSITION_OUTCOMES = [
  "RESOLVED",
  "ESCALATED",
  "TRANSFERRED",
  "FOLLOW_UP",
  "CALLBACK",
  "SALE",
  "NO_SALE",
  "NO_CONTACT",
  "DNC",
  "SYSTEM",
  "OTHER",
] as const;

export type DispositionOutcomeValue = (typeof DISPOSITION_OUTCOMES)[number];

export const OUTCOME_LABELS: Record<DispositionOutcomeValue, string> = {
  RESOLVED: "Resuelto (FCR)",
  ESCALATED: "Escalado a supervisor",
  TRANSFERRED: "Transferido",
  FOLLOW_UP: "Seguimiento",
  CALLBACK: "Rellamada",
  SALE: "Venta",
  NO_SALE: "Sin venta",
  NO_CONTACT: "Sin contacto",
  DNC: "No contactar",
  SYSTEM: "Sistema",
  OTHER: "Otro",
};

export const OUTCOME_LABELS_EN: Record<DispositionOutcomeValue, string> = {
  RESOLVED: "Resolved (FCR)",
  ESCALATED: "Escalated to supervisor",
  TRANSFERRED: "Transferred",
  FOLLOW_UP: "Follow-up",
  CALLBACK: "Callback",
  SALE: "Sale",
  NO_SALE: "No sale",
  NO_CONTACT: "No contact",
  DNC: "Do not contact",
  SYSTEM: "System",
  OTHER: "Other",
};

/** COPC: first-contact resolution. Transfers/escalations are NOT resolutions. */
export function isResolvedOutcome(outcome?: string | null): boolean {
  return outcome === "RESOLVED";
}

export function isEscalationOutcome(outcome?: string | null): boolean {
  return outcome === "ESCALATED";
}
