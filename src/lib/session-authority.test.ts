import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const { loggerInfoMock, loggerWarnMock } = vi.hoisted(() => ({
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("./prisma", async () => {
  const module = await vi.importActual("@/test/prisma-mock");
  return { prisma: (module as { prismaMock: unknown }).prismaMock };
});

vi.mock("./logger", () => ({
  logger: {
    info: loggerInfoMock,
    warn: loggerWarnMock,
  },
}));

import { createAuthoritativeAuth, revalidateSession } from "./session-authority";

const tokenSession: Session = {
  expires: "2099-01-01T00:00:00.000Z",
  user: {
    id: "user-1",
    email: "old@example.com",
    name: "Old name",
    image: null,
    role: "QA",
    campaignIds: ["old-campaign"],
    sessionVersion: 3,
    locale: "en",
  },
};

const activeUser = {
  id: "user-1",
  email: "current@example.com",
  name: "Current name",
  image: null,
  role: "SUPERVISOR" as const,
  active: true,
  sessionVersion: 3,
  locale: "es",
  campaigns: [{ campaignId: "campaign-2" }, { campaignId: "campaign-3" }],
};

describe("authoritative server sessions", () => {
  beforeEach(() => {
    resetPrismaMock();
    loggerInfoMock.mockReset();
    loggerWarnMock.mockReset();
  });

  it("should refresh role, identity, and campaign ids from the database", async () => {
    prismaMock.user.findUnique.mockResolvedValue(activeUser);

    await expect(revalidateSession(tokenSession)).resolves.toEqual({
      ...tokenSession,
      user: {
        ...tokenSession.user,
        email: "current@example.com",
        name: "Current name",
        role: "SUPERVISOR",
        campaignIds: ["campaign-2", "campaign-3"],
        locale: "es",
      },
    });

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: expect.objectContaining({
        active: true,
        role: true,
        sessionVersion: true,
        locale: true,
        campaigns: { select: { campaignId: true } },
      }),
    });
  });

  it("should reject a session after its version is revoked", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...activeUser, sessionVersion: 4 });

    await expect(revalidateSession(tokenSession)).resolves.toBeNull();
    expect(loggerInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({ tokenSessionVersion: 3, currentSessionVersion: 4 }),
      "Session rejected: token was revoked",
    );
  });

  it("should reject inactive users", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...activeUser, active: false });

    await expect(revalidateSession(tokenSession)).resolves.toBeNull();
    expect(loggerWarnMock).toHaveBeenCalledWith(
      { userId: "user-1" },
      "Session rejected: user missing or inactive",
    );
  });

  it("should reject deleted users", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(revalidateSession(tokenSession)).resolves.toBeNull();
    expect(loggerWarnMock).toHaveBeenCalledWith(
      { userId: "user-1" },
      "Session rejected: user missing or inactive",
    );
  });

  it("should reject legacy tokens without a session version", async () => {
    const legacySession = {
      ...tokenSession,
      user: { ...tokenSession.user, sessionVersion: undefined },
    } as unknown as Session;

    await expect(revalidateSession(legacySession)).resolves.toBeNull();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("should perform the database check on every wrapped auth call", async () => {
    prismaMock.user.findUnique.mockResolvedValue(activeUser);
    const rawAuth = vi.fn().mockResolvedValue(tokenSession);
    const auth = createAuthoritativeAuth(rawAuth);

    await auth();
    await auth();

    expect(rawAuth).toHaveBeenCalledTimes(2);
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2);
  });
});
