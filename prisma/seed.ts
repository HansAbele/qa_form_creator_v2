import { CampaignAccessLevel, PrismaClient, QuestionType, Role } from "@prisma/client";
import { hash } from "bcryptjs";
import { getCampaignAccessPreset } from "../src/lib/campaign-permissions";

const prisma = new PrismaClient();
const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);

function requireStrongPassword(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required to seed local login accounts.`);
  }
  if (value.length < 14 || value.length > 128) {
    throw new Error(`${name} must contain between 14 and 128 characters.`);
  }

  const characterClasses = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) =>
    pattern.test(value),
  ).length;
  if (characterClasses < 3) {
    throw new Error(`${name} must include at least three character classes.`);
  }
  if (/change[_-]?me|password|contrase[nñ]a/i.test(value)) {
    throw new Error(`${name} must not contain a placeholder or common password term.`);
  }

  return value;
}

function assertSafeSeedTarget() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The sample-data seed is disabled when NODE_ENV=production.");
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required before running the sample-data seed.");
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!LOCAL_DATABASE_HOSTS.has(hostname)) {
    throw new Error("The sample-data seed may only target a local PostgreSQL database.");
  }
  if (parsed.pathname === "" || parsed.pathname === "/") {
    throw new Error("DATABASE_URL must include a database name.");
  }
}

async function main() {
  assertSafeSeedTarget();

  const [adminPassword, qaPassword, supervisorPassword] = await Promise.all([
    hash(requireStrongPassword("QORE_SEED_ADMIN_PASSWORD"), 12),
    hash(requireStrongPassword("QORE_SEED_QA_PASSWORD"), 12),
    hash(requireStrongPassword("QORE_SEED_SUPERVISOR_PASSWORD"), 12),
  ]);
  const adminAccess = {
    roleInCampaign: CampaignAccessLevel.CAMPAIGN_ADMIN,
    ...getCampaignAccessPreset("CAMPAIGN_ADMIN"),
  };
  const evaluatorAccess = {
    roleInCampaign: CampaignAccessLevel.EVALUATOR,
    ...getCampaignAccessPreset("EVALUATOR"),
  };
  const supervisorAccess = {
    roleInCampaign: CampaignAccessLevel.SUPERVISOR,
    ...getCampaignAccessPreset("SUPERVISOR"),
  };

  console.log("Seeding database...");

  // ─── Admin user ──────────────────────────────────────
  const admin = await prisma.user.upsert({
    where: { email: "admin@qa.local" },
    update: {
      role: Role.ADMIN,
      password: adminPassword,
      active: true,
      sessionVersion: { increment: 1 },
    },
    create: {
      email: "admin@qa.local",
      name: "QA Manager",
      password: adminPassword,
      role: Role.ADMIN,
    },
  });
  console.log(`Admin user: ${admin.email}`);

  // ─── Default campaign ────────────────────────────────
  const campaign = await prisma.campaign.upsert({
    where: { id: "default-campaign" },
    update: {},
    create: {
      id: "default-campaign",
      name: "Customer Service",
      description: "Customer service quality assurance campaign",
    },
  });
  console.log(`Campaign: ${campaign.name}`);

  // ─── Assign admin to campaign ────────────────────────
  await prisma.userCampaign.upsert({
    where: {
      userId_campaignId: {
        userId: admin.id,
        campaignId: campaign.id,
      },
    },
    update: adminAccess,
    create: {
      userId: admin.id,
      campaignId: campaign.id,
      ...adminAccess,
    },
  });

  // ─── QA user ─────────────────────────────────────────
  const qaUser = await prisma.user.upsert({
    where: { email: "qa@qa.local" },
    update: {
      role: Role.QA,
      password: qaPassword,
      active: true,
      sessionVersion: { increment: 1 },
    },
    create: {
      email: "qa@qa.local",
      name: "QA Evaluator",
      password: qaPassword,
      role: Role.QA,
    },
  });

  await prisma.userCampaign.upsert({
    where: {
      userId_campaignId: {
        userId: qaUser.id,
        campaignId: campaign.id,
      },
    },
    update: evaluatorAccess,
    create: {
      userId: qaUser.id,
      campaignId: campaign.id,
      ...evaluatorAccess,
    },
  });
  console.log(`QA user: ${qaUser.email}`);

  const supervisorUser = await prisma.user.upsert({
    where: { email: "supervisor@qa.local" },
    update: {
      role: Role.SUPERVISOR,
      password: supervisorPassword,
      active: true,
      sessionVersion: { increment: 1 },
    },
    create: {
      email: "supervisor@qa.local",
      name: "QA Supervisor",
      password: supervisorPassword,
      role: Role.SUPERVISOR,
    },
  });

  await prisma.userCampaign.upsert({
    where: {
      userId_campaignId: {
        userId: supervisorUser.id,
        campaignId: campaign.id,
      },
    },
    update: supervisorAccess,
    create: {
      userId: supervisorUser.id,
      campaignId: campaign.id,
      ...supervisorAccess,
    },
  });
  console.log(`Supervisor user: ${supervisorUser.email}`);

  // ─── Sample agents ───────────────────────────────────
  const agentNames = [
    "John Smith",
    "Sarah Johnson",
    "Mike Williams",
    "Emily Davis",
    "Carlos Rodriguez",
  ];

  const agents = [];
  for (const name of agentNames) {
    const code = name.toLowerCase().replace(/\s/g, ".");
    const agent = await prisma.agent.upsert({
      where: {
        agentCode_campaignId: {
          agentCode: code,
          campaignId: campaign.id,
        },
      },
      update: {},
      create: {
        name,
        agentCode: code,
        campaignId: campaign.id,
      },
    });
    agents.push(agent);
  }
  console.log(`Agents created: ${agents.length}`);

  // ─── Sample form ─────────────────────────────────────
  const existingForm = await prisma.form.findFirst({
    where: { title: "Customer Service QA Form" },
  });

  if (!existingForm) {
    const form = await prisma.form.create({
      data: {
        title: "Customer Service QA Form",
        description: "Standard quality assurance evaluation form for customer service calls",
        campaignId: campaign.id,
        createdById: admin.id,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });

    const [
      softSkillsCategory,
      contactResolutionCategory,
      processAdherenceCategory,
      customerCriticalCategory,
    ] = await Promise.all([
      prisma.formCategory.create({
        data: {
          formId: form.id,
          qaCategoryId: "qa_soft_skills",
          weight: 44,
          sortOrder: 0,
        },
      }),
      prisma.formCategory.create({
        data: {
          formId: form.id,
          qaCategoryId: "qa_contact_resolution",
          weight: 28,
          sortOrder: 1,
        },
      }),
      prisma.formCategory.create({
        data: {
          formId: form.id,
          qaCategoryId: "qa_process_adherence",
          weight: 28,
          sortOrder: 2,
        },
      }),
      prisma.formCategory.create({
        data: {
          formId: form.id,
          qaCategoryId: "qa_customer_critical",
          weight: 0,
          fatalIfFailed: true,
          requiresComment: true,
          sortOrder: 3,
        },
      }),
    ]);

    await prisma.question.createMany({
      data: [
        {
          formId: form.id,
          formCategoryId: softSkillsCategory.id,
          type: QuestionType.RATING,
          label: "Greeting and Introduction",
          required: true,
          weight: 15,
          order: 0,
        },
        {
          formId: form.id,
          formCategoryId: softSkillsCategory.id,
          type: QuestionType.RATING,
          label: "Active Listening Skills",
          required: true,
          weight: 15,
          order: 1,
        },
        {
          formId: form.id,
          formCategoryId: contactResolutionCategory.id,
          type: QuestionType.RATING,
          label: "Problem Identification",
          required: true,
          weight: 14,
          order: 2,
        },
        {
          formId: form.id,
          formCategoryId: contactResolutionCategory.id,
          type: QuestionType.RATING,
          label: "Solution Provided",
          required: true,
          weight: 14,
          order: 3,
        },
        {
          formId: form.id,
          formCategoryId: softSkillsCategory.id,
          type: QuestionType.RATING,
          label: "Empathy and Tone",
          required: true,
          weight: 14,
          order: 4,
        },
        {
          formId: form.id,
          formCategoryId: processAdherenceCategory.id,
          type: QuestionType.RATING,
          label: "Call Control",
          required: true,
          weight: 14,
          order: 5,
        },
        {
          formId: form.id,
          formCategoryId: processAdherenceCategory.id,
          type: QuestionType.RATING,
          label: "Compliance with Script",
          required: true,
          weight: 14,
          order: 6,
        },
        {
          formId: form.id,
          formCategoryId: contactResolutionCategory.id,
          type: QuestionType.SELECT,
          label: "First Call Resolution",
          options: ["Yes", "No", "Escalated"],
          required: true,
          order: 7,
        },
        {
          formId: form.id,
          formCategoryId: customerCriticalCategory.id,
          type: QuestionType.RADIO,
          label: "Would you recommend this agent?",
          options: ["Yes", "No", "Maybe"],
          fatalOptions: ["No"],
          required: true,
          fatal: true,
          requiresCommentOnFail: true,
          order: 8,
        },
        {
          formId: form.id,
          formCategoryId: contactResolutionCategory.id,
          type: QuestionType.TEXT,
          label: "Additional Comments",
          required: false,
          order: 9,
        },
      ],
    });

    console.log(`Form created: ${form.title}`);
  }

  console.log("\nSeed completed successfully!");
  console.log("─────────────────────────────");
  console.log("Local login accounts were created from the configured seed credentials.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
