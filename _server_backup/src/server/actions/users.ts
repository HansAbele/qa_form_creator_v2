"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { hash } from "bcryptjs";
import type { Role } from "@prisma/client";

export async function getUsers() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("No autorizado");

  return prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      createdAt: true,
      campaigns: {
        include: { campaign: { select: { id: true, name: true } } },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function getUserById(id: string) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("No autorizado");

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      campaigns: {
        include: { campaign: { select: { id: true, name: true } } },
      },
    },
  });

  if (!user) throw new Error("Usuario no encontrado");
  return user;
}

export async function createUser(data: {
  email: string;
  name: string;
  password: string;
  role: Role;
  campaignIds: string[];
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("No autorizado");

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new Error("Ya existe un usuario con ese email");

  const hashedPassword = await hash(data.password, 10);

  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email: data.email,
        name: data.name,
        password: hashedPassword,
        role: data.role,
      },
    });

    if (data.campaignIds.length > 0) {
      await tx.userCampaign.createMany({
        data: data.campaignIds.map((campaignId) => ({
          userId: newUser.id,
          campaignId,
        })),
      });
    }

    return newUser;
  });

  revalidatePath("/admin/users");
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
  },
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("No autorizado");

  const updateData: Record<string, unknown> = {
    email: data.email,
    name: data.name,
    role: data.role,
    active: data.active,
  };

  if (data.password) {
    updateData.password = await hash(data.password, 10);
  }

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data: updateData,
    });

    await tx.userCampaign.deleteMany({ where: { userId: id } });

    if (data.campaignIds.length > 0) {
      await tx.userCampaign.createMany({
        data: data.campaignIds.map((campaignId) => ({
          userId: id,
          campaignId,
        })),
      });
    }

    return updated;
  });

  revalidatePath("/admin/users");
  return user;
}

export async function deleteUser(id: string) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("No autorizado");

  if (id === session.user.id) {
    throw new Error("No puedes desactivar tu propia cuenta");
  }

  await prisma.user.update({
    where: { id },
    data: { active: false },
  });

  revalidatePath("/admin/users");
}
