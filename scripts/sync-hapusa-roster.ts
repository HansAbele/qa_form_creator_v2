import { prisma } from "../src/lib/prisma";
import { writeAuditLog } from "../src/server/audit-log";

type RosterEntry = {
  name: string;
  providerAgentId: string | null;
};

const HAPUSA_ROSTER: readonly RosterEntry[] = [
  { name: "Kayla Whaley", providerAgentId: "43944621" },
  { name: "Adrian Peralta", providerAgentId: null },
  { name: "Osiris Cruz", providerAgentId: "39788685" },
  { name: "Angel Martinez", providerAgentId: "70160235" },
  { name: "Brauly Henriquez", providerAgentId: "70160239" },
  { name: "Tanddwina Edwitch Louis", providerAgentId: "70160243" },
  { name: "Jose Andres Santos", providerAgentId: "56398156" },
  { name: "Julio Chavez", providerAgentId: "52248340" },
  { name: "Audrey Peralta", providerAgentId: "44005561" },
  { name: "Clary Cabral", providerAgentId: "69499519" },
  { name: "Brianna Barone", providerAgentId: "69618988" },
  { name: "Rozanne Lohier", providerAgentId: "69618986" },
  { name: "Josue Guzman", providerAgentId: "70160242" },
  { name: "Antonia Eugene", providerAgentId: "56508817" },
  { name: "Sabline Baptiste", providerAgentId: "43944622" },
  { name: "Stherlyne Nisha", providerAgentId: "43886401" },
  { name: "Juan Carrasco", providerAgentId: "44005233" },
  { name: "Daphney St Fleur", providerAgentId: "69618832" },
  { name: "Alfy Mejia", providerAgentId: "69618833" },
  { name: "Stanley Romelus", providerAgentId: "52248539" },
  { name: "Elysee Elyus", providerAgentId: "69618989" },
  { name: "Miguel Delance", providerAgentId: null },
] as const;

type ExistingAgent = {
  id: string;
  name: string;
  agentCode: string | null;
  active: boolean;
};

function normalizedTokens(value: string) {
  return [
    ...new Set(
      value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    ),
  ];
}

function isSamePerson(rosterName: string, existingName: string) {
  const rosterTokens = normalizedTokens(rosterName);
  const existingTokens = normalizedTokens(existingName);
  return (
    rosterTokens.every((token) => existingTokens.includes(token)) ||
    existingTokens.every((token) => rosterTokens.includes(token))
  );
}

function matchExistingAgent(entry: RosterEntry, agents: ExistingAgent[]) {
  const byProviderId = entry.providerAgentId
    ? agents.filter((agent) => agent.agentCode === entry.providerAgentId)
    : [];
  const byName = agents.filter((agent) => isSamePerson(entry.name, agent.name));
  const candidates = [
    ...new Map([...byProviderId, ...byName].map((agent) => [agent.id, agent])).values(),
  ];
  if (candidates.length > 1) {
    throw new Error(
      `Ambiguous HAPUSA roster match for ${entry.name}: ${candidates.map((agent) => agent.name).join(", ")}`,
    );
  }
  return candidates[0] ?? null;
}

async function loadCurrentRoster() {
  const campaign = await prisma.campaign.findFirst({
    where: { name: { equals: "HAPUSA", mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      agents: {
        select: { id: true, name: true, agentCode: true, active: true },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!campaign) throw new Error("HAPUSA campaign was not found");
  return campaign;
}

async function preview() {
  const campaign = await loadCurrentRoster();
  const matchedIds = new Set<string>();
  const activateOrRename: string[] = [];
  const create: string[] = [];

  for (const entry of HAPUSA_ROSTER) {
    const existing = matchExistingAgent(entry, campaign.agents);
    if (!existing) {
      create.push(entry.name);
      continue;
    }
    matchedIds.add(existing.id);
    if (
      existing.name !== entry.name ||
      !existing.active ||
      (entry.providerAgentId && existing.agentCode !== entry.providerAgentId)
    ) {
      activateOrRename.push(`${existing.name} -> ${entry.name}`);
    }
  }

  return {
    mode: "preview",
    campaign: campaign.name,
    officialCount: HAPUSA_ROSTER.length,
    create,
    activateOrRename,
    deactivate: campaign.agents
      .filter((agent) => !matchedIds.has(agent.id) && agent.active)
      .map((agent) => agent.name),
  };
}

async function applyRoster() {
  return prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findFirst({
      where: { name: { equals: "HAPUSA", mode: "insensitive" } },
      select: {
        id: true,
        name: true,
        agents: {
          select: { id: true, name: true, agentCode: true, active: true },
          orderBy: { name: "asc" },
        },
      },
    });
    if (!campaign) throw new Error("HAPUSA campaign was not found");

    const before = campaign.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      agentCode: agent.agentCode,
      active: agent.active,
    }));
    const officialAgentIds = new Set<string>();
    let created = 0;
    let updated = 0;
    let callsLinked = 0;

    for (const entry of HAPUSA_ROSTER) {
      const existing = matchExistingAgent(entry, campaign.agents);
      const agent = existing
        ? await tx.agent.update({
            where: { id: existing.id },
            data: {
              name: entry.name,
              active: true,
              agentCode: entry.providerAgentId ?? existing.agentCode,
            },
            select: { id: true, name: true, agentCode: true, active: true },
          })
        : await tx.agent.create({
            data: {
              campaignId: campaign.id,
              name: entry.name,
              agentCode: entry.providerAgentId,
              active: true,
            },
            select: { id: true, name: true, agentCode: true, active: true },
          });

      if (existing) updated += 1;
      else created += 1;
      officialAgentIds.add(agent.id);

      if (entry.providerAgentId) {
        const linked = await tx.interaction.updateMany({
          where: {
            campaignId: campaign.id,
            provider: "NICE_CXONE",
            providerAgentId: entry.providerAgentId,
            OR: [{ agentId: null }, { agentId: { not: agent.id } }],
          },
          data: { agentId: agent.id },
        });
        callsLinked += linked.count;
      }
    }

    const deactivated = await tx.agent.updateMany({
      where: {
        campaignId: campaign.id,
        active: true,
        id: { notIn: [...officialAgentIds] },
      },
      data: { active: false },
    });
    const after = await tx.agent.findMany({
      where: { campaignId: campaign.id },
      select: { id: true, name: true, agentCode: true, active: true },
      orderBy: { name: "asc" },
    });

    await writeAuditLog(
      {
        campaignId: campaign.id,
        module: "agents",
        action: "roster_synchronized",
        entityType: "campaign",
        entityId: campaign.id,
        beforeValue: before,
        afterValue: after,
        impact:
          "HAPUSA roster synchronized from the approved operational list; removed agents were deactivated and historical records were preserved.",
      },
      tx,
    );

    return {
      mode: "applied",
      campaign: campaign.name,
      officialCount: HAPUSA_ROSTER.length,
      created,
      updated,
      deactivated: deactivated.count,
      callsLinked,
      activeAgents: after.filter((agent) => agent.active),
    };
  });
}

async function main() {
  const result = process.argv.includes("--apply") ? await applyRoster() : await preview();
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
