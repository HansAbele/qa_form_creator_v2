"use client";

import { useEffect } from "react";
import { requestAppNavigation } from "@/lib/navigation-guard";

const HISTORY_INDEX_KEY = "__qoreHistoryIndex";

type HistoryMarker = {
  epoch: string;
  index: number;
};

type NavigationApi = {
  currentEntry?: { index: number } | null;
};

function getHistoryMarker(state: unknown): HistoryMarker | null {
  if (!state || typeof state !== "object") return null;
  const marker = (state as Record<string, unknown>)[HISTORY_INDEX_KEY];
  if (!marker || typeof marker !== "object") return null;
  const { epoch, index } = marker as Record<string, unknown>;
  return typeof epoch === "string" && typeof index === "number" && Number.isFinite(index)
    ? { epoch, index }
    : null;
}

function withHistoryMarker(state: unknown, marker: HistoryMarker) {
  const source = state && typeof state === "object" ? state : {};
  return { ...source, [HISTORY_INDEX_KEY]: marker };
}

export function resolveHistoryTraversalDelta(input: {
  currentMarker: HistoryMarker;
  targetMarker: HistoryMarker | null;
  currentNativeIndex: number | null;
  targetNativeIndex: number | null;
}): number | null {
  if (input.targetMarker?.epoch === input.currentMarker.epoch) {
    return input.targetMarker.index - input.currentMarker.index;
  }
  if (input.targetNativeIndex !== null && input.currentNativeIndex !== null) {
    return input.targetNativeIndex - input.currentNativeIndex;
  }
  return null;
}

/**
 * Installs after Next's App Router history wrapper and returns an exact cleanup. Exported so
 * mount/unmount/remount behavior can be verified without rendering the application.
 */
export function installNavigationGuardRuntime() {
  const originalPushState = window.history.pushState;
  const originalReplaceState = window.history.replaceState;
  const navigationApi = (window as Window & { navigation?: NavigationApi }).navigation;
  const historyEpoch = crypto.randomUUID();
  let currentMarker: HistoryMarker = { epoch: historyEpoch, index: 0 };
  let currentNativeIndex = navigationApi?.currentEntry?.index ?? null;
  let currentEntryState = window.history.state;
  let currentEntryUrl = window.location.href;
  let restoringTraversal = false;

  originalReplaceState.call(
    window.history,
    withHistoryMarker(window.history.state, currentMarker),
    "",
    window.location.href,
  );
  currentEntryState = window.history.state;

  const syncCurrentEntry = () => {
    currentNativeIndex = navigationApi?.currentEntry?.index ?? currentNativeIndex;
    currentEntryState = window.history.state;
    currentEntryUrl = window.location.href;
  };

  const patchedPushState: History["pushState"] = (data, unused, url) => {
    const nextMarker = { epoch: historyEpoch, index: currentMarker.index + 1 };
    const result = originalPushState.call(
      window.history,
      withHistoryMarker(data, nextMarker),
      unused,
      url,
    );
    currentMarker = nextMarker;
    syncCurrentEntry();
    return result;
  };
  const patchedReplaceState: History["replaceState"] = (data, unused, url) => {
    const result = originalReplaceState.call(
      window.history,
      withHistoryMarker(data, currentMarker),
      unused,
      url,
    );
    syncCurrentEntry();
    return result;
  };

  window.history.pushState = patchedPushState;
  window.history.replaceState = patchedReplaceState;

  const guardHistoryTraversal = (event: PopStateEvent) => {
    const targetMarker = getHistoryMarker(event.state);
    const targetNativeIndex = navigationApi?.currentEntry?.index ?? null;

    if (restoringTraversal) {
      restoringTraversal = false;
      if (targetMarker?.epoch === currentMarker.epoch) currentMarker = targetMarker;
      currentNativeIndex = targetNativeIndex;
      currentEntryState = event.state;
      currentEntryUrl = window.location.href;
      return;
    }

    const delta = resolveHistoryTraversalDelta({
      currentMarker,
      targetMarker,
      currentNativeIndex,
      targetNativeIndex,
    });

    if ((delta === null || delta !== 0) && !requestAppNavigation()) {
      event.stopImmediatePropagation();
      if (delta === null) {
        // An unindexed same-document entry can only predate this root runtime. Restore the
        // current Next tree in a new entry; this sacrifices forward history but not user data.
        window.history.pushState(currentEntryState, "", currentEntryUrl);
        return;
      }

      restoringTraversal = true;
      window.history.go(-delta);
      window.setTimeout(() => {
        restoringTraversal = false;
      }, 1_000);
      return;
    }

    if (targetMarker?.epoch === currentMarker.epoch) {
      currentMarker = targetMarker;
    } else if (delta !== null) {
      currentMarker = { ...currentMarker, index: currentMarker.index + delta };
    }
    currentNativeIndex = targetNativeIndex;
    currentEntryState = event.state;
    currentEntryUrl = window.location.href;
  };

  window.addEventListener("popstate", guardHistoryTraversal, true);
  return () => {
    window.removeEventListener("popstate", guardHistoryTraversal, true);
    if (window.history.pushState === patchedPushState) {
      window.history.pushState = originalPushState;
    }
    if (window.history.replaceState === patchedReplaceState) {
      window.history.replaceState = originalReplaceState;
    }
  };
}

/** Root-persistent Back/Forward guard. */
export function NavigationGuardRuntime() {
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    // Child effects can run before Next's App Router effect. Deferring one task guarantees
    // that we wrap Next (and can later restore it) instead of Next retaining our wrapper.
    const installTimer = window.setTimeout(() => {
      cleanup = installNavigationGuardRuntime();
    }, 0);

    return () => {
      window.clearTimeout(installTimer);
      cleanup?.();
    };
  }, []);

  return null;
}
