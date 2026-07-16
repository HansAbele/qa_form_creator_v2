import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);
const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const DESTRUCTIVE_ARGUMENTS = new Set(["--accept-data-loss", "--force-reset"]);

export function assertSafeDbPushTarget({ databaseUrl, nodeEnv, args = [], allowDataLoss = false }) {
  if (nodeEnv === "production") {
    throw new Error("prisma db push is disabled when NODE_ENV=production.");
  }

  const value = databaseUrl?.trim();
  if (!value) {
    throw new Error("DATABASE_URL is required and must not be empty.");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!LOCAL_DATABASE_HOSTS.has(hostname)) {
    throw new Error("prisma db push may only target an explicitly local database host.");
  }
  if (parsed.pathname === "" || parsed.pathname === "/") {
    throw new Error("DATABASE_URL must include a database name.");
  }

  const destructiveArgument = args.find((argument) => DESTRUCTIVE_ARGUMENTS.has(argument));
  if (destructiveArgument && !allowDataLoss) {
    throw new Error(
      `${destructiveArgument} requires ALLOW_PRISMA_DB_PUSH_DATA_LOSS=true for this local run.`,
    );
  }

  return parsed;
}

export function runDbPush() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

  const args = process.argv.slice(2);
  try {
    assertSafeDbPushTarget({
      databaseUrl: process.env.DATABASE_URL,
      nodeEnv: process.env.NODE_ENV,
      args,
      allowDataLoss: process.env.ALLOW_PRISMA_DB_PUSH_DATA_LOSS === "true",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Refusing to run prisma db push: ${message}`);
    console.error("Use prisma migrate deploy for production and shared environments.");
    return 1;
  }

  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(pnpm, ["exec", "prisma", "db", "push", ...args], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`Unable to start Prisma: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

const isMainModule = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMainModule) {
  process.exitCode = runDbPush();
}
