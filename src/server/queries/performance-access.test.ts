import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { prismaMock } from "@/test/prisma-mock";
import {
  canAgentAccessInteractionEvidence,
  canViewCoachingSession,
  canViewPipPlan,
} from "./performance-access";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

describe("private performance access", () => {
  const agentSession = {
    id: "user-agent",
    role: "AGENT",
    campaignIds: ["campaign-1"],
    locale: "en",
  } as Session["user"];
  const evaluatorSession = {
    id: "qa-1",
    role: "QA",
    campaignIds: ["campaign-1"],
    locale: "en",
  } as Session["user"];

  beforeEach(() => {
    prismaMock.coachingSession.findUnique.mockReset();
    prismaMock.pipPlan.findUnique.mockReset();
    prismaMock.performanceEvidence.findFirst.mockReset();
    prismaMock.userCampaign.findUnique.mockReset();
  });

  it("lets an agent see only coaching assigned to their linked profile", async () => {
    prismaMock.coachingSession.findUnique.mockResolvedValueOnce({
      id: "coaching-1",
      campaignId: "campaign-1",
      agentId: "agent-1",
      coachId: "qa-1",
      createdById: "qa-1",
      agent: { userId: "user-agent", active: true },
    } as never);

    expect(await canViewCoachingSession(agentSession, "coaching-1")).toBe(true);

    prismaMock.coachingSession.findUnique.mockResolvedValueOnce({
      id: "coaching-2",
      campaignId: "campaign-1",
      agentId: "agent-2",
      coachId: "qa-1",
      createdById: "qa-1",
      agent: { userId: "other-agent-user", active: true },
    } as never);

    expect(await canViewCoachingSession(agentSession, "coaching-2")).toBe(false);
  });

  it("limits evaluators to coaching they own or created", async () => {
    prismaMock.coachingSession.findUnique.mockResolvedValueOnce({
      id: "coaching-1",
      campaignId: "campaign-1",
      agentId: "agent-1",
      coachId: "qa-2",
      createdById: "qa-2",
      agent: { userId: null, active: true },
    } as never);
    prismaMock.userCampaign.findUnique.mockResolvedValueOnce({
      roleInCampaign: "EVALUATOR",
      canViewCoaching: true,
    } as never);

    expect(await canViewCoachingSession(evaluatorSession, "coaching-1")).toBe(false);
  });

  it("lets an agent open their own PIP and linked call evidence", async () => {
    prismaMock.pipPlan.findUnique.mockResolvedValueOnce({
      id: "pip-1",
      campaignId: "campaign-1",
      agentId: "agent-1",
      ownerId: "qa-1",
      createdById: "qa-1",
      agent: { userId: "user-agent", active: true },
    } as never);

    expect(await canViewPipPlan(agentSession, "pip-1")).toBe(true);

    prismaMock.performanceEvidence.findFirst.mockResolvedValueOnce({
      id: "evidence-1",
    } as never);

    expect(await canAgentAccessInteractionEvidence("user-agent", "interaction-1")).toBe(true);
  });
});
