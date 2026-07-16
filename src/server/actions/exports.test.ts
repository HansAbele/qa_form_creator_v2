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

  it("drops imported rows whose related metadata belongs to another campaign", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    const valid = buildResponseFixture();
    prismaMock.response.findMany.mockResolvedValue([
      valid,
      {
        ...buildResponseFixture(),
        id: "foreign-agent",
        agent: {
          ...valid.agent,
          name: "Agente ajeno",
          campaignId: "campaign-2",
        },
      },
      {
        ...buildResponseFixture(),
        id: "foreign-team",
        agent: {
          ...valid.agent,
          team: { name: "Equipo ajeno", campaignId: "campaign-2" },
        },
      },
      {
        ...buildResponseFixture(),
        id: "foreign-disposition",
        disposition: {
          ...valid.disposition,
          name: "Disposicion ajena",
          campaignId: "campaign-2",
        },
      },
      {
        ...buildResponseFixture(),
        id: "foreign-disposition-category",
        disposition: {
          ...valid.disposition,
          category: { name: "Categoria ajena", campaignId: "campaign-2" },
        },
      },
      {
        ...buildResponseFixture(),
        id: "foreign-question",
        answers: [
          {
            ...valid.answers[0],
            question: {
              ...valid.answers[0].question,
              label: "Pregunta ajena",
              formId: "form-foreign",
            },
          },
        ],
      },
    ]);

    const csv = await exportToCsv({
      campaignId: "campaign-1",
      fields: ["responseId", "agent", "team", "disposition"],
    });

    expect(csv.split("\n")).toEqual([
      "ID evaluacion,Agente,Equipo,Disposicion",
      "response-1,Ana Perez,Equipo A,Venta efectiva",
    ]);
    expect(csv).not.toContain("ajeno");
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          afterValue: expect.objectContaining({ rowCount: 1 }),
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

  it("exports a fatal evaluation as FAIL even if its stored result says PASS", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    prismaMock.response.findMany.mockResolvedValue([
      { ...buildResponseFixture(), result: "PASS", hasFatalFail: true },
    ]);

    const csv = await exportToCsv({
      campaignId: "campaign-1",
      fields: ["result", "fatalFail"],
    });

    expect(csv.split("\n")).toEqual(["Resultado,Falla fatal", "FAIL,Si"]);
  });

  it("neutralizes spreadsheet formulas in CSV text without changing safe leading spaces", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    const dangerous = buildResponseFixture();
    dangerous.agent.name = '=HYPERLINK("https://example.invalid")';
    dangerous.form.title = "+cmd";
    dangerous.evaluator.name = "-2+3";
    dangerous.disposition.name = "\tformula";
    dangerous.answers[0].question.label = "  @SUM(A1:A2)";
    dangerous.answers[0].value = "  =1+1";
    prismaMock.response.findMany.mockResolvedValue([dangerous]);

    const csv = await exportToCsv({
      campaignId: "campaign-1",
      fields: ["agent", "form", "evaluator", "disposition", "answers"],
    });

    expect(csv).toContain("'  @SUM(A1:A2)");
    expect(csv).toContain("'=HYPERLINK(");
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'-2+3");
    expect(csv).toContain("'\tformula");
    expect(csv).toContain("'  =1+1");

    const safe = buildResponseFixture();
    safe.agent.name = "  Ana Perez";
    safe.answers[0].value = "  texto seguro";
    prismaMock.response.findMany.mockResolvedValue([safe]);
    const safeCsv = await exportToCsv({
      campaignId: "campaign-1",
      fields: ["agent", "answers"],
    });
    expect(safeCsv).toContain("  Ana Perez");
    expect(safeCsv).toContain("  texto seguro");
    expect(safeCsv).not.toContain("'  Ana Perez");
    expect(safeCsv).not.toContain("'  texto seguro");
  });

  it("does not audit a CSV export when row serialization fails", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    const response = buildResponseFixture();
    Object.defineProperty(response.form, "title", {
      get() {
        throw new Error("CSV serialization failed");
      },
    });
    prismaMock.response.findMany.mockResolvedValue([response]);

    await expect(exportToCsv({ campaignId: "campaign-1", fields: ["form"] })).rejects.toThrow(
      "CSV serialization failed",
    );
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("does not audit a JSON export when JSON serialization fails", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    const response = buildResponseFixture();
    response.agent.name = BigInt(1) as unknown as string;
    prismaMock.response.findMany.mockResolvedValue([response]);

    await expect(exportToJson({ campaignId: "campaign-1", fields: ["agent"] })).rejects.toThrow();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("creates enriched Excel with summary, evaluation and answer detail sheets", async () => {
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
  }, 15_000);

  it("styles Excel scores from the effective result even when Result is not exported", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    prismaMock.response.findMany.mockResolvedValue([
      { ...buildResponseFixture(), id: "fatal", score: 95, result: "PASS", hasFatalFail: true },
      { ...buildResponseFixture(), id: "stored-pass", score: 60, result: "PASS" },
      { ...buildResponseFixture(), id: "threshold-fail", score: 74, result: null },
    ]);

    const base64 = await exportToExcel({
      campaignId: "campaign-1",
      fields: ["score"],
    });
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const workbookBuffer = Buffer.from(base64, "base64") as unknown as Parameters<
      typeof workbook.xlsx.load
    >[0];
    await workbook.xlsx.load(workbookBuffer);
    const sheet = workbook.getWorksheet("Evaluaciones");

    expect(sheet?.getCell("A2").fill).toMatchObject({ fgColor: { argb: "FFFEE2E2" } });
    expect(sheet?.getCell("A3").fill).toMatchObject({ fgColor: { argb: "FFFEF3C7" } });
    expect(sheet?.getCell("A4").fill).toMatchObject({ fgColor: { argb: "FFFEE2E2" } });
  }, 15_000);
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
      campaignId: "campaign-1",
      team: { name: "Equipo A", campaignId: "campaign-1" },
    },
    evaluator: { name: "Luis QA" },
    disposition: {
      name: "Venta efectiva",
      code: "SALE",
      campaignId: "campaign-1",
      outcomeType: "SUCCESS",
      category: { name: "Ventas", campaignId: "campaign-1" },
    },
    answers: [
      {
        value: "Si",
        score: 100,
        comment: "Correcto",
        isFatalFail: false,
        notApplicable: false,
        question: {
          formId: "form-1",
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
