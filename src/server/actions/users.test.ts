import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const { authMock, hashMock, revalidatePathMock, writeAuditLogMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  hashMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  writeAuditLogMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  return { prisma: (module as { prismaMock: unknown }).prismaMock };
});
vi.mock("bcryptjs", () => ({ hash: hashMock }));
vi.mock("@/server/audit-log", () => ({ writeAuditLog: writeAuditLogMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { createUser, deleteUser, updateUser } from "./users";

const adminSession = { user: { id: "admin-1", role: "ADMIN", campaignIds: [] } };
const safeUser = {
  id: "user-1",
  email: "qa@example.com",
  name: "QA User",
  role: "QA",
  active: true,
  createdAt: new Date("2026-01-01"),
};

describe("admin user security controls", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    hashMock.mockReset();
    revalidatePathMock.mockReset();
    writeAuditLogMock.mockReset();
    authMock.mockResolvedValue(adminSession);
    hashMock.mockResolvedValue("strong-hash");
    prismaMock.user.findFirst.mockResolvedValue({ id: "admin-1" });
    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(prismaMock),
    );
  });

  it("creates users with a safe select and never returns the password hash", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue(safeUser);

    const result = await createUser({
      email: " QA@EXAMPLE.COM ",
      name: " QA User ",
      password: "S3cure-New-Pass!",
      role: "QA",
      campaignIds: [],
    });

    expect(hashMock).toHaveBeenCalledWith("S3cure-New-Pass!", 12);
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "qa@example.com", password: "strong-hash" }),
        select: expect.not.objectContaining({ password: true, sessionVersion: true }),
      }),
    );
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("sessionVersion");
  });

  it("rejects weak passwords on the server", async () => {
    await expect(
      createUser({
        email: "qa@example.com",
        name: "QA User",
        password: "password",
        role: "QA",
        campaignIds: [],
      }),
    ).rejects.toThrow("Password must contain at least 12 characters");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it.each([
    "ADMIN",
    "SUPERVISOR",
  ] as const)("resets existing campaign access when transitioning from %s to QA", async (previousRole) => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({
        id: "user-1",
        email: "qa@example.com",
        name: "QA User",
        role: previousRole,
        active: true,
        campaigns: [{ campaignId: "campaign-1" }],
      })
      .mockResolvedValueOnce({ id: "user-1" });
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.user.update.mockResolvedValue(safeUser);
    prismaMock.userCampaign.findMany.mockResolvedValue([{ campaignId: "campaign-1" }]);

    await updateUser("user-1", {
      email: "qa@example.com",
      name: "QA User",
      role: "QA",
      active: true,
      campaignIds: ["campaign-1"],
    });

    expect(prismaMock.userCampaign.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", campaignId: { in: ["campaign-1"] } },
      data: expect.objectContaining({
        roleInCampaign: "EVALUATOR",
        canViewDashboard: true,
        canEvaluate: true,
        canViewKPIs: true,
        canViewEvaluations: true,
        canViewReports: true,
        canExport: false,
        canEditForms: true,
      }),
    });
  });

  it("does not let a QA Manager deactivate or demote their own account", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
      name: "Admin",
      role: "ADMIN",
      active: true,
      campaigns: [],
    });

    await expect(
      updateUser("admin-1", {
        email: "admin@example.com",
        name: "Admin",
        role: "QA",
        active: true,
        campaignIds: [],
      }),
    ).rejects.toThrow("your own QA Manager account");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("does not let the last active QA Manager be deactivated", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "admin-2",
      email: "last@example.com",
      role: "ADMIN",
      active: true,
    });
    prismaMock.user.count.mockResolvedValue(0);

    await expect(deleteUser("admin-2")).rejects.toThrow("The last active QA Manager");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("takes a transaction lock and revalidates the QA Manager before mutating users", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "qa@example.com",
      role: "QA",
      active: true,
    });

    await expect(deleteUser("user-1")).rejects.toThrow(
      "the QA Manager account is no longer active",
    );

    expect(prismaMock.$executeRaw).toHaveBeenCalledOnce();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });

  it("increments the session version when deactivating an account", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "qa@example.com",
      role: "QA",
      active: true,
    });
    prismaMock.user.update.mockResolvedValue({ ...safeUser, active: false });

    await deleteUser("user-1");

    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: { active: false, sessionVersion: { increment: 1 } },
      }),
    );
  });
});
