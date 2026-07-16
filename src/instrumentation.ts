import type { Instrumentation } from "next";

export function register() {
  // Reserved for runtime-specific providers. Structured logging is initialized on import.
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "edge") {
    console.error("Server request error", {
      path: request.path.split("?")[0],
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
    });
    return;
  }

  const { reportOperationalError } = await import("@/lib/observability");
  const normalized = error instanceof Error ? error : new Error(String(error));
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String(error.digest)
      : undefined;

  await reportOperationalError({
    source: "next-server",
    name: normalized.name,
    message: normalized.message,
    stack: normalized.stack,
    digest,
    path: request.path,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    metadata: {
      routerKind: context.routerKind,
      renderSource: context.renderSource,
      renderType:
        "renderType" in context && typeof context.renderType === "string"
          ? context.renderType
          : null,
      revalidateReason: context.revalidateReason ?? null,
    },
  });
};
