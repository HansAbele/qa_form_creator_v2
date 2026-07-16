"use server";

import { compare, hash } from "bcryptjs";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { assertStrongPassword } from "@/lib/password-policy";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";

// ─── Profile shape returned to the client ──────────────
export interface ProfileInfo {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "QA" | "SUPERVISOR";
  hasPassword: boolean;
  campaignCount: number;
  campaigns: { id: string; name: string }[];
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
      campaigns: {
        select: {
          campaign: { select: { id: true, name: true } },
        },
      },
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
    campaigns: user.campaigns
      .map(({ campaign }) => campaign)
      .sort((a, b) => a.name.localeCompare(b.name)),
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

  await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, active: true, sessionVersion: true },
    });
    if (!before?.active) throw new Error("Usuario no encontrado o inactivo");
    if (
      session.user.sessionVersion !== undefined &&
      before.sessionVersion !== session.user.sessionVersion
    ) {
      throw new Error("La sesion cambio; vuelve a iniciar sesion");
    }

    const updated = await tx.user.updateMany({
      where: {
        id: before.id,
        active: true,
        name: before.name,
        sessionVersion: before.sessionVersion,
      },
      data: { name: trimmed },
    });
    if (updated.count !== 1) {
      throw new Error("El perfil cambio en otra sesion; vuelve a intentarlo");
    }

    await writeAuditLog(
      {
        userId: before.id,
        module: "profile",
        action: "profile_name_updated",
        entityType: "user",
        entityId: before.id,
        beforeValue: { name: before.name },
        afterValue: { name: trimmed },
        impact: "El usuario actualizo su nombre de perfil.",
      },
      tx,
    );
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
  assertStrongPassword(newPassword);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, password: true, active: true, sessionVersion: true },
  });

  if (!user?.active) throw new Error("Usuario no encontrado o inactivo");

  if (!user.password) {
    throw new Error("Esta cuenta usa inicio de sesión externo (SSO) y no tiene contraseña.");
  }
  if (
    session.user.sessionVersion !== undefined &&
    user.sessionVersion !== session.user.sessionVersion
  ) {
    throw new Error("La sesion cambio; vuelve a iniciar sesion");
  }

  const valid = await compare(currentPassword, user.password);
  if (!valid) {
    throw new Error("La contraseña actual es incorrecta");
  }

  const hashed = await hash(newPassword, 12);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: {
        id: user.id,
        active: true,
        password: user.password,
        sessionVersion: user.sessionVersion,
      },
      data: { password: hashed, sessionVersion: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new Error("La contrasena o la sesion cambiaron; vuelve a intentarlo");
    }

    await writeAuditLog(
      {
        userId: user.id,
        module: "profile",
        action: "password_changed",
        entityType: "user",
        entityId: user.id,
        afterValue: { passwordChanged: true, sessionsRevoked: true },
        impact: "Contrasena actualizada y sesiones anteriores revocadas.",
      },
      tx,
    );
  });

  revalidatePath("/settings");
}
