import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installNavigationGuardRuntime,
  resolveHistoryTraversalDelta,
} from "./navigation-guard-runtime";

describe("navigation guard runtime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves multi-entry traversals from app history metadata", () => {
    expect(
      resolveHistoryTraversalDelta({
        currentMarker: { epoch: "current", index: 8 },
        targetMarker: { epoch: "current", index: 3 },
        currentNativeIndex: 20,
        targetNativeIndex: 19,
      }),
    ).toBe(-5);
  });

  it("uses the native Navigation API index for an older untagged entry", () => {
    expect(
      resolveHistoryTraversalDelta({
        currentMarker: { epoch: "current", index: 8 },
        targetMarker: null,
        currentNativeIndex: 20,
        targetNativeIndex: 16,
      }),
    ).toBe(-4);
  });

  it("returns an unknown delta when neither index source can identify the target", () => {
    expect(
      resolveHistoryTraversalDelta({
        currentMarker: { epoch: "current", index: 8 },
        targetMarker: null,
        currentNativeIndex: null,
        targetNativeIndex: null,
      }),
    ).toBeNull();
  });

  it("does not compare equal indexes from a previous document epoch", () => {
    expect(
      resolveHistoryTraversalDelta({
        currentMarker: { epoch: "new-session", index: 2 },
        targetMarker: { epoch: "old-session", index: 2 },
        currentNativeIndex: null,
        targetNativeIndex: null,
      }),
    ).toBeNull();
  });

  it("restores the original History methods across install, cleanup and remount", () => {
    const events = new EventTarget();
    const location = { href: "https://qore.test/forms/form-1" };
    const history = {
      state: { __NA: true },
      go: vi.fn(),
      pushState(data: unknown, _unused: string, url?: string | URL | null) {
        this.state = data as { __NA: boolean };
        if (url) location.href = String(url);
      },
      replaceState(data: unknown, _unused: string, url?: string | URL | null) {
        this.state = data as { __NA: boolean };
        if (url) location.href = String(url);
      },
    };
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    vi.stubGlobal("window", {
      history,
      location,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      setTimeout: vi.fn(() => 1),
    });

    const firstCleanup = installNavigationGuardRuntime();
    expect(history.pushState).not.toBe(originalPushState);
    expect(history.replaceState).not.toBe(originalReplaceState);
    firstCleanup();
    expect(history.pushState).toBe(originalPushState);
    expect(history.replaceState).toBe(originalReplaceState);

    const secondCleanup = installNavigationGuardRuntime();
    secondCleanup();
    expect(history.pushState).toBe(originalPushState);
    expect(history.replaceState).toBe(originalReplaceState);
  });
});
