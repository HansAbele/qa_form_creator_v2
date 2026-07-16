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
  getFormById,
  getFormForEvaluation,
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

describe("form revision workflow", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    revalidatePathMock.mockReset();
    authMock.mockResolvedValue({ user: qaUser });
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
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
    prismaMock.formCategory.create.mockResolvedValue({ id: "form-category-1" });
    prismaMock.question.createMany.mockResolvedValue({ count: 1 });
    prismaMock.auditLog.create.mockResolvedValue({ id: "audit-1" });
  });

  it("does not export client-selectable form permission helpers", async () => {
    const formActions = await import("./forms");
    expect(formActions).not.toHaveProperty("getFormsForPermission");
    expect(formActions).not.toHaveProperty("getFormByIdForPermission");
  });

  it("creates a draft revision when editing a published form", async () => {
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
    prismaMock.form.create.mockResolvedValue({ id: "form-draft" });
    prismaMock.form.findUniqueOrThrow.mockResolvedValue({
      id: "form-draft",
      title: "QA Form",
      description: "Updated",
      campaignId: "campaign-1",
      status: "DRAFT",
      version: "1.1.0",
      parentFormId: "form-1",
      questions: [{ id: "q-1" }],
      categories: [{ id: "form-category-1" }],
    });

    await expect(updateForm("form-1", formInput)).resolves.toMatchObject({
      id: "form-draft",
      status: "DRAFT",
      version: "1.1.0",
      parentFormId: "form-1",
    });

    expect(prismaMock.question.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.formCategory.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.form.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parentFormId: "form-1",
          status: "DRAFT",
          version: "1.1.0",
        }),
      }),
    );
  });

  it("publishes a draft and archives the previously published revision", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      id: "form-draft",
      title: "QA Form",
      campaignId: "campaign-1",
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
      "No autorizado para esta accion en esta campana",
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
      status: "PUBLISHED",
      version: "1.0.0",
    });

    await expect(archiveForm("form-1")).rejects.toThrow(
      "No autorizado para esta accion en esta campana",
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

    await expect(getFormForEvaluation("form-draft")).rejects.toThrow("Formulario no publicado");
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
      "La campana del formulario esta inactiva",
    );
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

    await expect(getFormById("form-draft")).rejects.toThrow("Formulario no publicado");
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
      status: "PUBLISHED",
      campaign: { id: "campaign-1", name: "Campaign 1", active: false },
      questions: [],
    });

    await expect(getFormById("form-published")).rejects.toThrow(
      "La campana del formulario esta inactiva",
    );
  });

  it("does not expose draft revision metadata to a read-only evaluator", async () => {
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
      status: "PUBLISHED",
      campaign: { id: "campaign-1", name: "Campaign 1", active: true },
      parent: { id: "form-parent", version: "1.0.0", status: "ARCHIVED" },
      revisions: [{ id: "form-secret-draft", version: "1.1.0", status: "DRAFT" }],
      questions: [],
    });

    const form = await getFormById("form-published");

    expect(form.revisions).toEqual([]);
    expect(form.parent).toBeNull();
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
          ]),
          status: { not: "ARCHIVED" },
        }),
      }),
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

    await expect(getFormById("form-draft")).rejects.toThrow("Formulario no publicado");
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
    ).rejects.toThrow("No se puede cambiar la campana de una familia de revisiones");

    expect(prismaMock.form.update).not.toHaveBeenCalled();
  });

  it("does not publish a revision whose root belongs to another campaign", async () => {
    prismaMock.form.findUnique.mockResolvedValue({
      id: "form-draft",
      title: "QA Form",
      campaignId: "campaign-1",
      parentFormId: "form-root",
      parent: { id: "form-root", campaignId: "campaign-2" },
      status: "DRAFT",
      version: "1.1.0",
      questions: [],
    });

    await expect(publishForm("form-draft")).rejects.toThrow(
      "La revision no pertenece a la misma campana que su formulario base",
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
});
