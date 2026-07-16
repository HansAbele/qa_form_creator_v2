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

import {
  cancelResponse,
  cancelResponseAction,
  getResponseById,
  saveResponseDraft,
  submitResponse,
  submitResponseAction,
} from "./responses";

const qaUser = {
  id: "qa-1",
  role: "QA",
  campaignIds: ["campaign-1"],
};

const CLIENT_RESPONSE_ID = "11111111-1111-4111-8111-111111111111";
const SAVED_UPDATED_AT = new Date("2026-05-01T02:00:00.000Z");

function validForm() {
  return {
    id: "form-1",
    title: "QA Form",
    description: null,
    campaignId: "campaign-1",
    version: "1.0.0",
    status: "PUBLISHED",
    campaign: { name: "Campaign 1", active: true },
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
      fatalZeroesScore: false,
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
    prismaMock.response.create.mockResolvedValue({
      id: CLIENT_RESPONSE_ID,
      score: 80,
      status: "SUBMITTED",
      updatedAt: SAVED_UPDATED_AT,
    });
    prismaMock.response.update.mockResolvedValue({
      id: "response-1",
      score: 80,
      status: "SUBMITTED",
      updatedAt: SAVED_UPDATED_AT,
    });
  });

  it("creates a response only when form, agent and disposition share the campaign", async () => {
    await expect(
      submitResponse({
        clientResponseId: CLIENT_RESPONSE_ID,
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [
          { questionId: "q-rating", value: "4" },
          { questionId: "q-select", value: "Good" },
        ],
      }),
    ).resolves.toEqual({
      id: CLIENT_RESPONSE_ID,
      updatedAt: SAVED_UPDATED_AT.toISOString(),
      status: "SUBMITTED",
      score: 80,
      replayed: false,
    });

    expect(prismaMock.response.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: CLIENT_RESPONSE_ID,
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

  it("replays a create safely after a unique ID conflict", async () => {
    prismaMock.response.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    prismaMock.response.findUnique.mockResolvedValue({
      id: CLIENT_RESPONSE_ID,
      formId: "form-1",
      agentId: "agent-1",
      evaluatorId: "qa-1",
      dispositionId: "disp-1",
      score: 80,
      result: "PASS",
      hasFatalFail: false,
      status: "SUBMITTED",
      createdAt: new Date("2026-05-01T01:00:00.000Z"),
      updatedAt: SAVED_UPDATED_AT,
      submittedAt: new Date("2026-05-01T01:00:00.000Z"),
      cancellationReason: null,
      form: { campaignId: "campaign-1" },
      answers: [],
    });

    await expect(
      submitResponse({
        clientResponseId: CLIENT_RESPONSE_ID,
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [
          { questionId: "q-rating", value: "4" },
          { questionId: "q-select", value: "Good" },
        ],
      }),
    ).resolves.toEqual({
      id: CLIENT_RESPONSE_ID,
      updatedAt: SAVED_UPDATED_AT.toISOString(),
      status: "SUBMITTED",
      score: 80,
      replayed: true,
    });

    expect(prismaMock.response.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CLIENT_RESPONSE_ID } }),
    );
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("recovers a draft create by stable identity when its editable context changed", async () => {
    prismaMock.response.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    prismaMock.response.findUnique.mockResolvedValue({
      id: CLIENT_RESPONSE_ID,
      formId: "form-1",
      agentId: "agent-before-retry",
      evaluatorId: "qa-1",
      dispositionId: "disp-before-retry",
      score: 60,
      result: null,
      hasFatalFail: false,
      status: "DRAFT",
      createdAt: new Date("2026-05-01T01:00:00.000Z"),
      updatedAt: SAVED_UPDATED_AT,
      submittedAt: null,
      cancellationReason: null,
      form: { campaignId: "campaign-1" },
      answers: [],
    });

    await expect(
      saveResponseDraft({
        clientResponseId: CLIENT_RESPONSE_ID,
        formId: "form-1",
        agentId: "agent-after-retry",
        dispositionId: "disp-after-retry",
        answers: [{ questionId: "q-rating", value: "4" }],
      }),
    ).resolves.toEqual({
      id: CLIENT_RESPONSE_ID,
      updatedAt: SAVED_UPDATED_AT.toISOString(),
      status: "DRAFT",
      score: 60,
      replayed: true,
    });

    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("does not replay a client response ID owned by another evaluation context", async () => {
    prismaMock.response.create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    prismaMock.response.findUnique.mockResolvedValue({
      id: CLIENT_RESPONSE_ID,
      formId: "form-1",
      agentId: "agent-1",
      evaluatorId: "qa-2",
      dispositionId: "disp-1",
      score: 80,
      result: "PASS",
      hasFatalFail: false,
      status: "SUBMITTED",
      createdAt: new Date("2026-05-01T01:00:00.000Z"),
      updatedAt: SAVED_UPDATED_AT,
      submittedAt: new Date("2026-05-01T01:00:00.000Z"),
      cancellationReason: null,
      form: { campaignId: "campaign-1" },
      answers: [],
    });

    await expect(
      submitResponse({
        clientResponseId: CLIENT_RESPONSE_ID,
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [
          { questionId: "q-rating", value: "4" },
          { questionId: "q-select", value: "Good" },
        ],
      }),
    ).rejects.toThrow("El identificador de evaluacion ya fue usado en otro contexto");

    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects a create without a UUID client response ID", async () => {
    await expect(
      submitResponse({
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [],
      }),
    ).rejects.toThrow("Datos de evaluacion invalidos");

    expect(prismaMock.response.create).not.toHaveBeenCalled();
  });

  it("rejects a create with a malformed client response ID", async () => {
    await expect(
      submitResponse({
        clientResponseId: "not-a-uuid",
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [],
      }),
    ).rejects.toThrow("Datos de evaluacion invalidos");

    expect(prismaMock.response.create).not.toHaveBeenCalled();
  });

  it("rejects submitting an evaluation against a draft form", async () => {
    prismaMock.form.findUnique.mockResolvedValue({ ...validForm(), status: "DRAFT" });

    await expect(
      submitResponse({
        clientResponseId: CLIENT_RESPONSE_ID,
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [],
      }),
    ).rejects.toThrow("Solo se puede evaluar un formulario publicado");

    expect(prismaMock.response.create).not.toHaveBeenCalled();
  });

  it("rejects saving a draft evaluation against an archived form", async () => {
    prismaMock.form.findUnique.mockResolvedValue({ ...validForm(), status: "ARCHIVED" });

    await expect(
      saveResponseDraft({
        clientResponseId: CLIENT_RESPONSE_ID,
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [],
      }),
    ).rejects.toThrow("Solo se puede evaluar un formulario publicado");

    expect(prismaMock.response.create).not.toHaveBeenCalled();
  });

  it("rejects evaluations when the campaign is inactive", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      ...validForm(),
      campaign: { name: "Campaign 1", active: false },
    });

    await expect(
      saveResponseDraft({
        clientResponseId: CLIENT_RESPONSE_ID,
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [],
      }),
    ).rejects.toThrow("No se puede evaluar una campana inactiva");

    expect(prismaMock.response.create).not.toHaveBeenCalled();
  });

  it("does not let a QA read another evaluator's response without report access", async () => {
    prismaMock.response.findUnique.mockResolvedValue({
      id: "response-2",
      formId: "form-1",
      evaluatorId: "qa-2",
      status: "SUBMITTED",
      score: 80,
      form: { id: "form-1", title: "QA Form", campaignId: "campaign-1" },
      agent: { id: "agent-1", name: "Agent", campaignId: "campaign-1" },
      evaluator: { id: "qa-2", name: "Other QA" },
      disposition: {
        id: "disp-1",
        name: "Resolved",
        code: "RES",
        campaignId: "campaign-1",
      },
      answers: [],
    });

    await expect(getResponseById("response-2")).rejects.toThrow(
      "No autorizado para esta accion en esta campana",
    );
  });

  it("checks campaign permission before exposing cancellation or corrupt-relation state", async () => {
    prismaMock.response.findUnique.mockResolvedValue({
      id: "response-foreign",
      formId: "form-2",
      evaluatorId: "qa-2",
      status: "CANCELLED",
      score: 80,
      form: { id: "form-2", title: "Foreign Form", campaignId: "campaign-2" },
      agent: { id: "agent-2", name: "Foreign Agent", campaignId: "campaign-3" },
      evaluator: { id: "qa-2", name: "Other QA" },
      disposition: null,
      answers: [],
    });

    await expect(getResponseById("response-foreign")).rejects.toThrow("No autorizado");
  });

  it("lets a QA resume only their own draft with evaluate access", async () => {
    prismaMock.response.findUnique.mockResolvedValue({
      id: "response-1",
      formId: "form-1",
      evaluatorId: "qa-1",
      status: "DRAFT",
      score: 80,
      form: { id: "form-1", title: "QA Form", campaignId: "campaign-1" },
      agent: { id: "agent-1", name: "Agent", campaignId: "campaign-1" },
      evaluator: { id: "qa-1", name: "QA User" },
      disposition: {
        id: "disp-1",
        name: "Resolved",
        code: "RES",
        campaignId: "campaign-1",
      },
      answers: [],
    });

    await expect(getResponseById("response-1")).resolves.toMatchObject({
      id: "response-1",
      score: 80,
    });
  });

  it("requires edit permission to load a submitted response for correction", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canEditEvaluations: true,
    });
    prismaMock.response.findUnique.mockResolvedValue({
      id: "response-2",
      formId: "form-1",
      evaluatorId: "qa-2",
      status: "SUBMITTED",
      score: 80,
      form: { id: "form-1", title: "QA Form", campaignId: "campaign-1" },
      agent: { id: "agent-1", name: "Agent", campaignId: "campaign-1" },
      evaluator: { id: "qa-2", name: "Other QA" },
      disposition: null,
      answers: [],
    });

    await expect(getResponseById("response-2")).resolves.toMatchObject({ id: "response-2" });
  });

  it("does not expose an answer linked to a question from another form", async () => {
    prismaMock.response.findUnique.mockResolvedValue({
      id: "response-2",
      formId: "form-1",
      evaluatorId: "qa-1",
      status: "DRAFT",
      score: 80,
      form: { id: "form-1", title: "QA Form", campaignId: "campaign-1" },
      agent: { id: "agent-1", name: "Agent", campaignId: "campaign-1" },
      evaluator: { id: "qa-1", name: "QA User" },
      disposition: null,
      answers: [
        {
          id: "answer-foreign",
          score: 100,
          question: { id: "question-foreign", formId: "form-2", label: "Dato ajeno" },
        },
      ],
    });

    await expect(getResponseById("response-2")).rejects.toThrow(
      "La evaluacion contiene relaciones de otra campana",
    );
  });

  it("rejects an agent from another campaign", async () => {
    prismaMock.agent.findUnique.mockResolvedValue({
      campaignId: "campaign-2",
      active: true,
    });

    await expect(
      submitResponse({
        clientResponseId: CLIENT_RESPONSE_ID,
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
        clientResponseId: CLIENT_RESPONSE_ID,
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
        clientResponseId: CLIENT_RESPONSE_ID,
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
      clientResponseId: CLIENT_RESPONSE_ID,
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
      clientResponseId: CLIENT_RESPONSE_ID,
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
      clientResponseId: CLIENT_RESPONSE_ID,
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

  it("rejects an update without the client concurrency token", async () => {
    await expect(
      submitResponse({
        responseId: "response-1",
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [],
      }),
    ).rejects.toThrow("Datos de evaluacion invalidos");

    expect(prismaMock.response.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.response.update).not.toHaveBeenCalled();
  });

  it("returns expected validation failures as a production-safe action result", async () => {
    await expect(
      submitResponseAction({
        responseId: "response-1",
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [],
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "VALIDATION", message: "Datos de evaluacion invalidos" },
    });
  });

  it("rejects an update with a non-ISO concurrency token", async () => {
    await expect(
      submitResponse({
        responseId: "response-1",
        expectedUpdatedAt: "yesterday",
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [],
      }),
    ).rejects.toThrow("Datos de evaluacion invalidos");

    expect(prismaMock.response.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.response.update).not.toHaveBeenCalled();
  });

  it("edits submitted evaluations only with canEditEvaluations and audits before/after", async () => {
    const updatedAt = new Date("2026-05-01T01:00:00Z");
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
      updatedAt,
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
          question: { formId: "form-1" },
        },
      ],
    });

    await submitResponse({
      responseId: "response-1",
      expectedUpdatedAt: updatedAt.toISOString(),
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
        where: { id: "response-1", updatedAt, status: "SUBMITTED" },
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

  it("rejects a direct mutation when an existing answer belongs to another form", async () => {
    const updatedAt = new Date("2026-05-01T01:00:00Z");
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canEditEvaluations: true,
    });
    prismaMock.response.findUnique.mockResolvedValue({
      id: "response-corrupt",
      formId: "form-1",
      agentId: "agent-1",
      evaluatorId: "qa-2",
      dispositionId: "disp-1",
      score: 60,
      result: "FAIL",
      hasFatalFail: false,
      status: "SUBMITTED",
      createdAt: new Date("2026-05-01T00:00:00Z"),
      updatedAt,
      submittedAt: new Date("2026-05-01T00:00:00Z"),
      cancellationReason: null,
      form: { campaignId: "campaign-1" },
      answers: [
        {
          questionId: "question-foreign",
          value: "secret",
          score: 100,
          comment: null,
          isFatalFail: false,
          notApplicable: false,
          question: { formId: "form-2" },
        },
      ],
    });

    await expect(
      submitResponseAction({
        responseId: "response-corrupt",
        expectedUpdatedAt: updatedAt.toISOString(),
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [
          { questionId: "q-rating", value: "5" },
          { questionId: "q-select", value: "Good" },
        ],
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "La evaluacion contiene relaciones inconsistentes",
      },
    });
    expect(prismaMock.userCampaign.findUnique).toHaveBeenCalled();
    expect(prismaMock.response.update).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("corrects historical responses with their captured scoring policy and inactive relations", async () => {
    const updatedAt = new Date("2026-05-01T01:00:00Z");
    const capturedSettings = {
      campaignId: "campaign-1",
      passThreshold: 70,
      fatalZeroesScore: false,
      capturedAt: "2026-05-01T00:00:00.000Z",
    };
    const originalFormSnapshot = { id: "form-1", version: "1.0.0", title: "QA Form" };
    getCampaignScoringSettingsMock.mockResolvedValue({
      campaignId: "campaign-1",
      usesGlobalDefaults: false,
      passThreshold: 95,
      targetPassRate: 95,
      targetAvgScore: 95,
      targetDailyRate: 10,
      fatalFailuresAllowed: 0,
      fatalZeroesScore: true,
    });
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canEditEvaluations: true,
    });
    prismaMock.form.findUnique.mockResolvedValue({
      ...validForm(),
      status: "ARCHIVED",
      campaign: { name: "Campaign 1", active: false },
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
          requiresCommentOnFail: false,
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
    prismaMock.response.findUnique.mockResolvedValue({
      id: "response-1",
      formId: "form-1",
      formVersion: "1.0.0",
      agentId: "agent-1",
      evaluatorId: "qa-2",
      dispositionId: "disp-1",
      score: 88,
      result: "FAIL",
      hasFatalFail: true,
      status: "SUBMITTED",
      scoringSnapshot: { passThreshold: 70, score: 88, result: "FAIL" },
      settingsSnapshot: capturedSettings,
      formSnapshot: originalFormSnapshot,
      createdAt: new Date("2026-05-01T00:00:00Z"),
      updatedAt,
      submittedAt: new Date("2026-05-01T00:00:00Z"),
      cancellationReason: null,
      form: { campaignId: "campaign-1" },
      answers: [],
    });
    prismaMock.agent.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      active: false,
      name: "Historical Agent",
      agentCode: "A-1",
    });
    prismaMock.disposition.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      active: false,
    });

    await submitResponse({
      responseId: "response-1",
      expectedUpdatedAt: updatedAt.toISOString(),
      formId: "form-1",
      agentId: "agent-1",
      dispositionId: "disp-1",
      answers: [
        { questionId: "q-fatal", value: "2", comment: "Corrected evidence" },
        { questionId: "q-quality", value: "5" },
      ],
    });

    expect(prismaMock.response.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          formVersion: "1.0.0",
          score: 88,
          result: "FAIL",
          hasFatalFail: true,
          settingsSnapshot: capturedSettings,
          formSnapshot: originalFormSnapshot,
          scoringSnapshot: expect.objectContaining({ passThreshold: 70, score: 88 }),
        }),
      }),
    );
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          beforeValue: expect.objectContaining({ settingsSnapshot: capturedSettings }),
          afterValue: expect.objectContaining({ settingsSnapshot: capturedSettings }),
        }),
      }),
    );
    expect(prismaMock.userCampaign.findMany).not.toHaveBeenCalled();
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it("materializes the effective legacy policy and preserves a missing historical disposition", async () => {
    const updatedAt = new Date("2026-05-01T01:00:00Z");
    getCampaignScoringSettingsMock.mockResolvedValue({
      campaignId: "campaign-1",
      usesGlobalDefaults: false,
      passThreshold: 80,
      targetPassRate: 90,
      targetAvgScore: 85,
      targetDailyRate: 10,
      fatalFailuresAllowed: 0,
      fatalZeroesScore: true,
    });
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canEditEvaluations: true,
    });
    prismaMock.form.findUnique.mockResolvedValue({
      ...validForm(),
      status: "ARCHIVED",
      campaign: { name: "Campaign 1", active: false },
    });
    prismaMock.response.findUnique.mockResolvedValue({
      id: "response-legacy",
      formId: "form-1",
      formVersion: "1.0.0",
      agentId: "agent-1",
      evaluatorId: "qa-2",
      dispositionId: null,
      score: 60,
      result: "",
      hasFatalFail: false,
      status: "SUBMITTED",
      scoringSnapshot: { passThreshold: 70, score: 60, result: "" },
      settingsSnapshot: null,
      formSnapshot: null,
      createdAt: new Date("2026-05-01T00:00:00Z"),
      updatedAt,
      submittedAt: new Date("2026-05-01T00:00:00Z"),
      cancellationReason: null,
      form: { campaignId: "campaign-1" },
      answers: [],
    });
    prismaMock.agent.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      active: false,
      name: "Historical Agent",
      agentCode: "A-1",
    });

    await submitResponse({
      responseId: "response-legacy",
      expectedUpdatedAt: updatedAt.toISOString(),
      formId: "form-1",
      agentId: "agent-1",
      dispositionId: null,
      answers: [
        { questionId: "q-rating", value: "3" },
        { questionId: "q-select", value: "Good" },
      ],
    });

    expect(prismaMock.disposition.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.response.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dispositionId: null,
          score: 60,
          result: "FAIL",
          settingsSnapshot: expect.objectContaining({
            passThreshold: 70,
            fatalZeroesScore: true,
          }),
        }),
      }),
    );
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it("applies fatalZeroesScore from the effective campaign policy on submission", async () => {
    getCampaignScoringSettingsMock.mockResolvedValue({
      campaignId: "campaign-1",
      usesGlobalDefaults: false,
      passThreshold: 70,
      targetPassRate: 85,
      targetAvgScore: 80,
      targetDailyRate: 20,
      fatalFailuresAllowed: 0,
      fatalZeroesScore: true,
    });
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
          requiresCommentOnFail: false,
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
      clientResponseId: CLIENT_RESPONSE_ID,
      formId: "form-1",
      agentId: "agent-1",
      dispositionId: "disp-1",
      answers: [
        { questionId: "q-fatal", value: "2" },
        { questionId: "q-quality", value: "5" },
      ],
    });

    expect(prismaMock.response.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ score: 0, result: "FAIL", hasFatalFail: true }),
      }),
    );
  });

  it("rejects a stale client token even when the initial read returns the newer version", async () => {
    const clientUpdatedAt = new Date("2026-05-01T01:00:00Z");
    const persistedUpdatedAt = new Date("2026-05-01T01:05:00Z");
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
      updatedAt: persistedUpdatedAt,
      submittedAt: new Date("2026-05-01T00:00:00Z"),
      cancellationReason: null,
      form: { campaignId: "campaign-1" },
      answers: [],
    });
    await expect(
      submitResponseAction({
        responseId: "response-1",
        expectedUpdatedAt: clientUpdatedAt.toISOString(),
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [
          { questionId: "q-rating", value: "5" },
          { questionId: "q-select", value: "Good" },
        ],
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message:
          "La evaluacion fue modificada por otra sesion. Recarga la pagina e intenta nuevamente",
      },
    });

    expect(prismaMock.userCampaign.findUnique).toHaveBeenCalled();
    expect(prismaMock.response.update).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it("cancels submitted evaluations with canEditEvaluations", async () => {
    const updatedAt = new Date("2026-05-01T01:00:00Z");
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
      updatedAt,
      submittedAt: new Date("2026-05-01T00:00:00Z"),
      cancellationReason: null,
      form: { campaignId: "campaign-1" },
      answers: [],
    });

    prismaMock.response.update.mockResolvedValue({
      id: "response-1",
      score: 80,
      status: "CANCELLED",
      updatedAt: SAVED_UPDATED_AT,
    });

    await expect(
      cancelResponseAction({
        id: "response-1",
        expectedUpdatedAt: updatedAt.toISOString(),
        reason: "Duplicated evaluation",
      }),
    ).resolves.toEqual({
      ok: true,
      data: {
        id: "response-1",
        updatedAt: SAVED_UPDATED_AT.toISOString(),
        status: "CANCELLED",
        score: 80,
        replayed: false,
      },
    });

    expect(prismaMock.response.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "response-1", updatedAt, status: "SUBMITTED" },
        data: expect.objectContaining({
          status: "CANCELLED",
          cancelledById: "qa-1",
          cancellationReason: "Duplicated evaluation",
        }),
      }),
    );
  });

  it("requires the client concurrency token to cancel a response", async () => {
    await expect(
      cancelResponse({ id: "response-1", reason: "Duplicated evaluation" }),
    ).rejects.toThrow();

    expect(prismaMock.response.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.response.update).not.toHaveBeenCalled();
  });

  it("checks cancellation permission before exposing an already-cancelled state", async () => {
    const updatedAt = new Date("2026-05-01T01:00:00Z");
    prismaMock.response.findUnique.mockResolvedValue({
      id: "response-foreign",
      formId: "form-2",
      agentId: "agent-2",
      evaluatorId: "qa-2",
      dispositionId: null,
      score: 80,
      result: "PASS",
      hasFatalFail: false,
      status: "CANCELLED",
      createdAt: new Date("2026-05-01T00:00:00Z"),
      updatedAt,
      submittedAt: new Date("2026-05-01T00:00:00Z"),
      cancellationReason: "Duplicate",
      form: { campaignId: "campaign-2" },
      answers: [],
    });

    await expect(
      cancelResponse({
        id: "response-foreign",
        expectedUpdatedAt: updatedAt.toISOString(),
        reason: "Duplicate evaluation",
      }),
    ).rejects.toThrow("No autorizado");
  });

  it("does not cancel an evaluation changed by another session", async () => {
    const updatedAt = new Date("2026-05-01T01:00:00Z");
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
      updatedAt,
      submittedAt: new Date("2026-05-01T00:00:00Z"),
      cancellationReason: null,
      form: { campaignId: "campaign-1" },
      answers: [],
    });
    prismaMock.response.update.mockRejectedValue(
      Object.assign(new Error("Record to update not found"), { code: "P2025" }),
    );

    await expect(
      cancelResponseAction({
        id: "response-1",
        expectedUpdatedAt: updatedAt.toISOString(),
        reason: "Duplicated evaluation",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message:
          "La evaluacion fue modificada por otra sesion. Recarga la pagina e intenta nuevamente",
      },
    });

    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
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
      clientResponseId: CLIENT_RESPONSE_ID,
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
        clientResponseId: CLIENT_RESPONSE_ID,
        formId: "form-1",
        agentId: "agent-1",
        dispositionId: "disp-1",
        answers: [{ questionId: "q-select-fatal", value: "No" }],
      }),
    ).rejects.toThrow("Hay preguntas que requieren comentario al fallar");

    await submitResponse({
      clientResponseId: CLIENT_RESPONSE_ID,
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
        clientResponseId: CLIENT_RESPONSE_ID,
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
      clientResponseId: CLIENT_RESPONSE_ID,
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

  it("scores a weighted select alongside a rating (weight-model migration)", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      ...validForm(),
      questions: [
        {
          id: "q-rate",
          type: "RATING",
          label: "Quality",
          required: true,
          options: null,
          fatalOptions: null,
          weight: 60,
          fatal: false,
          requiresCommentOnFail: false,
          formCategory: { qaCategoryId: "qa-quality" },
        },
        {
          id: "q-sel",
          type: "SELECT",
          label: "Resolution",
          required: true,
          options: [
            { value: "full", points: 2 },
            { value: "partial", points: 1 },
            { value: "no", points: 0 },
          ],
          fatalOptions: null,
          weight: 40,
          fatal: false,
          requiresCommentOnFail: false,
          formCategory: { qaCategoryId: "qa-resolution" },
        },
      ],
    });

    await submitResponse({
      clientResponseId: CLIENT_RESPONSE_ID,
      formId: "form-1",
      agentId: "agent-1",
      dispositionId: "disp-1",
      answers: [
        { questionId: "q-rate", value: "5" },
        { questionId: "q-sel", value: "partial" },
      ],
    });

    // rating 5/5=100% × 60 + select partial (1/2=50%) × 40 = 60 + 20 = 80
    expect(prismaMock.response.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ score: 80, result: "PASS" }),
      }),
    );
  });

  it("scores a BOOLEAN and a 1-10 rating (new types + configurable scale)", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      ...validForm(),
      questions: [
        {
          id: "q-rate",
          type: "RATING",
          label: "Quality",
          required: true,
          options: null,
          fatalOptions: null,
          weight: 60,
          fatal: false,
          requiresCommentOnFail: false,
          ratingMax: 10,
          formCategory: { qaCategoryId: "qa-quality" },
        },
        {
          id: "q-bool",
          type: "BOOLEAN",
          label: "Greeting",
          required: true,
          options: [
            { value: "Si", points: 1 },
            { value: "No", points: 0 },
          ],
          fatalOptions: null,
          weight: 40,
          fatal: false,
          requiresCommentOnFail: false,
          formCategory: { qaCategoryId: "qa-greeting" },
        },
      ],
    });

    await submitResponse({
      clientResponseId: CLIENT_RESPONSE_ID,
      formId: "form-1",
      agentId: "agent-1",
      dispositionId: "disp-1",
      answers: [
        { questionId: "q-rate", value: "8" },
        { questionId: "q-bool", value: "Si" },
      ],
    });

    // rating 8/10=80% × 60 + boolean "Si" (1/1=100%) × 40 = 48 + 40 = 88
    expect(prismaMock.response.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ score: 88, result: "PASS" }),
      }),
    );
  });
});
