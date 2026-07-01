import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const { authMock, getCampaignScoringSettingsMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getCampaignScoringSettingsMock: vi.fn(),
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

import { exportToCsv, exportToExcel, exportToJson } from "./exports";

const qaUser = {
  id: "qa-1",
  role: "QA",
  campaignIds: ["campaign-1"],
};

describe("exports RBAC", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    getCampaignScoringSettingsMock.mockReset();
    authMock.mockResolvedValue({ user: qaUser });
    getCampaignScoringSettingsMock.mockResolvedValue({
      campaignId: "campaign-1",
      usesGlobalDefaults: false,
      passThreshold: 75,
      targetPassRate: 90,
      targetAvgScore: 85,
      targetDailyRate: 12,
      fatalFailuresAllowed: 1,
    });
    prismaMock.response.findMany.mockResolvedValue([]);
  });

  it("does not allow a QA export for a campaign without canExport", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: false,
    });

    await expect(exportToCsv({ campaignId: "campaign-1" })).rejects.toThrow(
      "No autorizado para esta accion en esta campana",
    );
    expect(prismaMock.response.findMany).not.toHaveBeenCalled();
  });

  it("keeps export queries scoped to the authorized campaign", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });

    await exportToJson({ campaignId: "campaign-1" });

    expect(prismaMock.response.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          form: { campaignId: "campaign-1" },
        }),
      }),
    );
  });

  it("exports only selected CSV fields and audits the selected field list", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    prismaMock.response.findMany.mockResolvedValue([buildResponseFixture()]);

    const csv = await exportToCsv({ campaignId: "campaign-1", fields: ["date", "score"] });

    expect(csv.split("\n")[0]).toBe("Fecha,Score");
    expect(csv).not.toContain("Agente");
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          module: "exports",
          action: "generated",
          afterValue: expect.objectContaining({
            format: "csv",
            selectedFields: ["date", "score"],
            rowCount: 1,
          }),
        }),
      }),
    );
  });

  it(
    "creates enriched Excel with summary, evaluation and answer detail sheets",
    async () => {
      prismaMock.userCampaign.findUnique.mockResolvedValue({
        campaignId: "campaign-1",
        canExport: true,
      });
      prismaMock.response.findMany.mockResolvedValue([buildResponseFixture()]);

      const base64 = await exportToExcel({
        campaignId: "campaign-1",
        fields: ["date", "agent", "score", "answers"],
      });

      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const workbookBuffer = Buffer.from(base64, "base64") as unknown as Parameters<
        typeof workbook.xlsx.load
      >[0];
      await workbook.xlsx.load(workbookBuffer);

      expect(workbook.getWorksheet("Resumen")).toBeTruthy();
      expect(workbook.getWorksheet("Evaluaciones")).toBeTruthy();
      expect(workbook.getWorksheet("Detalle respuestas")).toBeTruthy();
      expect(workbook.getWorksheet("Evaluaciones")?.getRow(1).values).toEqual(
        expect.arrayContaining(["Fecha", "Agente", "Score", "Saludo"]),
      );
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            afterValue: expect.objectContaining({
              format: "xlsx",
              selectedFields: ["date", "agent", "score", "answers"],
              detailRowCount: 1,
            }),
          }),
        }),
      );
    },
    15_000,
  );
});

function buildResponseFixture() {
  return {
    id: "response-1",
    formId: "form-1",
    formVersion: "1.0.0",
    agentId: "agent-1",
    evaluatorId: "qa-1",
    dispositionId: "disp-1",
    score: 88.5,
    result: "PASS",
    hasFatalFail: false,
    status: "SUBMITTED",
    submittedAt: new Date("2026-05-10T12:05:00Z"),
    createdAt: new Date("2026-05-10T12:00:00Z"),
    form: {
      id: "form-1",
      title: "QA Ventas",
      version: "1.0.0",
      campaignId: "campaign-1",
      campaign: { name: "Ventas" },
    },
    agent: {
      name: "Ana Perez",
      agentCode: "A-001",
      team: { name: "Equipo A" },
    },
    evaluator: { name: "Luis QA" },
    disposition: {
      name: "Venta efectiva",
      code: "SALE",
      category: { name: "Ventas" },
    },
    answers: [
      {
        value: "Si",
        score: 100,
        comment: "Correcto",
        isFatalFail: false,
        notApplicable: false,
        question: {
          label: "Saludo",
          type: "RADIO",
          order: 1,
          weight: 20,
          fatal: false,
          requiresCommentOnFail: false,
        },
        category: { name: "Apertura", systemColor: "#ff6600" },
      },
    ],
  };
}
