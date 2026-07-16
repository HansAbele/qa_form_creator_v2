export const APP_NAVIGATION_REQUEST_EVENT = "qore:app-navigation-request";

export type AppNavigationRequestDetail = {
  allowed: boolean;
};

export type AppNavigationRequestEvent = CustomEvent<AppNavigationRequestDetail>;

let allowNextDocumentUnload = false;

/** Allows exactly one imminent document unload after the app already confirmed it. */
export function permitNextDocumentUnload() {
  if (typeof window === "undefined") return;
  allowNextDocumentUnload = true;
  window.setTimeout(() => {
    allowNextDocumentUnload = false;
  }, 1_000);
}

export function consumeDocumentUnloadPermission(): boolean {
  if (!allowNextDocumentUnload) return false;
  allowNextDocumentUnload = false;
  return true;
}

/** Gives the active screen a synchronous opportunity to veto an in-app navigation. */
export function requestAppNavigation({ documentUnload = false } = {}): boolean {
  if (typeof window === "undefined") return true;

  const detail: AppNavigationRequestDetail = { allowed: true };
  window.dispatchEvent(
    new CustomEvent<AppNavigationRequestDetail>(APP_NAVIGATION_REQUEST_EVENT, { detail }),
  );
  if (detail.allowed && documentUnload) permitNextDocumentUnload();
  return detail.allowed;
}
