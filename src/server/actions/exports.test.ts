import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  getCampaignScoringSettingsMap: async (campaignIds: string[]) => {
    const entries = await Promise.all(
      campaignIds.map(
        async (campaignId) =>
          [campaignId, await getCampaignScoringSettingsMock(campaignId)] as const,
      ),
    );
    return new Map(entries);
  },
}));

vi.mock("@/lib/prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  const mockedPrisma = (module as { prismaMock: unknown }).prismaMock;
  return { prisma: mockedPrisma };
});

import { createExportDownload, exportToCsv, exportToExcel, exportToJson } from "./exports";

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

  afterEach(() => {
    vi.unstubAllEnvs();
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
    mockExportResponses([
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
    mockExportResponses([buildResponseFixture()]);

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
    mockExportResponses([{ ...buildResponseFixture(), result: "PASS", hasFatalFail: true }]);

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
    mockExportResponses([dangerous]);

    const csv = await exportToCsv({
      campaignId: "campaign-1",
      fields: ["agent", "form", "evaluator", "disposition", "answers"],
    });

    expect(csv).toContain("S01-P02 · Apertura ·   @SUM(A1:A2) [question-1]");
    expect(csv).toContain("'=HYPERLINK(");
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'-2+3");
    expect(csv).toContain("'\tformula");
    expect(csv).toContain("'  =1+1");

    const safe = buildResponseFixture();
    safe.agent.name = "  Ana Perez";
    safe.answers[0].value = "  texto seguro";
    mockExportResponses([safe]);
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
    mockExportResponses([response]);

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
    mockExportResponses([response]);

    await expect(exportToJson({ campaignId: "campaign-1", fields: ["agent"] })).rejects.toThrow();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("creates enriched Excel with summary, evaluation and answer detail sheets", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    mockExportResponses([buildResponseFixture()]);

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
      expect.arrayContaining([
        "Fecha",
        "Agente",
        "Score",
        "S01-P02 · Apertura · Saludo [question-1]",
      ]),
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

  it("audits stream reservation/start before delivery and completion after serialization", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    mockExportResponses([buildResponseFixture()]);

    const download = await createExportDownload("csv", {
      campaignId: "campaign-1",
      fields: ["responseId", "score"],
    });
    expect(download.contentType).toContain("text/csv");
    expect(prismaMock.auditLog.create.mock.calls.map(([call]) => call.data.action)).toEqual([
      "reserved",
      "started",
    ]);

    await expect(new Response(download.body).text()).resolves.toContain("response-1,88.5");
    expect(prismaMock.auditLog.create.mock.calls.map(([call]) => call.data.action)).toEqual([
      "reserved",
      "started",
      "generated",
    ]);
  });

  it("streams a valid XLSX workbook without base64 buffering", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    mockExportResponses([buildResponseFixture()]);

    const download = await createExportDownload("xlsx", {
      campaignId: "campaign-1",
      fields: ["date", "agent", "score", "answers"],
    });
    const workbookBytes = await new Response(download.body).arrayBuffer();
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(workbookBytes) as never);

    expect(workbook.getWorksheet("Resumen")).toBeTruthy();
    expect(workbook.getWorksheet("Evaluaciones")?.getCell("B2").value).toBe("Ana Perez");
    expect(workbook.getWorksheet("Detalle respuestas")?.rowCount).toBe(2);
    await vi.waitFor(() =>
      expect(prismaMock.auditLog.create.mock.calls.map(([call]) => call.data.action)).toEqual([
        "reserved",
        "started",
        "generated",
      ]),
    );
  }, 15_000);

  it("records cancellation when a client stops a CSV stream", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    mockExportResponses([buildResponseFixture()]);

    const download = await createExportDownload("csv", {
      campaignId: "campaign-1",
      fields: ["responseId", "score"],
    });
    const reader = download.body.getReader();
    await reader.read();
    await reader.cancel();

    await vi.waitFor(() =>
      expect(prismaMock.auditLog.create.mock.calls.map(([call]) => call.data.action)).toContain(
        "cancelled",
      ),
    );
    expect(prismaMock.auditLog.create.mock.calls.map(([call]) => call.data.action)).not.toContain(
      "generated",
    );
  });

  it("does not mark a buffered XLSX as generated when the consumer cancels before EOF", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    mockExportResponses([buildResponseFixture()]);

    const download = await createExportDownload("xlsx", {
      campaignId: "campaign-1",
      fields: ["responseId", "score"],
    });
    const reader = download.body.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await reader.cancel();

    await vi.waitFor(() =>
      expect(prismaMock.auditLog.create.mock.calls.map(([call]) => call.data.action)).toContain(
        "cancelled",
      ),
    );
    expect(prismaMock.auditLog.create.mock.calls.map(([call]) => call.data.action)).not.toContain(
      "generated",
    );
  });

  it("writes campaign-scoped lifecycle rows for a multi-campaign export", async () => {
    authMock.mockResolvedValue({
      user: { ...qaUser, campaignIds: ["campaign-1", "campaign-2"] },
    });
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1", canExport: true },
      { campaignId: "campaign-2", canExport: true },
    ]);
    const second = buildResponseFixture();
    second.id = "response-2";
    second.form.campaignId = "campaign-2";
    second.form.campaign.name = "Soporte";
    second.agent.campaignId = "campaign-2";
    if (second.agent.team) second.agent.team.campaignId = "campaign-2";
    if (second.disposition) {
      second.disposition.campaignId = "campaign-2";
      if (second.disposition.category) second.disposition.category.campaignId = "campaign-2";
    }
    mockExportResponses([buildResponseFixture(), second]);

    const download = await createExportDownload("csv", { fields: ["responseId"] });
    const startedCampaigns = prismaMock.auditLog.create.mock.calls
      .map(([call]) => call.data)
      .filter((data) => data.action === "started")
      .map((data) => data.campaignId)
      .sort();
    expect(startedCampaigns).toEqual(["campaign-1", "campaign-2"]);

    await new Response(download.body).text();
    const generatedCampaigns = prismaMock.auditLog.create.mock.calls
      .map(([call]) => call.data)
      .filter((data) => data.action === "generated")
      .map((data) => data.campaignId)
      .sort();
    expect(generatedCampaigns).toEqual(["campaign-1", "campaign-2"]);
  });

  it("styles Excel scores from the effective result even when Result is not exported", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    mockExportResponses([
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

  it("keeps duplicate labels in separate stable question-ID columns", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    const first = buildResponseFixture();
    const second = buildResponseFixture();
    second.id = "response-2";
    second.answers[0].question.id = "question-2";
    second.answers[0].question.order = 2;
    second.answers[0].value = "No";
    mockExportResponses([first, second]);

    const csv = await exportToCsv({
      campaignId: "campaign-1",
      fields: ["responseId", "answers"],
    });
    const [header, firstRow, secondRow] = csv.split("\n");

    expect(header).toContain("Saludo [question-1]");
    expect(header).toContain("Saludo [question-2]");
    expect(header.split(",")).toHaveLength(3);
    expect(firstRow).toBe("response-1,Si,");
    expect(secondRow).toBe("response-2,,No");
  });

  it("rejects exports above the configured evaluation limit without auditing", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    vi.stubEnv("EXPORT_MAX_EVALUATIONS", "1");
    prismaMock.response.findMany.mockResolvedValueOnce([
      { id: "response-1" },
      { id: "response-2" },
    ]);

    await expect(exportToCsv({ campaignId: "campaign-1" })).rejects.toMatchObject({
      name: "ExportLimitError",
      code: "EXPORT_LIMIT_EXCEEDED",
      message: expect.stringContaining("supera 1 evaluaciones"),
    });
    expect(prismaMock.response.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects answer and question-column limit overflows without auditing", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    const response = buildResponseFixture();
    response.answers.push({
      ...response.answers[0],
      value: "No",
      question: {
        ...response.answers[0].question,
        id: "question-2",
        order: 2,
      },
    });

    vi.stubEnv("EXPORT_MAX_ANSWER_ROWS", "1");
    mockExportResponses([response]);
    await expect(
      exportToCsv({ campaignId: "campaign-1", fields: ["answers"] }),
    ).rejects.toMatchObject({
      name: "ExportLimitError",
      code: "EXPORT_LIMIT_EXCEEDED",
      message: expect.stringContaining("supera 1 respuestas"),
    });
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();

    vi.stubEnv("EXPORT_MAX_ANSWER_ROWS", "100");
    vi.stubEnv("EXPORT_MAX_QUESTION_COLUMNS", "1");
    mockExportResponses([response]);
    await expect(
      exportToCsv({ campaignId: "campaign-1", fields: ["answers"] }),
    ).rejects.toMatchObject({
      name: "ExportLimitError",
      code: "EXPORT_LIMIT_EXCEEDED",
      message: expect.stringContaining("supera 1 columnas"),
    });
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects the DB answer budget before hydrating response details", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    vi.stubEnv("EXPORT_MAX_ANSWER_ROWS", "1");
    prismaMock.response.findMany.mockResolvedValueOnce([{ id: "response-1" }]);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ answerRows: 2, textBytes: 20 }]);

    await expect(
      exportToCsv({ campaignId: "campaign-1", fields: ["answers"] }),
    ).rejects.toMatchObject({ code: "EXPORT_LIMIT_EXCEEDED" });
    expect(prismaMock.response.findMany).toHaveBeenCalledOnce();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects oversized answer text before hydration", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    vi.stubEnv("EXPORT_MAX_TEXT_BYTES", "10");
    prismaMock.response.findMany.mockResolvedValueOnce([{ id: "response-1" }]);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ answerRows: 1, textBytes: 11 }]);

    await expect(
      exportToJson({ campaignId: "campaign-1", fields: ["answers"] }),
    ).rejects.toMatchObject({ code: "EXPORT_LIMIT_EXCEEDED" });
    expect(prismaMock.response.findMany).toHaveBeenCalledOnce();
  });

  it("budgets hydrated relation text even when answers are not selected", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    vi.stubEnv("EXPORT_MAX_TEXT_BYTES", "10");
    prismaMock.response.findMany.mockResolvedValueOnce([{ id: "response-1" }]);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ answerRows: 0, textBytes: 11 }]);

    await expect(
      exportToCsv({ campaignId: "campaign-1", fields: ["score"] }),
    ).rejects.toMatchObject({ code: "EXPORT_LIMIT_EXCEEDED" });
    const budgetQuery = prismaMock.$queryRaw.mock.calls[0]?.[0] as { strings?: string[] };
    const sql = budgetQuery.strings?.join("?") ?? "";
    expect(sql).toContain('form."title"');
    expect(sql).toContain('campaign."name"');
    expect(sql).toContain('question."label"');
    expect(prismaMock.response.findMany).toHaveBeenCalledOnce();
  });

  it("rechecks hydrated text to close changes after the database preflight", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    vi.stubEnv("EXPORT_MAX_TEXT_BYTES", "500");
    const response = buildResponseFixture();
    response.agent.name = "A".repeat(600);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ answerRows: 0, textBytes: 1 }]);
    mockExportResponses([response]);

    await expect(
      exportToCsv({ campaignId: "campaign-1", fields: ["score"] }),
    ).rejects.toMatchObject({ code: "EXPORT_LIMIT_EXCEEDED" });
    expect(prismaMock.response.findMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
      maxWait: 5_000,
      timeout: 60_000,
    });
  });

  it("counts all 21 XLSX detail cells per answer", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });
    vi.stubEnv("EXPORT_MAX_CELLS", "50");
    const response = buildResponseFixture();
    response.answers.push({
      ...response.answers[0],
      question: {
        ...response.answers[0].question,
        id: "question-2",
        order: 2,
      },
    });
    mockExportResponses([response]);

    await expect(
      exportToExcel({ campaignId: "campaign-1", fields: ["score", "answers"] }),
    ).rejects.toMatchObject({ code: "EXPORT_LIMIT_EXCEEDED" });
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});

function mockExportResponses<T extends { id: string }>(responses: T[]) {
  prismaMock.response.findMany
    .mockResolvedValueOnce(responses.map(({ id }) => ({ id })))
    .mockResolvedValueOnce(responses);
}

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
          id: "question-1",
          formId: "form-1",
          formCategoryId: "form-category-1",
          formCategory: {
            sortOrder: 0,
            qaCategory: { name: "Apertura" },
          },
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
