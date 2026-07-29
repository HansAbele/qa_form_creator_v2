import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getOperationalDateBounds } from "@/lib/operational-time";
import { prisma } from "@/lib/prisma";
import {
  assertCampaignPermissionForUser,
  CampaignAuthorizationError,
} from "@/server/queries/campaign-filter";

export const dynamic = "force-dynamic";

const searchSchema = z.object({
  campaignId: z.string().trim().min(1).max(100),
  agentId: z.string().trim().min(1).max(100),
  scope: z.enum(["coaching", "pip"]),
  templateKey: z.enum(["PARKER_DAVIS", "HAPUSA", "CUSTOM"]).default("CUSTOM"),
  query: z.string().trim().max(120).default(""),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  cursor: z.string().trim().min(1).max(100).optional(),
});

const PAGE_SIZE = 25;

function templateFormFilter(
  templateKey: z.infer<typeof searchSchema>["templateKey"],
): Prisma.FormWhereInput {
  if (templateKey === "HAPUSA") {
    return {
      OR: [
        { title: { contains: "HAPUSA", mode: "insensitive" } },
        { templateKey: { contains: "HAPUSA", mode: "insensitive" } },
      ],
    };
  }
  if (templateKey === "PARKER_DAVIS") {
    return {
      OR: [
        { title: { contains: "Parker Davis", mode: "insensitive" } },
        { templateKey: { contains: "PARKER_DAVIS", mode: "insensitive" } },
      ],
    };
  }
  return {};
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const parsed = searchSchema.safeParse({
    campaignId: url.searchParams.get("campaignId"),
    agentId: url.searchParams.get("agentId"),
    scope: url.searchParams.get("scope"),
    templateKey: url.searchParams.get("templateKey") || "CUSTOM",
    query: url.searchParams.get("query") || "",
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    cursor: url.searchParams.get("cursor") || undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid evidence search filters" }, { status: 400 });
  }

  const input = parsed.data;
  try {
    await assertCampaignPermissionForUser(
      session.user,
      input.campaignId,
      input.scope === "coaching" ? "canManageCoaching" : "canManagePips",
    );
  } catch (error) {
    if (error instanceof CampaignAuthorizationError) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    throw error;
  }

  let evidenceDate: Prisma.DateTimeFilter | undefined;
  try {
    const bounds = getOperationalDateBounds(input.from, input.to);
    evidenceDate = Object.keys(bounds).length > 0 ? bounds : undefined;
  } catch {
    return Response.json({ error: "Invalid evidence date range" }, { status: 400 });
  }

  const queryFilter: Prisma.ResponseWhereInput =
    input.query.length > 0
      ? {
          OR: [
            { form: { title: { contains: input.query, mode: "insensitive" } } },
            {
              interaction: {
                is: {
                  providerInteractionId: {
                    contains: input.query,
                    mode: "insensitive",
                  },
                },
              },
            },
            {
              interaction: {
                is: { phoneNumber: { contains: input.query, mode: "insensitive" } },
              },
            },
          ],
        }
      : {};

  const rows = await prisma.response.findMany({
    where: {
      status: "SUBMITTED",
      agentId: input.agentId,
      form: {
        campaignId: input.campaignId,
        ...templateFormFilter(input.templateKey),
      },
      AND: [
        queryFilter,
        ...(evidenceDate
          ? [
              {
                OR: [
                  { submittedAt: evidenceDate },
                  { interaction: { is: { startedAt: evidenceDate } } },
                ],
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      score: true,
      result: true,
      hasFatalFail: true,
      submittedAt: true,
      form: { select: { id: true, title: true } },
      interaction: {
        select: {
          id: true,
          providerInteractionId: true,
          startedAt: true,
          phoneNumber: true,
          hasRecording: true,
          mediaAssets: { select: { id: true }, take: 1 },
        },
      },
    },
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return Response.json(
    {
      items: page.map((response) => ({
        id: response.id,
        formId: response.form.id,
        formTitle: response.form.title,
        score: Number(response.score),
        result: response.result,
        hasFatalFail: response.hasFatalFail,
        submittedAt: response.submittedAt?.toISOString() ?? null,
        interaction: response.interaction
          ? {
              id: response.interaction.id,
              providerInteractionId: response.interaction.providerInteractionId,
              startedAt: response.interaction.startedAt.toISOString(),
              phoneNumber: response.interaction.phoneNumber,
              hasRecording:
                response.interaction.hasRecording || response.interaction.mediaAssets.length > 0,
            }
          : null,
      })),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
