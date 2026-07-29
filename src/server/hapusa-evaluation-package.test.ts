import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/server/audit-log", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/server/call-finder/nice-cxone-service", () => ({
  attachNiceCxoneRecording: vi.fn(),
}));
vi.mock("@/server/queries/campaign-filter", () => ({
  getCampaignFilterForPermissions: vi.fn(),
}));

import { buildHapusaScorecardWorkbook } from "./hapusa-evaluation-package";

describe("buildHapusaScorecardWorkbook", () => {
  it("should reproduce the HAPUSA scorecard structure and traffic-light point colors", async () => {
    const workbook = await buildHapusaScorecardWorkbook({
      id: "response-1",
      score: 50,
      createdAt: new Date("2026-07-13T14:46:05.000Z"),
      submittedAt: new Date("2026-07-13T14:46:05.000Z"),
      agent: { id: "agent-1", name: "Antonia Eugene" },
      form: {
        id: "form-1",
        title: "HAPUSA Call Monitoring Score Card",
        campaignId: "campaign-1",
        templateKey: "HAPUSA_QA_SCORECARD",
      },
      answers: [
        {
          score: 100,
          comment: "Complete",
          notApplicable: false,
          category: { name: "Greeting" },
          question: {
            label: "The agent identified themselves to the patient",
            order: 1,
            weight: 2,
            formCategory: { qaCategory: { name: "Greeting" } },
          },
        },
        {
          score: 50,
          comment: "Partial",
          notApplicable: false,
          category: { name: "Greeting" },
          question: {
            label: "The agent asked for the caller's name",
            order: 2,
            weight: 2,
            formCategory: { qaCategory: { name: "Greeting" } },
          },
        },
        {
          score: 0,
          comment: "Missed",
          notApplicable: false,
          category: { name: "Account Verification" },
          question: {
            label: "The agent verified the patient's name and DOB",
            order: 3,
            weight: 10,
            formCategory: { qaCategory: { name: "Account Verification" } },
          },
        },
      ],
      interaction: null,
    } as never);

    const serialized = await workbook.xlsx.writeBuffer();
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(serialized);
    const scorecard = loaded.getWorksheet("Scorecard");

    expect(scorecard?.getCell("A1").value).toBe("Call Monitoring Score Card");
    expect(scorecard?.getCell("A2").value).toContain("Name: Antonia Eugene");
    expect(scorecard?.getCell("A2").value).toContain("Account #:                 ANI#:");
    expect(scorecard?.getCell("C4").value).toBe(2);
    expect(scorecard?.getCell("C5").value).toBe(1);
    expect(scorecard?.getCell("C7").value).toBe(0);
    expect(scorecard?.getCell("C4").fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FFC6E0B4" },
    });
    expect(scorecard?.getCell("C5").fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FFFFD966" },
    });
    expect(scorecard?.getCell("C7").fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FFFF0000" },
    });
    expect(loaded.getWorksheet("Adding Quality to the call tips")?.getCell("A1").value).toBe(
      "Added Quality to the call",
    );
  });
});
