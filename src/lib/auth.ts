import NextAuth from "next-auth";
import authConfig from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role: string }).role;
        token.campaignIds = (user as { campaignIds: string[] }).campaignIds;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as "ADMIN" | "QA";
        session.user.campaignIds = token.campaignIds as string[];
      }
      return session;
    },
  },
  trustHost: true,
  useSecureCookies: process.env.NODE_ENV === "production",
  ...authConfig,
});
