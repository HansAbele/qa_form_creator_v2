"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isAgentRole } from "@/lib/campaign-permissions";
import {
  ACKNOWLEDGEMENT_METHODS,
  availablePipReviewFrequencies,
  canTransitionCoaching,
  canTransitionPip,
  defaultPipTemplateVersion,
  elapsedSeconds,
  PIP_REVIEW_FREQUENCIES,
  PIP_TEMPLATE_KEYS,
  QA_ACTIVITY_TYPES,
} from "@/lib/performance-management";
import { prisma } from "@/lib/prisma";
import { toOperationalDateKey } from "@/lib/operational-time";
import { writeAuditLog } from "@/server/audit-log";
import { assertCampaignPermissionForUser } from "@/server/queries/campaign-filter";

const optionalIsoDate = z.string().datetime().nullish();
const optionalText = z.string().trim().max(5_000).nullish();

const createCoachingSchema = z.object({
  campaignId: z.string().trim().min(1).max(100),
  agentId: z.string().trim().min(1).max(100),
  responseId: z.string().trim().min(1).max(100),
  pipPlanId: z.string().trim().min(1).max(100).nullish(),
  focusArea: z.string().trim().min(2).max(120),
  objective: z.string().trim().min(10).max(5_000),
  scheduledAt: optionalIsoDate,
  acknowledgementDueAt: optionalIsoDate,
  followUpAt: optionalIsoDate,
  startNow: z.boolean().default(false),
});

const startActivitySchema = z.object({
  campaignId: z.string().trim().min(1).max(100),
  activityType: z.enum(QA_ACTIVITY_TYPES),
  label: z.string().trim().max(160).nullish(),
  notes: optionalText,
  responseId: z.string().trim().min(1).max(100).nullish(),
  coachingSessionId: z.string().trim().min(1).max(100).nullish(),
  pipPlanId: z.string().trim().min(1).max(100).nullish(),
});

const activityMutationSchema = z.object({
  activitySessionId: z.string().trim().min(1).max(100),
  reason: z.string().trim().max(500).nullish(),
});

const coachingAcknowledgementSchema = z
  .object({
    coachingSessionId: z.string().trim().min(1).max(100),
    status: z.enum(["ACKNOWLEDGED", "REFUSED"]),
    method: z.enum(ACKNOWLEDGEMENT_METHODS),
    comment: optionalText,
  })
  .superRefine((value, context) => {
    if (value.status === "REFUSED" && value.method !== "WITNESSED") {
      context.addIssue({
        code: "custom",
        path: ["method"],
        message: "A refusal must be recorded with a witness",
      });
    }
  });

const pipGoalSchema = z.object({
  area: z.string().trim().min(2).max(160),
  baseline: z.string().trim().min(3).max(5_000),
  target: z.string().trim().min(3).max(5_000),
  dataSource: z.string().trim().min(2).max(500),
  measurementPeriod: z.string().trim().max(160).nullish(),
  measurementMethod: optionalText,
  sustainabilityPeriod: z.string().trim().max(160).nullish(),
  isCritical: z.boolean().default(false),
});

const createPipSchema = z
  .object({
    campaignId: z.string().trim().min(1).max(100),
    agentId: z.string().trim().min(1).max(100),
    title: z.string().trim().min(3).max(160),
    templateKey: z.enum(PIP_TEMPLATE_KEYS),
    reason: z.string().trim().min(20).max(10_000),
    objective: z.string().trim().min(10).max(10_000),
    baselineSummary: optionalText,
    supportSummary: optionalText,
    consequences: optionalText,
    reviewFrequency: z.enum(PIP_REVIEW_FREQUENCIES).nullish(),
    startDate: z.string().datetime(),
    targetEndDate: z.string().datetime(),
    midpointDate: optionalIsoDate,
    finalReviewDate: optionalIsoDate,
    evidenceResponseIds: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    coachingSessionIds: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    goals: z.array(pipGoalSchema).min(1).max(5),
  })
  .superRefine((value, context) => {
    if (new Date(value.targetEndDate) <= new Date(value.startDate)) {
      context.addIssue({
        code: "custom",
        path: ["targetEndDate"],
        message: "The PIP end date must be after its start date",
      });
    }
    const start = new Date(value.startDate);
    const end = new Date(value.targetEndDate);
    for (const [field, dateValue] of [
      ["midpointDate", value.midpointDate],
      ["finalReviewDate", value.finalReviewDate],
    ] as const) {
      if (dateValue && (new Date(dateValue) < start || new Date(dateValue) > end)) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Review dates must fall within the PIP period",
        });
      }
    }
    if (
      value.reviewFrequency &&
      !availablePipReviewFrequencies(
        value.startDate.slice(0, 10),
        value.targetEndDate.slice(0, 10),
      ).includes(value.reviewFrequency)
    ) {
      context.addIssue({
        code: "custom",
        path: ["reviewFrequency"],
        message: "The selected review frequency does not fit the PIP period",
      });
    }
    if (value.evidenceResponseIds.length === 0 && value.coachingSessionIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidenceResponseIds"],
        message: "A PIP requires at least one evaluation or coaching record as evidence",
      });
    }
  });

