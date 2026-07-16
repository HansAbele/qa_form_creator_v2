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

import { readOperationalAudit } from "./audit";

const qaUser = {
  id: "qa-1",
  role: "QA" as const,
  campaignIds: ["campaign-1", "campaign-2"],
};

const adminUser = {
  id: "admin-1",
  role: "ADMIN" as const,
  campaignIds: [],
};

describe("operational audit RBAC", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    prismaMock.$transaction.mockImplementation((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );
    prismaMock.auditLog.count.mockResolvedValue(0);
    prismaMock.auditLog.findMany.mockResolvedValue([]);
  });

  it("allows admins to read audit without campaign scoping", async () => {
    authMock.mockResolvedValue({ user: adminUser });

    await readOperationalAudit({ page: 1, pageSize: 25 });

    expect(prismaMock.userCampaign.findMany).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.count).toHaveBeenCalledWith({ where: {} });
  });

  it("scopes non-admin audit reads to campaigns with canViewAudit", async () => {
    authMock.mockResolvedValue({ user: qaUser });
    prismaMock.userCampaign.findMany.mockResolvedValue([
      { campaignId: "campaign-1" },
      { campaignId: "campaign-2" },
    ]);

    await readOperationalAudit({ page: 1, pageSize: 25 });

    expect(prismaMock.auditLog.count).toHaveBeenCalledWith({
      where: { campaignId: { in: ["campaign-1", "campaign-2"] } },
    });
  });

  it("rejects non-admin audit reads for campaigns outside their audit scope", async () => {
    authMock.mockResolvedValue({ user: qaUser });
    prismaMock.userCampaign.findMany.mockResolvedValue([{ campaignId: "campaign-1" }]);

    await expect(readOperationalAudit({ campaignId: "campaign-2" })).rejects.toThrow(
      "No autorizado para esta campana",
    );
    expect(prismaMock.auditLog.count).not.toHaveBeenCalled();
  });

  it("rejects non-admin audit reads without canViewAudit campaigns", async () => {
    authMock.mockResolvedValue({ user: qaUser });
    prismaMock.userCampaign.findMany.mockResolvedValue([]);

    await expect(readOperationalAudit()).rejects.toThrow("No autorizado");
    expect(prismaMock.auditLog.count).not.toHaveBeenCalled();
  });

  it("surfaces audit storage failures instead of displaying a false empty history", async () => {
    authMock.mockResolvedValue({ user: adminUser });
    prismaMock.auditLog.count.mockRejectedValue(new Error("audit storage unavailable"));

    await expect(readOperationalAudit()).rejects.toThrow("audit storage unavailable");
  });
});
