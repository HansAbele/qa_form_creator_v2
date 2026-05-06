import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const { authMock, revalidatePathMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  const mockedPrisma = (module as { prismaMock: unknown }).prismaMock;
  return { prisma: mockedPrisma };
});

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

import { submitResponse } from "./responses";

const qaUser = {
  id: "qa-1",
  role: "QA",
  campaignIds: ["campaign-1"],
};

function validForm() {
  return {
    id: "form-1",
    campaignId: "campaign-1",
    questions: [
      {
        id: "q-rating",
        type: "RATING",
        label: "Rating",
        required: true,
        options: null,
      },
      {
        id: "q-select",
        type: "SELECT",
        label: "Disposition",
        required: true,
        options: ["Good", "Bad"],
      },
      {
        id: "q-comment",
        type: "TEXT",
        label: "Comment",
        required: false,
        options: null,
      },
    ],
  };
}

describe("submitResponse validation and RBAC", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    revalidatePathMock.mockReset();
    authMock.mockResolvedValue({ user: qaUser });
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
});
