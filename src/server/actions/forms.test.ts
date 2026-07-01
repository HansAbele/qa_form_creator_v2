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

import { archiveForm, getFormByIdForPermission, publishForm, updateForm } from "./forms";

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
      canEditForms: true,
      canPublishForms: true,
      canEvaluate: true,
    });
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
      questions: [],
    });

    await expect(getFormByIdForPermission("form-draft", "canEvaluate")).rejects.toThrow(
      "Formulario no publicado",
    );
  });
});
