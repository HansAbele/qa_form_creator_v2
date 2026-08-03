import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const { authMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  return { prisma: (module as { prismaMock: unknown }).prismaMock };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import {
  approvePipPlan,
  createCoachingSession,
  createPipPlan,
  pauseQaActivity,
  recordPipAcknowledgement,
  startQaActivity,
  submitPipForApproval,
} from "./performance-management";

const qaSession = {
  user: {
    id: "qa-1",
    name: "QA One",
    email: "qa@example.com",
    role: "QA",
    campaignIds: ["campaign-1"],
  },
};

describe("performance management actions", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    authMock.mockResolvedValue(qaSession);
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      userId: "qa-1",
      campaignId: "campaign-1",
      canManageCoaching: true,
      canTrackQaActivity: true,
      canManagePips: false,
    });
    prismaMock.auditLog.create.mockResolvedValue({ id: "audit-1" });
  });

  it("creates campaign-scoped coaching with an acknowledgement trail", async () => {
    prismaMock.agent.findFirst.mockResolvedValue({ id: "agent-1", name: "Agent One" });
    prismaMock.response.findFirst.mockResolvedValue({
      id: "response-1",
      interactionId: "interaction-1",
      score: 86,
      hasFatalFail: false,
      form: { title: "Official scorecard" },
    } as never);
    prismaMock.coachingSession.create.mockResolvedValue({
      id: "coaching-1",
      status: "DRAFT",
      campaignId: "campaign-1",
    });

    await createCoachingSession({
      campaignId: "campaign-1",
      agentId: "agent-1",
      responseId: "response-1",
      pipPlanId: null,
      focusArea: "Documentation",
      objective: "Improve documentation accuracy in every evaluated interaction.",
      scheduledAt: null,
      acknowledgementDueAt: null,
      followUpAt: null,
    });

    expect(prismaMock.coachingSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          campaignId: "campaign-1",
          agentId: "agent-1",
          coachId: "qa-1",
          responseId: "response-1",
          interactionId: "interaction-1",
          title: "Coaching — Documentation",
          behavior: null,
          source: "EVALUATION",
          acknowledgement: {
            create: {
              status: "PENDING",
              agentNameSnapshot: "Agent One",
            },
          },
        }),
      }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "coaching_created",
          entityId: "coaching-1",
        }),
      }),
    );
  });

  it("rejects coaching creation outside the QA campaign scope before data access", async () => {
    await expect(
      createCoachingSession({
        campaignId: "campaign-2",
        agentId: "agent-2",
        responseId: "response-2",
        focusArea: "Quality",
        objective: "This request must be rejected before campaign data is queried.",
      }),
    ).rejects.toThrow("Unauthorized for this campaign");

    expect(prismaMock.agent.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.coachingSession.create).not.toHaveBeenCalled();
  });

  it("allows only one active QA timer per user", async () => {
    prismaMock.qaActivitySession.findFirst.mockResolvedValue({ id: "activity-active" });

    await expect(
      startQaActivity({
        campaignId: "campaign-1",
        activityType: "EVALUATION",
        label: "Weekly QA",
        notes: null,
        responseId: null,
        coachingSessionId: null,
        pipPlanId: null,
      }),
    ).rejects.toThrow("Finish or pause the current timer before starting another");

    expect(prismaMock.qaActivitySession.create).not.toHaveBeenCalled();
  });

  it("closes the open interval and persists elapsed seconds when pausing", async () => {
    prismaMock.qaActivitySession.findFirst.mockResolvedValue({
      id: "activity-1",
      campaignId: "campaign-1",
      status: "ACTIVE",
      totalSeconds: 30,
    });
    prismaMock.qaActivityInterval.findFirst.mockResolvedValue({
      id: "interval-1",
      startedAt: new Date(Date.now() - 10_000),
    });
    prismaMock.qaActivityInterval.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.qaActivitySession.update.mockResolvedValue({
      id: "activity-1",
      status: "PAUSED",
      totalSeconds: 40,
    });

    await pauseQaActivity({ activitySessionId: "activity-1", reason: "Break" });

    expect(prismaMock.qaActivityInterval.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "interval-1", endedAt: null },
        data: expect.objectContaining({
          durationSeconds: expect.any(Number),
          stopReason: "Break",
        }),
      }),
    );
    expect(prismaMock.qaActivitySession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: "PAUSED",
          totalSeconds: { increment: expect.any(Number) },
        },
      }),
    );
  });

  it("reserves PIP approval for the QA Manager role", async () => {
    await expect(approvePipPlan({ pipPlanId: "pip-1" })).rejects.toThrow(
      "Only a QA Manager can approve a PIP",
    );
    expect(prismaMock.pipPlan.findUnique).not.toHaveBeenCalled();
  });

  it("creates a versioned PIP with multiple measurable goals", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      userId: "qa-1",
      campaignId: "campaign-1",
      canManagePips: true,
    });
    prismaMock.agent.findFirst.mockResolvedValue({ id: "agent-1" });
    prismaMock.coachingSession.findMany.mockResolvedValue([{ id: "coaching-1" }]);
    prismaMock.coachingSession.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.pipPlan.create.mockResolvedValue({
      id: "pip-1",
      campaignId: "campaign-1",
      status: "DRAFT",
      templateVersion: "PD-HR-FRM-PIP-001-v1",
    });

    await createPipPlan({
      campaignId: "campaign-1",
      agentId: "agent-1",
      title: "Formal quality improvement plan",
      templateKey: "PARKER_DAVIS",
      reason:
        "Documented quality results remained below the campaign expectation during the review period.",
      objective: "Meet and sustain the written quality expectations for the full PIP period.",
      baselineSummary: "Current documented QA average is 68%.",
      supportSummary: "Weekly coaching and call review.",
      consequences: "The case will proceed to a manager-reviewed closure decision.",
      reviewFrequency: "Weekly",
      startDate: "2026-07-29T12:00:00.000Z",
      targetEndDate: "2026-08-29T12:00:00.000Z",
      midpointDate: "2026-08-13T12:00:00.000Z",
      finalReviewDate: "2026-08-29T12:00:00.000Z",
      evidenceResponseIds: [],
      coachingSessionIds: ["coaching-1"],
      goals: [
        {
          area: "Quality score",
          baseline: "68% average",
          target: "At least 85% weekly",
          dataSource: "Qore evaluations",
          measurementPeriod: "Weekly",
          measurementMethod: "Weekly average of submitted evaluations",
          sustainabilityPeriod: "Three consecutive weeks",
          isCritical: true,
        },
        {
          area: "Documentation",
          baseline: "Three misses in the prior month",
          target: "Zero documentation misses",
          dataSource: "QA scorecard",
          measurementPeriod: "Entire PIP",
          measurementMethod: "Count of failed documentation questions",
          sustainabilityPeriod: "Entire PIP",
          isCritical: false,
        },
      ],
    });

    expect(prismaMock.pipPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          templateVersion: "PD-HR-FRM-PIP-001-v1",
          goals: {
            create: expect.arrayContaining([
              expect.objectContaining({ area: "Quality score", isCritical: true }),
              expect.objectContaining({ area: "Documentation", isCritical: false }),
            ]),
          },
        }),
      }),
    );
  });

  it("enforces the selected PIP template when persisting evaluation evidence", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      userId: "qa-1",
      campaignId: "campaign-1",
      canManagePips: true,
    });
    prismaMock.agent.findFirst.mockResolvedValue({ id: "agent-1" });
    prismaMock.response.findMany.mockResolvedValue([
      {
        id: "response-hapusa-1",
        interactionId: "interaction-1",
        score: 88,
        hasFatalFail: false,
        form: { title: "HAPUSA Call Monitoring Score Card" },
      },
    ] as never);
    prismaMock.pipPlan.create.mockResolvedValue({
      id: "pip-1",
      campaignId: "campaign-1",
      status: "DRAFT",
      templateVersion: "HAPUSA-INDUSTRY-v1",
    });

    await createPipPlan({
      campaignId: "campaign-1",
      agentId: "agent-1",
      title: "HAPUSA quality improvement plan",
      templateKey: "HAPUSA",
      reason:
        "Documented HAPUSA quality results remained below the expected score during the review period.",
      objective: "Meet and sustain the HAPUSA scorecard expectations during the plan.",
      reviewFrequency: "Weekly",
      startDate: "2026-07-29T12:00:00.000Z",
      targetEndDate: "2026-08-29T12:00:00.000Z",
      evidenceResponseIds: ["response-hapusa-1"],
      coachingSessionIds: [],
      goals: [
        {
          area: "Problem solving",
          baseline: "Three documented misses",
          target: "Zero documented misses",
          dataSource: "HAPUSA scorecard",
          isCritical: true,
        },
      ],
    });

    expect(prismaMock.response.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          agentId: "agent-1",
          form: expect.objectContaining({
            campaignId: "campaign-1",
            OR: expect.arrayContaining([
              expect.objectContaining({
                title: expect.objectContaining({
                  contains: "HAPUSA",
                  mode: "insensitive",
                }),
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it("requires a witness method when a PIP acknowledgement is refused", async () => {
    await expect(
      recordPipAcknowledgement({
        pipPlanId: "pip-1",
        status: "REFUSED",
        method: "EMAIL",
        comment: "The employee declined to sign.",
      }),
    ).rejects.toThrow("A refusal must be recorded with a witness");

    expect(prismaMock.pipPlan.findUnique).not.toHaveBeenCalled();
  });

  it("lets the linked agent acknowledge their own active PIP in the portal", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "agent-user-1",
        name: "Agent One",
        email: "agent@example.com",
        role: "AGENT",
        campaignIds: ["campaign-1"],
      },
    });
    prismaMock.pipPlan.findUnique.mockResolvedValue({
      id: "pip-1",
      campaignId: "campaign-1",
      status: "ACTIVE",
      agent: { userId: "agent-user-1", active: true },
    } as never);
    prismaMock.pipPlan.update.mockResolvedValue({
      id: "pip-1",
      acknowledgementStatus: "ACKNOWLEDGED",
      acknowledgedAt: new Date(),
      refusedAt: null,
    } as never);

    await recordPipAcknowledgement({
      pipPlanId: "pip-1",
      status: "ACKNOWLEDGED",
      method: "EMAIL",
      comment: "Reviewed the plan and evidence.",
    });

    expect(prismaMock.userCampaign.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.pipPlan.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pip-1" },
        data: expect.objectContaining({
          acknowledgementStatus: "ACKNOWLEDGED",
          acknowledgementMethod: "COMPANY_SYSTEM",
          acknowledgementWitnessId: null,
        }),
      }),
    );
  });

  it("does not let an agent submit a PIP into the manager approval workflow", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "agent-user-1",
        name: "Agent One",
        email: "agent@example.com",
        role: "AGENT",
        campaignIds: ["campaign-1"],
      },
    });
    prismaMock.pipPlan.findUnique.mockResolvedValue({
      id: "pip-1",
      campaignId: "campaign-1",
      status: "DRAFT",
    } as never);

    await expect(submitPipForApproval({ pipPlanId: "pip-1" })).rejects.toThrow(
      "Agent portal access is limited to personal records",
    );
    expect(prismaMock.pipPlan.update).not.toHaveBeenCalled();
  });
});
