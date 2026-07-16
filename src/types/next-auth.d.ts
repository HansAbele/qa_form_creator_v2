import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role: Role;
    campaignIds: string[];
    sessionVersion?: number;
  }

  interface Session {
    user: {
      id: string;
      role: Role;
      campaignIds: string[];
      sessionVersion?: number;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    campaignIds?: string[];
    sessionVersion?: number;
  }
}
