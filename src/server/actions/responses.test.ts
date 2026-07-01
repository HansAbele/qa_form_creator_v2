import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const { authMock, getCampaignScoringSettingsMock, revalidatePathMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getCampaignScoringSettingsMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/settings", () => ({
  getCampaignScoringSettings: getCampaignScoringSettingsMock,
}));

vi.mock("@/lib/prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  const mockedPrisma = (module as { prismaMock: unknown }).prismaMock;
  return { prisma: mockedPrisma };
});

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

import { cancelResponse, saveResponseDraft, submitResponse } from "./responses";

const qaUser = {
  id: "qa-1",
  role: "QA",
  campaignIds: ["campaign-1"],
};

function validForm() {
  return {
    id: "form-1",
    campaignId: "campaign-1",
    version: "1.0.0",
    questions: [
      {
        id: "q-rating",
        type: "RATING",
        label: "Rating",
        required: true,
        options: null,
        fatalOptions: null,
        weight: 0,
        fatal: false,
        requiresCommentOnFail: false,
        formCategory: {
          qaCategoryId: "qa-soft-skills",
        },
      },
      {
        id: "q-select",
        type: "SELECT",
        label: "Disposition",
        required: true,
        options: ["Good", "Bad"],
        fatalOptions: null,
        weight: 0,
        fatal: false,
        requiresCommentOnFail: false,
        formCategory: {
          qaCategoryId: "qa-process",
        },
      },
      {
        id: "q-comment",
        type: "TEXT",
        label: "Comment",
        required: false,
        options: null,
        fatalOptions: null,
        weight: 0,
        fatal: false,
        requiresCommentOnFail: false,
        formCategory: null,
      },
    ],
  };
}

