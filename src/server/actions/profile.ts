"use server";

import { revalidatePath } from "next/cache";
import { hash, compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

// ─── Profile shape returned to the client ──────────────
export interface ProfileInfo {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "QA";
  hasPassword: boolean;
  campaignCount: number;
  createdAt: string;
}

/** Read the logged-in user's profile info. */
export async function getMyProfile(): Promise<ProfileInfo> {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      password: true,
      createdAt: true,
      _count: { select: { campaigns: true } },
    },
  });

  if (!user) throw new Error("Usuario no encontrado");

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    hasPassword: !!user.password,
    campaignCount: user._count.campaigns,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Update the logged-in user's own name. */
export async function updateMyName(name: string): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const trimmed = name.trim();
  if (trimmed.length < 2) {
    throw new Error("El nombre debe tener al menos 2 caracteres");
  }
  if (trimmed.length > 100) {
    throw new Error("El nombre no puede exceder 100 caracteres");
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { name: trimmed },
  });

  revalidatePath("/settings");
  revalidatePath("/", "layout");
}

/** Change the logged-in user's own password. */
export async function changeMyPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  if (!currentPassword) {
    throw new Error("Debes ingresar tu contraseña actual");
  }
  if (!newPassword || newPassword.length < 8) {
    throw new Error("La nueva contraseña debe tener al menos 8 caracteres");
  }
  if (newPassword.length > 128) {
    throw new Error("La contraseña no puede exceder 128 caracteres");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { password: true },
  });

  if (!user) throw new Error("Usuario no encontrado");

  if (!user.password) {
    throw new Error(
      "Esta cuenta usa inicio de sesión externo (SSO) y no tiene contraseña.",
    );
  }

  const valid = await compare(currentPassword, user.password);
  if (!valid) {
    throw new Error("La contraseña actual es incorrecta");
  }

  const hashed = await hash(newPassword, 10);
  await prisma.user.update({
    where: { id: session.user.id },
    data: { password: hashed },
  });

  revalidatePath("/settings");
}
