import NextAuth from "next-auth";
import authConfig from "./auth.config";
import { shouldUseSecureAuthCookies } from "./auth-cookie-policy";
import { createAuthoritativeAuth } from "./session-authority";

const nextAuth = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.campaignIds = user.campaignIds;
        token.sessionVersion = user.sessionVersion;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id ?? "";
        session.user.role = token.role ?? "QA";
        session.user.campaignIds = token.campaignIds ?? [];
        session.user.sessionVersion = token.sessionVersion ?? -1;
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
export const auth = createAuthoritativeAuth(nextAuth.auth);
