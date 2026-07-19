"use server";

import { compare, hash } from "bcryptjs";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n";
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
  locale: Locale;
}

/** Read the logged-in user's profile info. */
export async function getMyProfile(): Promise<ProfileInfo> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      password: true,
      createdAt: true,
      locale: true,
      campaigns: {
        select: {
          campaign: { select: { id: true, name: true } },
        },
      },
      _count: { select: { campaigns: true } },
    },
  });

  if (!user) throw new Error("User not found");

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
    locale: isLocale(user.locale) ? user.locale : DEFAULT_LOCALE,
  };
}

/** Persist the logged-in user's language preference and synchronize SSR locale. */
export async function updateMyLocale(locale: string): Promise<void> {
  const session = await auth();
  if (!isLocale(locale)) throw new Error("Unsupported language");

  if (session?.user) {
    await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id: session.user.id },
        select: { id: true, active: true, locale: true, sessionVersion: true },
      });
      if (!before?.active) throw new Error("User not found or inactive");
      if (
        session.user.sessionVersion !== undefined &&
        before.sessionVersion !== session.user.sessionVersion
      ) {
        throw new Error("Your session changed; sign in again");
      }

      if (before.locale === locale) return;

      const updated = await tx.user.updateMany({
        where: {
          id: before.id,
          active: true,
          locale: before.locale,
          sessionVersion: before.sessionVersion,
        },
        data: { locale },
      });
      if (updated.count !== 1) {
        throw new Error("Your preferences changed in another session; try again");
      }

      await writeAuditLog(
        {
          userId: before.id,
          module: "profile",
          action: "profile_locale_updated",
          entityType: "user",
          entityId: before.id,
          beforeValue: { locale: before.locale },
          afterValue: { locale },
          impact: "User changed the interface language.",
        },
        tx,
      );
    });
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    httpOnly: false,
    maxAge: 31_536_000,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  revalidatePath("/", "layout");
}

/** Update the logged-in user's own name. */
export async function updateMyName(name: string): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const trimmed = name.trim();
  if (trimmed.length < 2) {
    throw new Error("Full name must contain at least 2 characters.");
  }
  if (trimmed.length > 100) {
    throw new Error("Full name cannot exceed 100 characters.");
  }

  await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, active: true, sessionVersion: true },
    });
    if (!before?.active) throw new Error("User not found or inactive");
    if (
      session.user.sessionVersion !== undefined &&
      before.sessionVersion !== session.user.sessionVersion
    ) {
      throw new Error("Your session changed; sign in again");
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
      throw new Error("Your profile changed in another session; try again");
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
        impact: "User updated their profile name.",
      },
      tx,
    );
  });

  revalidatePath("/account");
  revalidatePath("/", "layout");
}

/** Change the logged-in user's own password. */
export async function changeMyPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  if (!currentPassword) {
    throw new Error("Enter your current password.");
  }
  assertStrongPassword(newPassword);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, password: true, active: true, sessionVersion: true },
  });

  if (!user?.active) throw new Error("User not found or inactive");

  if (!user.password) {
    throw new Error("This account uses an external identity provider and has no local password.");
  }
  if (
    session.user.sessionVersion !== undefined &&
    user.sessionVersion !== session.user.sessionVersion
  ) {
    throw new Error("Your session changed; sign in again");
  }

  const valid = await compare(currentPassword, user.password);
  if (!valid) {
    throw new Error("Current password is incorrect.");
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
      throw new Error("The password or session changed; try again");
    }

    await writeAuditLog(
      {
        userId: user.id,
        module: "profile",
        action: "password_changed",
        entityType: "user",
        entityId: user.id,
        afterValue: { passwordChanged: true, sessionsRevoked: true },
        impact: "Password updated and previous sessions revoked.",
      },
      tx,
    );
  });

  revalidatePath("/settings");
}
