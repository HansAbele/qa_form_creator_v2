import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "ADMIN" | "QA" | "SUPERVISOR";
      campaignIds: string[];
    } & DefaultSession["user"];
  }
}
