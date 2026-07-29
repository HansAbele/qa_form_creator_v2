import "server-only";

import { TranscriptionStatus, type Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { isAgentRole } from "@/lib/campaign-permissions";
import { prisma } from "@/lib/prisma";
import {
  assertCanViewCoachingSession,
  assertCanViewPipPlan,
} from "@/server/queries/performance-access";

const visibleTranscriptStatuses = [
  TranscriptionStatus.COMPLETED,
  TranscriptionStatus.SPEAKERS_UNVERIFIED,
];

const performanceInteractionSelect = {
  id: true,
  provider: true,
  providerInteractionId: true,
  direction: true,
  phoneNumber: true,
  queueName: true,
  startedAt: true,
  durationSeconds: true,
  hasRecording: true,
  mediaAssets: {
    orderBy: [{ kind: "desc" }, { createdAt: "desc" }],
    take: 1,
    select: { id: true, durationMs: true },
  },
  transcripts: {
    where: { status: { in: visibleTranscriptStatuses } },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    take: 1,
    select: {
      id: true,
      provider: true,
      status: true,
      isDiarized: true,
      segments: {
        orderBy: { ordinal: "asc" },
        select: {
          id: true,
          ordinal: true,
          startMs: true,
          endMs: true,
          speakerKey: true,
          speakerRole: true,
          text: true,
          confidence: true,
        },
      },
    },
  },
  transcriptionJobs: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      status: true,
      attemptCount: true,
      maxAttempts: true,
      lastErrorCode: true,
    },
  },
} satisfies Prisma.InteractionSelect;

const evidenceSelect = {
  id: true,
  type: true,
  title: true,
  description: true,
  startMs: true,
  endMs: true,
  createdAt: true,
  response: {
    select: {
      id: true,
      score: true,
      result: true,
      hasFatalFail: true,
      submittedAt: true,
      formVersion: true,
      form: { select: { title: true, version: true } },
      evaluator: { select: { name: true } },
      answers: {
        orderBy: { question: { order: "asc" } },
        select: {
          id: true,
          value: true,
          score: true,
          comment: true,
          isFatalFail: true,
          notApplicable: true,
          category: { select: { name: true } },
          question: {
            select: {
              label: true,
              type: true,
              weight: true,
              fatal: true,
              order: true,
            },
          },
        },
      },
    },
  },
  interaction: { select: performanceInteractionSelect },
} satisfies Prisma.PerformanceEvidenceSelect;

function serializeInteraction(
  interaction: Prisma.InteractionGetPayload<{ select: typeof performanceInteractionSelect }> | null,
) {
  if (!interaction) return null;
  const mediaAsset = interaction.mediaAssets[0] ?? null;
  return {
    id: interaction.id,
    provider: interaction.provider,
    providerInteractionId: interaction.providerInteractionId,
    direction: interaction.direction,
    phoneNumber: interaction.phoneNumber,
    queueName: interaction.queueName,
    startedAt: interaction.startedAt.toISOString(),
    durationSeconds:
      mediaAsset?.durationMs != null
        ? Math.round(mediaAsset.durationMs / 1_000)
        : interaction.durationSeconds,
    audioUrl: mediaAsset ? `/api/call-finder/interactions/${interaction.id}/audio` : null,
    recordingExpected: interaction.hasRecording,
    transcript: interaction.transcripts[0] ?? null,
    transcriptionJob: interaction.transcriptionJobs[0] ?? null,
  };
}

function serializeEvidence(
  evidence: Prisma.PerformanceEvidenceGetPayload<{ select: typeof evidenceSelect }>,
) {
  return {
    id: evidence.id,
    type: evidence.type,
    title: evidence.title,
    description: evidence.description,
    startMs: evidence.startMs,
    endMs: evidence.endMs,
    createdAt: evidence.createdAt.toISOString(),
    response: evidence.response
      ? {
          id: evidence.response.id,
          score: Number(evidence.response.score),
          result: evidence.response.result,
          hasFatalFail: evidence.response.hasFatalFail,
          submittedAt: evidence.response.submittedAt?.toISOString() ?? null,
          formVersion: evidence.response.formVersion ?? evidence.response.form.version,
          formTitle: evidence.response.form.title,
          evaluatorName: evidence.response.evaluator.name,
          answers: evidence.response.answers.map((answer) => ({
            ...answer,
            score: answer.score === null ? null : Number(answer.score),
          })),
        }
      : null,
    interaction: serializeInteraction(evidence.interaction),
  };
}