function pipTemplateFormFilter(
  templateKey: (typeof PIP_TEMPLATE_KEYS)[number],
): Prisma.FormWhereInput {
  if (templateKey === "HAPUSA") {
    return {
      OR: [
        { title: { contains: "HAPUSA", mode: "insensitive" } },
        { templateKey: { contains: "HAPUSA", mode: "insensitive" } },
      ],
    };
  }
  if (templateKey === "PARKER_DAVIS") {
    return {
      OR: [
        { title: { contains: "Parker Davis", mode: "insensitive" } },
        { templateKey: { contains: "PARKER_DAVIS", mode: "insensitive" } },
      ],
    };
  }
  return {};
}

const pipIdSchema = z.object({ pipPlanId: z.string().trim().min(1).max(100) });
const closePipSchema = pipIdSchema.extend({
  successful: z.boolean(),
  closureSummary: z.string().trim().min(10).max(10_000),
});
const pipReviewSchema = pipIdSchema.extend({
  outcome: z.enum(["ON_TRACK", "AT_RISK", "IMPROVED", "NO_PROGRESS"]),
  summary: z.string().trim().min(5).max(10_000),
  barriers: optionalText,
  supportProvided: optionalText,
  nextSteps: optionalText,
  goalUpdates: z
    .array(
      z.object({
        goalId: z.string().trim().min(1).max(100),
        currentResult: z.string().trim().min(1).max(5_000),
        status: z.enum(["PENDING", "ON_TRACK", "AT_RISK", "MET", "NOT_MET", "NOT_APPLICABLE"]),
      }),
    )
    .max(5)
    .default([]),
});

const pipAcknowledgementSchema = z
  .object({
    pipPlanId: z.string().trim().min(1).max(100),
    status: z.enum(["ACKNOWLEDGED", "REFUSED"]),
    method: z.enum(ACKNOWLEDGEMENT_METHODS),
    comment: optionalText,
  })
  .superRefine((value, context) => {
    if (value.status === "REFUSED" && value.method !== "WITNESSED") {
      context.addIssue({
        code: "custom",
        path: ["method"],
        message: "A refusal must be recorded with a witness",
      });
    }
  });

function parseInput<TSchema extends z.ZodType>(schema: TSchema, input: unknown): z.output<TSchema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid performance management data");
  }
  return parsed.data;
}

function toDate(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

function revalidatePerformanceWorkspace() {
  revalidatePath("/performance");
  revalidatePath("/");
}

async function getPipForMutation(
  user: NonNullable<Awaited<ReturnType<typeof auth>>>["user"],
  pipPlanId: string,
) {
  const pip = await prisma.pipPlan.findUnique({
    where: { id: pipPlanId },
    select: { id: true, campaignId: true, status: true },
  });
  if (!pip) throw new Error("Performance improvement plan unavailable");
  await assertCampaignPermissionForUser(user, pip.campaignId, "canManagePips");
  return pip;
}

async function getCoachingForAcknowledgement(
  user: NonNullable<Awaited<ReturnType<typeof auth>>>["user"],
  coachingSessionId: string,
) {
  const coaching = await prisma.coachingSession.findUnique({
    where: { id: coachingSessionId },
    select: {
      id: true,
      campaignId: true,
      agentId: true,
      status: true,
      agent: { select: { name: true, userId: true, active: true } },
    },
  });
  if (!coaching) throw new Error("Coaching session unavailable");
  if (isAgentRole(user.role)) {
    if (!coaching.agent.active || coaching.agent.userId !== user.id) {
      throw new Error("Coaching session unavailable");
    }
  } else {
    await assertCampaignPermissionForUser(user, coaching.campaignId, "canManageCoaching");
  }
  return coaching;
}

async function getPipForAcknowledgement(
  user: NonNullable<Awaited<ReturnType<typeof auth>>>["user"],
  pipPlanId: string,
) {
  const pip = await prisma.pipPlan.findUnique({
    where: { id: pipPlanId },
    select: {
      id: true,
      campaignId: true,
      status: true,
      agent: { select: { userId: true, active: true } },
    },
  });
  if (!pip) throw new Error("Performance improvement plan unavailable");
  if (isAgentRole(user.role)) {
    if (!pip.agent.active || pip.agent.userId !== user.id) {
      throw new Error("Performance improvement plan unavailable");
    }
  } else {
    await assertCampaignPermissionForUser(user, pip.campaignId, "canManagePips");
  }
  return pip;
}

async function closeOpenInterval(
  tx: Prisma.TransactionClient,
  activitySessionId: string,
  endedAt: Date,
  stopReason?: string | null,
) {
  const interval = await tx.qaActivityInterval.findFirst({
    where: { activitySessionId, endedAt: null },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true },
  });
  if (!interval) return 0;

  const durationSeconds = elapsedSeconds(interval.startedAt, endedAt);
  const closed = await tx.qaActivityInterval.updateMany({
    where: { id: interval.id, endedAt: null },
    data: { endedAt, durationSeconds, stopReason: stopReason?.trim() || null },
  });
  return closed.count === 1 ? durationSeconds : 0;
}

