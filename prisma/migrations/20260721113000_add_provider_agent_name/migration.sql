-- Preserve the provider display name when a call cannot yet be linked to a
-- local Agent row. This keeps Call Finder useful while mappings are refined.
ALTER TABLE "Interaction" ADD COLUMN "providerAgentName" TEXT;

CREATE INDEX "Interaction_providerAgentName_idx" ON "Interaction"("providerAgentName");
