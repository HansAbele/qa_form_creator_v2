import { vi } from "vitest";

export const prismaMock = {
  userCampaign: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  campaign: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  campaignScoringSettings: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  team: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  agent: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  },
  dispositionCategory: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  disposition: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  form: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  question: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  formCategory: {
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  qACategory: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  response: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  campaignCallSource: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  interaction: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    upsert: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  mediaAsset: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  transcript: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  transcriptSegment: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
  },
  transcriptionAttempt: {
    create: vi.fn(),
    update: vi.fn(),
  },
  transcriptionJob: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  answer: {
    findMany: vi.fn(),
  },
  appSetting: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
    count: vi.fn(),
    findMany: vi.fn(),
  },
  loginRateLimit: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  loginRateLimitReservation: {
    count: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    findUnique: vi.fn(),
  },
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
};

export function resetPrismaMock() {
  for (const value of Object.values(prismaMock)) {
    if (typeof value === "function") {
      value.mockReset();
      continue;
    }

    for (const fn of Object.values(value)) {
      if (typeof fn === "function" && "mockReset" in fn) {
        fn.mockReset();
      }
    }
  }

  prismaMock.$transaction.mockImplementation(async (operation: unknown) => {
    if (typeof operation === "function") {
      return operation(prismaMock);
    }
    return Promise.all(operation as Promise<unknown>[]);
  });
  prismaMock.$queryRaw.mockResolvedValue([]);
}