export async function createCoachingSession(data: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const input = parseInput(createCoachingSchema, data);
  await assertCampaignPermissionForUser(session.user, input.campaignId, "canManageCoaching");
  if (input.startNow) {
    await assertCampaignPermissionForUser(session.user, input.campaignId, "canTrackQaActivity");
  }

  const now = new Date();
  const selectedSchedule = input.startNow ? now : toDate(input.scheduledAt);
  if (!selectedSchedule) {
    throw new Error("Choose a time for today's coaching");
  }
  if (toOperationalDateKey(selectedSchedule) !== toOperationalDateKey(now)) {
    throw new Error("Coaching can only be created for today");
  }

  const [agent, response, pipPlan] = await Promise.all([
    prisma.agent.findFirst({
      where: { id: input.agentId, campaignId: input.campaignId, active: true },
      select: { id: true, name: true },
    }),
    prisma.response.findFirst({
      where: {
        id: input.responseId,
        agentId: input.agentId,
        form: { campaignId: input.campaignId },
        status: "SUBMITTED",
      },
      select: {
        id: true,
        interactionId: true,
        score: true,
        hasFatalFail: true,
        form: { select: { title: true } },
      },
    }),
    input.pipPlanId
      ? prisma.pipPlan.findFirst({
          where: { id: input.pipPlanId, campaignId: input.campaignId, agentId: input.agentId },
          select: { id: true },
        })
      : null,
  ]);

  if (!agent) throw new Error("Agent unavailable for this campaign");
  if (!response) throw new Error("Evaluation unavailable for this agent");
  if (input.pipPlanId && !pipPlan) throw new Error("PIP unavailable for this agent");

  const coaching = await prisma.$transaction(async (tx) => {
    if (input.startNow) {
      const currentActivity = await tx.qaActivitySession.findFirst({
        where: { userId: session.user.id, status: "ACTIVE" },
        select: { id: true },
      });
      if (currentActivity) {
        throw new Error("Finish or pause the current timer before starting coaching now");
      }
    }

    const created = await tx.coachingSession.create({
      data: {
        campaignId: input.campaignId,
        agentId: input.agentId,
        coachId: session.user.id,
        createdById: session.user.id,
        responseId: response.id,
        interactionId: response.interactionId,
        pipPlanId: pipPlan?.id ?? null,
        title: `Coaching — ${input.focusArea}`,
        focusArea: input.focusArea,
        behavior: null,
        objective: input.objective,
        source: response.hasFatalFail ? "CRITICAL_FAILURE" : "EVALUATION",
        status: input.startNow ? "IN_PROGRESS" : "SCHEDULED",
        scheduledAt: selectedSchedule,
        startedAt: input.startNow ? now : null,
        acknowledgementDueAt: toDate(input.acknowledgementDueAt),
        followUpAt: toDate(input.followUpAt),
        acknowledgement: {
          create: {
            status: "PENDING",
            agentNameSnapshot: agent.name,
          },
        },
        evidence: {
          create: {
            campaignId: input.campaignId,
            responseId: response.id,
            interactionId: response.interactionId,
            createdById: session.user.id,
            type: "EVALUATION",
            title: response.form.title,
            description: `${Number(response.score).toFixed(2)}%${response.hasFatalFail ? " · Critical failure" : ""}`,
          },
        },
      },
      select: { id: true, status: true, campaignId: true },
    });

    if (input.startNow) {
      await tx.qaActivitySession.create({
        data: {
          userId: session.user.id,
          campaignId: input.campaignId,
          activityType: "COACHING_LIVE",
          label: `Coaching — ${input.focusArea}`,
          responseId: response.id,
          coachingSessionId: created.id,
          pipPlanId: pipPlan?.id ?? null,
          startedAt: now,
          intervals: { create: { startedAt: now } },
        },
      });
    }

    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: input.campaignId,
        module: "performance_management",
        action: "coaching_created",
        entityType: "coaching_session",
        entityId: created.id,
        afterValue: {
          agentId: input.agentId,
          responseId: response.id,
          pipPlanId: pipPlan?.id ?? null,
          source: response.hasFatalFail ? "CRITICAL_FAILURE" : "EVALUATION",
          status: created.status,
          startNow: input.startNow,
          evidenceType: "EVALUATION",
          actionItemCount: 0,
        },
        impact: "A campaign-scoped coaching record and acknowledgement trail were created.",
      },
      tx,
    );

    return created;
  });

  revalidatePerformanceWorkspace();
  return coaching;
}

