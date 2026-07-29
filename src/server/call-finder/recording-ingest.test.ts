import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { InteractionProvider } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { persistRecordingResponse } from "./recording-ingest";

let temporaryRoot: string;
let previousStorageRoot: string | undefined;
let previousMaximumBytes: string | undefined;

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "qore-recordings-"));
  previousStorageRoot = process.env.RECORDING_STORAGE_ROOT;
  previousMaximumBytes = process.env.MAX_RECORDING_BYTES;
  process.env.RECORDING_STORAGE_ROOT = temporaryRoot;
  delete process.env.MAX_RECORDING_BYTES;
});

afterEach(async () => {
  if (previousStorageRoot === undefined) delete process.env.RECORDING_STORAGE_ROOT;
  else process.env.RECORDING_STORAGE_ROOT = previousStorageRoot;
  if (previousMaximumBytes === undefined) delete process.env.MAX_RECORDING_BYTES;
  else process.env.MAX_RECORDING_BYTES = previousMaximumBytes;
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe("persistRecordingResponse", () => {
  it("should stream an allowed recording into a tenant-neutral private key", async () => {
    const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
    const stored = await persistRecordingResponse({
      response: new Response(bytes, {
        headers: {
          "content-type": "audio/wav; charset=binary",
          "content-disposition": 'attachment; filename="contact-101.wav"',
        },
      }),
      provider: InteractionProvider.NICE_CXONE,
      providerInstance: "HAPUSA Main",
      interactionId: "interaction-1",
      startedAt: new Date("2026-07-20T12:00:00.000Z"),
    });

    expect(stored).toEqual(
      expect.objectContaining({
        originalFileName: "contact-101.wav",
        mimeType: "audio/wav",
        byteSize: BigInt(8),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }),
    );
    expect(stored.storageKey).toMatch(
      /^nice_cxone\/hapusa-main\/2026\/07\/interaction-1-[a-f0-9]{16}\.wav$/,
    );
    await expect(
      readFile(path.join(temporaryRoot, ...stored.storageKey.split("/"))),
    ).resolves.toEqual(Buffer.from(bytes));
  });

  it("should reject oversized streamed responses and remove the staging file", async () => {
    process.env.MAX_RECORDING_BYTES = "3";

    await expect(
      persistRecordingResponse({
        response: new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { "content-type": "audio/wav" },
        }),
        provider: InteractionProvider.NICE_CXONE,
        providerInstance: "hapusa",
        interactionId: "interaction-1",
        startedAt: new Date("2026-07-20T12:00:00.000Z"),
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "FILE_TOO_LARGE" }));

    await expect(readdir(path.join(temporaryRoot, ".staging"))).resolves.toEqual([]);
  });

  it("should reject non-audio provider responses", async () => {
    await expect(
      persistRecordingResponse({
        response: new Response("not audio", { headers: { "content-type": "text/html" } }),
        provider: InteractionProvider.NICE_CXONE,
        providerInstance: "hapusa",
        interactionId: "interaction-1",
        startedAt: new Date("2026-07-20T12:00:00.000Z"),
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "UNSUPPORTED_MEDIA" }));
  });
});
