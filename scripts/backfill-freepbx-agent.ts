import { loadEnvConfig } from "@next/env";
import { InteractionProvider } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createCallSourceAdapter } from "@/server/call-finder/providers/factory";
import { syncCampaignCallSource } from "@/server/call-finder/sync-engine";

loadEnvConfig(process.cwd());

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const inputSchema = z.object({
  extension: z
    .string()
    .trim()
    .regex(/^\d{2,10}$/),
  from: z.string().regex(datePattern),
  to: z.string().regex(datePattern).optional(),
  instance: z.string().trim().min(1).max(100).default("parker-davis"),
});

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const input = inputSchema.parse({
    extension: argument("extension"),
    from: argument("from"),
    to: argument("to"),
    instance: argument("instance"),
  });
  const startedFrom = new Date(`${input.from}T00:00:00.000Z`);
  const startedTo = input.to
    ? new Date(`${input.to}T23:59:59.999Z`)
    : new Date(Date.now() - 2 * 60_000);
  if (startedFrom >= startedTo) throw new Error("The backfill date range is invalid");

  const source = await prisma.campaignCallSource.findFirst({
    where: {
      provider: InteractionProvider.FREEPBX,
      instanceKey: input.instance,
      enabled: true,
    },
    select: { id: true, campaignId: true },
  });
  if (!source) throw new Error("The requested FreePBX source is unavailable");

  const agent = await prisma.agent.findFirst({
    where: {
      campaignId: source.campaignId,
      agentCode: input.extension,
      active: true,
    },
    select: { id: true, name: true },
  });
  if (!agent) throw new Error("No active campaign agent uses the requested extension");

  const requestedDays = Math.ceil((startedTo.getTime() - startedFrom.getTime()) / 86_400_000) + 2;
  const result = await syncCampaignCallSource({
    sourceId: source.id,
    adapter: createCallSourceAdapter(InteractionProvider.FREEPBX, input.instance),
    startedFrom,
    startedTo,
    maxPages: Math.min(1_000, Math.max(1, requestedDays)),
    downloadRecordings: false,
    providerAgentIds: [input.extension],
  });

  console.log(
    JSON.stringify(
      {
        agent: agent.name,
        extension: input.extension,
        startedFrom: startedFrom.toISOString(),
        startedTo: startedTo.toISOString(),
        pages: result.pages,
        discovered: result.discovered,
        created: result.created,
        updated: result.updated,
        errors: result.errors,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
