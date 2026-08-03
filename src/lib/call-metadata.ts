export type CallMetadataSummary = {
  masterContactId: string | null;
  skillName: string | null;
  teamName: string | null;
  mediaTypeName: string | null;
  pointOfContactName: string | null;
  primaryDispositionId: string | null;
  secondaryDispositionId: string | null;
  holdCount: number | null;
  holdSeconds: number | null;
  transferIndicatorName: string | null;
  providerSystem: string | null;
  agentExtension: string | null;
  application: string | null;
  did: string | null;
  outboundCallerId: string | null;
  talkSeconds: number | null;
};

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metadataString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function metadataNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

export function summarizeCallMetadata(value: unknown): CallMetadataSummary {
  const record = metadataRecord(value);
  return {
    masterContactId: metadataString(record, "masterContactId"),
    skillName: metadataString(record, "skillName"),
    teamName: metadataString(record, "teamName"),
    mediaTypeName: metadataString(record, "mediaTypeName"),
    pointOfContactName: metadataString(record, "pointOfContactName"),
    primaryDispositionId: metadataString(record, "primaryDispositionId"),
    secondaryDispositionId: metadataString(record, "secondaryDispositionId"),
    holdCount: metadataNumber(record, "holdCount"),
    holdSeconds: metadataNumber(record, "holdSeconds"),
    transferIndicatorName: metadataString(record, "transferIndicatorName"),
    providerSystem: metadataString(record, "providerSystem"),
    agentExtension: metadataString(record, "agentExtension"),
    application: metadataString(record, "application"),
    did: metadataString(record, "did"),
    outboundCallerId: metadataString(record, "outboundCallerId"),
    talkSeconds: metadataNumber(record, "talkSeconds"),
  };
}
