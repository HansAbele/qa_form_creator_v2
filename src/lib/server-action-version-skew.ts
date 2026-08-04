const RELOAD_KEY = "qore:server-action-version-skew-reload";
const RELOAD_COOLDOWN_MS = 60_000;

type RecoveryOptions = {
  reload?: () => void;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  now?: () => number;
};

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

export function isServerActionVersionSkewError(error: unknown) {
  const message = errorText(error);
  return (
    /failed to find server action/i.test(message) ||
    /server action ["'][a-f0-9]+["'] was not found on the server/i.test(message) ||
    /request might be from an older or newer deployment/i.test(message)
  );
}

/**
 * Recovers stale browser tabs after a deployment. The cooldown prevents a
 * persistent server problem from creating a reload loop.
 */
export function recoverFromServerActionVersionSkew(error: unknown, options: RecoveryOptions = {}) {
  if (!isServerActionVersionSkewError(error)) return false;

  const browserWindow = typeof window === "undefined" ? null : window;
  const reload = options.reload ?? (() => browserWindow?.location.reload());
  const storage = options.storage ?? browserWindow?.sessionStorage ?? null;
  const now = (options.now ?? Date.now)();
  const previousReload = Number(storage?.getItem(RELOAD_KEY) ?? 0);

  if (Number.isFinite(previousReload) && now - previousReload < RELOAD_COOLDOWN_MS) {
    return false;
  }

  storage?.setItem(RELOAD_KEY, String(now));
  reload();
  return true;
}
