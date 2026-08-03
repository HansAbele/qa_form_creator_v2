export type CallEndParty = "AGENT" | "CONTACT" | "SYSTEM" | "TRANSFERRED" | "UNKNOWN";

export function inferCallEndParty(status: string | null | undefined): CallEndParty {
  const normalized = status?.trim().toLowerCase() ?? "";
  if (!normalized) return "UNKNOWN";
  if (normalized.includes("transfer")) return "TRANSFERRED";
  if (/\bagent\b.*\b(hung up|hang up|disconnected)\b/.test(normalized)) return "AGENT";
  if (/\b(contact|customer|patient|peer)\b.*\b(hung up|hang up|disconnected)\b/.test(normalized)) {
    return "CONTACT";
  }
  if (/\b(failed|no answer|time out|timeout|interrupted)\b/.test(normalized)) return "SYSTEM";
  return "UNKNOWN";
}

export function callEndPartyLabel(party: CallEndParty, campaignName?: string | null) {
  if (party === "AGENT") return "Agent";
  if (party === "CONTACT") {
    return campaignName?.trim().toLowerCase() === "hapusa" ? "Patient" : "Customer";
  }
  if (party === "SYSTEM") return "System";
  if (party === "TRANSFERRED") return "Transferred";
  return "Not provided";
}
