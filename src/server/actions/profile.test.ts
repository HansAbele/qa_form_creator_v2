import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const { authMock, compareMock, hashMock, revalidatePathMock, writeAuditLogMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    compareMock: vi.fn(),
    hashMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    writeAuditLogMock: vi.fn(),
  }),
);

vi.mock("@/lib/auth", () => ({ auth: authMock }));

vi.mock("@/lib/prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  return { prisma: (module as { prismaMock: unknown }).prismaMock };
});

vi.mock("bcryptjs", () => ({
  compare: compareMock,
  hash: hashMock,
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/server/audit-log", () => ({ writeAuditLog: writeAuditLogMock }));

import { changeMyPassword, updateMyName } from "./profile";

describe("profile session revocation", () => {
  beforeEach(() => {
    resetPrismaMock();
    authMock.mockReset();
    compareMock.mockReset();
    hashMock.mockReset();
    revalidatePathMock.mockReset();
    writeAuditLogMock.mockReset();

    authMock.mockResolvedValue({
      user: { id: "user-1", role: "QA", campaignIds: ["campaign-1"], sessionVersion: 3 },
    });
  });

  it("increments the session version and audits a password change atomically", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      password: "old-hash",
      active: true,
      sessionVersion: 3,
    });
    compareMock.mockResolvedValue(true);
    hashMock.mockResolvedValue("new-hash");
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });

    await changeMyPassword("old-password", "N3w-Secure-Pass!");

    expect(hashMock).toHaveBeenCalledWith("N3w-Secure-Pass!", 12);

    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: "user-1",
        active: true,
        password: "old-hash",
        sessionVersion: 3,
      },
      data: {
        password: "new-hash",
        sessionVersion: { increment: 1 },
      },
    });
    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        action: "password_changed",
        afterValue: { passwordChanged: true, sessionsRevoked: true },
      }),
      prismaMock,
    );
    expect(JSON.stringify(writeAuditLogMock.mock.calls)).not.toContain("old-password");
    expect(JSON.stringify(writeAuditLogMock.mock.calls)).not.toContain("new-hash");
  });

  it("rejects a concurrent password reset without writing false audit evidence", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      password: "old-hash",
      active: true,
      sessionVersion: 3,
    });
    compareMock.mockResolvedValue(true);
    hashMock.mockResolvedValue("new-hash");
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(changeMyPassword("old-password", "N3w-Secure-Pass!")).rejects.toThrow(
      "password or session changed",
    );
    expect(writeAuditLogMock).not.toHaveBeenCalled();
  });

  it("updates a profile name with compare-and-swap and audit in one transaction", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      name: "Old Name",
      active: true,
      sessionVersion: 3,
    });
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });

    await updateMyName(" New Name ");

    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: "user-1",
        active: true,
        name: "Old Name",
        sessionVersion: 3,
      },
      data: { name: "New Name" },
    });
    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "profile_name_updated",
        beforeValue: { name: "Old Name" },
        afterValue: { name: "New Name" },
      }),
      prismaMock,
    );
  });
});
