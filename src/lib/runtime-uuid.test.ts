import { describe, expect, it, vi } from "vitest";
import { createRuntimeUuid } from "@/lib/runtime-uuid";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("createRuntimeUuid", () => {
  it("uses native randomUUID when the runtime provides it", () => {
    const nativeUuid = "75911c38-b719-4e39-bca0-e520efb9ff35";
    const randomUUID = vi.fn(() => nativeUuid);

    expect(createRuntimeUuid({ randomUUID })).toBe(nativeUuid);
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("creates a valid UUID when HTTP removes randomUUID", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0xab);
      return bytes;
    });

    const uuid = createRuntimeUuid({ getRandomValues });

    expect(uuid).toMatch(UUID_V4_PATTERN);
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it("retains a UUID-compatible fallback without Web Crypto", () => {
    expect(createRuntimeUuid(null)).toMatch(UUID_V4_PATTERN);
  });
});
