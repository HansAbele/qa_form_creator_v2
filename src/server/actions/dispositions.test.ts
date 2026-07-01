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

import { createDisposition } from "./dispositions";

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
    ).rejects.toThrow("No autorizado para esta accion en esta campana");
    expect(prismaMock.disposition.create).not.toHaveBeenCalled();
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
    ).rejects.toThrow("Categoria invalida para esta campana");
    expect(prismaMock.disposition.create).not.toHaveBeenCalled();
  });
});
