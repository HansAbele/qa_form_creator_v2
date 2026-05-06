"use server";

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

function getScoringDelegate() {
  const delegate = (
    prisma as unknown as { campaignScoringSettings?: CampaignScoringDelegate }
  ).campaignScoringSettings;

  if (!delegate) {
    throw new Error("El cliente de Prisma debe regenerarse para usar scoring por campana");
  }

  return delegate;
}

async function assertCanManageCampaignScoring(campaignId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  if (session.user.role !== "ADMIN") {
    await assertCampaignPermissionForUser(
      session.user,
      campaignId,
      "canManageCampaignScoring",
    );
  }

  return session;
}

export async function readCampaignScoringSettings(campaignIds: string[]) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  if (session.user.role !== "ADMIN") {
    for (const campaignId of campaignIds) {
      await assertCampaignPermissionForUser(
        session.user,
        campaignId,
        "canManageCampaignScoring",
      );
    }
  }

  return Promise.all(campaignIds.map((campaignId) => getCampaignScoringSettings(campaignId)));
}

export async function updateCampaignScoringSettings(
  campaignId: string,
  patch: CampaignScoringPatch,
) {
  const session = await assertCanManageCampaignScoring(campaignId);
  const delegate = getScoringDelegate();

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, name: true },
  });
  if (!campaign) throw new Error("Campana no encontrada");

  const beforeValue = await getCampaignScoringSettings(campaignId);
  const validatedPatch = validateCampaignScoringPatch(patch);

  const saved = await delegate.upsert({
    where: { campaignId },
    create: {
      campaignId,
      usesGlobalDefaults: validatedPatch.usesGlobalDefaults ?? true,
      passThreshold: validatedPatch.passThreshold ?? beforeValue.passThreshold,
      targetPassRate: validatedPatch.targetPassRate ?? beforeValue.targetPassRate,
      targetAvgScore: validatedPatch.targetAvgScore ?? beforeValue.targetAvgScore,
      targetDailyRate: validatedPatch.targetDailyRate ?? beforeValue.targetDailyRate,
      fatalFailuresAllowed:
        validatedPatch.fatalFailuresAllowed ?? beforeValue.fatalFailuresAllowed,
      updatedBy: session.user.id,
    },
    update: {
      ...validatedPatch,
      updatedBy: session.user.id,
    },
  });

  const afterValue = await getCampaignScoringSettings(campaignId);
  await writeAuditLog({
    userId: session.user.id,
    campaignId,
    module: "settings",
    action: "campaign_scoring_updated",
    entityType: "campaign_scoring_settings",
    entityId: campaignId,
    beforeValue,
    afterValue: { saved, effective: afterValue },
    impact: "Dashboard, KPIs, reportes y evaluaciones futuras usan los overrides de la campana.",
  });

  revalidatePath("/", "layout");
  revalidatePath("/settings");
  revalidatePath("/kpis");
  revalidatePath("/reports");

  return afterValue;
}
