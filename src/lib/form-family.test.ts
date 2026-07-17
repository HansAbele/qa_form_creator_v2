import { describe, expect, it } from "vitest";
import { collapseFormFamilies, FORM_FAMILY_STATUS, getFormFamilyKey } from "@/lib/form-family";

type TestForm = {
  id: string;
  campaignId: string;
  parentFormId: string | null;
  status: string;
  version: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
};

function form(overrides: Partial<TestForm> = {}): TestForm {
  return {
    id: "form-root",
    campaignId: "campaign-1",
    parentFormId: null,
    status: "PUBLISHED",
    version: "1.0.0",
    title: "Published form",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("collapseFormFamilies", () => {
  it("should present a published form as its own editable and evaluation target", () => {
    const [result] = collapseFormFamilies([form()]);

    expect(result).toEqual({
      id: "form-root",
      campaignId: "campaign-1",
      title: "Published form",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      familyKey: "campaign-1:form-root",
      familyId: "form-root",
      status: FORM_FAMILY_STATUS.PUBLISHED,
      editableFormId: "form-root",
      evaluationFormId: "form-root",
    });
  });

  it("should present a standalone draft without an evaluation target", () => {
    const [result] = collapseFormFamilies([
      form({ id: "draft-root", status: "DRAFT", title: "New draft" }),
    ]);

    expect(result.status).toBe(FORM_FAMILY_STATUS.DRAFT);
    expect(result.editableFormId).toBe("draft-root");
    expect(result.evaluationFormId).toBeNull();
  });

  it("should prefer the most recently updated draft while retaining the published target", () => {
    const published = form();
    const olderDraft = form({
      id: "draft-old",
      parentFormId: "form-root",
      status: "DRAFT",
      version: "1.1.0",
      title: "Older pending changes",
      createdAt: new Date("2026-07-02T00:00:00.000Z"),
      updatedAt: new Date("2026-07-03T00:00:00.000Z"),
    });
    const recentDraft = form({
      id: "draft-new",
      parentFormId: "form-root",
      status: "DRAFT",
      version: "1.2.0",
      title: "Latest pending changes",
      createdAt: new Date("2026-07-04T00:00:00.000Z"),
      updatedAt: new Date("2026-07-05T00:00:00.000Z"),
    });

    const [result] = collapseFormFamilies([published, olderDraft, recentDraft]);

    expect(result).toMatchObject({
      id: "draft-new",
      title: "Latest pending changes",
      status: FORM_FAMILY_STATUS.PENDING_CHANGES,
      editableFormId: "draft-new",
      evaluationFormId: "form-root",
    });
  });

  it("should isolate identical family ids by campaign", () => {
    const results = collapseFormFamilies([
      form(),
      form({ campaignId: "campaign-2", title: "Other campaign" }),
    ]);

    expect(results.map((result) => result.familyKey)).toEqual([
      "campaign-1:form-root",
      "campaign-2:form-root",
    ]);
  });

  it("should not expose version numbers or mutate the source forms", () => {
    const source = form();
    const [result] = collapseFormFamilies([source]);

    expect(result).not.toHaveProperty("version");
    expect(source.version).toBe("1.0.0");
  });

  it("should defensively ignore archived forms", () => {
    const results = collapseFormFamilies([form({ status: "ARCHIVED" })]);

    expect(results).toEqual([]);
  });

  it("should return an empty list for an empty input", () => {
    expect(collapseFormFamilies([])).toEqual([]);
  });
});

describe("getFormFamilyKey", () => {
  it("should combine campaign scope with the root form id", () => {
    expect(
      getFormFamilyKey({
        id: "draft-1",
        campaignId: "campaign-1",
        parentFormId: "form-root",
      }),
    ).toBe("campaign-1:form-root");
  });
});
