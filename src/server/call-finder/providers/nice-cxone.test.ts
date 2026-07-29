import { InteractionDirection } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadNiceCxoneAdapterConfig, NiceCxoneCallSourceAdapter } from "./nice-cxone";

const config = {
  instanceKey: "hapusa",
  apiBaseUrl: "https://api-na1.niceincontact.com",
  mediaBaseUrl: "https://na1.nice-incontact.com",
  scopeField: "campaign" as const,
  pageSize: 1,
  recordingMode: "media-playback" as const,
};

const legacyConfig = {
  ...config,
  recordingMode: "legacy-acd" as const,
  legacyFilesApiVersion: "v34.0",
};

const searchInput = {
  externalCampaignIds: ["campaign-10"],
  startedFrom: new Date("2026-07-20T00:00:00.000Z"),
  startedTo: new Date("2026-07-21T00:00:00.000Z"),
};

function contactResponse() {
  return {
    totalRecords: 2,
    completedContacts: [
      {
        contactId: 101,
        masterContactId: 100,
        agentId: 20,
        firstName: "John",
        lastName: "Smith",
        campaignId: "campaign-10",
        campaignName: "HAPUSA",
        skillId: 30,
        skillName: "Customer Service",
        teamId: 40,
        teamName: "Support",
        primaryDispositionId: 50,
        secondaryDispositionId: null,
        isOutbound: false,
        isLogged: true,
        fromAddr: "+15550101",
        toAddr: "+18005550100",
        contactStart: "2026-07-20T12:00:00.000Z",
        totalDurationSeconds: 180.4,
        holdCount: 1,
        holdSeconds: 12,
        mediaType: 4,
        mediaTypeName: "Phone Call",
        pointOfContactId: 60,
        pointOfContactName: "Support Line",
        transferIndicatorId: null,
        transferIndicatorName: null,
        endReason: "Completed",
      },
    ],
  };
}

