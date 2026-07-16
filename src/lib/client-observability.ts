type ClientErrorPayload = {
  source: "client-runtime" | "client-boundary";
  name?: string;
  message: string;
  digest?: string;
  stack?: string;
  path?: string;
};

export function reportClientError(payload: ClientErrorPayload) {
  try {
    const body = JSON.stringify({
      ...payload,
      message: payload.message.slice(0, 1_000),
      stack: payload.stack?.slice(0, 4_000),
      path: payload.path ?? window.location.pathname,
    });
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon("/api/observability/client-error", blob)) return;

    void fetch("/api/observability/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => undefined);
  } catch {
    // Monitoring must never interfere with the user flow.
  }
}
