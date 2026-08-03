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
      interaction: { phoneNumber: "+1 (978) 935-3171" },
    } as never);

    const serialized = await workbook.xlsx.writeBuffer();
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(serialized);
    const scorecard = loaded.getWorksheet("Scorecard");

    expect(scorecard?.getCell("A1").value).toBe("Call Monitoring Score Card");
    expect(scorecard?.getCell("A2").value).toContain("Name: Antonia Eugene");
    expect(scorecard?.getCell("A2").value).toContain("Date: 07/13/2026");
    expect(scorecard?.getCell("A2").value).toContain(
      "Account #:                 ANI#: 19789353171",
    );
    expect(scorecard?.getCell("A3").value).toBe("Greeting");
    expect(scorecard?.getCell("B3").value).toBe("10 Points ");
    expect(scorecard?.getCell("C3").value).toBe("Points Scored");
    expect(scorecard?.getCell("D3").value).toBe("Comment Section");
    expect(scorecard?.getCell("C4").value).toBe(2);
    expect(scorecard?.getCell("C5").value).toBe(1);
    expect(scorecard?.getCell("C6").value).toBe(0);
    expect(scorecard?.getCell("D4").value).toBe("Complete");
    expect(scorecard?.getCell("D5").value).toBe("Partial");
    expect(scorecard?.getCell("D6").value).toBe("Missed");
    expect(scorecard?.getCell("C4").fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FFC6E0B4" },
    });
    expect(scorecard?.getCell("C5").fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FFFFD966" },
    });
    expect(scorecard?.getCell("C6").fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FFFF0000" },
    });
    expect(scorecard?.getCell("C35").value).toEqual({ formula: "SUM(C4:C34)", result: 50 });
    expect(
      (scorecard as unknown as { conditionalFormattings: unknown[] }).conditionalFormattings,
    ).toHaveLength(2);
    expect(scorecard?.getColumn(1).width).toBeCloseTo(94.5703125);
    expect(scorecard?.getColumn(4).width).toBeCloseTo(48.42578125);
    expect(scorecard?.getRow(33).height).toBe(38.25);
    expect(String(scorecard?.getCell("A37").value)).toContain(
      "Total points accumulate on a scale of 100%",
    );
    expect(loaded.worksheets.map((sheet) => sheet.name)).toEqual([
      "Scorecard",
      "Adding Quality to the call tips",
      "Sheet3",
    ]);
    expect(loaded.getWorksheet("Adding Quality to the call tips")?.getCell("A1").value).toBe(
      "Added Quality to the call",
    );
  });
});
