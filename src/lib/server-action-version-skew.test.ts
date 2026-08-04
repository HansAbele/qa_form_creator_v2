import { describe, expect, it, vi } from "vitest";
import {
  isServerActionVersionSkewError,
  recoverFromServerActionVersionSkew,
} from "@/lib/server-action-version-skew";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("server action version skew recovery", () => {
  it("should recognize the production missing-action message", () => {
    expect(
      isServerActionVersionSkewError(
        new Error(
          'Server Action "406199ea4e1daa4be528dcb9d9fe1dc005f879d10a" was not found on the server.',
        ),
      ),
    ).toBe(true);
  });

  it("should ignore ordinary server action errors", () => {
    expect(isServerActionVersionSkewError(new Error("An activity is already active"))).toBe(false);
  });

  it("should reload once and suppress a reload loop", () => {
    const reload = vi.fn();
    const storage = memoryStorage();
    const error = new Error("Failed to find Server Action");

    expect(recoverFromServerActionVersionSkew(error, { reload, storage, now: () => 100_000 })).toBe(
      true,
    );
    expect(recoverFromServerActionVersionSkew(error, { reload, storage, now: () => 100_500 })).toBe(
      false,
    );
    expect(reload).toHaveBeenCalledOnce();
  });
});
