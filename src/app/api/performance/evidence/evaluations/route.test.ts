import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  assertPermission: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: { response: { findMany: mocks.findMany } },
}));
vi.mock("@/server/queries/campaign-filter", () => {
  class CampaignAuthorizationError extends Error {}
  return {
    CampaignAuthorizationError,
    assertCampaignPermissionForUser: mocks.assertPermission,
  };
});

import { GET } from "./route";

const sessionUser = {
  id: "qa-1",
  role: "QA",
  campaignIds: ["campaign-1"],
};

describe("GET /api/performance/evidence/evaluations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: sessionUser });
    mocks.assertPermission.mockResolvedValue(undefined);
    mocks.findMany.mockResolvedValue([]);
  });

  it("searches one agent with date, text, template, and paginated Qore filters", async () => {
    mocks.findMany.mockResolvedValue(
      Array.from({ length: 26 }, (_, index) => ({
        id: `response-${index + 1}`,
        score: 92,
        result: "PASS",
        hasFatalFail: false,
        submittedAt: new Date("2026-07-20T12:00:00.000Z"),
        form: { id: "form-1", title: "HAPUSA Call Monitoring Score Card" },
        interaction: {
          id: "call-1",
          providerInteractionId: "CALL-9001",
          startedAt: new Date("2026-07-20T11:00:00.000Z"),
          phoneNumber: "5551234",
          hasRecording: true,
          mediaAssets: [],
        },
      })),
    );

    const response = await GET(
      new Request(
        "http://localhost/api/performance/evidence/evaluations?campaignId=campaign-1&agentId=agent-1&scope=pip&templateKey=HAPUSA&query=CALL-9001&from=2026-07-01&to=2026-07-31",
      ),
    );
    const body = (await response.json()) as {
      items: Array<{ id: string; interaction: { hasRecording: boolean } }>;
      nextCursor: string | null;
    };

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(25);
    expect(body.nextCursor).toBe("response-25");
    expect(body.items[0]?.interaction.hasRecording).toBe(true);
    expect(mocks.assertPermission).toHaveBeenCalledWith(sessionUser, "campaign-1", "canManagePips");
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          agentId: "agent-1",
          status: "SUBMITTED",
          form: expect.objectContaining({
            campaignId: "campaign-1",
            OR: expect.arrayContaining([
              expect.objectContaining({
                title: expect.objectContaining({
                  contains: "HAPUSA",
                  mode: "insensitive",
                }),
              }),
            ]),
          }),
          AND: expect.arrayContaining([
            expect.objectContaining({ OR: expect.any(Array) }),
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  submittedAt: expect.objectContaining({
                    gte: expect.any(Date),
                    lt: expect.any(Date),
                  }),
                }),
              ]),
            }),
          ]),
        }),
        take: 26,
      }),
    );
  });

  it("rejects unauthenticated evidence searches", async () => {
    mocks.auth.mockResolvedValue(null);

    const response = await GET(
      new Request(
        "http://localhost/api/performance/evidence/evaluations?campaignId=campaign-1&agentId=agent-1&scope=coaching",
      ),
    );

    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
