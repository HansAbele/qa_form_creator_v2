"use client";

import type { UiAccess } from "@/server/queries/ui-access";
import { DashboardEvaluator } from "./dashboard-evaluator";
import { DashboardManager } from "./dashboard-manager";

/**
 * Role-differentiated dashboard entry point.
 * - "manager"  → program health, CEA risk, coaching & evaluator governance (ADMIN / CAMPAIGN_ADMIN).
 * - "evaluator" → self-scoped "Mi trabajo" (never a peer ranking).
 */
export function DashboardClient({
  userName,
  access,
  campaigns,
  viewMode,
  initialCampaignId,
  initialDateFrom,
  initialDateTo,
}: {
  userName: string;
  access: UiAccess;
  campaigns: { id: string; name: string }[];
  viewMode: "manager" | "evaluator";
  initialCampaignId?: string;
  initialDateFrom?: string;
  initialDateTo?: string;
}) {
  if (viewMode === "evaluator") {
    return (
      <DashboardEvaluator
        userName={userName}
        access={access}
        campaigns={campaigns}
        initialDateFrom={initialDateFrom}
        initialDateTo={initialDateTo}
      />
    );
  }
  return (
    <DashboardManager
      userName={userName}
      access={access}
      campaigns={campaigns}
      initialCampaignId={initialCampaignId}
      initialDateFrom={initialDateFrom}
      initialDateTo={initialDateTo}
    />
  );
}
