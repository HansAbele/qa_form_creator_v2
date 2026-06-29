import { spawnSync } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL ?? "";
const allowOverride = process.env.ALLOW_PRISMA_DB_PUSH === "true";
const isProduction = process.env.NODE_ENV === "production";
const isLocalDatabase =
  databaseUrl === "" ||
  /\/\/[^/@]*@?(localhost|127\.0\.0\.1|host\.docker\.internal)(:|\/)/.test(databaseUrl);

if (!allowOverride && (isProduction || !isLocalDatabase)) {
  console.error("Refusing to run prisma db push against a non-local or production database.");
  console.error("Use prisma migrate deploy for production.");
  console.error("For an intentional local override, set ALLOW_PRISMA_DB_PUSH=true.");
  process.exit(1);
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(pnpm, ["exec", "prisma", "db", "push", ...process.argv.slice(2)], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
