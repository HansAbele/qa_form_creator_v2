import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertSafeDbPushTarget } from "./guard-db-push.mjs";

describe("assertSafeDbPushTarget", () => {
  it.each([undefined, "", "   "])("should reject a missing DATABASE_URL (%s)", (databaseUrl) => {
    expect(() => assertSafeDbPushTarget({ databaseUrl })).toThrow(/required/);
  });

  it("should reject production even when PostgreSQL is local", () => {
    expect(() =>
      assertSafeDbPushTarget({
        databaseUrl: "postgresql://qore:secret@localhost:5432/qore",
        nodeEnv: "production",
      }),
    ).toThrow(/disabled/);
  });

  it.each([
    "postgresql://qore:secret@db.internal:5432/qore",
    "postgresql://qore:secret@192.168.1.20:5432/qore",
  ])("should reject a non-local host (%s)", (databaseUrl) => {
    expect(() => assertSafeDbPushTarget({ databaseUrl })).toThrow(/local database host/);
  });

  it.each([
    "postgresql://qore:secret@localhost:5432/qore",
    "postgres://qore:secret@127.0.0.1:5432/qore",
    "postgresql://qore:secret@[::1]:5432/qore",
    "postgresql://qore:secret@host.docker.internal:5432/qore",
  ])("should allow an explicit local PostgreSQL database (%s)", (databaseUrl) => {
    expect(assertSafeDbPushTarget({ databaseUrl })).toBeInstanceOf(URL);
  });

  it("should reject destructive flags without a separate acknowledgement", () => {
    expect(() =>
      assertSafeDbPushTarget({
        databaseUrl: "postgresql://qore:secret@localhost:5432/qore",
        args: ["--accept-data-loss"],
      }),
    ).toThrow(/ALLOW_PRISMA_DB_PUSH_DATA_LOSS/);
  });

  it("should allow an acknowledged destructive flag only for a local target", () => {
    expect(
      assertSafeDbPushTarget({
        databaseUrl: "postgresql://qore:secret@localhost:5432/qore",
        args: ["--force-reset"],
        allowDataLoss: true,
      }),
    ).toBeInstanceOf(URL);
  });

  it("should load as a Node CLI and refuse production before invoking Prisma", () => {
    const scriptPath = fileURLToPath(new URL("./guard-db-push.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://qore:secret@localhost:5432/qore",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing to run prisma db push");
    expect(result.stderr).not.toContain("SyntaxError");
  });
});
