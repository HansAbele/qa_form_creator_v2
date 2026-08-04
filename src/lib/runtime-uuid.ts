type RuntimeCrypto = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

let fallbackSequence = 0;

function fillFallbackBytes(bytes: Uint8Array) {
  fallbackSequence = (fallbackSequence + 1) >>> 0;
  let state =
    (Date.now() ^ (fallbackSequence * 0x9e3779b9) ^ Math.floor(Math.random() * 0x1_0000_0000)) >>>
    0;

  for (let index = 0; index < bytes.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }
}

function formatUuidV4(bytes: Uint8Array) {
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Generates a UUID in browsers served over HTTP as well as secure contexts.
 * UUIDs identify client operations only; authorization never relies on them.
 */
export function createRuntimeUuid(
  runtimeCrypto: RuntimeCrypto | null | undefined = globalThis.crypto as RuntimeCrypto | undefined,
) {
  if (typeof runtimeCrypto?.randomUUID === "function") {
    return runtimeCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof runtimeCrypto?.getRandomValues === "function") {
    runtimeCrypto.getRandomValues(bytes);
  } else {
    fillFallbackBytes(bytes);
  }
  return formatUuidV4(bytes);
}