describe("submitResponse validation and RBAC", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    getCampaignScoringSettingsMock.mockReset();
    revalidatePathMock.mockReset();
    authMock.mockResolvedValue({ user: qaUser });
    getCampaignScoringSettingsMock.mockResolvedValue({
      campaignId: "campaign-1",
      usesGlobalDefaults: true,
      passThreshold: 70,
      targetPassRate: 85,
      targetAvgScore: 80,
      targetDailyRate: 20,
      fatalFailuresAllowed: 0,
    });
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canEvaluate: true,
    });
    prismaMock.form.findUnique.mockResolvedValue(validForm());
    prismaMock.agent.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      active: true,
    });
    prismaMock.disposition.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      active: true,
    });
    prismaMock.$transaction.mockImplementation((callback) => callback(prismaMock));
    prismaMock.response.create.mockResolvedValue({ id: "response-1", score: 80 });
    prismaMock.response.update.mockResolvedValue({ id: "response-1", score: 80 });
  });

  it("creates a response only when form, agent and disposition share the campaign", async () => {
    await expect(
      submitResponse({
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [
          { questionId: "q-rating", value: "4" },
          { questionId: "q-select", value: "Good" },
        ],
      }),
    ).resolves.toEqual({ id: "response-1", score: 80 });

    expect(prismaMock.response.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          formId: "form-1",
          agentId: "agent-1",
          evaluatorId: "qa-1",
          dispositionId: "disp-1",
          formVersion: "1.0.0",
          hasFatalFail: false,
          result: "PASS",
        }),
      }),
    );
  });

  it("rejects an agent from another campaign", async () => {
    prismaMock.agent.findUnique.mockResolvedValue({
      campaignId: "campaign-2",
      active: true,
    });

    await expect(
      submitResponse({
        formId: "form-1",
        agentId: "agent-2",
        dispositionId: "disp-1",
        answers: [
          { questionId: "q-rating", value: "4" },
          { questionId: "q-select", value: "Good" },
        ],
      }),
    ).rejects.toThrow("Agente invalido para esta campana");
  });

  it("rejects arbitrary select answers outside the form definition", async () => {
    await expect(
      submitResponse({
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [
          { questionId: "q-rating", value: "4" },
          { questionId: "q-select", value: "Other campaign data" },
        ],
      }),
    ).rejects.toThrow("Respuesta no pertenece a las opciones del formulario");
  });

  it("rejects duplicate answers for the same question", async () => {
    await expect(
      submitResponse({
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [
          { questionId: "q-rating", value: "4" },
          { questionId: "q-rating", value: "5" },
          { questionId: "q-select", value: "Good" },
        ],
      }),
    ).rejects.toThrow("Respuesta duplicada para una pregunta");
  });

  it("calculates weighted rating score and stores answer metadata", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      ...validForm(),
      questions: [
        {
          id: "q-resolution",
          type: "RATING",
          label: "Resolution",
          required: true,
          options: null,
          fatalOptions: null,
          weight: 80,
          fatal: false,
          requiresCommentOnFail: false,
          formCategory: { qaCategoryId: "qa-resolution" },
        },
        {
          id: "q-soft",
          type: "RATING",
          label: "Soft skills",
          required: true,
          options: null,
          fatalOptions: null,
          weight: 20,
          fatal: false,
          requiresCommentOnFail: false,
          formCategory: { qaCategoryId: "qa-soft" },
        },
      ],
    });

    await submitResponse({
      formId: "form-1",
      agentId: "agent-1",
      dispositionId: "disp-1",
      answers: [
        { questionId: "q-resolution", value: "5" },
        { questionId: "q-soft", value: "1" },
      ],
    });

    expect(prismaMock.response.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          score: 84,
          result: "PASS",
          answers: {
            create: [
              expect.objectContaining({
                questionId: "q-resolution",
                categoryId: "qa-resolution",
                score: 100,
                isFatalFail: false,
              }),
              expect.objectContaining({
                questionId: "q-soft",
                categoryId: "qa-soft",
                score: 20,
                isFatalFail: false,
              }),
            ],
          },
        }),
      }),
    );
  });

  it("excludes N/A rating answers from the score denominator", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      ...validForm(),
      questions: [
        {
          id: "q-resolution",
          type: "RATING",
          label: "Resolution",
          required: true,
          options: null,
          fatalOptions: null,
          weight: 80,
          fatal: false,
          requiresCommentOnFail: false,
          formCategory: { qaCategoryId: "qa-resolution" },
        },
        {
          id: "q-soft",
          type: "RATING",
          label: "Soft skills",
          required: true,
          options: null,
          fatalOptions: null,
          weight: 20,
          fatal: false,
          requiresCommentOnFail: false,
          formCategory: { qaCategoryId: "qa-soft" },
        },
      ],
    });

    await submitResponse({
      formId: "form-1",
      agentId: "agent-1",
      dispositionId: "disp-1",
      answers: [
        { questionId: "q-resolution", value: "5" },
        { questionId: "q-soft", value: "", notApplicable: true },
      ],
    });

    expect(prismaMock.response.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          score: 100,
          result: "PASS",
          answers: {
            create: [
              expect.objectContaining({
                questionId: "q-resolution",
                score: 100,
                notApplicable: false,
              }),
              expect.objectContaining({
                questionId: "q-soft",
                score: undefined,
                notApplicable: true,
              }),
            ],
          },
        }),
      }),
    );
  });

  it("saves incomplete evaluations as drafts without publishing to KPIs", async () => {
    await saveResponseDraft({
      formId: "form-1",
      agentId: "agent-1",
      dispositionId: "disp-1",
      answers: [{ questionId: "q-rating", value: "4" }],
    });

    expect(prismaMock.response.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "DRAFT",
          result: null,
          submittedAt: null,
        }),
      }),
    );
  });

  it("edits submitted evaluations only with canEditEvaluations and audits before/after", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canEditEvaluations: true,
    });
    prismaMock.response.findUnique.mockResolvedValue({
      id: "response-1",
      formId: "form-1",
      agentId: "agent-1",
      evaluatorId: "qa-2",
      dispositionId: "disp-1",
      score: 60,
      result: "FAIL",
      hasFatalFail: false,
      status: "SUBMITTED",
      createdAt: new Date("2026-05-01T00:00:00Z"),
      submittedAt: new Date("2026-05-01T00:00:00Z"),
      cancellationReason: null,
      form: { campaignId: "campaign-1" },
      answers: [
        {
          questionId: "q-rating",
          value: "3",
          score: 60,
          comment: null,
          isFatalFail: false,
          notApplicable: false,
        },
      ],
    });

    await submitResponse({
      responseId: "response-1",
      formId: "form-1",
      agentId: "agent-1",
      dispositionId: "disp-1",
      answers: [
        { questionId: "q-rating", value: "5" },
        { questionId: "q-select", value: "Good" },
      ],
    });

    expect(prismaMock.response.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "response-1" },
        data: expect.objectContaining({
          status: "SUBMITTED",
          score: 100,
          result: "PASS",
          answers: expect.objectContaining({
            deleteMany: {},
          }),
        }),
      }),
    );
  });

  it("cancels submitted evaluations with canEditEvaluations", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canEditEvaluations: true,
    });
    prismaMock.response.findUnique.mockResolvedValue({
      id: "response-1",
      formId: "form-1",
      agentId: "agent-1",
      evaluatorId: "qa-2",
      dispositionId: "disp-1",
      score: 80,
      result: "PASS",
      hasFatalFail: false,
      status: "SUBMITTED",
      createdAt: new Date("2026-05-01T00:00:00Z"),
      submittedAt: new Date("2026-05-01T00:00:00Z"),
      cancellationReason: null,
      form: { campaignId: "campaign-1" },
      answers: [],
    });

    await cancelResponse({ id: "response-1", reason: "Duplicated evaluation" });

    expect(prismaMock.response.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "response-1" },
        data: expect.objectContaining({
          status: "CANCELLED",
          cancelledById: "qa-1",
          cancellationReason: "Duplicated evaluation",
        }),
      }),
    );
  });

  it("marks a fatal failed rating as FAIL even when the weighted score passes", async () => {
    // Fatal question rated 2/5 (below the <3 fail threshold) but the overall
    // weighted score is 88 (≥70): the critical overlay must still force FAIL.
    prismaMock.form.findUnique.mockResolvedValue({
      ...validForm(),
      questions: [
        {
          id: "q-fatal",
          type: "RATING",
          label: "Compliance",
          required: true,
          options: null,
          fatalOptions: null,
          weight: 20,
          fatal: true,
          requiresCommentOnFail: true,
          formCategory: { qaCategoryId: "qa-compliance" },
        },
        {
          id: "q-quality",
          type: "RATING",
          label: "Quality",
          required: true,
          options: null,
          fatalOptions: null,
          weight: 80,
          fatal: false,
          requiresCommentOnFail: false,
          formCategory: { qaCategoryId: "qa-quality" },
        },
      ],
    });

    await submitResponse({
      formId: "form-1",
      agentId: "agent-1",
      dispositionId: "disp-1",
      answers: [
        { questionId: "q-fatal", value: "2", comment: "Missing required verification." },
        { questionId: "q-quality", value: "5" },
      ],
    });

    expect(prismaMock.response.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          score: 88,
          result: "FAIL",
          hasFatalFail: true,
          answers: {
            create: [
              expect.objectContaining({
                questionId: "q-fatal",
                categoryId: "qa-compliance",
                comment: "Missing required verification.",
                isFatalFail: true,
              }),
              expect.objectContaining({
                questionId: "q-quality",
                isFatalFail: false,
              }),
            ],
          },
        }),
      }),
    );
  });

  it("marks configured select fatal option and requires comment", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      ...validForm(),
      questions: [
        {
          id: "q-select-fatal",
          type: "SELECT",
          label: "First call resolution",
          required: true,
          options: ["Yes", "No"],
          fatalOptions: ["No"],
          weight: 0,
          fatal: true,
          requiresCommentOnFail: true,
          formCategory: { qaCategoryId: "qa-critical" },
        },
      ],
    });

    await expect(
      submitResponse({
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [{ questionId: "q-select-fatal", value: "No" }],
      }),
    ).rejects.toThrow("Hay preguntas que requieren comentario al fallar");

    await submitResponse({
      formId: "form-1",
      agentId: "agent-1",
      dispositionId: "disp-1",
      answers: [
        {
          questionId: "q-select-fatal",
          value: "No",
          comment: "Resolution was missed.",
        },
      ],
    });

    expect(prismaMock.response.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          score: 0,
          result: "FAIL",
          hasFatalFail: true,
          answers: {
            create: [
              expect.objectContaining({
                questionId: "q-select-fatal",
                categoryId: "qa-critical",
                comment: "Resolution was missed.",
                isFatalFail: true,
              }),
            ],
          },
        }),
      }),
    );
  });

  it("requires a comment when a comment-required rating fails", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      ...validForm(),
      questions: [
        {
          id: "q-comment-required",
          type: "RATING",
          label: "Compliance",
          required: true,
          options: null,
          fatalOptions: null,
          weight: 100,
          fatal: false,
          requiresCommentOnFail: true,
          formCategory: { qaCategoryId: "qa-compliance" },
        },
      ],
    });

    // 2/5 is below the <3 fail threshold → the required comment is enforced.
    await expect(
      submitResponse({
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [{ questionId: "q-comment-required", value: "2" }],
      }),
    ).rejects.toThrow("Hay preguntas que requieren comentario al fallar");
  });

  it("does not require a comment when a rating is above the fail threshold", async () => {
    // Regression: 4/5 (=80%) must NOT count as a failed answer, so a
    // comment-required rating passes without a comment and results in PASS.
    prismaMock.form.findUnique.mockResolvedValue({
      ...validForm(),
      questions: [
        {
          id: "q-comment-required",
          type: "RATING",
          label: "Compliance",
          required: true,
          options: null,
          fatalOptions: null,
          weight: 100,
          fatal: false,
          requiresCommentOnFail: true,
          formCategory: { qaCategoryId: "qa-compliance" },
        },
      ],
    });

    await submitResponse({
      formId: "form-1",
      agentId: "agent-1",
      dispositionId: "disp-1",
      answers: [{ questionId: "q-comment-required", value: "4" }],
    });

    expect(prismaMock.response.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ score: 80, result: "PASS", hasFatalFail: false }),
      }),
    );
  });
});
