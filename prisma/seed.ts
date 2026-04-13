import { PrismaClient, QuestionType, Role } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // ─── Admin user ──────────────────────────────────────
  const adminPassword = await hash("Admin.2026", 12);
  const admin = await prisma.user.upsert({
    where: { email: "admin@qa.local" },
    update: {},
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
    update: {},
    create: {
      userId: admin.id,
      campaignId: campaign.id,
    },
  });

  // ─── QA user ─────────────────────────────────────────
  const qaPassword = await hash("Qa.2026", 12);
  const qaUser = await prisma.user.upsert({
    where: { email: "qa@qa.local" },
    update: {},
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
    update: {},
    create: {
      userId: qaUser.id,
      campaignId: campaign.id,
    },
  });
  console.log(`QA user: ${qaUser.email}`);

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
        questions: {
          create: [
            {
              type: QuestionType.RATING,
              label: "Greeting and Introduction",
              required: true,
              order: 0,
            },
            {
              type: QuestionType.RATING,
              label: "Active Listening Skills",
              required: true,
              order: 1,
            },
            {
              type: QuestionType.RATING,
              label: "Problem Identification",
              required: true,
              order: 2,
            },
            {
              type: QuestionType.RATING,
              label: "Solution Provided",
              required: true,
              order: 3,
            },
            {
              type: QuestionType.RATING,
              label: "Empathy and Tone",
              required: true,
              order: 4,
            },
            {
              type: QuestionType.RATING,
              label: "Call Control",
              required: true,
              order: 5,
            },
            {
              type: QuestionType.RATING,
              label: "Compliance with Script",
              required: true,
              order: 6,
            },
            {
              type: QuestionType.SELECT,
              label: "First Call Resolution",
              options: ["Yes", "No", "Escalated"],
              required: true,
              order: 7,
            },
            {
              type: QuestionType.RADIO,
              label: "Would you recommend this agent?",
              options: ["Yes", "No", "Maybe"],
              required: true,
              order: 8,
            },
            {
              type: QuestionType.TEXT,
              label: "Additional Comments",
              required: false,
              order: 9,
            },
          ],
        },
      },
    });
    console.log(`Form created: ${form.title}`);
  }

  console.log("\nSeed completed successfully!");
  console.log("─────────────────────────────");
  console.log("Admin login:  admin@qa.local / Admin.2026");
  console.log("QA login:     qa@qa.local / Qa.2026");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
