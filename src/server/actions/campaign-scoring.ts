"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  getCampaignScoringSettings,
  validateCampaignScoringPatch,
  type CampaignScoringPatch,
} from "@/lib/settings";
import { writeAuditLog } from "@/server/audit-log";
import { assertCampaignPermissionForUser } from "@/server/queries/campaign-filter";

type CampaignScoringDelegate = {
  findUnique: (args: { where: { campaignId: string } }) => Promise<unknown>;
  upsert: (args: {
    where: { campaignId: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => Promise<unknown>;
};

function getScoringDelegate(database: typeof prisma | Prisma.TransactionClient = prisma) {
  const delegate = (database as unknown as { campaignScoringSettings?: CampaignScoringDelegate })
    .campaignScoringSettings;

  if (!delegate) {
    throw new Error("The Prisma client must be regenerated to use campaign scoring");
  }

  return delegate;
}

async function assertCanManageCampaignScoring(campaignId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  if (session.user.role !== "ADMIN") {
    await assertCampaignPermissionForUser(session.user, campaignId, "canManageCampaignScoring");
  }

  return session;
}

export async function readCampaignScoringSettings(campaignIds: string[]) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  if (session.user.role !== "ADMIN") {
    for (const campaignId of campaignIds) {
      await assertCampaignPermissionForUser(session.user, campaignId, "canManageCampaignScoring");
    }
  }

  return Promise.all(campaignIds.map((campaignId) => getCampaignScoringSettings(campaignId)));
}

export async function updateCampaignScoringSettings(
  campaignId: string,
  patch: CampaignScoringPatch,
) {
  const session = await assertCanManageCampaignScoring(campaignId);

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, name: true },
  });
  if (!campaign) throw new Error("Campaign not found");

  const beforeValue = await getCampaignScoringSettings(campaignId);
  const validatedPatch = validateCampaignScoringPatch(patch);

  await prisma.$transaction(async (tx) => {
    const saved = await getScoringDelegate(tx).upsert({
      where: { campaignId },
      create: {
        campaignId,
        usesGlobalDefaults: validatedPatch.usesGlobalDefaults ?? true,
        passThreshold: validatedPatch.passThreshold ?? beforeValue.passThreshold,
        targetPassRate: validatedPatch.targetPassRate ?? beforeValue.targetPassRate,
        targetAvgScore: validatedPatch.targetAvgScore ?? beforeValue.targetAvgScore,
        targetDailyRate: validatedPatch.targetDailyRate ?? beforeValue.targetDailyRate,
        customerCeaTarget: validatedPatch.customerCeaTarget ?? beforeValue.customerCeaTarget,
        businessCeaTarget: validatedPatch.businessCeaTarget ?? beforeValue.businessCeaTarget,
        complianceCeaTarget: validatedPatch.complianceCeaTarget ?? beforeValue.complianceCeaTarget,
        fatalFailuresAllowed:
          validatedPatch.fatalFailuresAllowed ?? beforeValue.fatalFailuresAllowed,
        fatalZeroesScore: validatedPatch.fatalZeroesScore ?? beforeValue.fatalZeroesScore,
        updatedBy: session.user.id,
      },
      update: {
        ...validatedPatch,
        updatedBy: session.user.id,
      },
    });

    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId,
        module: "settings",
        action: "campaign_scoring_updated",
        entityType: "campaign_scoring_settings",
        entityId: campaignId,
        beforeValue,
        afterValue: { saved, effective: { ...beforeValue, ...validatedPatch } },
        impact:
          "Dashboard, KPIs, reports, and future evaluations use the campaign overrides.",
      },
      tx,
    );

    return saved;
  });

  const afterValue = await getCampaignScoringSettings(campaignId);

  revalidatePath("/", "layout");
  revalidatePath("/settings");
  revalidatePath("/kpis");
  revalidatePath("/reports");

  return afterValue;
}
