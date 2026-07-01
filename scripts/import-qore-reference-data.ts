import { readFile } from "node:fs/promises";
import path from "node:path";
import { CampaignAccessLevel, PrismaClient, Role } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

type RemoteCampaign = {
  id: string;
  name: string;
  description?: string | null;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type RemoteUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type RemoteUserCampaign = {
  userId: string;
  campaignId: string;
  assignedAt?: string;
};

type RemoteTeam = {
  id: string;
  name: string;
  campaignId: string;
  createdAt?: string;
};

type RemoteAgent = {
  id: string;
  name: string;
  agentCode?: string | null;
  campaignId: string;
  teamId?: string | null;
  active?: boolean;
  createdAt?: string;
};

type ReferenceData = {
  exportedAt?: string;
  campaigns: RemoteCampaign[];
  users: RemoteUser[];
  userCampaigns: RemoteUserCampaign[];
  teams: RemoteTeam[];
  agents: RemoteAgent[];
};

type Counters = {
  campaigns: number;
  users: number;
  userCampaigns: number;
  teams: number;
  agents: number;
};

const DEFAULT_DATA_PATH = path.join(process.cwd(), ".logs", "qore-reference-data.json");
const DEFAULT_IMPORTED_PASSWORD = "Qore.Local.2026";

function parseDate(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizeRole(role: string): Role {
  if (role === Role.ADMIN) return Role.ADMIN;
  if (role === Role.SUPERVISOR) return Role.SUPERVISOR;
  return Role.QA;
}

function accessLevelForRole(role: Role): CampaignAccessLevel {
  if (role === Role.ADMIN) return CampaignAccessLevel.CAMPAIGN_ADMIN;
  if (role === Role.SUPERVISOR) return CampaignAccessLevel.SUPERVISOR;
  return CampaignAccessLevel.EVALUATOR;
}

function permissionsForRole(role: Role) {
  const isAdmin = role === Role.ADMIN;
  const isSupervisor = role === Role.SUPERVISOR;

  return {
    roleInCampaign: accessLevelForRole(role),
    canViewDashboard: true,
    canViewKPIs: true,
    canViewForms: true,
    canCreateForms: isAdmin,
    canEditForms: isAdmin,
    canPublishForms: isAdmin,
    canEvaluate: !isSupervisor,
    canEditEvaluations: isAdmin,
    canViewReports: true,
    canExport: isAdmin,
    canManageAgents: isAdmin,
    canManageDispositions: isAdmin,
    canManageCampaignScoring: isAdmin,
    canViewAudit: isAdmin,
  };
}

async function readReferenceData(filePath: string): Promise<ReferenceData> {
  const raw = await readFile(filePath, "utf8");
  const data = JSON.parse(raw) as Partial<ReferenceData>;

  for (const key of ["campaigns", "users", "userCampaigns", "teams", "agents"] as const) {
    if (!Array.isArray(data[key])) {
      throw new Error(`Invalid reference data: missing array ${key}`);
    }
  }

  return data as ReferenceData;
}

async function importReferenceData(data: ReferenceData, importedPassword: string) {
  const counters: Counters = {
    campaigns: 0,
    users: 0,
    userCampaigns: 0,
    teams: 0,
    agents: 0,
  };
  const password = await hash(importedPassword, 12);
  const userIdByRemoteId = new Map<string, string>();
  const teamIdByRemoteId = new Map<string, string>();

  for (const campaign of data.campaigns) {
    await prisma.campaign.upsert({
      where: { id: campaign.id },
      update: {
        name: campaign.name,
        description: campaign.description ?? null,
        active: campaign.active ?? true,
      },
      create: {
        id: campaign.id,
        name: campaign.name,
        description: campaign.description ?? null,
        active: campaign.active ?? true,
        createdAt: parseDate(campaign.createdAt),
        updatedAt: parseDate(campaign.updatedAt),
      },
    });
    counters.campaigns += 1;
  }

  for (const user of data.users) {
    const role = normalizeRole(user.role);
    const existing = await prisma.user.findUnique({
      where: { email: user.email },
      select: { id: true },
    });
    const imported = existing
      ? await prisma.user.update({
          where: { email: user.email },
          data: {
            name: user.name,
            role,
            active: user.active ?? true,
          },
          select: { id: true },
        })
      : await prisma.user.create({
          data: {
            id: user.id,
            email: user.email,
            name: user.name,
            password,
            role,
            active: user.active ?? true,
            createdAt: parseDate(user.createdAt),
            updatedAt: parseDate(user.updatedAt),
          },
          select: { id: true },
        });

    userIdByRemoteId.set(user.id, imported.id);
    counters.users += 1;
  }

  for (const team of data.teams) {
    const existingById = await prisma.team.findUnique({
      where: { id: team.id },
      select: { id: true },
    });
    const existingByNaturalKey = existingById
      ? null
      : await prisma.team.findUnique({
          where: { name_campaignId: { name: team.name, campaignId: team.campaignId } },
          select: { id: true },
        });
    const existing = existingById ?? existingByNaturalKey;
    const imported = existing
      ? await prisma.team.update({
          where: { id: existing.id },
          data: {
            name: team.name,
            campaignId: team.campaignId,
          },
          select: { id: true },
        })
      : await prisma.team.create({
          data: {
            id: team.id,
            name: team.name,
            campaignId: team.campaignId,
            createdAt: parseDate(team.createdAt),
          },
          select: { id: true },
        });

    teamIdByRemoteId.set(team.id, imported.id);
    counters.teams += 1;
  }

  for (const agent of data.agents) {
    const teamId = agent.teamId ? (teamIdByRemoteId.get(agent.teamId) ?? agent.teamId) : null;
    const existingById = await prisma.agent.findUnique({
      where: { id: agent.id },
      select: { id: true },
    });
    const existingByNaturalKey =
      existingById || !agent.agentCode
        ? null
        : await prisma.agent.findUnique({
            where: {
              agentCode_campaignId: {
                agentCode: agent.agentCode,
                campaignId: agent.campaignId,
              },
            },
            select: { id: true },
          });
    const existing = existingById ?? existingByNaturalKey;

    if (existing) {
      await prisma.agent.update({
        where: { id: existing.id },
        data: {
          name: agent.name,
          agentCode: agent.agentCode ?? null,
          campaignId: agent.campaignId,
          teamId,
          active: agent.active ?? true,
        },
      });
    } else {
      await prisma.agent.create({
        data: {
          id: agent.id,
          name: agent.name,
          agentCode: agent.agentCode ?? null,
          campaignId: agent.campaignId,
          teamId,
          active: agent.active ?? true,
          createdAt: parseDate(agent.createdAt),
        },
      });
    }
    counters.agents += 1;
  }

  for (const assignment of data.userCampaigns) {
    const userId = userIdByRemoteId.get(assignment.userId);
    if (!userId) continue;

    const user = data.users.find((candidate) => candidate.id === assignment.userId);
    const role = normalizeRole(user?.role ?? Role.QA);
    const permissions = permissionsForRole(role);

    await prisma.userCampaign.upsert({
      where: {
        userId_campaignId: {
          userId,
          campaignId: assignment.campaignId,
        },
      },
      update: permissions,
      create: {
        userId,
        campaignId: assignment.campaignId,
        assignedAt: parseDate(assignment.assignedAt),
        ...permissions,
      },
    });
    counters.userCampaigns += 1;
  }

  return counters;
}

async function main() {
  const filePath = process.argv[2] ?? DEFAULT_DATA_PATH;
  const importedPassword = process.env.QORE_IMPORT_PASSWORD ?? DEFAULT_IMPORTED_PASSWORD;
  const data = await readReferenceData(filePath);
  const counters = await importReferenceData(data, importedPassword);

  console.log("Qore reference data imported locally.");
  console.log(`Source: ${filePath}`);
  console.log(`Imported password for new users: ${importedPassword}`);
  console.log(JSON.stringify(counters, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
