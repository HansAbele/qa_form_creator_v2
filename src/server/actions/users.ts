"use server";

import type { Prisma, Role } from "@prisma/client";
import { hash } from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  CAMPAIGN_PERMISSION_KEYS,
  type CampaignAccessLevel,
  type CampaignPermissionKey,
  getCampaignAccessPreset,
  getDefaultCampaignAccessForUserRole,
  normalizeCampaignPermissionsForRole,
} from "@/lib/campaign-permissions";
import { assertStrongPassword } from "@/lib/password-policy";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";

const roleSchema = z.enum(["ADMIN", "QA", "SUPERVISOR", "AGENT"]);
const campaignIdsSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(500)
  .transform((campaignIds) => [...new Set(campaignIds)]);
const userInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(2).max(100),
  password: z.string(),
  role: roleSchema,
  campaignIds: campaignIdsSchema,
  agentId: z.string().trim().min(1).max(100).nullish(),
});

function requireAgentLink(
  value: { role: z.infer<typeof roleSchema>; agentId?: string | null },
  context: z.RefinementCtx,
) {
  if (value.role === "AGENT" && !value.agentId) {
    context.addIssue({
      code: "custom",
      path: ["agentId"],
      message: "An agent portal account must be linked to an agent",
    });
  }
}

const createUserSchema = userInputSchema.superRefine(requireAgentLink);
const updateUserSchema = userInputSchema
  .extend({
    password: z.string().optional(),
    active: z.boolean(),
  })
  .superRefine(requireAgentLink);
const ACTIVE_ADMIN_LOCK_KEY = "qa-form-creator:active-admin-guard";

const SAFE_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  active: true,
  createdAt: true,
} as const satisfies Prisma.UserSelect;

function parseUserInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid user data");
  }
  return parsed.data;
}

async function assertNotRemovingLastActiveAdmin(
  tx: Prisma.TransactionClient,
  userId: string,
  before: { role: Role; active: boolean },
  after: { role: Role; active: boolean },
) {
  if (before.role !== "ADMIN" || !before.active || (after.role === "ADMIN" && after.active)) {
    return;
  }

  const otherActiveAdmins = await tx.user.count({
    where: { id: { not: userId }, role: "ADMIN", active: true },
  });
  if (otherActiveAdmins === 0) {
    throw new Error("The last active QA Manager cannot be deactivated or demoted");
  }
}

