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
  createDisposition,
  createDispositionInline,
  getDispositionCategories,
  getDispositions,
  getDispositionsForSelector,
} from "./dispositions";

const qaUser = {
  id: "qa-1",
  role: "QA",
  campaignIds: ["campaign-1"],
};

describe("disposition mutations RBAC", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    revalidatePathMock.mockReset();
    authMock.mockResolvedValue({ user: qaUser });
  });

  it("rejects disposition creation when the QA lacks canManageDispositions", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canManageDispositions: false,
    });

    await expect(
      createDisposition({ name: "Completed", campaignId: "campaign-1" }),
    ).rejects.toThrow("Unauthorized for this action in this campaign");
    expect(prismaMock.disposition.create).not.toHaveBeenCalled();
  });

  it("enforces management permission for inline disposition creation", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canManageDispositions: false,
    });

    await expect(
      createDispositionInline({ name: "Completed", campaignId: "campaign-1" }),
    ).rejects.toThrow("Unauthorized for this action in this campaign");
    expect(prismaMock.disposition.create).not.toHaveBeenCalled();
  });

  it("allows an authorized user to confirm a similar inline disposition", async () => {
    const disposition = {
      id: "disposition-1",
      name: "Completed",
      campaignId: "campaign-1",
    };
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canManageDispositions: true,
    });
    prismaMock.disposition.findUnique.mockResolvedValue(null);
    prismaMock.disposition.create.mockResolvedValue(disposition);

    await expect(
      createDispositionInline({
        name: "Completed",
        campaignId: "campaign-1",
        allowSimilar: true,
      }),
    ).resolves.toEqual({ ok: true, disposition });
    expect(prismaMock.disposition.findMany).not.toHaveBeenCalled();
  });

  it("returns a structured similar-name result for the inline confirmation flow", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canManageDispositions: true,
    });
    prismaMock.disposition.findUnique.mockResolvedValue(null);
    prismaMock.disposition.findMany.mockResolvedValue([{ id: "disposition-1", name: "Completed" }]);

    await expect(
      createDispositionInline({ name: "Complete", campaignId: "campaign-1" }),
    ).resolves.toEqual({
      ok: false,
      code: "SIMILAR",
      existing: { id: "disposition-1", name: "Completed" },
    });
    expect(prismaMock.disposition.create).not.toHaveBeenCalled();
  });

  it("rejects detailed disposition readers without management permission", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canManageDispositions: false,
    });

    await expect(getDispositionCategories("campaign-1")).rejects.toThrow(
      "Unauthorized for this action in this campaign",
    );
    await expect(getDispositions("campaign-1")).rejects.toThrow(
      "Unauthorized for this action in this campaign",
    );
  });

  it("returns selector data without global usage counts", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canEvaluate: true,
    });
    prismaMock.disposition.findMany.mockResolvedValue([]);

    await expect(getDispositionsForSelector("campaign-1")).resolves.toEqual({
      categories: [],
      uncategorized: [],
      all: [],
    });
    expect(prismaMock.disposition.findMany).toHaveBeenCalledWith({
      where: { campaignId: "campaign-1", active: true, campaign: { active: true } },
      select: {
        id: true,
        name: true,
        code: true,
        category: { select: { id: true, name: true, campaignId: true } },
      },
      orderBy: { name: "asc" },
    });
  });

  it("hides a selector category linked from another campaign", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canEvaluate: true,
    });
    prismaMock.disposition.findMany.mockResolvedValue([
      {
        id: "disposition-valid",
        name: "Venta",
        code: "SALE",
        category: { id: "category-1", name: "Ventas", campaignId: "campaign-1" },
      },
      {
        id: "disposition-corrupt",
        name: "Ajena",
        code: "OTHER",
        category: { id: "category-2", name: "Categoria ajena", campaignId: "campaign-2" },
      },
    ]);

    const result = await getDispositionsForSelector("campaign-1");

    expect(result.categories).toEqual([
      {
        categoryName: "Ventas",
        items: [
          {
            id: "disposition-valid",
            name: "Venta",
            code: "SALE",
            category: { id: "category-1", name: "Ventas" },
          },
        ],
      },
    ]);
    expect(result.uncategorized).toEqual([
      {
        id: "disposition-corrupt",
        name: "Ajena",
        code: "OTHER",
        category: null,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("Categoria ajena");
  });

  it("hides foreign categories in the management reader and scopes usage counts", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canManageDispositions: true,
    });
    prismaMock.disposition.findMany.mockResolvedValue([
      {
        id: "disposition-corrupt",
        name: "Escalado",
        campaignId: "campaign-1",
        category: { id: "category-2", name: "Categoria ajena", campaignId: "campaign-2" },
        createdBy: { name: "Manager" },
        _count: { responses: 1 },
      },
    ]);

    await expect(getDispositions("campaign-1")).resolves.toEqual([
      expect.objectContaining({ id: "disposition-corrupt", category: null }),
    ]);
    expect(prismaMock.disposition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          _count: {
            select: {
              responses: {
                where: {
                  form: { campaignId: "campaign-1" },
                  agent: { campaignId: "campaign-1" },
                },
              },
            },
          },
        }),
      }),
    );
  });

  it("rejects a disposition category from another campaign", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canManageDispositions: true,
    });
    prismaMock.dispositionCategory.findUnique.mockResolvedValue({
      campaignId: "campaign-2",
    });

    await expect(
      createDisposition({
        name: "Completed",
        categoryId: "category-2",
        campaignId: "campaign-1",
      }),
    ).rejects.toThrow("Invalid category for this campaign");
    expect(prismaMock.disposition.create).not.toHaveBeenCalled();
  });
});
