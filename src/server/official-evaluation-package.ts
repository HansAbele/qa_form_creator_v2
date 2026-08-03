import "server-only";

import { createReadStream } from "node:fs";
import { HAPUSA_SCORECARD_KEY, PARKER_DAVIS_SCORECARD_KEY } from "@/lib/official-form-templates";
import { prisma } from "@/lib/prisma";
import { prepareHapusaEvaluationPackage } from "@/server/hapusa-evaluation-package";
import { prepareParkerDavisEvaluationPackage } from "@/server/parker-davis-evaluation-package";
import { getCampaignFilterForPermissions } from "@/server/queries/campaign-filter";

export const MAX_OFFICIAL_PACKAGE_EVALUATIONS = 50;

export class OfficialEvaluationPackageError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_SELECTION" | "FORBIDDEN",
  ) {
    super(message);
    this.name = "OfficialEvaluationPackageError";
  }
}

export async function prepareOfficialEvaluationPackage(responseIds: string[], userId: string) {
  const uniqueIds = [...new Set(responseIds)];
  if (
    uniqueIds.length === 0 ||
    uniqueIds.length > MAX_OFFICIAL_PACKAGE_EVALUATIONS ||
    uniqueIds.some((id) => !id.trim() || id.length > 100)
  ) {
    throw new OfficialEvaluationPackageError(
      `Select between 1 and ${MAX_OFFICIAL_PACKAGE_EVALUATIONS} official evaluations.`,
      "INVALID_SELECTION",
    );
  }

  const campaignFilter = await getCampaignFilterForPermissions(["canExport", "canViewReports"]);
  const responses = await prisma.response.findMany({
    where: {
      id: { in: uniqueIds },
      status: "SUBMITTED",
      form: {
        ...campaignFilter,
        templateKey: { in: [HAPUSA_SCORECARD_KEY, PARKER_DAVIS_SCORECARD_KEY] },
      },
    },
    select: { id: true, form: { select: { templateKey: true } } },
  });
  if (responses.length !== uniqueIds.length) {
    throw new OfficialEvaluationPackageError(
      "One or more evaluations are unavailable for export.",
      "FORBIDDEN",
    );
  }

  const hapusaIds = responses
    .filter((response) => response.form.templateKey === HAPUSA_SCORECARD_KEY)
    .map((response) => response.id);
  const parkerDavisIds = responses
    .filter((response) => response.form.templateKey === PARKER_DAVIS_SCORECARD_KEY)
    .map((response) => response.id);
  const prepared = await Promise.all([
    hapusaIds.length > 0 ? prepareHapusaEvaluationPackage(hapusaIds, userId) : null,
    parkerDavisIds.length > 0 ? prepareParkerDavisEvaluationPackage(parkerDavisIds, userId) : null,
  ]);
  const packages = prepared.filter((item) => item !== null);

  return {
    archiveName:
      packages.length === 1
        ? (packages[0]?.archiveName ?? "Qore QA Evidence.zip")
        : `Qore QA Evidence - ${new Date().toISOString().slice(0, 10)}.zip`,
    entries: packages.flatMap((item) => item.entries),
    createRecordingStream: (recordingPath: string) => createReadStream(recordingPath),
  };
}
