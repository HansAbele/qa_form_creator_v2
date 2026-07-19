import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  return { prisma: (module as { prismaMock: unknown }).prismaMock };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  createQACategory,
  deactivateQACategory,
  readActiveQACategoriesForFormCreation,
  readQACategories,
} from "./qa-categories";

describe("QA category data minimization", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
  });

  it("reserves the full catalog and global usage counts for QA Managers", async () => {
    authMock.mockResolvedValue({
      user: { id: "qa-1", role: "QA", campaignIds: ["campaign-1"] },
    });

    await expect(readQACategories()).rejects.toThrow("Unauthorized");
    expect(prismaMock.qACategory.findMany).not.toHaveBeenCalled();
  });

  it("returns only active minimal options to authorized form authors", async () => {
    authMock.mockResolvedValue({
      user: { id: "author-1", role: "QA", campaignIds: ["campaign-1"] },
    });
    prismaMock.userCampaign.findMany.mockResolvedValue([{ campaignId: "campaign-1" }]);
    prismaMock.qACategory.findMany.mockResolvedValue([]);

    await readActiveQACategoriesForFormCreation();

    expect(prismaMock.userCampaign.findMany).toHaveBeenCalledWith({
      where: { userId: "author-1", canCreateForms: true },
      select: { campaignId: true },
      take: 1,
    });
    expect(prismaMock.qACategory.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        systemColor: true,
        canBeFatal: true,
        requiresCommentOnFail: true,
      },
    });
  });

  it("blocks supervisors even if a legacy row still has a write bit", async () => {
    authMock.mockResolvedValue({
      user: { id: "supervisor-1", role: "SUPERVISOR", campaignIds: ["campaign-1"] },
    });

    await expect(readActiveQACategoriesForFormCreation()).rejects.toThrow("Unauthorized");
    expect(prismaMock.userCampaign.findMany).not.toHaveBeenCalled();
  });

  it("allows only a QA Manager to create a validated category", async () => {
    authMock.mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN", campaignIds: [] },
    });
    prismaMock.qACategory.findFirst.mockResolvedValue(null);
    prismaMock.qACategory.count.mockResolvedValue(3);
    prismaMock.qACategory.create.mockResolvedValue({ id: "category-1", name: "Compliance" });

    await createQACategory({
      name: " Compliance ",
      description: "Required checks",
      canBeFatal: true,
      requiresCommentOnFail: true,
      visibleInDashboard: true,
      visibleInKPIs: true,
    });

    expect(prismaMock.qACategory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Compliance", sortOrder: 3, canBeFatal: true }),
    });
  });

  it("preserves categories used by historical forms", async () => {
    authMock.mockResolvedValue({
      user: { id: "admin-1", role: "ADMIN", campaignIds: [] },
    });
    prismaMock.qACategory.findUnique.mockResolvedValue({
      id: "category-1",
      isActive: true,
      _count: { formCategories: 2 },
    });

    await expect(deactivateQACategory("category-1")).rejects.toThrow(
      "A QA category used by forms cannot be deactivated",
    );
    expect(prismaMock.qACategory.update).not.toHaveBeenCalled();
  });
});
