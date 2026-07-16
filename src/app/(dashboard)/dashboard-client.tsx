"use client";

import { DashboardEvaluator } from "./dashboard-evaluator";
import { DashboardManager } from "./dashboard-manager";
import type { UiAccess } from "@/server/queries/ui-access";

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
}: {
  userName: string;
  access: UiAccess;
  campaigns: { id: string; name: string }[];
  viewMode: "manager" | "evaluator";
}) {
  if (viewMode === "evaluator") {
    return <DashboardEvaluator userName={userName} access={access} campaigns={campaigns} />;
  }
  return <DashboardManager userName={userName} access={access} campaigns={campaigns} />;
}