export async function startQaActivity(data: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const input = parseInput(startActivitySchema, data);
  await assertCampaignPermissionForUser(session.user, input.campaignId, "canTrackQaActivity");

  if (input.activityType === "COACHING_LIVE" && !input.coachingSessionId) {
    throw new Error("Live coaching time must be linked to a coaching session");
  }

  const [response, coaching, pipPlan] = await Promise.all([
    input.responseId
      ? prisma.response.findFirst({
          where: { id: input.responseId, form: { campaignId: input.campaignId } },
          select: { id: true },
        })
      : null,
    input.coachingSessionId
      ? prisma.coachingSession.findFirst({
          where: { id: input.coachingSessionId, campaignId: input.campaignId },
          select: { id: true, status: true, startedAt: true },
        })
      : null,
    input.pipPlanId
      ? prisma.pipPlan.findFirst({
          where: { id: input.pipPlanId, campaignId: input.campaignId },
          select: { id: true },
        })
      : null,
  ]);
  if (input.responseId && !response) throw new Error("Evaluation unavailable for this campaign");
  if (input.coachingSessionId && !coaching) {
    throw new Error("Coaching session unavailable for this campaign");
  }
  if (input.pipPlanId && !pipPlan) throw new Error("PIP unavailable for this campaign");
  if (
    input.activityType === "COACHING_LIVE" &&
    coaching &&
    coaching.status !== "IN_PROGRESS" &&
    !canTransitionCoaching(coaching.status, "IN_PROGRESS")
  ) {
    throw new Error("This coaching session cannot be started");
  }

  const now = new Date();
  try {
    const activity = await prisma.$transaction(async (tx) => {
      const existing = await tx.qaActivitySession.findFirst({
        where: { userId: session.user.id, status: "ACTIVE" },
        select: { id: true },
      });
      if (existing) throw new Error("Finish or pause the current timer before starting another");

      if (input.activityType === "COACHING_LIVE" && coaching) {
        const existingCoachingTimer = await tx.qaActivitySession.findFirst({
          where: {
            coachingSessionId: coaching.id,
            activityType: "COACHING_LIVE",
            status: { in: ["ACTIVE", "PAUSED"] },
          },
          select: { id: true },
        });
        if (existingCoachingTimer) {
          throw new Error("This coaching session already has a timer that can be resumed");
        }

        await tx.coachingSession.update({
          where: { id: coaching.id },
          data: {
            status: "IN_PROGRESS",
            startedAt: coaching.startedAt ?? now,
          },
        });
      }

      const created = await tx.qaActivitySession.create({
        data: {
          userId: session.user.id,
          campaignId: input.campaignId,
          activityType: input.activityType,
          label: input.label || null,
          notes: input.notes || null,
          responseId: response?.id ?? null,
          coachingSessionId: coaching?.id ?? null,
          pipPlanId: pipPlan?.id ?? null,
          startedAt: now,
          intervals: { create: { startedAt: now } },
        },
        select: {
          id: true,
          campaignId: true,
          activityType: true,
          status: true,
          startedAt: true,
        },
      });

      await writeAuditLog(
        {
          userId: session.user.id,
          campaignId: input.campaignId,
          module: "performance_management",
          action: "qa_activity_started",
          entityType: "qa_activity_session",
          entityId: created.id,
          afterValue: {
            activityType: created.activityType,
            responseId: response?.id ?? null,
            coachingSessionId: coaching?.id ?? null,
            pipPlanId: pipPlan?.id ?? null,
          },
          impact: "Server-side QA activity timing started.",
        },
        tx,
      );

      return created;
    });

    revalidatePerformanceWorkspace();
    return activity;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("Finish or pause the current timer before starting another");
    }
    throw error;
  }
}

