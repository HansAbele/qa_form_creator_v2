import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_NAVIGATION_REQUEST_EVENT,
  type AppNavigationRequestEvent,
  consumeDocumentUnloadPermission,
  permitNextDocumentUnload,
  requestAppNavigation,
} from "./navigation-guard";

describe("requestAppNavigation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows navigation during server rendering", () => {
    vi.stubGlobal("window", undefined);

    expect(requestAppNavigation()).toBe(true);
  });

  it("allows navigation when the active screen does not veto it", () => {
    const events = new EventTarget();
    vi.stubGlobal("window", {
      dispatchEvent: events.dispatchEvent.bind(events),
    });

    expect(requestAppNavigation()).toBe(true);
  });

  it("returns false when an active screen vetoes navigation", () => {
    const events = new EventTarget();
    events.addEventListener(APP_NAVIGATION_REQUEST_EVENT, (event) => {
      (event as AppNavigationRequestEvent).detail.allowed = false;
    });
    vi.stubGlobal("window", {
      dispatchEvent: events.dispatchEvent.bind(events),
    });

    expect(requestAppNavigation()).toBe(false);
  });

  it("permits exactly one document unload after an approved custom confirmation", () => {
    const events = new EventTarget();
    vi.stubGlobal("window", {
      dispatchEvent: events.dispatchEvent.bind(events),
      setTimeout: vi.fn(),
    });

    expect(requestAppNavigation({ documentUnload: true })).toBe(true);
    expect(consumeDocumentUnloadPermission()).toBe(true);
    expect(consumeDocumentUnloadPermission()).toBe(false);
  });

  it("does not permit unload when the active screen vetoes navigation", () => {
    const events = new EventTarget();
    events.addEventListener(APP_NAVIGATION_REQUEST_EVENT, (event) => {
      (event as AppNavigationRequestEvent).detail.allowed = false;
    });
    vi.stubGlobal("window", {
      dispatchEvent: events.dispatchEvent.bind(events),
      setTimeout: vi.fn(),
    });

    expect(requestAppNavigation({ documentUnload: true })).toBe(false);
    expect(consumeDocumentUnloadPermission()).toBe(false);
  });

  it("can explicitly permit the unload after an async logout request finishes", () => {
    vi.stubGlobal("window", { setTimeout: vi.fn() });

    permitNextDocumentUnload();

    expect(consumeDocumentUnloadPermission()).toBe(true);
  });
});
