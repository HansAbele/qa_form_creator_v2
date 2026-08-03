import type { InteractionProvider } from "@prisma/client";

/**
 * Returns a stable, non-anonymous label for a provider agent identity.
 * FreePBX exposes extensions but not agent display names in its CDR report.
 */
export function providerAgentDisplayName(
  provider: InteractionProvider,
  providerAgentId: string | null,
  providerAgentName: string | null,
) {
  const name = providerAgentName?.trim();
  if (name) return name;

  const id = providerAgentId?.trim();
  if (!id) return null;

  return provider === "FREEPBX" ? `Extension ${id}` : `Agent ${id}`;
}
