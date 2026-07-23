import { describe, expect, test, vi } from "vitest";
import {
  SIP_DISPATCH_RULE_NAME,
  SIP_LOCAL_NUMBER,
  SIP_ROOM_PREFIX,
  SIP_TRUNK_NAME,
  ensureSipResources,
  loadSipBootstrapConfig,
  retry,
  runSipBootstrap,
  type SipAdminClient,
} from "../src/sipBootstrap.js";

function createClient(): SipAdminClient {
  return {
    listSipInboundTrunk: vi.fn(),
    createSipInboundTrunk: vi.fn(),
    listSipDispatchRule: vi.fn(),
    createSipDispatchRule: vi.fn(),
  };
}

describe("ensureSipResources", () => {
  test("creates the local trunk and dispatch rule when missing", async () => {
    const client = createClient();
    vi.mocked(client.listSipInboundTrunk).mockResolvedValue([]);
    vi.mocked(client.createSipInboundTrunk).mockResolvedValue({
      sipTrunkId: "ST_test",
      name: SIP_TRUNK_NAME,
    } as never);
    vi.mocked(client.listSipDispatchRule).mockResolvedValue([]);
    vi.mocked(client.createSipDispatchRule).mockResolvedValue({
      sipDispatchRuleId: "SDR_test",
      name: SIP_DISPATCH_RULE_NAME,
    } as never);

    const result = await ensureSipResources(client);

    expect(client.createSipInboundTrunk).toHaveBeenCalledWith(
      SIP_TRUNK_NAME,
      [SIP_LOCAL_NUMBER],
    );
    expect(client.createSipDispatchRule).toHaveBeenCalledWith(
      { type: "individual", roomPrefix: SIP_ROOM_PREFIX },
      {
        name: SIP_DISPATCH_RULE_NAME,
        trunkIds: ["ST_test"],
      },
    );
    expect(result).toEqual({
      trunkId: "ST_test",
      dispatchRuleId: "SDR_test",
      trunkCreated: true,
      dispatchRuleCreated: true,
    });
  });

  test("reuses existing resources without creating duplicates", async () => {
    const client = createClient();
    vi.mocked(client.listSipInboundTrunk).mockResolvedValue([
      {
        sipTrunkId: "ST_existing",
        name: SIP_TRUNK_NAME,
      } as never,
    ]);
    vi.mocked(client.listSipDispatchRule).mockResolvedValue([
      {
        sipDispatchRuleId: "SDR_existing",
        name: SIP_DISPATCH_RULE_NAME,
        trunkIds: ["ST_existing"],
      } as never,
    ]);

    const result = await ensureSipResources(client);

    expect(client.createSipInboundTrunk).not.toHaveBeenCalled();
    expect(client.createSipDispatchRule).not.toHaveBeenCalled();
    expect(result).toEqual({
      trunkId: "ST_existing",
      dispatchRuleId: "SDR_existing",
      trunkCreated: false,
      dispatchRuleCreated: false,
    });
  });
});

describe("loadSipBootstrapConfig", () => {
  test("loads the LiveKit HTTP credentials", () => {
    expect(
      loadSipBootstrapConfig({
        LIVEKIT_HTTP_URL: "http://livekit:7880",
        LIVEKIT_API_KEY: "devkey",
        LIVEKIT_API_SECRET: "secret",
      }),
    ).toEqual({
      livekitHttpUrl: "http://livekit:7880",
      apiKey: "devkey",
      apiSecret: "secret",
    });
  });

  test("rejects a missing required value", () => {
    expect(() => loadSipBootstrapConfig({})).toThrow(
      "LIVEKIT_HTTP_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required",
    );
  });
});

describe("retry", () => {
  test("retries a failed operation and returns its result", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValue("ready");
    const sleep = vi.fn<() => Promise<void>>().mockResolvedValue();

    await expect(retry(operation, 3, sleep)).resolves.toBe("ready");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  test("throws after the final failed attempt", async () => {
    const error = new Error("still unavailable");
    const operation = vi.fn<() => Promise<void>>().mockRejectedValue(error);
    const sleep = vi.fn<() => Promise<void>>().mockResolvedValue();

    await expect(retry(operation, 2, sleep)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});

describe("runSipBootstrap", () => {
  test("creates a client from config and returns ensured resource IDs", async () => {
    const client = createClient();
    vi.mocked(client.listSipInboundTrunk).mockResolvedValue([
      {
        sipTrunkId: "ST_existing",
        name: SIP_TRUNK_NAME,
      } as never,
    ]);
    vi.mocked(client.listSipDispatchRule).mockResolvedValue([
      {
        sipDispatchRuleId: "SDR_existing",
        name: SIP_DISPATCH_RULE_NAME,
      } as never,
    ]);
    const createClientFromConfig = vi.fn(() => client);

    const result = await runSipBootstrap(
      {
        LIVEKIT_HTTP_URL: "http://livekit:7880",
        LIVEKIT_API_KEY: "devkey",
        LIVEKIT_API_SECRET: "secret",
      },
      createClientFromConfig,
    );

    expect(createClientFromConfig).toHaveBeenCalledWith({
      livekitHttpUrl: "http://livekit:7880",
      apiKey: "devkey",
      apiSecret: "secret",
    });
    expect(result.trunkId).toBe("ST_existing");
    expect(result.dispatchRuleId).toBe("SDR_existing");
  });
});