export async function pauseQaActivity(data: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const input = parseInput(activityMutationSchema, data);
  const activity = await prisma.qaActivitySession.findFirst({
    where: { id: input.activitySessionId, userId: session.user.id },
    select: { id: true, campaignId: true, status: true, totalSeconds: true },
  });
  if (!activity) throw new Error("Activity timer unavailable");
  await assertCampaignPermissionForUser(session.user, activity.campaignId, "canTrackQaActivity");
  if (activity.status !== "ACTIVE") throw new Error("Only an active timer can be paused");

  const now = new Date();
  const paused = await prisma.$transaction(async (tx) => {
    const addedSeconds = await closeOpenInterval(tx, activity.id, now, input.reason);
    const updated = await tx.qaActivitySession.update({
      where: { id: activity.id },
      data: {
        status: "PAUSED",
        totalSeconds: { increment: addedSeconds },
      },
      select: { id: true, status: true, totalSeconds: true },
    });

    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: activity.campaignId,
        module: "performance_management",
        action: "qa_activity_paused",
        entityType: "qa_activity_session",
        entityId: activity.id,
        afterValue: { addedSeconds, totalSeconds: updated.totalSeconds, reason: input.reason },
        impact: "The active interval was closed and retained for reporting.",
      },
      tx,
    );
    return updated;
  });

  revalidatePerformanceWorkspace();
  return paused;
}

export async function resumeQaActivity(data: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const input = parseInput(activityMutationSchema, data);
  const activity = await prisma.qaActivitySession.findFirst({
    where: { id: input.activitySessionId, userId: session.user.id },
    select: { id: true, campaignId: true, status: true },
  });
  if (!activity) throw new Error("Activity timer unavailable");
  await assertCampaignPermissionForUser(session.user, activity.campaignId, "canTrackQaActivity");
  if (activity.status !== "PAUSED") throw new Error("Only a paused timer can be resumed");

  const now = new Date();
  try {
    const resumed = await prisma.$transaction(async (tx) => {
      const existing = await tx.qaActivitySession.findFirst({
        where: { userId: session.user.id, status: "ACTIVE" },
        select: { id: true },
      });
      if (existing) throw new Error("Finish or pause the current timer before resuming another");

      await tx.qaActivityInterval.create({
        data: { activitySessionId: activity.id, startedAt: now },
      });
      const updated = await tx.qaActivitySession.update({
        where: { id: activity.id },
        data: { status: "ACTIVE" },
        select: { id: true, status: true, totalSeconds: true, startedAt: true },
      });
      await writeAuditLog(
        {
          userId: session.user.id,
          campaignId: activity.campaignId,
          module: "performance_management",
          action: "qa_activity_resumed",
          entityType: "qa_activity_session",
          entityId: activity.id,
          impact: "A new server-side activity interval was opened.",
        },
        tx,
      );
      return updated;
    });

    revalidatePerformanceWorkspace();
    return resumed;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("Finish or pause the current timer before resuming another");
    }
    throw error;
  }
}

export async function finishQaActivity(data: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const input = parseInput(activityMutationSchema, data);
  const activity = await prisma.qaActivitySession.findFirst({
    where: { id: input.activitySessionId, userId: session.user.id },
    select: {
      id: true,
      campaignId: true,
      status: true,
      totalSeconds: true,
      activityType: true,
      coachingSessionId: true,
    },
  });
  if (!activity) throw new Error("Activity timer unavailable");
  await assertCampaignPermissionForUser(session.user, activity.campaignId, "canTrackQaActivity");
  if (!["ACTIVE", "PAUSED"].includes(activity.status)) {
    throw new Error("This timer is already closed");
  }

  const now = new Date();
  const finished = await prisma.$transaction(async (tx) => {
    const addedSeconds =
      activity.status === "ACTIVE"
        ? await closeOpenInterval(tx, activity.id, now, input.reason)
        : 0;
    const updated = await tx.qaActivitySession.update({
      where: { id: activity.id },
      data: {
        status: "COMPLETED",
        endedAt: now,
        totalSeconds: { increment: addedSeconds },
      },
      select: { id: true, status: true, totalSeconds: true, endedAt: true },
    });

    if (activity.activityType === "COACHING_LIVE" && activity.coachingSessionId) {
      await tx.coachingSession.update({
        where: { id: activity.coachingSessionId },
        data: {
          status: "AWAITING_ACKNOWLEDGEMENT",
          endedAt: now,
        },
      });
    }

    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: activity.campaignId,
        module: "performance_management",
        action: "qa_activity_completed",
        entityType: "qa_activity_session",
        entityId: activity.id,
        afterValue: {
          addedSeconds,
          totalSeconds: updated.totalSeconds,
          coachingSessionId: activity.coachingSessionId,
        },
        impact:
          activity.activityType === "COACHING_LIVE"
            ? "The coaching timer ended and the session moved to acknowledgement."
            : "The activity timer ended and was retained for workload reporting.",
      },
      tx,
    );
    return updated;
  });

  revalidatePerformanceWorkspace();
  return finished;
}