export async function getCoachingCaseDetail(coachingSessionId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  await assertCanViewCoachingSession(session.user, coachingSessionId);

  const coaching = await prisma.coachingSession.findUnique({
    where: { id: coachingSessionId },
    select: {
      id: true,
      title: true,
      focusArea: true,
      behavior: true,
      objective: true,
      strengths: true,
      opportunities: true,
      rootCause: true,
      comments: true,
      source: true,
      status: true,
      scheduledAt: true,
      acknowledgementDueAt: true,
      followUpAt: true,
      startedAt: true,
      endedAt: true,
      createdAt: true,
      campaign: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true, agentCode: true } },
      coach: { select: { id: true, name: true } },
      pipPlan: { select: { id: true, title: true, status: true } },
      actionItems: {
        orderBy: [{ status: "asc" }, { dueAt: "asc" }],
        select: {
          id: true,
          description: true,
          ownerType: true,
          ownerName: true,
          dueAt: true,
          status: true,
          completedAt: true,
          evidenceNote: true,
        },
      },
      acknowledgement: {
        select: {
          status: true,
          method: true,
          agentNameSnapshot: true,
          comment: true,
          acknowledgedAt: true,
          refusedAt: true,
        },
      },
      evidence: { orderBy: { createdAt: "asc" }, select: evidenceSelect },
    },
  });
  if (!coaching) throw new Error("Coaching session unavailable");

  return {
    ...coaching,
    scheduledAt: coaching.scheduledAt?.toISOString() ?? null,
    acknowledgementDueAt: coaching.acknowledgementDueAt?.toISOString() ?? null,
    followUpAt: coaching.followUpAt?.toISOString() ?? null,
    startedAt: coaching.startedAt?.toISOString() ?? null,
    endedAt: coaching.endedAt?.toISOString() ?? null,
    createdAt: coaching.createdAt.toISOString(),
    actionItems: coaching.actionItems.map((item) => ({
      ...item,
      dueAt: item.dueAt?.toISOString() ?? null,
      completedAt: item.completedAt?.toISOString() ?? null,
    })),
    acknowledgement: coaching.acknowledgement
      ? {
          ...coaching.acknowledgement,
          acknowledgedAt: coaching.acknowledgement.acknowledgedAt?.toISOString() ?? null,
          refusedAt: coaching.acknowledgement.refusedAt?.toISOString() ?? null,
        }
      : null,
    evidence: coaching.evidence.map(serializeEvidence),
    viewer: {
      isAgent: isAgentRole(session.user.role),
      canAcknowledge:
        isAgentRole(session.user.role) &&
        coaching.status === "AWAITING_ACKNOWLEDGEMENT" &&
        coaching.acknowledgement?.status === "PENDING",
    },
  };
}

export async function getPipCaseDetail(pipPlanId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  await assertCanViewPipPlan(session.user, pipPlanId);

  const pip = await prisma.pipPlan.findUnique({
    where: { id: pipPlanId },
    select: {
      id: true,
      title: true,
      templateKey: true,
      templateVersion: true,
      reason: true,
      objective: true,
      baselineSummary: true,
      supportSummary: true,
      consequences: true,
      employeeComments: true,
      reviewFrequency: true,
      startDate: true,
      targetEndDate: true,
      midpointDate: true,
      finalReviewDate: true,
      status: true,
      approvedAt: true,
      acknowledgementStatus: true,
      acknowledgementMethod: true,
      acknowledgementComment: true,
      acknowledgedAt: true,
      refusedAt: true,
      outcome: true,
      closureSummary: true,
      closedAt: true,
      createdAt: true,
      campaign: { select: { id: true, name: true } },
      agent: { select: { id: true, name: true, agentCode: true } },
      owner: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      goals: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          area: true,
          baseline: true,
          target: true,
          measurementPeriod: true,
          dataSource: true,
          measurementMethod: true,
          sustainabilityPeriod: true,
          isCritical: true,
          currentResult: true,
          status: true,
        },
      },
      reviews: {
        orderBy: { scheduledAt: "desc" },
        select: {
          id: true,
          scheduledAt: true,
          completedAt: true,
          outcome: true,
          summary: true,
          metricsSnapshot: true,
          barriers: true,
          supportProvided: true,
          nextSteps: true,
          reviewer: { select: { name: true } },
        },
      },
      coachingSessions: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          focusArea: true,
          objective: true,
          status: true,
          createdAt: true,
          evidence: { select: { id: true } },
        },
      },
      evidence: { orderBy: { createdAt: "asc" }, select: evidenceSelect },
    },
  });
  if (!pip) throw new Error("Performance improvement plan unavailable");

  return {
    ...pip,
    startDate: pip.startDate.toISOString(),
    targetEndDate: pip.targetEndDate.toISOString(),
    midpointDate: pip.midpointDate?.toISOString() ?? null,
    finalReviewDate: pip.finalReviewDate?.toISOString() ?? null,
    approvedAt: pip.approvedAt?.toISOString() ?? null,
    acknowledgedAt: pip.acknowledgedAt?.toISOString() ?? null,
    refusedAt: pip.refusedAt?.toISOString() ?? null,
    closedAt: pip.closedAt?.toISOString() ?? null,
    createdAt: pip.createdAt.toISOString(),
    reviews: pip.reviews.map((review) => ({
      ...review,
      scheduledAt: review.scheduledAt.toISOString(),
      completedAt: review.completedAt?.toISOString() ?? null,
    })),
    coachingSessions: pip.coachingSessions.map((coaching) => ({
      ...coaching,
      createdAt: coaching.createdAt.toISOString(),
      evidenceCount: coaching.evidence.length,
      evidence: undefined,
    })),
    evidence: pip.evidence.map(serializeEvidence),
    viewer: {
      isAgent: isAgentRole(session.user.role),
      canAcknowledge:
        isAgentRole(session.user.role) &&
        ["ACTIVE", "ON_HOLD", "EXTENDED"].includes(pip.status) &&
        pip.acknowledgementStatus === "PENDING",
    },
  };
}

export type CoachingCaseDetail = Awaited<ReturnType<typeof getCoachingCaseDetail>>;
export type PipCaseDetail = Awaited<ReturnType<typeof getPipCaseDetail>>;
