import { compare } from "bcryptjs";
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod/v4";
import { logger } from "./logger";
import { prisma } from "./prisma";
import { completeLoginAttempt, createLoginRateLimitKeys, reserveLoginAttempt } from "./rate-limit";

const loginSchema = z.object({
  email: z.email().transform((email) => email.trim().toLowerCase()),
  password: z.string().min(1),
});

const DUMMY_PASSWORD_HASH = "$2b$12$BGRw6zb9oimG4./3u2dCa.f.N4pzrVeFvMd/DAvLsRtxilVoVBRze";

export default {
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const rateLimitKeys = createLoginRateLimitKeys(parsed.data.email, request.headers);
        const admission = await reserveLoginAttempt(rateLimitKeys);
        if (!admission.allowed) {
          logger.warn(
            {
              scope: admission.blockedScope,
              blockedUntil: admission.blockedUntil,
              reason: admission.reason,
            },
            "Login rate limited",
          );
          throw new Error("Too many attempts. Try again in 15 minutes.");
        }

        let reservationCompleted = false;
        try {
          const user = await prisma.user.findUnique({
            where: { email: parsed.data.email, active: true },
            include: { campaigns: true },
          });
          const valid = await compare(parsed.data.password, user?.password ?? DUMMY_PASSWORD_HASH);
          if (!user?.password || !valid) {
            const completion = await completeLoginAttempt(admission.reservationId, "failure");
            reservationCompleted = completion.completed;
            logger.info(
              {
                accountBlocked: completion.states.some(
                  ({ scope, state }) => scope === "account" && Boolean(state.blockedUntil),
                ),
                ipBlocked: completion.states.some(
                  ({ scope, state }) => scope === "ip" && Boolean(state.blockedUntil),
                ),
                reason: !user ? "unknown_account" : user.password ? "invalid_password" : "sso_only",
              },
              "Login failed",
            );
            return null;
          }

          const completion = await completeLoginAttempt(admission.reservationId, "success");
          if (!completion.completed) {
            throw new Error("Login rate-limit reservation expired before completion");
          }
          reservationCompleted = completion.completed;
          logger.info({ userId: user.id, email: user.email }, "Login successful");

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            campaignIds: user.campaigns.map((c) => c.campaignId),
            sessionVersion: user.sessionVersion,
            mustChangePassword: user.mustChangePassword,
            locale: user.locale === "es" ? "es" : "en",
          };
        } finally {
          if (!reservationCompleted) {
            await completeLoginAttempt(admission.reservationId, "failure");
          }
        }
      },
    }),
  ],
} satisfies NextAuthConfig;
