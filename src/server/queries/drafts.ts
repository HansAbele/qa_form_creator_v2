import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { isSupervisorRole } from "@/lib/campaign-permissions";
import { prisma } from "@/lib/prisma";
import { RESPONSE_STATUS } from "@/lib/response-status";

const DRAFT_LIST_LIMIT = 50;

export async function getAccessibleEvaluationDrafts() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (isSupervisorRole(session.user.role)) return [];

  const accessRules: Prisma.ResponseWhereInput[] = [];
  if (session.user.role !== "ADMIN") {
    if (session.user.campaignIds.length === 0) return [];

    const campaignAccess = await prisma.userCampaign.findMany({
      where: {
        userId: session.user.id,
        campaignId: { in: session.user.campaignIds },
      },
      select: {
        campaignId: true,
        canEvaluate: true,
        canEditEvaluations: true,
      },
    });
    const evaluationCampaignIds = campaignAccess
      .filter((access) => access.canEvaluate)
      .map((access) => access.campaignId);
    const correctionCampaignIds = campaignAccess
      .filter((access) => access.canEditEvaluations)
      .map((access) => access.campaignId);

    if (evaluationCampaignIds.length > 0) {
      accessRules.push({
        evaluatorId: session.user.id,
        form: { campaignId: { in: evaluationCampaignIds } },
      });
    }
    if (correctionCampaignIds.length > 0) {
      accessRules.push({
        evaluatorId: { not: session.user.id },
        form: { campaignId: { in: correctionCampaignIds } },
      });
    }
    if (accessRules.length === 0) return [];
  }

  const drafts = await prisma.response.findMany({
    where: {
      status: RESPONSE_STATUS.DRAFT,
      form: { status: "PUBLISHED", campaign: { active: true } },
      agent: { active: true },
      ...(accessRules.length > 0 ? { OR: accessRules } : {}),
    },
    select: {
      id: true,
      formId: true,
      evaluatorId: true,
      updatedAt: true,
      form: {
        select: {
          title: true,
          campaignId: true,
          campaign: { select: { name: true } },
        },
      },
      agent: { select: { name: true, agentCode: true, campaignId: true } },
      evaluator: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: DRAFT_LIST_LIMIT,
  });

  return drafts
    .filter((draft) => draft.agent.campaignId === draft.form.campaignId)
    .map((draft) => ({
      id: draft.id,
      formId: draft.formId,
      formTitle: draft.form.title,
      campaignName: draft.form.campaign.name,
      agentName: draft.agent.name,
      agentCode: draft.agent.agentCode,
      evaluatorName: draft.evaluator.name,
      updatedAt: draft.updatedAt,
      isOwn: draft.evaluatorId === session.user.id,
    }));
}
