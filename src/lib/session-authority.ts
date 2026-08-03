import type { Session } from "next-auth";
import { DEFAULT_LOCALE, isLocale } from "./i18n";
import { logger } from "./logger";
import { prisma } from "./prisma";

type RawAuth = () => Promise<Session | null>;
type RevalidationOptions = { allowPasswordChangeRequired?: boolean };

/**
 * Revalidates the identity and authorization snapshot carried by a JWT against
 * the database. A session version mismatch deliberately rejects every token
 * issued before a sensitive account change.
 */
export async function revalidateSession(
  session: Session | null,
  options: RevalidationOptions = {},
): Promise<Session | null> {
  const userId = session?.user?.id;
  const tokenSessionVersion = session?.user?.sessionVersion;

  if (!userId || !Number.isInteger(tokenSessionVersion)) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      active: true,
      sessionVersion: true,
      mustChangePassword: true,
      locale: true,
      campaigns: { select: { campaignId: true } },
    },
  });

  if (!user?.active) {
    logger.warn({ userId }, "Session rejected: user missing or inactive");
    return null;
  }

  if (user.sessionVersion !== tokenSessionVersion) {
    logger.info(
      { userId, tokenSessionVersion, currentSessionVersion: user.sessionVersion },
      "Session rejected: token was revoked",
    );
    return null;
  }

  if (user.mustChangePassword && !options.allowPasswordChangeRequired) {
    logger.info({ userId }, "Session restricted: password change required");
    return null;
  }

  return {
    ...session,
    user: {
      ...session.user,
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: user.role,
      campaignIds: user.campaigns.map(({ campaignId }) => campaignId),
      sessionVersion: user.sessionVersion,
      mustChangePassword: user.mustChangePassword,
      locale: isLocale(user.locale) ? user.locale : DEFAULT_LOCALE,
    },
  };
}

/** Wraps Auth.js' cookie/JWT reader with the authoritative database check. */
export function createAuthoritativeAuth(
  rawAuth: RawAuth,
  options: RevalidationOptions = {},
): RawAuth {
  return async () => revalidateSession(await rawAuth(), options);
}
