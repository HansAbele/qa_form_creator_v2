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

import {
  archiveForm,
  createForm,
  createParkerDavisScorecard,
  deleteForm,
  getFormById,
  getFormForDraftCorrection,
  getFormForEvaluation,
  getFormForEvaluationCorrection,
  getFormForEvaluationDraft,
  getForms,
  getFormsForExport,
  getFormsForReports,
  publishForm,
  updateForm,
} from "./forms";

const qaUser = {
  id: "qa-1",
  role: "QA",
  campaignIds: ["campaign-1"],
};

const formInput = {
  title: "QA Form",
  description: "Updated",
  campaignId: "campaign-1",
  questions: [
    {
      type: "RATING" as const,
      label: "Resolution",
      required: true,
      qaCategoryId: "qa-resolution",
      weight: 100,
      fatal: false,
      requiresCommentOnFail: false,
    },
  ],
};

const formFindFirstMock = vi.fn();
Object.assign(prismaMock.form, { findFirst: formFindFirstMock });

describe("form lifecycle", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    revalidatePathMock.mockReset();
    authMock.mockResolvedValue({ user: qaUser });
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canViewForms: true,
      canCreateForms: true,
      canEditForms: true,
      canPublishForms: true,
      canEvaluate: true,
    });
    prismaMock.userCampaign.findMany.mockResolvedValue([
      {
        campaignId: "campaign-1",
        canViewForms: true,
      },
    ]);
    prismaMock.qACategory.findMany.mockResolvedValue([
      {
        id: "qa-resolution",
        canBeFatal: false,
        requiresCommentOnFail: false,
      },
    ]);
    prismaMock.$transaction.mockImplementation((callback) => callback(prismaMock));
    formFindFirstMock.mockResolvedValue(null);
    prismaMock.formCategory.create.mockResolvedValue({ id: "form-category-1" });
    prismaMock.question.createMany.mockResolvedValue({ count: 1 });
    prismaMock.auditLog.create.mockResolvedValue({ id: "audit-1" });
  });

  it("does not export client-selectable form permission helpers", async () => {
    const formActions = await import("./forms");
    expect(formActions).not.toHaveProperty("getFormsForPermission");
    expect(formActions).not.toHaveProperty("getFormsForPermissions");
    expect(formActions).not.toHaveProperty("getFormByIdForPermission");
  });

  it("replaces a published form immediately while preserving its historical record", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      id: "form-1",
      title: "QA Form",
      description: null,
      campaignId: "campaign-1",
      createdById: "qa-1",
      parentFormId: null,
      status: "PUBLISHED",
      version: "1.0.0",
      questions: [],
    });
    prismaMock.form.create.mockResolvedValue({ id: "form-replacement" });
    prismaMock.form.findUniqueOrThrow.mockResolvedValue({
      id: "form-replacement",
      title: "QA Form",
      description: "Updated",
      campaignId: "campaign-1",
      status: "PUBLISHED",
      version: "1.0.0",
      parentFormId: null,
      questions: [{ id: "q-1" }],
      categories: [{ id: "form-category-1" }],
    });

    await expect(updateForm("form-1", formInput)).resolves.toMatchObject({
      id: "form-replacement",
      status: "PUBLISHED",
      parentFormId: null,
    });

    expect(prismaMock.question.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.formCategory.deleteMany).not.toHaveBeenCalled();
    expect(formFindFirstMock).not.toHaveBeenCalled();
    expect(prismaMock.form.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdById: "qa-1",
          status: "PUBLISHED",
          publishedAt: expect.any(Date),
        }),
      }),
    );
    expect(prismaMock.form.update).toHaveBeenCalledWith({
      where: { id: "form-1" },
      data: { status: "ARCHIVED", archivedAt: expect.any(Date) },
    });
  });

  it("publishes a draft and archives the previously published form", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      id: "form-draft",
      title: "QA Form",
      campaignId: "campaign-1",
      createdById: "qa-1",
      parentFormId: "form-1",
      status: "DRAFT",
      version: "1.1.0",
      questions: [
        {
          id: "q-1",
          type: "RATING",
          weight: 100,
          formCategoryId: "form-category-1",
        },
      ],
    });
    prismaMock.form.update.mockResolvedValue({
      id: "form-draft",
      status: "PUBLISHED",
      version: "1.1.0",
      parentFormId: "form-1",
      archivedAt: null,
    });

    await publishForm("form-draft");

    expect(prismaMock.form.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          campaignId: "campaign-1",
          status: "PUBLISHED",
          id: { not: "form-draft" },
          OR: [{ id: "form-1" }, { parentFormId: "form-1" }],
        }),
        data: expect.objectContaining({
          status: "ARCHIVED",
        }),
      }),
    );
    expect(prismaMock.form.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "form-draft" },
        data: expect.objectContaining({
          status: "PUBLISHED",
          archivedAt: null,
        }),
      }),
    );
  });

  it("rejects a draft save when publication changed the form while waiting for the family lock", async () => {
    const initialUpdatedAt = new Date("2026-07-17T10:00:00Z");
    prismaMock.form.findUnique
      .mockResolvedValueOnce({
        id: "form-draft",
        title: "QA Form",
        description: null,
        campaignId: "campaign-1",
        createdById: "qa-1",
        parentFormId: "form-1",
        parent: { campaignId: "campaign-1" },
        status: "DRAFT",
        version: "1.1.0",
        updatedAt: initialUpdatedAt,
        questions: [],
      })
      .mockResolvedValueOnce({
        id: "form-draft",
        title: "QA Form",
        description: null,
        campaignId: "campaign-1",
        createdById: "qa-1",
        parentFormId: "form-1",
        parent: { campaignId: "campaign-1" },
        status: "PUBLISHED",
        version: "1.1.0",
        updatedAt: new Date("2026-07-17T10:00:01Z"),
        questions: [],
      });

    await expect(updateForm("form-draft", formInput)).rejects.toThrow(
      "The form changed while the action was being processed",
    );

    expect(prismaMock.$executeRaw).toHaveBeenCalled();
    expect(prismaMock.question.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.form.update).not.toHaveBeenCalled();
  });

  it("rejects publication when a concurrent save changed the locked draft", async () => {
    const validQuestion = {
      id: "q-1",
      type: "RATING",
      options: null,
      weight: 100,
      fatal: false,
      fatalOptions: null,
      formCategoryId: "form-category-1",
    };
    prismaMock.form.findUnique
      .mockResolvedValueOnce({
        id: "form-draft",
        title: "QA Form",
        campaignId: "campaign-1",
        createdById: "qa-1",
        parentFormId: "form-1",
        parent: { id: "form-1", campaignId: "campaign-1" },
        status: "DRAFT",
        version: "1.1.0",
        updatedAt: new Date("2026-07-17T10:00:00Z"),
        questions: [validQuestion],
      })
      .mockResolvedValueOnce({
        id: "form-draft",
        title: "QA Form actualizado",
        campaignId: "campaign-1",
        createdById: "qa-1",
        parentFormId: "form-1",
        parent: { id: "form-1", campaignId: "campaign-1" },
        status: "DRAFT",
        version: "1.1.0",
        updatedAt: new Date("2026-07-17T10:00:01Z"),
        questions: [validQuestion],
      });

    await expect(publishForm("form-draft")).rejects.toThrow(
      "The form changed while the action was being processed",
    );

    expect(prismaMock.$executeRaw).toHaveBeenCalled();
    expect(prismaMock.form.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.form.update).not.toHaveBeenCalled();
  });

  it("requires publish permission to publish a draft", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValueOnce({
      campaignId: "campaign-1",
      canEditForms: true,
      canPublishForms: false,
      canEvaluate: true,
    });
    prismaMock.form.findUnique.mockResolvedValue({
      id: "form-draft",
      title: "QA Form",
      campaignId: "campaign-1",
      createdById: "qa-1",
      parentFormId: null,
      status: "DRAFT",
      version: "1.0.0",
      questions: [
        {
          id: "q-1",
          type: "RATING",
          weight: 100,
          formCategoryId: "form-category-1",
        },
      ],
    });

    await expect(publishForm("form-draft")).rejects.toThrow(
      "Unauthorized for this action in this campaign",
    );

    expect(prismaMock.form.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.form.update).not.toHaveBeenCalled();
  });

  it("requires publish permission to archive a published form", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValueOnce({
      campaignId: "campaign-1",
      canEditForms: true,
      canPublishForms: false,
      canEvaluate: true,
    });
    prismaMock.form.findUnique.mockResolvedValue({
      id: "form-1",
      title: "QA Form",
      campaignId: "campaign-1",
      createdById: "qa-1",
      status: "PUBLISHED",
      version: "1.0.0",
    });

    await expect(archiveForm("form-1")).rejects.toThrow(
      "Unauthorized for this action in this campaign",
    );

    expect(prismaMock.form.update).not.toHaveBeenCalled();
  });

  it("does not allow evaluating draft forms", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      id: "form-draft",
      campaignId: "campaign-1",
      status: "DRAFT",
      campaign: { id: "campaign-1", name: "Campaign 1", active: true },
      questions: [],
    });

    await expect(getFormForEvaluation("form-draft")).rejects.toThrow("Form is not published");
  });

  it("does not allow evaluating published forms from an inactive campaign", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      id: "form-published",
      campaignId: "campaign-1",
      status: "PUBLISHED",
      campaign: { id: "campaign-1", name: "Campaign 1", active: false },
      questions: [],
    });

    await expect(getFormForEvaluation("form-published")).rejects.toThrow(
      "The form campaign is inactive",
    );
  });

  it("loads an archived form for historical correction but blocks draft work in an inactive campaign", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canEditEvaluations: true,
    });
    prismaMock.form.findUnique.mockResolvedValue({
      id: "form-archived",
      campaignId: "campaign-1",
      status: "ARCHIVED",
      campaign: { id: "campaign-1", name: "Campaign 1", active: false },
      parent: null,
      revisions: [],
      questions: [],
    });

    await expect(getFormForEvaluationCorrection("form-archived")).resolves.toMatchObject({
      id: "form-archived",
      status: "ARCHIVED",
    });
    await expect(getFormForDraftCorrection("form-archived")).rejects.toThrow(
      "The form campaign is inactive",
    );
  });

  it("loads an archived form for an existing evaluation draft in an active campaign", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      id: "form-archived",
      campaignId: "campaign-1",
      status: "ARCHIVED",
      campaign: { id: "campaign-1", name: "Campaign 1", active: true },
      questions: [],
    });

    await expect(getFormForEvaluationDraft("form-archived")).resolves.toMatchObject({
      id: "form-archived",
      status: "ARCHIVED",
    });
  });

  it("does not expose a draft by id to a read-only evaluator", async () => {
    prismaMock.userCampaign.findUnique
      .mockResolvedValueOnce({ campaignId: "campaign-1", canViewForms: true })
      .mockResolvedValueOnce({
        campaignId: "campaign-1",
        canCreateForms: false,
        canEditForms: false,
        canPublishForms: false,
      });
    prismaMock.form.findUnique.mockResolvedValue({
      id: "form-draft",
      campaignId: "campaign-1",
      status: "DRAFT",
      campaign: { id: "campaign-1", name: "Campaign 1", active: true },
      questions: [],
    });

    await expect(getFormById("form-draft")).rejects.toThrow("Form is not published");
  });

  it("does not expose another QA's draft by id even with form-management permissions", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      id: "foreign-draft",
      campaignId: "campaign-1",
      createdById: "qa-2",
      status: "DRAFT",
      campaign: { id: "campaign-1", name: "Campaign 1", active: true },
      parent: null,
      revisions: [],
      questions: [],
    });

    await expect(getFormById("foreign-draft")).rejects.toThrow("Form is not published");
  });

  it("allows a QA to open their own draft with form-management permissions", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      id: "own-draft",
      campaignId: "campaign-1",
      createdById: "qa-1",
      status: "DRAFT",
      campaign: { id: "campaign-1", name: "Campaign 1", active: true },
      parent: null,
      revisions: [],
      questions: [],
    });

    await expect(getFormById("own-draft")).resolves.toMatchObject({
      id: "own-draft",
      createdById: "qa-1",
      status: "DRAFT",
    });
  });

  it("does not expose an inactive campaign form by id to a read-only evaluator", async () => {
    prismaMock.userCampaign.findUnique
      .mockResolvedValueOnce({ campaignId: "campaign-1", canViewForms: true })
      .mockResolvedValueOnce({
        campaignId: "campaign-1",
        canCreateForms: false,
        canEditForms: false,
        canPublishForms: false,
      });
    prismaMock.form.findUnique.mockResolvedValue({
      id: "form-published",
      campaignId: "campaign-1",
      createdById: "qa-1",
      status: "PUBLISHED",
      campaign: { id: "campaign-1", name: "Campaign 1", active: false },
      questions: [],
    });

    await expect(getFormById("form-published")).rejects.toThrow("The form campaign is inactive");
  });

  it("lists only active published forms for a QA without form-management permissions", async () => {
    prismaMock.form.findMany.mockResolvedValue([]);

    await getForms();

    expect(prismaMock.form.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              status: "PUBLISHED",
              campaign: { active: true },
            },
            expect.objectContaining({
              createdById: "qa-1",
              campaign: expect.objectContaining({
                users: expect.objectContaining({
                  some: expect.objectContaining({ userId: "qa-1" }),
                }),
              }),
            }),
          ]),
          status: { not: "ARCHIVED" },
        }),
      }),
    );
  });

  it("rejects editing another QA's form in the same campaign", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      id: "foreign-draft",
      title: "Other QA Form",
      description: null,
      campaignId: "campaign-1",
      createdById: "qa-2",
      parentFormId: null,
      parent: null,
      status: "DRAFT",
      version: "1.0.0",
      questions: [],
    });

    await expect(updateForm("foreign-draft", formInput)).rejects.toThrow(
      "You can only modify forms you created",
    );

    expect(prismaMock.form.update).not.toHaveBeenCalled();
    expect(prismaMock.question.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects deleting another QA's draft in the same campaign", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      id: "foreign-draft",
      title: "Other QA Form",
      description: null,
      campaignId: "campaign-1",
      createdById: "qa-2",
      status: "DRAFT",
    });

    await expect(deleteForm("foreign-draft")).rejects.toThrow(
      "You can only modify forms you created",
    );

    expect(prismaMock.response.count).not.toHaveBeenCalled();
    expect(prismaMock.form.delete).not.toHaveBeenCalled();
  });

  it("allows a QA to delete their own unused draft", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      id: "own-draft",
      title: "Own QA Form",
      description: null,
      campaignId: "campaign-1",
      createdById: "qa-1",
      status: "DRAFT",
    });
    prismaMock.response.count.mockResolvedValue(0);

    await expect(deleteForm("own-draft")).resolves.toBeUndefined();

    expect(prismaMock.form.delete).toHaveBeenCalledWith({ where: { id: "own-draft" } });
  });

  it("rejects publishing another QA's draft in the same campaign", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      id: "foreign-draft",
      title: "Other QA Form",
      campaignId: "campaign-1",
      createdById: "qa-2",
      parentFormId: null,
      parent: null,
      status: "DRAFT",
      version: "1.0.0",
      questions: [
        {
          id: "q-1",
          type: "RATING",
          weight: 100,
          formCategoryId: "form-category-1",
        },
      ],
    });

    await expect(publishForm("foreign-draft")).rejects.toThrow(
      "You can only modify forms you created",
    );

    expect(prismaMock.form.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.form.update).not.toHaveBeenCalled();
  });

  it("allows an ADMIN to edit a draft created by another user", async () => {
    authMock.mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN", campaignIds: [] },
    });
    prismaMock.form.findUnique.mockResolvedValue({
      id: "foreign-draft",
      title: "Other QA Form",
      description: null,
      campaignId: "campaign-1",
      createdById: "qa-2",
      parentFormId: null,
      parent: null,
      status: "DRAFT",
      version: "1.0.0",
      questions: [],
    });
    prismaMock.form.findUniqueOrThrow.mockResolvedValue({
      id: "foreign-draft",
      title: "QA Form",
      description: "Updated",
      campaignId: "campaign-1",
      createdById: "qa-2",
      parentFormId: null,
      status: "DRAFT",
      version: "1.0.0",
      questions: [{ id: "q-1" }],
      categories: [{ id: "form-category-1" }],
    });

    await expect(updateForm("foreign-draft", formInput)).resolves.toMatchObject({
      id: "foreign-draft",
      status: "DRAFT",
    });

    expect(prismaMock.form.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "foreign-draft" } }),
    );
  });

  it("keeps report and export form readers on published or archived history", async () => {
    prismaMock.userCampaign.findMany.mockResolvedValue([
      {
        campaignId: "campaign-1",
        canViewReports: true,
        canExport: true,
      },
    ]);
    prismaMock.form.findMany.mockResolvedValue([]);

    await getFormsForReports();
    await getFormsForExport();

    for (const call of prismaMock.form.findMany.mock.calls.slice(-2)) {
      expect(call[0]).toEqual(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ["PUBLISHED", "ARCHIVED"] },
          }),
        }),
      );
    }
  });

  it("lists export forms only for campaigns with report and export access", async () => {
    authMock.mockResolvedValue({
      user: { ...qaUser, campaignIds: ["campaign-1", "campaign-2"] },
    });
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1", canViewReports: true, canExport: true },
      { campaignId: "campaign-2", canViewReports: false, canExport: true },
    ]);
    prismaMock.form.findMany.mockResolvedValue([]);

    await getFormsForExport();

    expect(prismaMock.form.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          campaignId: { in: ["campaign-1"] },
        }),
      }),
    );
  });

  it("lists only active published forms for a read-only supervisor", async () => {
    authMock.mockResolvedValue({
      user: { id: "supervisor-1", role: "SUPERVISOR", campaignIds: ["campaign-1"] },
    });
    prismaMock.form.findMany.mockResolvedValue([]);

    await getForms();

    expect(prismaMock.form.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            {
              status: "PUBLISHED",
              campaign: { active: true },
            },
          ],
        }),
      }),
    );
  });

  it("does not expose a draft by id to a supervisor with legacy write bits", async () => {
    authMock.mockResolvedValue({
      user: { id: "supervisor-1", role: "SUPERVISOR", campaignIds: ["campaign-1"] },
    });
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canViewForms: true,
      canCreateForms: true,
      canEditForms: true,
      canPublishForms: true,
    });
    prismaMock.form.findUnique.mockResolvedValue({
      id: "form-draft",
      campaignId: "campaign-1",
      status: "DRAFT",
      campaign: { id: "campaign-1", name: "Campaign 1", active: true },
      questions: [],
    });

    await expect(getFormById("form-draft")).rejects.toThrow("Form is not published");
  });

  it("does not allow moving a draft revision to another campaign", async () => {
    authMock.mockResolvedValue({
      user: { ...qaUser, campaignIds: ["campaign-1", "campaign-2"] },
    });
    prismaMock.form.findUnique.mockResolvedValue({
      id: "form-draft",
      title: "QA Form",
      description: null,
      campaignId: "campaign-1",
      createdById: "qa-1",
      parentFormId: "form-root",
      status: "DRAFT",
      version: "1.1.0",
      questions: [],
    });

    await expect(
      updateForm("form-draft", { ...formInput, campaignId: "campaign-2" }),
    ).rejects.toThrow("A published or legacy form cannot be moved to another campaign");

    expect(prismaMock.form.update).not.toHaveBeenCalled();
  });

  it("does not update a revision whose parent belongs to another campaign", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      id: "form-draft",
      title: "QA Form",
      description: null,
      campaignId: "campaign-1",
      createdById: "qa-1",
      parentFormId: "form-root",
      parent: { campaignId: "campaign-2" },
      status: "DRAFT",
      version: "1.1.0",
      questions: [],
    });

    await expect(updateForm("form-draft", formInput)).rejects.toThrow(
      "The legacy form record belongs to a different campaign",
    );
    expect(prismaMock.form.update).not.toHaveBeenCalled();
  });

  it("does not publish a revision whose root belongs to another campaign", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      id: "form-draft",
      title: "QA Form",
      campaignId: "campaign-1",
      createdById: "qa-1",
      parentFormId: "form-root",
      parent: { id: "form-root", campaignId: "campaign-2" },
      status: "DRAFT",
      version: "1.1.0",
      questions: [],
    });

    await expect(publishForm("form-draft")).rejects.toThrow(
      "The legacy form record belongs to a different campaign",
    );

    expect(prismaMock.form.updateMany).not.toHaveBeenCalled();
  });

  it("creates a form persisting new types (BOOLEAN, weighted options, critical type, rating scale)", async () => {
    prismaMock.qACategory.findMany.mockResolvedValue([
      { id: "qa-quality", canBeFatal: true, requiresCommentOnFail: false },
    ]);
    prismaMock.form.create.mockResolvedValue({ id: "form-new" });
    prismaMock.form.findUniqueOrThrow.mockResolvedValue({
      id: "form-new",
      title: "Rich QA Form",
      description: null,
      campaignId: "campaign-1",
      status: "DRAFT",
      version: "1.0.0",
      questions: [{ id: "q1" }, { id: "q2" }, { id: "q3" }],
      categories: [{ id: "form-category-1" }],
    });

    await createForm({
      title: "Rich QA Form",
      campaignId: "campaign-1",
      questions: [
        {
          type: "RATING",
          label: "Quality",
          required: true,
          qaCategoryId: "qa-quality",
          weight: 50,
          fatal: true,
          requiresCommentOnFail: true,
          criticalType: "COMPLIANCE",
          ratingFailThreshold: 3,
          ratingMax: 10,
          ratingStyle: "stars",
        },
        {
          type: "BOOLEAN",
          label: "Greeting",
          required: true,
          qaCategoryId: "qa-quality",
          weight: 30,
          fatal: false,
          requiresCommentOnFail: false,
          options: ["Si", "No"],
          optionPoints: [1, 0],
        },
        {
          type: "SELECT",
          label: "Resolution",
          required: true,
          qaCategoryId: "qa-quality",
          weight: 20,
          fatal: true,
          requiresCommentOnFail: true,
          options: ["Full", "Partial", "No"],
          optionPoints: [2, 1, 0],
          fatalOptions: ["No"],
        },
      ],
    });

    expect(prismaMock.question.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            type: "RATING",
            weight: 50,
            fatal: true,
            criticalType: "COMPLIANCE",
            ratingFailThreshold: 3,
            ratingMax: 10,
            ratingStyle: "stars",
          }),
          expect.objectContaining({
            type: "BOOLEAN",
            weight: 30,
            options: [
              { value: "Si", points: 1 },
              { value: "No", points: 0 },
            ],
          }),
          expect.objectContaining({
            type: "SELECT",
            weight: 20,
            fatal: true,
            fatalOptions: ["No"],
            options: [
              { value: "Full", points: 2 },
              { value: "Partial", points: 1 },
              { value: "No", points: 0 },
            ],
          }),
        ]),
      }),
    );
  });

  it("creates the official Parker Davis scorecard only inside its campaign", async () => {
    prismaMock.qACategory.findMany.mockResolvedValue([
      { id: "qa_pd_opening_verification", canBeFatal: false, requiresCommentOnFail: false },
      { id: "qa_pd_communication_control", canBeFatal: false, requiresCommentOnFail: false },
      { id: "qa_pd_problem_resolution", canBeFatal: false, requiresCommentOnFail: false },
      { id: "qa_pd_policy_compliance", canBeFatal: true, requiresCommentOnFail: false },
      { id: "qa_pd_correct_information", canBeFatal: true, requiresCommentOnFail: false },
      { id: "qa_pd_documentation", canBeFatal: true, requiresCommentOnFail: false },
    ]);
    prismaMock.form.create.mockResolvedValue({
      id: "parker-davis-scorecard",
      status: "DRAFT",
    });

    await expect(createParkerDavisScorecard("campaign-1")).resolves.toEqual({
      id: "parker-davis-scorecard",
      status: "DRAFT",
      created: true,
    });

    expect(prismaMock.form.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: "campaign-1",
        templateKey: "PARKER_DAVIS_QA_SCORECARD",
        templateVersion: "PD-QA-SCORECARD-2026-07-R2",
        passThresholdOverride: 95,
        status: "DRAFT",
      }),
      select: { id: true, status: true },
    });
    expect(prismaMock.question.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          label: expect.stringContaining("1. Properly opened the call"),
          weight: 5,
          options: [
            { value: "0 / 5 points", points: 0 },
            { value: "2.5 / 5 points", points: 2.5 },
            { value: "5 / 5 points", points: 5 },
          ],
        }),
        expect.objectContaining({
          fatal: true,
          fatalOptions: ["No"],
          weight: 0,
        }),
      ]),
    });
  });
});
