import NextAuth from "next-auth";
import { cache } from "react";
import authConfig from "./auth.config";
import { shouldUseSecureAuthCookies } from "./auth-cookie-policy";
import { prisma } from "./prisma";
import { createAuthoritativeAuth } from "./session-authority";

const nextAuth = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.campaignIds = user.campaignIds;
        token.sessionVersion = user.sessionVersion;
        token.mustChangePassword = user.mustChangePassword;
        token.locale = user.locale;
      }

      if (trigger === "update" && token.id && Number.isInteger(token.sessionVersion)) {
        const currentUser = await prisma.user.findFirst({
          where: {
            id: token.id,
            active: true,
            sessionVersion: token.sessionVersion,
          },
          select: {
            email: true,
            name: true,
            image: true,
            role: true,
            locale: true,
            mustChangePassword: true,
            campaigns: { select: { campaignId: true } },
          },
        });

        if (currentUser) {
          token.email = currentUser.email;
          token.name = currentUser.name;
          token.picture = currentUser.image;
          token.role = currentUser.role;
          token.locale = currentUser.locale === "es" ? "es" : "en";
          token.mustChangePassword = currentUser.mustChangePassword;
          token.campaignIds = currentUser.campaigns.map(({ campaignId }) => campaignId);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id ?? "";
        session.user.role = token.role ?? "QA";
        session.user.campaignIds = token.campaignIds ?? [];
        session.user.sessionVersion = token.sessionVersion ?? -1;
        session.user.mustChangePassword = token.mustChangePassword === true;
        session.user.locale = token.locale === "es" ? "es" : "en";
      }
      return session;
    },
  },
  trustHost: true,
  useSecureCookies: shouldUseSecureAuthCookies(),
  ...authConfig,
});

export const { handlers, signIn, signOut } = nextAuth;

// Do not export Auth.js' raw reader. Every server caller must pass through the
// database-backed active/role/campaign/session-version verification.
export const auth = cache(createAuthoritativeAuth(nextAuth.auth));
export const authForPasswordChange = cache(
  createAuthoritativeAuth(nextAuth.auth, { allowPasswordChangeRequired: true }),
);
