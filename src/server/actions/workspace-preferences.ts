"use server";

import type { Prisma, Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  EVALUATION_WORKSPACE_SCOPES,
  normalizeWorkspacePreferences,
  resolvePreferredCampaignId,
  WORKSPACE_DATE_RANGES,
  type WorkspacePreferences,
} from "@/lib/workspace-preferences";
import { writeAuditLog } from "@/server/audit-log";

type PreferenceCampaign = { id: string; name: string };
type PreferenceDb = Pick<typeof prisma, "campaign" | "userCampaign">;

type PreferenceAccess = {
  campaigns: PreferenceCampaign[];
  canUseOwnEvaluationScope: boolean;
  canUseManagedEvaluationScope: boolean;
};

async function getPreferenceAccess(
  userId: string,
  role: Role,
  db: PreferenceDb = prisma,
): Promise<PreferenceAccess> {
  if (role === "ADMIN") {
    const campaigns = await db.campaign.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return {
      campaigns,
      canUseOwnEvaluationScope: true,
      canUseManagedEvaluationScope: true,
    };
  }

  const assignments = await db.userCampaign.findMany({
    where: { userId, campaign: { active: true } },
    select: {
      canViewDashboard: true,
      canViewEvaluations: true,
      campaign: { select: { id: true, name: true } },
    },
    orderBy: { campaign: { name: "asc" } },
  });

  return {
    campaigns: assignments.map(({ campaign }) => campaign),
    canUseOwnEvaluationScope: assignments.some((assignment) => assignment.canViewDashboard),
    canUseManagedEvaluationScope: assignments.some((assignment) => assignment.canViewEvaluations),
  };
}

function resolveEvaluationScope(preferences: WorkspacePreferences, access: PreferenceAccess) {
  if (preferences.defaultEvaluationScope === "MANAGED" && access.canUseManagedEvaluationScope) {
    return "MANAGED" as const;
  }
  if (preferences.defaultEvaluationScope === "OWN" && access.canUseOwnEvaluationScope) {
    return "OWN" as const;
  }
  if (!access.canUseManagedEvaluationScope && !access.canUseOwnEvaluationScope) {
    return preferences.defaultEvaluationScope;
  }
  return access.canUseManagedEvaluationScope ? ("MANAGED" as const) : ("OWN" as const);
}

export async function readMyWorkspacePreferences() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const user = await prisma.user.findFirst({
    where: { id: session.user.id, active: true },
    select: { id: true, role: true, workspacePreferences: true },
  });
  if (!user) throw new Error("User not found or inactive");
  if (user.role === "AGENT") throw new Error("Workspace settings are not available for agents");

  const access = await getPreferenceAccess(user.id, user.role);
  const normalized = normalizeWorkspacePreferences(user.workspacePreferences);
  const preferences: WorkspacePreferences = {
    ...normalized,
    defaultCampaignId: resolvePreferredCampaignId(normalized, access.campaigns) ?? null,
    defaultEvaluationScope: resolveEvaluationScope(normalized, access),
  };

  return { preferences, ...access };
}

export async function updateMyWorkspacePreferences(input: WorkspacePreferences) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  if (!WORKSPACE_DATE_RANGES.includes(input.defaultDateRange)) {
    throw new Error("Unsupported default date range");
  }
  if (!EVALUATION_WORKSPACE_SCOPES.includes(input.defaultEvaluationScope)) {
    throw new Error("Unsupported evaluation view");
  }
  if (
    input.defaultCampaignId !== null &&
    (typeof input.defaultCampaignId !== "string" ||
      input.defaultCampaignId.trim().length === 0 ||
      input.defaultCampaignId.length > 100)
  ) {
    throw new Error("Invalid default campaign");
  }

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: { id: session.user.id, active: true },
      select: { id: true, role: true, workspacePreferences: true },
    });
    if (!user) throw new Error("User not found or inactive");
    if (user.role === "AGENT") {
      throw new Error("Workspace settings are not available for agents");
    }

    const access = await getPreferenceAccess(user.id, user.role, tx);
    const requestedCampaignId = input.defaultCampaignId?.trim() || null;
    if (
      requestedCampaignId &&
      !access.campaigns.some((campaign) => campaign.id === requestedCampaignId)
    ) {
      throw new Error("The default campaign is outside your assigned scope");
    }
    if (
      input.defaultEvaluationScope === "MANAGED" &&
      !access.canUseManagedEvaluationScope &&
      access.canUseOwnEvaluationScope
    ) {
      throw new Error("Managed evaluations are not available for your role");
    }
    if (
      input.defaultEvaluationScope === "OWN" &&
      !access.canUseOwnEvaluationScope &&
      access.canUseManagedEvaluationScope
    ) {
      throw new Error("Own evaluations are not available for your role");
    }

    const preferences: WorkspacePreferences = {
      defaultCampaignId:
        access.campaigns.length === 1 ? (access.campaigns[0]?.id ?? null) : requestedCampaignId,
      defaultDateRange: input.defaultDateRange,
      defaultEvaluationScope: input.defaultEvaluationScope,
    };

    await tx.user.update({
      where: { id: user.id },
      data: { workspacePreferences: preferences as Prisma.InputJsonValue },
    });
    await writeAuditLog(
      {
        userId: user.id,
        module: "profile",
        action: "workspace_preferences_updated",
        entityType: "user",
        entityId: user.id,
        beforeValue: normalizeWorkspacePreferences(user.workspacePreferences),
        afterValue: preferences,
        impact: "User changed personal workspace defaults; global configuration was not changed.",
      },
      tx,
    );

    return { preferences, ...access };
  });

  for (const path of ["/", "/call-finder", "/evaluations", "/reports", "/performance"]) {
    revalidatePath(path);
  }
  revalidatePath("/settings");
  return result;
}
