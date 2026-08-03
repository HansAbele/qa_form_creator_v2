import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/server/audit-log", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/server/call-finder/call-source-service", () => ({
  attachProviderRecording: vi.fn(),
}));
vi.mock("@/server/queries/campaign-filter", () => ({
  getCampaignFilterForPermissions: vi.fn(),
}));

import { buildParkerDavisScorecardWorkbook } from "./parker-davis-evaluation-package";

function answer(label: string, order: number, weight: number, score: number, comment: string) {
  return {
    value: String(score),
    score,
    comment,
    isFatalFail: false,
    notApplicable: false,
    category: { name: "SECTION 1 — Opening/Greeting & Verification" },
    question: {
      label,
      order,
      weight,
      fatal: false,
      formCategory: {
        qaCategory: { name: "SECTION 1 — Opening/Greeting & Verification" },
      },
    },
  };
}

describe("buildParkerDavisScorecardWorkbook", () => {
  it("reproduces the official Parker Davis workbook and fills evaluation data", async () => {
    const workbook = await buildParkerDavisScorecardWorkbook({
      id: "response-1",
      score: 90,
      result: "FAIL",
      hasFatalFail: false,
      createdAt: new Date("2026-08-03T14:46:05.000Z"),
      submittedAt: new Date("2026-08-03T14:46:05.000Z"),
      agent: { id: "agent-1", name: "Richard José Muñoz" },
      evaluator: { id: "qa-1", name: "Ivanna QA" },
      form: {
        id: "form-1",
        title: "Parker Davis — QA Scorecard",
        campaignId: "campaign-1",
        templateKey: "PARKER_DAVIS_QA_SCORECARD",
      },
      answers: [
        answer(
          "1. Properly opened the call and greeted the customer with the branding of the company.",
          1,
          5,
          100,
          "Correct greeting and branding.",
        ),
        answer(
          "2. Correctly verifies information: name, phone number, order number, invoice number etc.",
          2,
          5,
          50,
          "Partial verification.",
        ),
        answer(
          "4. Did the agent listen without interrupting, acknowledge concerns, ask clarifying questions?",
          3,
          5,
          0,
          "The customer was interrupted.",
        ),
      ],
      interaction: { phoneNumber: "4075550100" },
    } as never);

    const serialized = await workbook.xlsx.writeBuffer();
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(serialized);
    const sheet = loaded.getWorksheet("Sheet1");

    expect(sheet?.getCell("A1").value).toBe("Parker Davis — QA Scorecard");
    expect(sheet?.getCell("B5").value).toBe("Richard José Muñoz");
    expect(sheet?.getCell("D5").value).toBe("08/03/2026");
    expect(sheet?.getCell("F5").value).toBe("Ivanna QA");
    expect(sheet?.getCell("D10").value).toBe(5);
    expect(sheet?.getCell("D11").value).toBe(2.5);
    expect(sheet?.getCell("D14").value).toBe(0);
    expect(sheet?.getCell("G10").value).toBe("Correct greeting and branding.");
    expect(sheet?.getCell("B33").value).toBeNull();
    expect(sheet?.getRow(33).hidden).toBe(true);
    expect(sheet?.getCell("C60").value).toEqual({
      formula: "SUM(D10,D11,D14,D15,D16,D17,D18,D19,D22,D28,D42,D48,D54)",
      result: 90,
    });
    expect(sheet?.getCell("C61").value).toEqual({ formula: "IFERROR(C60/C59,0)", result: 0.9 });
    expect(sheet?.getCell("D65").value).toBe("ACCEPTABLE");
    expect(sheet?.getCell("D65").fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FFFFD966" },
    });
    expect(sheet?.getColumn(1).width).toBeCloseTo(6.88671875);
    expect(sheet?.getColumn(2).width).toBeCloseTo(65.33203125);
    expect(sheet?.getColumn(7).width).toBeCloseTo(16.21875);
    expect(sheet?.model.merges).toContain("A1:G1");
    expect(sheet?.views[0]).toMatchObject({ state: "frozen", ySplit: 8 });
  });
});