export async function recordCoachingAcknowledgement(data: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const input = parseInput(coachingAcknowledgementSchema, data);
  const coaching = await getCoachingForAcknowledgement(session.user, input.coachingSessionId);
  if (coaching.status !== "AWAITING_ACKNOWLEDGEMENT") {
    throw new Error("This coaching session is not awaiting acknowledgement");
  }

  const now = new Date();
  const acknowledgementMethod = isAgentRole(session.user.role) ? "COMPANY_SYSTEM" : input.method;
  const witnessUserId =
    !isAgentRole(session.user.role) && input.status === "REFUSED" ? session.user.id : null;
  const result = await prisma.$transaction(async (tx) => {
    const acknowledgement = await tx.coachingAcknowledgement.upsert({
      where: { coachingSessionId: coaching.id },
      create: {
        coachingSessionId: coaching.id,
        status: input.status,
        method: acknowledgementMethod,
        agentNameSnapshot: coaching.agent.name,
        comment: input.comment || null,
        acknowledgedAt: input.status === "ACKNOWLEDGED" ? now : null,
        refusedAt: input.status === "REFUSED" ? now : null,
        witnessUserId,
      },
      update: {
        status: input.status,
        method: acknowledgementMethod,
        comment: input.comment || null,
        acknowledgedAt: input.status === "ACKNOWLEDGED" ? now : null,
        refusedAt: input.status === "REFUSED" ? now : null,
        witnessUserId,
      },
      select: { id: true, status: true, acknowledgedAt: true, refusedAt: true },
    });
    await tx.coachingSession.update({
      where: { id: coaching.id },
      data: { status: "COMPLETED", closedAt: now },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: coaching.campaignId,
        module: "performance_management",
        action:
          input.status === "ACKNOWLEDGED"
            ? "coaching_acknowledged"
            : "coaching_acknowledgement_refused",
        entityType: "coaching_session",
        entityId: coaching.id,
        afterValue: {
          status: input.status,
          method: acknowledgementMethod,
          witnessUserId,
        },
        impact: "The coaching notification outcome was recorded and the session was closed.",
      },
      tx,
    );
    return acknowledgement;
  });

  revalidatePerformanceWorkspace();
  return result;
}

