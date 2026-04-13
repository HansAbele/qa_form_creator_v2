import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { z } from "zod/v4";
import { prisma } from "./prisma";
import { checkRateLimit } from "./rate-limit";
import { logger } from "./logger";
import type { NextAuthConfig } from "next-auth";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export default {
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        // Rate limit by email
        const { ok } = checkRateLimit(`login:${parsed.data.email}`);
        if (!ok) {
          logger.warn({ email: parsed.data.email }, "Login rate limited");
          throw new Error("Demasiados intentos. Intenta de nuevo en 15 minutos.");
        }

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email, active: true },
          include: { campaigns: true },
        });
        if (!user) {
          logger.info({ email: parsed.data.email }, "Login failed: user not found");
          return null;
        }

        if (!user.password) {
          logger.info({ email: parsed.data.email }, "Login failed: SSO-only account");
          return null;
        }

        const valid = await compare(parsed.data.password, user.password);
        if (!valid) {
          logger.info({ email: parsed.data.email }, "Login failed: invalid password");
          return null;
        }

        logger.info({ userId: user.id, email: user.email }, "Login successful");

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          campaignIds: user.campaigns.map((c) => c.campaignId),
        };
      },
    }),
  ],
} satisfies NextAuthConfig;
