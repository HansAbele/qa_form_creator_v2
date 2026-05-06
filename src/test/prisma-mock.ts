import { vi } from "vitest";

export const prismaMock = {
  userCampaign: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  campaign: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  team: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  agent: {
    findUnique: vi.fn(),
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
    findMany: vi.fn(),
  },
  response: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  },
  answer: {
    findMany: vi.fn(),
  },
  appSetting: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
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
}
