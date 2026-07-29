import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { auth } from "@/lib/auth";
import { resolveByteRange } from "@/lib/http-byte-range";
import { prisma } from "@/lib/prisma";
import {
  getRecordingStorageRoot,
  resolveRecordingStorageKey,
  safeAudioMimeType,
} from "@/server/call-finder/storage";
import { writeAuditLog } from "@/server/audit-log";
import { getCallFinderCampaignFilter } from "@/server/queries/call-finder";

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
  const campaignFilter = await getCallFinderCampaignFilter("review");
  const interaction = await prisma.interaction.findFirst({
    where: { id: interactionId, ...campaignFilter },
    select: {
      id: true,
      campaignId: true,
      provider: true,
      mediaAssets: {
        orderBy: [{ kind: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          storageKey: true,
          originalFileName: true,
          mimeType: true,
        },
      },
    },
  });
  const asset = interaction?.mediaAssets[0];
  if (!interaction || !asset) return unavailable();

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