export async function createPipPlan(data: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const input = parseInput(createPipSchema, data);
  await assertCampaignPermissionForUser(session.user, input.campaignId, "canManagePips");

  const [agent, evidenceResponses, linkedCoachings] = await Promise.all([
    prisma.agent.findFirst({
      where: { id: input.agentId, campaignId: input.campaignId, active: true },
      select: { id: true },
    }),
    input.evidenceResponseIds.length > 0
      ? prisma.response.findMany({
          where: {
            id: { in: [...new Set(input.evidenceResponseIds)] },
            agentId: input.agentId,
            status: "SUBMITTED",
            form: {
              campaignId: input.campaignId,
              ...pipTemplateFormFilter(input.templateKey),
            },
          },
          select: {
            id: true,
            interactionId: true,
            score: true,
            hasFatalFail: true,
            form: { select: { title: true } },
          },
        })
      : Promise.resolve([]),
    input.coachingSessionIds.length > 0
      ? prisma.coachingSession.findMany({
          where: {
            id: { in: [...new Set(input.coachingSessionIds)] },
            campaignId: input.campaignId,
            agentId: input.agentId,
            pipPlanId: null,
          },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);
  if (!agent) throw new Error("Agent unavailable for this campaign");
  if (evidenceResponses.length !== new Set(input.evidenceResponseIds).size) {
    throw new Error("One or more PIP evaluations are unavailable for this agent");
  }
  if (linkedCoachings.length !== new Set(input.coachingSessionIds).size) {
    throw new Error("One or more coaching records are unavailable for this agent");
  }

  const pip = await prisma.$transaction(async (tx) => {
    const created = await tx.pipPlan.create({
      data: {
        campaignId: input.campaignId,
        agentId: input.agentId,
        ownerId: session.user.id,
        createdById: session.user.id,
        title: input.title,
        templateKey: input.templateKey,
        templateVersion: defaultPipTemplateVersion(input.templateKey),
        reason: input.reason,
        objective: input.objective,
        baselineSummary: input.baselineSummary || null,
        supportSummary: input.supportSummary || null,
        consequences: input.consequences || null,
        reviewFrequency: input.reviewFrequency || null,
        startDate: new Date(input.startDate),
        targetEndDate: new Date(input.targetEndDate),
        midpointDate: toDate(input.midpointDate),
        finalReviewDate: toDate(input.finalReviewDate),
        goals: {
          create: input.goals.map((goal) => ({
            area: goal.area,
            baseline: goal.baseline,
            target: goal.target,
            dataSource: goal.dataSource,
            measurementPeriod: goal.measurementPeriod || null,
            measurementMethod: goal.measurementMethod || null,
            sustainabilityPeriod: goal.sustainabilityPeriod || null,
            isCritical: goal.isCritical,
          })),
        },
        evidence:
          evidenceResponses.length > 0
            ? {
                create: evidenceResponses.map((response) => ({
                  campaignId: input.campaignId,
                  responseId: response.id,
                  interactionId: response.interactionId,
                  createdById: session.user.id,
                  type: "EVALUATION" as const,
                  title: response.form.title,
                  description: `${Number(response.score).toFixed(2)}%${response.hasFatalFail ? " · Critical failure" : ""}`,
                })),
              }
            : undefined,
      },
      select: { id: true, campaignId: true, status: true, templateVersion: true },
    });

    if (linkedCoachings.length > 0) {
      await tx.coachingSession.updateMany({
        where: { id: { in: linkedCoachings.map((coaching) => coaching.id) } },
        data: { pipPlanId: created.id },
      });
    }

    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: input.campaignId,
        module: "performance_management",
        action: "pip_created",
        entityType: "pip_plan",
        entityId: created.id,
        afterValue: {
          agentId: input.agentId,
          templateKey: input.templateKey,
          templateVersion: created.templateVersion,
          status: created.status,
          goalCount: input.goals.length,
          criticalGoalCount: input.goals.filter((goal) => goal.isCritical).length,
          evidenceCount: evidenceResponses.length,
          coachingCount: linkedCoachings.length,
        },
        impact: "A versioned PIP draft and its first measurable goal were created.",
      },
      tx,
    );
    return created;
  });

  revalidatePerformanceWorkspace();
  return pip;
}

export async function submitPipForApproval(data: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const input = parseInput(pipIdSchema, data);
  const pip = await getPipForMutation(session.user, input.pipPlanId);
  if (!canTransitionPip(pip.status, "PENDING_APPROVAL")) {
    throw new Error("This PIP cannot be submitted for approval");
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.pipPlan.update({
      where: { id: pip.id },
      data: { status: "PENDING_APPROVAL" },
      select: { id: true, status: true },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: pip.campaignId,
        module: "performance_management",
        action: "pip_submitted_for_approval",
        entityType: "pip_plan",
        entityId: pip.id,
        beforeValue: { status: pip.status },
        afterValue: { status: updated.status },
        impact: "The PIP was locked into the manager approval workflow.",
      },
      tx,
    );
    return updated;
  });

  revalidatePerformanceWorkspace();
  return result;
}

export async function approvePipPlan(data: unknown) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("Only a QA Manager can approve a PIP");
  }

  const input = parseInput(pipIdSchema, data);
  const pip = await prisma.pipPlan.findUnique({
    where: { id: input.pipPlanId },
    select: { id: true, campaignId: true, status: true },
  });
  if (!pip) throw new Error("Performance improvement plan unavailable");
  if (!canTransitionPip(pip.status, "ACTIVE")) {
    throw new Error("Only a PIP pending approval can be activated");
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.pipPlan.update({
      where: { id: pip.id },
      data: { status: "ACTIVE", approvedById: session.user.id, approvedAt: now },
      select: { id: true, status: true, approvedAt: true },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: pip.campaignId,
        module: "performance_management",
        action: "pip_approved",
        entityType: "pip_plan",
        entityId: pip.id,
        beforeValue: { status: pip.status },
        afterValue: { status: updated.status, approvedAt: now },
        impact: "The QA Manager approved and activated the PIP.",
      },
      tx,
    );
    return updated;
  });

  revalidatePerformanceWorkspace();
  return result;
}

