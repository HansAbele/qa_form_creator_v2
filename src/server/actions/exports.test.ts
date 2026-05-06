import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const { authMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: authMock,
}));

vi.mock("@/lib/prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  const mockedPrisma = (module as { prismaMock: unknown }).prismaMock;
  return { prisma: mockedPrisma };
});

import { exportToCsv, exportToJson } from "./exports";

const qaUser = {
  id: "qa-1",
  role: "QA",
  campaignIds: ["campaign-1"],
};

describe("exports RBAC", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    authMock.mockResolvedValue({ user: qaUser });
    prismaMock.response.findMany.mockResolvedValue([]);
  });

  it("does not allow a QA export for a campaign without canExport", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: false,
    });

    await expect(exportToCsv({ campaignId: "campaign-1" })).rejects.toThrow(
      "No autorizado para esta accion en esta campana",
    );
    expect(prismaMock.response.findMany).not.toHaveBeenCalled();
  });

  it("keeps export queries scoped to the authorized campaign", async () => {
    prismaMock.userCampaign.findUnique.mockResolvedValue({
      campaignId: "campaign-1",
      canExport: true,
    });

    await exportToJson({ campaignId: "campaign-1" });

    expect(prismaMock.response.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          form: { campaignId: "campaign-1" },
        }),
      }),
    );
  });
});
