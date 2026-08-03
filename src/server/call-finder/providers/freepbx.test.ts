import { InteractionDirection, InteractionProvider } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  type FreePbxAdapterConfig,
  FreePbxCallSourceAdapter,
  loadFreePbxAdapterConfig,
  parseFreePbxCdrHtml,
} from "./freepbx";

const config: FreePbxAdapterConfig = {
  instanceKey: "parker-davis",
  baseUrl: "https://pbx.example.test/",
  allowedHosts: ["pbx.example.test"],
  username: "server-user",
  password: "server-password",
  timeZone: "America/New_York",
  pageSize: 5_000,
};

const callEpoch = Math.floor(new Date("2026-07-31T14:46:00.000Z").getTime() / 1_000);

function cdrHtml() {
  return `
    <html><body>
      <h1>CDR Reports</h1>
      <table id="cdr_table"><tbody>
        <tr><th>Call Date</th></tr>
        <tr>
          <td>Fri, Jul 31, 2026 10:46 AM</td>
          <td><a href="/admin/config.php?display=cdr&amp;action=download_audio&amp;cdr_file=${callEpoch}.101">audio</a></td>
          <td>${callEpoch}.101</td><td>"Customer" &lt;15550100001&gt;</td><td></td>
          <td>18005550100</td><td>Dial</td><td>4141</td><td>ANSWERED</td><td>00:05:00</td>
          <td></td><td></td>
        </tr>
        <tr>
          <td>Fri, Jul 31, 2026 10:40 AM</td>
          <td><a href="/admin/config.php?display=cdr&amp;action=download_audio&amp;cdr_file=${callEpoch - 360}.202">audio</a></td>
          <td>${callEpoch - 360}.202</td><td>"Agent" &lt;4154&gt;</td><td>"Parker Davis" &lt;18005550100&gt;</td>
          <td></td><td>Dial</td><td>15550100002</td><td>ANSWERED</td><td>00:01:04</td>
          <td></td><td></td>
        </tr>
        <tr>
          <td>Fri, Jul 31, 2026 10:39 AM</td><td></td><td>${callEpoch - 420}.303</td>
          <td>"Customer" &lt;15550100003&gt;</td><td></td><td></td><td>Queue</td><td>4140</td>
          <td>ANSWERED</td><td>00:02:00</td><td></td><td></td>
        </tr>
        <tr>
          <td>Fri, Jul 31, 2026 10:38 AM</td>
          <td><a href="/admin/config.php?display=cdr&amp;action=download_audio&amp;cdr_file=${callEpoch - 480}.404">audio</a></td>
          <td>${callEpoch - 480}.404</td><td>"System" &lt;15550100004&gt;</td><td></td>
          <td></td><td>Dial</td><td>15550100005</td><td>ANSWERED</td><td>00:01:00</td>
          <td></td><td></td>
        </tr>
      </tbody></table>
    </body></html>`;
}

describe("FreePbxCallSourceAdapter", () => {
  it("loads only an explicitly allowed HTTPS origin", () => {
    expect(
      loadFreePbxAdapterConfig({
        FREEPBX_INSTANCE_KEY: "parker-davis",
        FREEPBX_BASE_URL: "https://pbx.example.test/",
        FREEPBX_ALLOWED_HOSTS: "pbx.example.test",
        FREEPBX_USERNAME: "user",
        FREEPBX_PASSWORD: "secret",
      }),
    ).toEqual(expect.objectContaining({ baseUrl: "https://pbx.example.test/" }));

    expect(() =>
      loadFreePbxAdapterConfig({
        FREEPBX_INSTANCE_KEY: "parker-davis",
        FREEPBX_BASE_URL: "https://attacker.example/",
        FREEPBX_ALLOWED_HOSTS: "pbx.example.test",
        FREEPBX_USERNAME: "user",
        FREEPBX_PASSWORD: "secret",
      }),
    ).toThrow("allowed HTTPS origin");
  });

  it("keeps only answered agent call legs and maps their direction", () => {
    const parsed = parseFreePbxCdrHtml(cdrHtml(), {
      instanceKey: "parker-davis",
      externalCampaignId: "parker-davis",
      baseUrl: config.baseUrl,
    });

    expect(parsed.calls).toHaveLength(2);
    expect(parsed.calls[0]).toEqual(
      expect.objectContaining({
        provider: InteractionProvider.FREEPBX,
        providerAgentId: "4141",
        providerAgentName: "Extension 4141",
        providerRecordingId: `${callEpoch}.101`,
        direction: InteractionDirection.INBOUND,
        phoneNumber: "15550100001",
        durationSeconds: 300,
      }),
    );
    expect(parsed.calls[1]).toEqual(
      expect.objectContaining({
        providerAgentId: "4154",
        direction: InteractionDirection.OUTBOUND,
        phoneNumber: "15550100002",
        durationSeconds: 64,
      }),
    );
  });

  it("authenticates server-side and never includes credentials in the CDR request", async () => {
    const loginHtml = '<form><input name="username"><input name="password"></form>';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(loginHtml, { headers: { "set-cookie": "freepbx=session-one; Path=/" } }),
      )
      .mockResolvedValueOnce(new Response("<h1>CDR Reports</h1>"))
      .mockResolvedValueOnce(new Response(cdrHtml()));
    const adapter = new FreePbxCallSourceAdapter(config, fetchMock);

    const page = await adapter.searchCalls({
      externalCampaignIds: ["parker-davis"],
      startedFrom: new Date("2026-07-31T00:00:00.000Z"),
      startedTo: new Date("2026-08-01T00:00:00.000Z"),
    });

    expect(page.calls).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const loginBody = String(fetchMock.mock.calls[1]?.[1]?.body);
    expect(loginBody).toContain("username=server-user");
    expect(loginBody).toContain("password=server-password");
    const reportBody = String(fetchMock.mock.calls[2]?.[1]?.body);
    expect(reportBody).not.toContain("server-user");
    expect(reportBody).not.toContain("server-password");
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get("cookie")).toContain(
      "freepbx=session-one",
    );
  });

  it("downloads a validated recording through the authenticated CDR endpoint", async () => {
    const wave = new Uint8Array([82, 73, 70, 70]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("<h1>CDR Reports</h1>"))
      .mockResolvedValueOnce(
        new Response(wave, {
          headers: {
            "content-type": "application/octet-stream",
            "content-disposition": 'attachment; filename="call.wav"',
          },
        }),
      );
    const adapter = new FreePbxCallSourceAdapter(config, fetchMock);

    const response = await adapter.fetchRecording({
      providerInteractionId: `${callEpoch}.101`,
      providerRecordingId: `${callEpoch}.101`,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    const requested = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(requested.origin).toBe("https://pbx.example.test");
    expect(requested.searchParams.get("cdr_file")).toBe(`${callEpoch}.101`);
  });

  it("rejects untrusted login redirects before forwarding credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('<input name="username"><input name="password">'))
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://attacker.example/" } }),
      );
    const adapter = new FreePbxCallSourceAdapter(config, fetchMock);

    await expect(
      adapter.searchCalls({
        externalCampaignIds: ["parker-davis"],
        startedFrom: new Date("2026-07-31T00:00:00.000Z"),
        startedTo: new Date("2026-08-01T00:00:00.000Z"),
      }),
    ).rejects.toThrow("untrusted URL");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