async function lockAndAssertActiveAdmin(
  tx: Prisma.TransactionClient,
  actor: { id: string; sessionVersion?: number },
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ACTIVE_ADMIN_LOCK_KEY}, 0))`;

  const where: Prisma.UserWhereInput = {
    id: actor.id,
    role: "ADMIN",
    active: true,
  };
  if (actor.sessionVersion !== undefined) {
    where.sessionVersion = actor.sessionVersion;
  }

  const authoritativeActor = await tx.user.findFirst({
    where,
    select: { id: true },
  });
  if (!authoritativeActor) {
    throw new Error("Unauthorized: the QA Manager account is no longer active");
  }
}

export async function getUsers() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");

  return prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      createdAt: true,
      agentProfile: {
        select: { id: true, name: true, campaignId: true, agentCode: true, active: true },
      },
      campaigns: {
        include: { campaign: { select: { id: true, name: true } } },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function getUserById(id: string) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      agentProfile: {
        select: { id: true, name: true, campaignId: true, agentCode: true, active: true },
      },
      campaigns: {
        include: { campaign: { select: { id: true, name: true } } },
      },
    },
  });

  if (!user) throw new Error("User not found");
  return user;
}

export async function createUser(data: {
  email: string;
  name: string;
  password: string;
  role: Role;
  campaignIds: string[];
  agentId?: string | null;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");

  const input = parseUserInput(createUserSchema, data);
  assertStrongPassword(input.password);

  const hashedPassword = await hash(input.password, 12);

  const user = await prisma.$transaction(async (tx) => {
    await lockAndAssertActiveAdmin(tx, session.user);

    const existing = await tx.user.findUnique({ where: { email: input.email } });
    if (existing) throw new Error("A user with this email already exists");

    const linkedAgent =
      input.role === "AGENT"
        ? await tx.agent.findFirst({
            where: { id: input.agentId as string, active: true, userId: null },
            select: { id: true, campaignId: true, name: true },
          })
        : null;
    if (input.role === "AGENT" && !linkedAgent) {
      throw new Error("The selected agent is unavailable or already has a portal account");
    }
    const effectiveCampaignIds = linkedAgent ? [linkedAgent.campaignId] : input.campaignIds;

    const newUser = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        password: hashedPassword,
        role: input.role,
      },
      select: SAFE_USER_SELECT,
    });

    if (linkedAgent) {
      const linked = await tx.agent.updateMany({
        where: { id: linkedAgent.id, userId: null },
        data: { userId: newUser.id },
      });
      if (linked.count !== 1) {
        throw new Error("The selected agent already has a portal account");
      }
    }

    if (effectiveCampaignIds.length > 0) {
      const defaultCampaignAccess = getDefaultCampaignAccessForUserRole(input.role);
      await tx.userCampaign.createMany({
        data: effectiveCampaignIds.map((campaignId) => ({
          userId: newUser.id,
          campaignId,
          ...defaultCampaignAccess,
        })),
      });
    }

    await writeAuditLog(
      {
        userId: session.user.id,
        module: "users",
        action: "created",
        entityType: "user",
        entityId: newUser.id,
        afterValue: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          role: newUser.role,
          campaignIds: effectiveCampaignIds,
          agentId: linkedAgent?.id ?? null,
        },
        impact: "User created and assigned to initial campaigns.",
      },
      tx,
    );

    return newUser;
  });

  revalidatePath("/admin/users");
  revalidatePath("/settings");
  return user;
}

export async function updateUser(
  id: string,
  data: {
    email: string;
    name: string;
    password?: string;
    role: Role;
    active: boolean;
    campaignIds: string[];
    agentId?: string | null;
  },
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");

  const input = parseUserInput(updateUserSchema, data);
  if (input.password) assertStrongPassword(input.password);

  const updateData: Record<string, unknown> = {
    email: input.email,
    name: input.name,
    role: input.role,
    active: input.active,
  };

  if (input.password) {
    updateData.password = await hash(input.password, 12);
  }

  const user = await prisma.$transaction(async (tx) => {
    await lockAndAssertActiveAdmin(tx, session.user);

    const beforeUser = await tx.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        campaigns: { select: { campaignId: true } },
        agentProfile: { select: { id: true, campaignId: true } },
      },
    });
    if (!beforeUser) throw new Error("User not found");

    if (id === session.user.id && (input.role !== "ADMIN" || !input.active)) {
      throw new Error("You cannot deactivate or demote your own QA Manager account");
    }
    await assertNotRemovingLastActiveAdmin(tx, id, beforeUser, input);

    const emailOwner = await tx.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (emailOwner && emailOwner.id !== id) {
      throw new Error("A user with this email already exists");
    }

    const linkedAgent =
      input.role === "AGENT"
        ? await tx.agent.findFirst({
            where: {
              id: input.agentId as string,
              active: true,
              OR: [{ userId: null }, { userId: id }],
            },
            select: { id: true, campaignId: true, name: true },
          })
        : null;
    if (input.role === "AGENT" && !linkedAgent) {
      throw new Error("The selected agent is unavailable or already has a portal account");
    }

    const effectiveCampaignIds = linkedAgent ? [linkedAgent.campaignId] : input.campaignIds;
    const agentLinkChanged = (beforeUser.agentProfile?.id ?? null) !== (linkedAgent?.id ?? null);
    const transactionUpdateData = { ...updateData };
    const shouldRevokeSessions =
      Boolean(input.password) ||
      beforeUser.role !== input.role ||
      beforeUser.active !== input.active ||
      agentLinkChanged;
    if (shouldRevokeSessions) {
      transactionUpdateData.sessionVersion = { increment: 1 };
    }

    const updated = await tx.user.update({
      where: { id },
      data: transactionUpdateData,
      select: SAFE_USER_SELECT,
    });

    if (beforeUser.agentProfile && beforeUser.agentProfile.id !== linkedAgent?.id) {
      await tx.agent.update({
        where: { id: beforeUser.agentProfile.id },
        data: { userId: null },
      });
    }
    if (linkedAgent && beforeUser.agentProfile?.id !== linkedAgent.id) {
      const linked = await tx.agent.updateMany({
        where: { id: linkedAgent.id, OR: [{ userId: null }, { userId: id }] },
        data: { userId: id },
      });
      if (linked.count !== 1) {
        throw new Error("The selected agent already has a portal account");
      }
    }

    const nextCampaignIds = effectiveCampaignIds;

    if (nextCampaignIds.length === 0) {
      await tx.userCampaign.deleteMany({ where: { userId: id } });
    } else {
      await tx.userCampaign.deleteMany({
        where: { userId: id, campaignId: { notIn: nextCampaignIds } },
      });
    }

    const existingAccess = await tx.userCampaign.findMany({
      where: { userId: id },
      select: { campaignId: true },
    });
    const existingCampaignIds = new Set(existingAccess.map((access) => access.campaignId));
    const campaignIdsToCreate = nextCampaignIds.filter(
      (campaignId) => !existingCampaignIds.has(campaignId),
    );

    if (campaignIdsToCreate.length > 0) {
      const defaultCampaignAccess = getDefaultCampaignAccessForUserRole(input.role);
      await tx.userCampaign.createMany({
        data: campaignIdsToCreate.map((campaignId) => ({
          userId: id,
          campaignId,
          ...defaultCampaignAccess,
        })),
      });
    }

    if (
      (beforeUser.role !== input.role || input.role === "SUPERVISOR" || input.role === "AGENT") &&
      nextCampaignIds.length > 0
    ) {
      await tx.userCampaign.updateMany({
        where: { userId: id, campaignId: { in: nextCampaignIds } },
        data: getDefaultCampaignAccessForUserRole(input.role),
      });
    }

    await writeAuditLog(
      {
        userId: session.user.id,
        module: "users",
        action: "updated",
        entityType: "user",
        entityId: id,
        beforeValue: beforeUser,
        afterValue: {
          id: updated.id,
          email: updated.email,
          name: updated.name,
          role: updated.role,
          active: updated.active,
          campaignIds: effectiveCampaignIds,
          agentId: linkedAgent?.id ?? null,
          passwordChanged: Boolean(input.password),
        },
        impact: "User and campaign assignments updated.",
      },
      tx,
    );

    return updated;
  });

  revalidatePath("/admin/users");
  revalidatePath("/settings");
  return user;
}

export async function updateCampaignAccess(data: {
  userId: string;
  campaignId: string;
  roleInCampaign: CampaignAccessLevel;
  permissions: Partial<Record<CampaignPermissionKey, boolean>>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("Unauthorized");
  }

  const access = await prisma.$transaction(async (tx) => {
    await lockAndAssertActiveAdmin(tx, session.user);

    const [user, campaign, existingAccess] = await Promise.all([
      tx.user.findUnique({
        where: { id: data.userId },
        select: { id: true, role: true },
      }),
      tx.campaign.findUnique({
        where: { id: data.campaignId },
        select: { id: true },
      }),
      tx.userCampaign.findUnique({
        where: {
          userId_campaignId: {
            userId: data.userId,
            campaignId: data.campaignId,
          },
        },
      }),
    ]);

    if (!user) throw new Error("User not found");
    if (!campaign) throw new Error("Campaign not found");
    if (user.role === "ADMIN") {
      throw new Error("QA Managers have global access");
    }
    if (!existingAccess) {
      throw new Error("User is not assigned to this campaign");
    }

    const rawPermissionPatch = Object.fromEntries(
      CAMPAIGN_PERMISSION_KEYS.map((key) => [key, Boolean(data.permissions[key])]),
    ) as Record<CampaignPermissionKey, boolean>;
    const permissionPatch =
      user.role === "AGENT"
        ? getCampaignAccessPreset("AGENT")
        : user.role === "SUPERVISOR"
          ? getCampaignAccessPreset("SUPERVISOR")
          : normalizeCampaignPermissionsForRole(user.role, rawPermissionPatch);
    const roleInCampaign =
      user.role === "AGENT"
        ? "AGENT"
        : user.role === "SUPERVISOR"
          ? "SUPERVISOR"
          : data.roleInCampaign;

    const access = await tx.userCampaign.update({
      where: {
        userId_campaignId: {
          userId: data.userId,
          campaignId: data.campaignId,
        },
      },
      data: {
        roleInCampaign,
        ...permissionPatch,
      },
      include: { campaign: { select: { id: true, name: true } } },
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        campaignId: data.campaignId,
        module: "permissions",
        action: "campaign_access_updated",
        entityType: "user_campaign",
        entityId: `${data.userId}:${data.campaignId}`,
        beforeValue: existingAccess,
        afterValue: access,
        impact: "Effective user permissions updated for the campaign.",
      },
      tx,
    );
    return access;
  });

  revalidatePath("/settings");
  revalidatePath("/admin/users");
  return access;
}

export async function deleteUser(id: string) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Unauthorized");

  if (id === session.user.id) {
    throw new Error("You cannot deactivate your own account");
  }

  await prisma.$transaction(async (tx) => {
    await lockAndAssertActiveAdmin(tx, session.user);

    const beforeUser = await tx.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, active: true },
    });
    if (!beforeUser) throw new Error("User not found");
    await assertNotRemovingLastActiveAdmin(tx, id, beforeUser, {
      role: beforeUser.role,
      active: false,
    });

    const user = await tx.user.update({
      where: { id },
      data: { active: false, sessionVersion: { increment: 1 } },
      select: SAFE_USER_SELECT,
    });
    await writeAuditLog(
      {
        userId: session.user.id,
        module: "users",
        action: "deactivated",
        entityType: "user",
        entityId: id,
        beforeValue: beforeUser,
        afterValue: { id: user.id, email: user.email, active: user.active },
        impact: "User deactivated; future access was blocked.",
      },
      tx,
    );
  });

  revalidatePath("/admin/users");
  revalidatePath("/settings");
}
