import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { getPasswordPolicyError } from "../src/lib/password-policy";

const prisma = new PrismaClient();
const APPLY_CONFIRMATION = "RESET_QORE_GO_LIVE";
const CORPORATE_EMAIL_DOMAIN = "@tnoutsourcing.com";
const KEEP_FORM_IDS = [
  "cmqzop4gy001wvsc0x75z88jz", // Customer Service QA Form (published test form)
  "cmruzfd9i000gvs9kfk0xmpnc", // HAPUSA official scorecard
  "official_pd_r3_a36f6d8ce48403bca1c9c351", // Parker Davis scored-only official scorecard
] as const;

type Credential = {
  userId: string;
  name: string;
  email: string;
  temporaryPassword: string;
  passwordHash: string;
};

function makeTemporaryPassword() {
  while (true) {
    const candidate = `Qa!${randomBytes(15).toString("base64url")}7z`;
    if (!getPasswordPolicyError(candidate)) return candidate;
  }
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function credentialsCsv(credentials: Credential[]) {
  const rows = credentials.map(({ name, email, temporaryPassword }) =>
    [name, email, temporaryPassword, "Change required on first sign-in"].map(csvCell).join(","),
  );
  return `\uFEFF${[
    ["Name", "Email", "Temporary password", "Required action"].map(csvCell).join(","),
    ...rows,
  ].join("\r\n")}\r\n`;
}

async function inspect() {
  const [forms, corporateQas, counts] = await Promise.all([
    prisma.form.findMany({
      where: { id: { in: [...KEEP_FORM_IDS] } },
      select: {
        id: true,
        title: true,
        status: true,
        templateKey: true,
        campaign: { select: { name: true } },
      },
      orderBy: { id: "asc" },
    }),
    prisma.user.findMany({
      where: {
        role: "QA",
        active: true,
        email: { endsWith: CORPORATE_EMAIL_DOMAIN, mode: "insensitive" },
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    Promise.all([
      prisma.form.count(),
      prisma.response.count(),
      prisma.coachingSession.count(),
      prisma.pipPlan.count(),
      prisma.qaActivitySession.count(),
      prisma.performanceEvidence.count(),
      prisma.transcript.count(),
      prisma.auditLog.count(),
      prisma.interaction.count(),
      prisma.mediaAsset.count(),
      prisma.user.count(),
    ]),
  ]);

  if (forms.length !== KEEP_FORM_IDS.length) {
    const found = new Set(forms.map(({ id }) => id));
    const missing = KEEP_FORM_IDS.filter((id) => !found.has(id));
    throw new Error(`Required go-live forms are missing: ${missing.join(", ")}`);
  }
  if (forms.some(({ status }) => status !== "PUBLISHED")) {
    throw new Error("Every retained go-live form must be published");
  }
  if (corporateQas.length === 0) {
    throw new Error(`No active corporate QA users found for ${CORPORATE_EMAIL_DOMAIN}`);
  }

  return {
    forms,
    corporateQas,
    counts: {
      forms: counts[0],
      responses: counts[1],
      coachingSessions: counts[2],
      pipPlans: counts[3],
      qaActivitySessions: counts[4],
      performanceEvidence: counts[5],
      transcripts: counts[6],
      auditLogs: counts[7],
      interactions: counts[8],
      mediaAssets: counts[9],
      users: counts[10],
    },
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const before = await inspect();

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "preview",
        retainedForms: before.forms,
        corporateQaCount: before.corporateQas.length,
        before: before.counts,
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.log(
      `Preview only. Use --apply with CONFIRM_QORE_GO_LIVE=${APPLY_CONFIRMATION} and QORE_TEMP_CREDENTIALS_PATH.`,
    );
    return;
  }
  if (process.env.CONFIRM_QORE_GO_LIVE !== APPLY_CONFIRMATION) {
    throw new Error("Go-live reset confirmation is missing or invalid");
  }

  const credentialTargetInput = process.env.QORE_TEMP_CREDENTIALS_PATH;
  if (!credentialTargetInput) throw new Error("QORE_TEMP_CREDENTIALS_PATH is required");
  const credentialTarget = resolve(credentialTargetInput);
  const credentialTemp = `${credentialTarget}.pending`;
  const credentialPlan: Credential[] = await Promise.all(
    before.corporateQas.map(async ({ id, name, email }) => {
      const temporaryPassword = makeTemporaryPassword();
      return {
        userId: id,
        name,
        email,
        temporaryPassword,
        passwordHash: await hash(temporaryPassword, 12),
      };
    }),
  );

  await mkdir(dirname(credentialTarget), { recursive: true });
  await writeFile(credentialTemp, credentialsCsv(credentialPlan), {
    encoding: "utf8",
    flag: "wx",
  });

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.performanceEvidence.deleteMany();
        await tx.qaActivitySession.deleteMany();
        await tx.coachingSession.deleteMany();
        await tx.pipPlan.deleteMany();
        await tx.response.deleteMany();
        await tx.transcriptionJob.deleteMany();
        await tx.transcriptionAttempt.deleteMany();
        await tx.transcript.deleteMany();
        await tx.form.deleteMany({ where: { id: { notIn: [...KEEP_FORM_IDS] } } });
        await tx.loginRateLimitReservation.deleteMany();
        await tx.loginRateLimit.deleteMany();

        for (const credential of credentialPlan) {
          const updated = await tx.user.updateMany({
            where: {
              email: credential.email,
              role: "QA",
              active: true,
            },
            data: {
              password: credential.passwordHash,
              mustChangePassword: true,
              sessionVersion: { increment: 1 },
            },
          });
          if (updated.count !== 1) {
            throw new Error(`Corporate QA account changed during reset: ${credential.email}`);
          }

          await tx.auditLog.create({
            data: {
              userId: null,
              module: "users",
              action: "go_live_temporary_password_assigned",
              entityType: "user",
              entityId: credential.userId,
              afterValue: { mustChangePassword: true, sessionsRevoked: true },
              impact:
                "A one-time temporary password was assigned for official platform onboarding.",
            },
          });
        }
      },
      { timeout: 120_000 },
    );

    await rename(credentialTemp, credentialTarget);
  } catch (error) {
    await rm(credentialTemp, { force: true });
    throw error;
  }

  const after = await inspect();
  const requiredChangeCount = await prisma.user.count({
    where: {
      role: "QA",
      active: true,
      mustChangePassword: true,
      email: { endsWith: CORPORATE_EMAIL_DOMAIN, mode: "insensitive" },
    },
  });
  if (
    after.counts.forms !== KEEP_FORM_IDS.length ||
    after.counts.responses !== 0 ||
    after.counts.coachingSessions !== 0 ||
    after.counts.pipPlans !== 0 ||
    after.counts.qaActivitySessions !== 0 ||
    after.counts.performanceEvidence !== 0 ||
    after.counts.transcripts !== 0 ||
    after.counts.auditLogs !== before.counts.auditLogs + credentialPlan.length ||
    requiredChangeCount !== credentialPlan.length
  ) {
    throw new Error("Post-reset verification failed; restore the pre-go-live backup");
  }

  console.log(
    JSON.stringify(
      {
        status: "complete",
        after: after.counts,
        temporaryCredentialsCreated: credentialPlan.length,
        credentialsFile: credentialTarget,
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
