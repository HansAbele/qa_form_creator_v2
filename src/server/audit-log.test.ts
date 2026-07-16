import { beforeEach, describe, expect, it } from "vitest";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";
import { writeAuditLog } from "./audit-log";

describe("writeAuditLog", () => {
  beforeEach(() => resetPrismaMock());

  it("uses the supplied transaction client", async () => {
    prismaMock.auditLog.create.mockResolvedValue({ id: "audit-1" });

    await writeAuditLog(
      { module: "forms", action: "created", afterValue: { id: "form-1" } },
      prismaMock as never,
    );

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        module: "forms",
        action: "created",
        afterValue: { id: "form-1" },
      }),
    });
  });

  it("propagates persistence failures instead of silently losing audit evidence", async () => {
    const failure = new Error("audit storage unavailable");
    prismaMock.auditLog.create.mockRejectedValue(failure);

    await expect(
      writeAuditLog({ module: "users", action: "updated" }, prismaMock as never),
    ).rejects.toBe(failure);
  });
});
