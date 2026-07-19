import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  ExportBusyError,
  ExportGlobalBusyError,
  ExportLimitError,
  ExportNoDataError,
  ExportRateLimitError,
} from "@/lib/export-limits";
import {
  isCanonicalSameOrigin,
  RequestBodyTooLargeError,
  readJsonBodyWithinLimit,
} from "@/lib/http-request";
import { logger } from "@/lib/logger";
import {
  createExportDownload,
  type ExportDownloadFormat,
  type ExportFilters,
} from "@/server/actions/exports";
import { CampaignAuthorizationError } from "@/server/queries/campaign-filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORMATS = new Set<ExportDownloadFormat>(["csv", "json", "xlsx"]);
const MAX_REQUEST_BYTES = 16_384;

function jsonError(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>,
) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store", ...headers } },
  );
}

function optionalString(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 128) {
    throw new Error("Filtro invalido.");
  }
  return value;
}

function parseFilters(value: unknown): ExportFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Filtros invalidos.");
  }
  const input = value as Record<string, unknown>;
  const fields = input.fields;
  if (
    fields !== undefined &&
    (!Array.isArray(fields) ||
      fields.length > 32 ||
      fields.some((field) => typeof field !== "string" || field.length > 64))
  ) {
    throw new Error("Campos de exportacion invalidos.");
  }

  return {
    campaignId: optionalString(input.campaignId),
    formId: optionalString(input.formId),
    agentId: optionalString(input.agentId),
    dateFrom: optionalString(input.dateFrom),
    dateTo: optionalString(input.dateTo),
    fields: fields as string[] | undefined,
  };
}

export async function POST(request: NextRequest, context: { params: Promise<{ format: string }> }) {
  if (!isCanonicalSameOrigin(request)) {
    return jsonError(403, "INVALID_ORIGIN", "La solicitud de exportacion no es valida.");
  }

  const session = await auth();
  if (!session?.user) {
    return jsonError(401, "UNAUTHORIZED", "Debes iniciar sesion para exportar.");
  }

  const { format: rawFormat } = await context.params;
  if (!FORMATS.has(rawFormat as ExportDownloadFormat)) {
    return jsonError(404, "FORMAT_NOT_FOUND", "Formato de exportacion no disponible.");
  }
  const format = rawFormat as ExportDownloadFormat;

  try {
    const filters = parseFilters(await readJsonBodyWithinLimit(request, MAX_REQUEST_BYTES));
    const download = await createExportDownload(format, filters);
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);

    return new Response(download.body, {
      status: 200,
      headers: {
        "Content-Type": download.contentType,
        "Content-Disposition": `attachment; filename="evaluations_${timestamp}.${download.extension}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ExportLimitError) {
      return jsonError(413, error.code, error.message);
    }
    if (error instanceof ExportNoDataError) {
      return jsonError(404, error.code, error.message);
    }
    if (
      error instanceof ExportRateLimitError ||
      error instanceof ExportBusyError ||
      error instanceof ExportGlobalBusyError
    ) {
      return jsonError(429, error.code, error.message, {
        "Retry-After": String(error.retryAfterSeconds),
      });
    }
    if (error instanceof CampaignAuthorizationError) {
      return jsonError(403, "EXPORT_FORBIDDEN", "No tienes acceso a esta exportacion.");
    }
    if (error instanceof RequestBodyTooLargeError) {
      return jsonError(
        413,
        "REQUEST_TOO_LARGE",
        "La solicitud de exportacion es demasiado grande.",
      );
    }
    if (error instanceof SyntaxError) {
      return jsonError(400, "INVALID_JSON", "La solicitud de exportacion no es valida.");
    }
    if (error instanceof Error && /fecha|dateFrom|dateTo|Filtro|Campos/.test(error.message)) {
      return jsonError(400, "INVALID_FILTERS", error.message);
    }

    logger.error(
      { err: error, userId: session.user.id, format },
      "Export download preparation failed",
    );
    return jsonError(500, "EXPORT_FAILED", "No fue posible generar la exportacion solicitada.");
  }
}