function waveBytes(data = [1, 2, 3, 4]) {
  const bytes = new Uint8Array(44 + data.length);
  const view = new DataView(bytes.buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + data.length, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 7, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8_000, true);
  view.setUint32(28, 8_000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeText(36, "data");
  view.setUint32(40, data.length, true);
  bytes.set(data, 44);
  return bytes;
}

function legacyMetadata(fileName: string, size: number) {
  return {
    files: [
      {
        isDeleted: false,
        weblink: false,
        fileName: "notes.txt",
        fullFileName: "Notes\\101.txt",
        purposeName: "Other",
        size: 20,
      },
      {
        isDeleted: false,
        weblink: false,
        fileName,
        fullFileName: `CallLog\\${fileName}`,
        purposeName: "CallLog",
        size,
        modifiedDate: "2026-07-21T13:00:00.000Z",
      },
      {
        isDeleted: true,
        weblink: false,
        fileName: "deleted.wav",
        fullFileName: "CallLog\\deleted.wav",
        purposeName: "CallLog",
        size: size + 100,
      },
    ],
  };
}

describe("NiceCxoneCallSourceAdapter", () => {
  const tokenProvider = {
    getAccessToken: vi.fn(),
    invalidate: vi.fn(),
  };

  beforeEach(() => {
    tokenProvider.getAccessToken.mockReset().mockResolvedValue("bearer-token");
    tokenProvider.invalidate.mockReset();
  });

  it("should configure legacy ACD recording retrieval without a Media Playback base URL", () => {
    expect(
      loadNiceCxoneAdapterConfig({
        NICE_CXONE_INSTANCE_KEY: "hapusa",
        NICE_CXONE_API_BASE_URL: "https://api-na1.niceincontact.com",
        NICE_CXONE_RECORDING_MODE: "legacy-acd",
      }),
    ).toEqual(
      expect.objectContaining({
        recordingMode: "legacy-acd",
        legacyFilesApiVersion: "v34.0",
      }),
    );
  });

  it("should reject an invalid legacy Admin API version", () => {
    expect(() =>
      loadNiceCxoneAdapterConfig({
        NICE_CXONE_INSTANCE_KEY: "hapusa",
        NICE_CXONE_API_BASE_URL: "https://api-na1.niceincontact.com",
        NICE_CXONE_ADMIN_API_VERSION: "34",
      }),
    ).toThrow("vNN.0 format");
  });

  it("should normalize completed contacts without exposing provider response objects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(contactResponse()));
    const adapter = new NiceCxoneCallSourceAdapter(config, tokenProvider, fetchMock);

    const page = await adapter.searchCalls(searchInput);

    expect(page).toEqual({
      calls: [
        expect.objectContaining({
          providerInstance: "hapusa",
          providerInteractionId: "101",
          providerRecordingId: "100",
          providerCampaignId: "campaign-10",
          providerAgentId: "20",
          providerAgentName: "John Smith",
          dispositionCode: "50",
          direction: InteractionDirection.INBOUND,
          phoneNumber: "+15550101",
          queueName: "Customer Service",
          durationSeconds: 180,
          hasRecording: true,
        }),
      ],
      nextCursor: "1",
    });
    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestedUrl.searchParams.get("skip")).toBe("0");
  });

  it("should filter calls outside the configured external campaign scope", async () => {
    const response = contactResponse();
    response.completedContacts[0].campaignId = "campaign-other";
    const adapter = new NiceCxoneCallSourceAdapter(
      config,
      tokenProvider,
      vi.fn().mockResolvedValue(Response.json(response)),
    );

    await expect(adapter.searchCalls(searchInput)).resolves.toEqual({ calls: [], nextCursor: "1" });
  });

  it("should resolve a trusted temporary voice recording URL", async () => {
    const recording = new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "video/mp4" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          redirectUrl:
            "https://recordings.s3.us-west-2.amazonaws.com/call.mp4?X-Amz-Signature=signed",
        }),
      )
      .mockResolvedValueOnce(recording);
    const adapter = new NiceCxoneCallSourceAdapter(config, tokenProvider, fetchMock);

    await expect(
      adapter.fetchRecording({ providerInteractionId: "101", providerRecordingId: "100" }),
    ).resolves.toBe(recording);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("acd-call-id=100");
    expect(fetchMock.mock.calls[1]?.[1]).not.toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.anything() }),
      }),
    );
  });

  it("should reject temporary media URLs outside trusted provider hosts", async () => {
    const adapter = new NiceCxoneCallSourceAdapter(
      config,
      tokenProvider,
      vi
        .fn()
        .mockResolvedValue(Response.json({ redirectUrl: "https://attacker.example/call.mp4" })),
    );

    await expect(
      adapter.fetchRecording({ providerInteractionId: "101", providerRecordingId: "100" }),
    ).rejects.toThrow("untrusted media URL");
  });

  it("should retrieve the CallLog WAV through the legacy Admin file APIs", async () => {
    const wave = waveBytes();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(legacyMetadata("101.wav", wave.byteLength)))
      .mockResolvedValueOnce(
        Response.json({
          files: {
            file: Buffer.from(wave).toString("base64"),
            fileName: "CallLog\\101.wav",
          },
        }),
      );
    const adapter = new NiceCxoneCallSourceAdapter(legacyConfig, tokenProvider, fetchMock);

    const response = await adapter.fetchRecording({
      providerInteractionId: "101",
      providerRecordingId: "100",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("content-length")).toBe(String(wave.byteLength));
    await expect(response.arrayBuffer()).resolves.toEqual(wave.buffer);

    const metadataUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(metadataUrl.pathname).toBe("/incontactapi/services/v34.0/contacts/101/files");
    const fileUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(fileUrl.pathname).toBe("/incontactapi/services/v34.0/files");
    expect(fileUrl.searchParams.get("fileName")).toBe("CallLog\\101.wav");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer bearer-token" }),
      }),
    );
  });

  it("should return not found when the contact has no active CallLog WAV", async () => {
    const adapter = new NiceCxoneCallSourceAdapter(
      legacyConfig,
      tokenProvider,
      vi.fn().mockResolvedValue(Response.json({ files: [] })),
    );

    const response = await adapter.fetchRecording({ providerInteractionId: "101" });
    expect(response.status).toBe(404);
  });

  it("should convert a pending contact-file response into recording not found", async () => {
    const adapter = new NiceCxoneCallSourceAdapter(
      legacyConfig,
      tokenProvider,
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );

    const response = await adapter.fetchRecording({ providerInteractionId: "101" });
    expect(response.status).toBe(404);
  });

  it("should reject oversized CallLog metadata before requesting its Base64 payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(legacyMetadata("101.wav", 49)));
    const adapter = new NiceCxoneCallSourceAdapter(
      { ...legacyConfig, maxLegacyRecordingBytes: 48 },
      tokenProvider,
      fetchMock,
    );

    const response = await adapter.fetchRecording({ providerInteractionId: "101" });
    expect(response.status).toBe(413);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("should reject malformed or non-WAV legacy file content", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(legacyMetadata("101.wav", 44)))
      .mockResolvedValueOnce(Response.json({ files: { file: "not-base64", fileName: "101.wav" } }));
    const adapter = new NiceCxoneCallSourceAdapter(legacyConfig, tokenProvider, fetchMock);

    await expect(adapter.fetchRecording({ providerInteractionId: "101" })).resolves.toMatchObject({
      status: 502,
    });
  });

  it("should reject valid Base64 when the decoded payload is not a WAV recording", async () => {
    const bytes = new Uint8Array(44).fill(1);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(legacyMetadata("101.wav", bytes.byteLength)))
      .mockResolvedValueOnce(
        Response.json({
          files: { file: Buffer.from(bytes).toString("base64"), fileName: "101.wav" },
        }),
      );
    const adapter = new NiceCxoneCallSourceAdapter(legacyConfig, tokenProvider, fetchMock);

    const response = await adapter.fetchRecording({ providerInteractionId: "101" });
    expect(response.status).toBe(502);
  });

  it("should reject a non-numeric contact ID without contacting NICE", async () => {
    const fetchMock = vi.fn();
    const adapter = new NiceCxoneCallSourceAdapter(legacyConfig, tokenProvider, fetchMock);

    await expect(
      adapter.fetchRecording({ providerInteractionId: "../CallLog/101.wav" }),
    ).rejects.toThrow("Invalid NICE CXone contact ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should preserve provider authorization failures without exposing their response body", async () => {
    const adapter = new NiceCxoneCallSourceAdapter(
      legacyConfig,
      tokenProvider,
      vi.fn().mockResolvedValue(Response.json({ secret: "provider detail" }, { status: 403 })),
    );

    const response = await adapter.fetchRecording({ providerInteractionId: "101" });
    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("");
  });

  it("should refresh authentication when the legacy file request returns 401", async () => {
    const wave = waveBytes();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(legacyMetadata("101.wav", wave.byteLength)))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({
          files: { file: Buffer.from(wave).toString("base64"), fileName: "101.wav" },
        }),
      );
    const adapter = new NiceCxoneCallSourceAdapter(legacyConfig, tokenProvider, fetchMock);

    await expect(adapter.fetchRecording({ providerInteractionId: "101" })).resolves.toMatchObject({
      status: 200,
    });
    expect(tokenProvider.invalidate).toHaveBeenCalledOnce();
    expect(tokenProvider.getAccessToken).toHaveBeenLastCalledWith({ forceRefresh: true });
  });

  it("should invalidate and refresh the token once after an unauthorized response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json(contactResponse()));
    const adapter = new NiceCxoneCallSourceAdapter(config, tokenProvider, fetchMock);

    await expect(adapter.searchCalls(searchInput)).resolves.toEqual(
      expect.objectContaining({ calls: expect.any(Array) }),
    );
    expect(tokenProvider.invalidate).toHaveBeenCalledOnce();
    expect(tokenProvider.getAccessToken).toHaveBeenLastCalledWith({ forceRefresh: true });
  });
});