export async function addPipReview(data: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const input = parseInput(pipReviewSchema, data);
  const pip = await getPipForMutation(session.user, input.pipPlanId);
  if (!["ACTIVE", "ON_HOLD", "EXTENDED"].includes(pip.status)) {
    throw new Error("Reviews can only be recorded for an active PIP");
  }

  const goalIds = [...new Set(input.goalUpdates.map((update) => update.goalId))];
  if (goalIds.length !== input.goalUpdates.length) {
    throw new Error("Each PIP goal may be updated only once per review");
  }
  if (goalIds.length > 0) {
    const goals = await prisma.pipGoal.findMany({
      where: { pipPlanId: pip.id, id: { in: goalIds } },
      select: { id: true },
    });
    if (goals.length !== goalIds.length) {
      throw new Error("One or more goals are unavailable for this PIP");
    }
  }

  const now = new Date();
  const review = await prisma.$transaction(async (tx) => {
    const created = await tx.pipReview.create({
      data: {
        pipPlanId: pip.id,
        reviewerId: session.user.id,
        scheduledAt: now,
        completedAt: now,
        outcome: input.outcome,
        summary: input.summary,
        barriers: input.barriers || null,
        supportProvided: input.supportProvided || null,
        nextSteps: input.nextSteps || null,
      },
      select: { id: true, outcome: true, completedAt: true },
    });
    await Promise.all(
      input.goalUpdates.map((goal) =>
        tx.pipGoal.update({
          where: { id: goal.goalId },
          data: {
            currentResult: goal.currentResult,
            status: goal.status,
          },
        }),
      ),
    );
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: pip.campaignId,
        module: "performance_management",
        action: "pip_review_recorded",
        entityType: "pip_review",
        entityId: created.id,
        afterValue: {
          pipPlanId: pip.id,
          outcome: input.outcome,
          goalUpdateCount: input.goalUpdates.length,
        },
        impact: "A dated PIP checkpoint, support record, and next steps were documented.",
      },
      tx,
    );
    return created;
  });

  revalidatePerformanceWorkspace();
  return review;
}

export async function recordPipAcknowledgement(data: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const input = parseInput(pipAcknowledgementSchema, data);
  const pip = await getPipForAcknowledgement(session.user, input.pipPlanId);
  if (!["ACTIVE", "ON_HOLD", "EXTENDED"].includes(pip.status)) {
    throw new Error("Only an active PIP can be acknowledged");
  }

  const now = new Date();
  const acknowledgementMethod = isAgentRole(session.user.role) ? "COMPANY_SYSTEM" : input.method;
  const witnessUserId =
    !isAgentRole(session.user.role) && input.status === "REFUSED" ? session.user.id : null;
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.pipPlan.update({
      where: { id: pip.id },
      data: {
        acknowledgementStatus: input.status,
        acknowledgementMethod,
        acknowledgementComment: input.comment || null,
        acknowledgedAt: input.status === "ACKNOWLEDGED" ? now : null,
        refusedAt: input.status === "REFUSED" ? now : null,
        acknowledgementWitnessId: witnessUserId,
      },
      select: {
        id: true,
        acknowledgementStatus: true,
        acknowledgedAt: true,
        refusedAt: true,
      },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: pip.campaignId,
        module: "performance_management",
        action:
          input.status === "ACKNOWLEDGED" ? "pip_acknowledged" : "pip_acknowledgement_refused",
        entityType: "pip_plan",
        entityId: pip.id,
        afterValue: {
          acknowledgementStatus: input.status,
          method: acknowledgementMethod,
          witnessUserId,
        },
        impact: "The PIP notification outcome and receipt evidence were recorded.",
      },
      tx,
    );
    return updated;
  });

  revalidatePerformanceWorkspace();
  return result;
}

export async function closePipPlan(data: unknown) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("Only a QA Manager can close a PIP");
  }

  const input = parseInput(closePipSchema, data);
  const pip = await prisma.pipPlan.findUnique({
    where: { id: input.pipPlanId },
    select: { id: true, campaignId: true, status: true },
  });
  if (!pip) throw new Error("Performance improvement plan unavailable");
  const nextStatus = input.successful
    ? ("COMPLETED_SUCCESSFULLY" as const)
    : ("COMPLETED_UNSUCCESSFULLY" as const);
  if (!canTransitionPip(pip.status, nextStatus)) {
    throw new Error("This PIP cannot be closed from its current status");
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.pipPlan.update({
      where: { id: pip.id },
      data: {
        status: nextStatus,
        outcome: input.successful ? "SUCCESSFUL" : "UNSUCCESSFUL",
        closureSummary: input.closureSummary,
        closedAt: now,
      },
      select: { id: true, status: true, closedAt: true },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: pip.campaignId,
        module: "performance_management",
        action: "pip_closed",
        entityType: "pip_plan",
        entityId: pip.id,
        beforeValue: { status: pip.status },
        afterValue: {
          status: updated.status,
          closedAt: now,
          closureSummary: input.closureSummary,
        },
        impact: "The PIP received a manager-approved final outcome and closure record.",
      },
      tx,
    );
    return updated;
  });

  revalidatePerformanceWorkspace();
  return result;
}
