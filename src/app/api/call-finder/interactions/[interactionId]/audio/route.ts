import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { InteractionProvider } from "@prisma/client";
import { auth } from "@/lib/auth";
import { isAgentRole } from "@/lib/campaign-permissions";
import { resolveByteRange } from "@/lib/http-byte-range";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";
import { attachProviderRecording } from "@/server/call-finder/call-source-service";
import {
  getRecordingStorageRoot,
  resolveRecordingStorageKey,
  safeAudioMimeType,
} from "@/server/call-finder/storage";
import { getCallFinderCampaignFilter } from "@/server/queries/call-finder";
import { canAgentAccessInteractionEvidence } from "@/server/queries/performance-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isInsideRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function unavailable() {
  return Response.json({ error: "Recording unavailable" }, { status: 404 });
}

export async function GET(
  request: Request,
  context: RouteContext<"/api/call-finder/interactions/[interactionId]/audio">,
) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { interactionId } = await context.params;
  const downloadRequested = new URL(request.url).searchParams.get("download") === "1";
  const agentPortalAccess = isAgentRole(session.user.role);
  if (agentPortalAccess && downloadRequested) {
    return Response.json(
      { error: "Recording downloads are disabled in the agent portal" },
      {
        status: 403,
      },
    );
  }
  if (
    agentPortalAccess &&
    !(await canAgentAccessInteractionEvidence(session.user.id, interactionId))
  ) {
    return unavailable();
  }
  const campaignFilter = agentPortalAccess ? {} : await getCallFinderCampaignFilter("review");
  const interaction = await prisma.interaction.findFirst({
    where: { id: interactionId, ...campaignFilter },
    select: {
      id: true,
      campaignId: true,
      provider: true,
      providerInstance: true,
      providerInteractionId: true,
      hasRecording: true,
      metadata: true,
      startedAt: true,
      durationSeconds: true,
      mediaAssets: {
        orderBy: [{ kind: "desc" }, { createdAt: "desc" }],
        take: 2,
        select: {
          id: true,
          kind: true,
          storageKey: true,
          originalFileName: true,
          mimeType: true,
        },
      },
    },
  });
  if (!interaction) return unavailable();

  let asset =
    interaction.provider === InteractionProvider.FREEPBX
      ? interaction.mediaAssets.find((candidate) => candidate.kind === "PLAYBACK")
      : interaction.mediaAssets[0];
  if (!asset && interaction.hasRecording) {
    try {
      await attachProviderRecording({ interaction, userId: session.user.id });
      asset =
        (await prisma.mediaAsset.findFirst({
          where: {
            interactionId: interaction.id,
            ...(interaction.provider === InteractionProvider.FREEPBX ? { kind: "PLAYBACK" } : {}),
          },
          orderBy: [{ kind: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            kind: true,
            storageKey: true,
            originalFileName: true,
            mimeType: true,
          },
        })) ?? undefined;
    } catch {
      return unavailable();
    }
  }
  if (!asset) return unavailable();

  try {
    const configuredRoot = getRecordingStorageRoot();
    const configuredFile = resolveRecordingStorageKey(asset.storageKey, configuredRoot);
    const [actualRoot, actualFile] = await Promise.all([
      realpath(configuredRoot),
      realpath(configuredFile),
    ]);
    if (!isInsideRoot(actualRoot, actualFile)) return unavailable();

    const fileStat = await stat(actualFile);
    if (!fileStat.isFile() || !Number.isSafeInteger(fileStat.size) || fileStat.size <= 0) {
      return unavailable();
    }

    const range = resolveByteRange(request.headers.get("range"), fileStat.size);
    if (range.kind === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes */${fileStat.size}`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    const start = range.kind === "partial" ? range.start : 0;
    const end = range.kind === "partial" ? range.end : fileStat.size - 1;
    const contentLength = end - start + 1;
    const stream = createReadStream(actualFile, { start, end });
    const safeFileName = (asset.originalFileName ?? `recording-${interaction.id}`)
      .replace(/[\r\n"\\]/g, "_")
      .slice(0, 160);

    if (start === 0 || downloadRequested) {
      await writeAuditLog({
        userId: session.user.id,
        campaignId: interaction.campaignId,
        module: "call_finder",
        action: downloadRequested ? "recording_downloaded" : "recording_played",
        entityType: "interaction",
        entityId: interaction.id,
        afterValue: {
          mediaAssetId: asset.id,
          provider: interaction.provider,
          byteRange: range.kind === "partial" ? `${start}-${end}` : "full",
          disposition: downloadRequested ? "attachment" : "inline",
        },
        impact: downloadRequested
          ? "Authenticated recording download was requested."
          : "Authenticated recording playback was started.",
      });
    }

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: range.kind === "partial" ? 206 : 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `${downloadRequested ? "attachment" : "inline"}; filename="${safeFileName}"`,
        "Content-Length": String(contentLength),
        "Content-Type": safeAudioMimeType(asset.mimeType),
        ...(range.kind === "partial"
          ? { "Content-Range": `bytes ${start}-${end}/${fileStat.size}` }
          : {}),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return unavailable();
  }
}
