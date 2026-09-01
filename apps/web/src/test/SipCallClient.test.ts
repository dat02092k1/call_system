import { describe, expect, it, vi } from "vitest";
import {
  readSipCallConfig,
  SipCallClient,
} from "../asterisk/SipCallClient";
import type {
  SipCallState,
  SipUser,
  SipUserFactory,
  SipUserOptions,
} from "../asterisk/sipTypes";

function harness() {
  const states: SipCallState[] = [];
  const remoteAudio = document.createElement("audio");
  const pause = vi.spyOn(remoteAudio, "pause").mockImplementation(() => undefined);
  let capturedOptions: SipUserOptions | undefined;
  const user: SipUser = {
    connect: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
    call: vi.fn().mockResolvedValue(undefined),
    hangup: vi.fn().mockResolvedValue(undefined),
    unregister: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  const factory: SipUserFactory = (_server, options) => {
    capturedOptions = options;
    return user;
  };
  const client = new SipCallClient(
    {
      server: "ws://localhost:8088/ws",
      domain: "localhost",
      extension: "2001",
      password: "demo2001",
      destination: "1000",
      timeoutMs: 5000,
    },
    remoteAudio,
    (state) => states.push(state),
    factory,
  );
  return {
    client,
    user,
    states,
    remoteAudio,
    pause,
    options: () => {
      if (!capturedOptions) throw new Error("SIP options were not captured");
      return capturedOptions;
    },
  };
}

describe("SipCallClient", () => {
  it("registers and calls extension 1000", async () => {
    const { client, user, states, options } = harness();

    await client.start("Nguyen Van A");

    expect(user.connect).toHaveBeenCalledOnce();
    expect(user.register).toHaveBeenCalledOnce();
    expect(user.call).toHaveBeenCalledWith("sip:1000@localhost");
    expect(options().aor).toBe("sip:2001@localhost");
    expect(options().media.remote.audio).toBeInstanceOf(HTMLAudioElement);
    expect(states.map((state) => state.status)).toEqual([
      "registering",
      "calling",
    ]);

    options().delegate.onCallAnswered?.();

    expect(states.at(-1)).toEqual({ status: "active" });
  });

  it("hangs up, unregisters, disconnects, and detaches remote media", async () => {
    const { client, user, remoteAudio, states, pause } = harness();

    await client.start("Nguyen Van A");
    await client.hangup();
    await client.hangup();

    expect(user.hangup).toHaveBeenCalledOnce();
    expect(user.unregister).toHaveBeenCalledOnce();
    expect(user.disconnect).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledOnce();
    expect(remoteAudio.srcObject).toBeNull();
    expect(states.at(-1)).toEqual({ status: "ended" });
  });

  it("maps registration failure to a concise Vietnamese error", async () => {
    const { client, user, states } = harness();
    vi.mocked(user.register).mockRejectedValueOnce(new Error("403 Forbidden"));

    await client.start("Nguyen Van A");

    expect(states.at(-1)).toEqual({
      status: "failed",
      message: "Asterisk từ chối đăng ký máy nhánh 2001.",
    });
  });

  it("does not report a failed state after an intentional disconnect", async () => {
    const { client, states, options } = harness();
    await client.start("Nguyen Van A");
    await client.hangup();

    options().delegate.onServerDisconnect?.(new Error("network disconnected"));

    expect(states.at(-1)).toEqual({ status: "ended" });
  });

  it("reports an unexpected errorless server disconnect as failed", async () => {
    const { client, states, options } = harness();
    await client.start("Nguyen Van A");

    options().delegate.onServerDisconnect?.();

    expect(states.at(-1)).toEqual({
      status: "failed",
      message: "Không thể kết nối cuộc gọi qua Asterisk.",
    });
  });

  it("continues stalled cleanup and detaches media", async () => {
    vi.useFakeTimers();
    try {
      const { client, user, remoteAudio, pause, states } = harness();
      vi.mocked(user.hangup).mockImplementation(
        () => new Promise<void>(() => undefined),
      );

      await client.start("Nguyen Van A");
      void client.hangup();
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.runAllTimersAsync();

      expect(user.unregister).toHaveBeenCalledOnce();
      expect(user.disconnect).toHaveBeenCalledOnce();
      expect(pause).toHaveBeenCalledOnce();
      expect(remoteAudio.srcObject).toBeNull();
      expect(states.at(-1)).toEqual({ status: "ended" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a late answer callback after hangup", async () => {
    const { client, states, options } = harness();
    await client.start("Nguyen Van A");
    await client.hangup();

    options().delegate.onCallAnswered?.();

    expect(states.at(-1)).toEqual({ status: "ended" });
  });
});

describe("readSipCallConfig", () => {
  it("reads and trims browser Asterisk configuration", () => {
    expect(
      readSipCallConfig({
        VITE_ASTERISK_WS_URL: " ws://localhost:8088/ws ",
        VITE_ASTERISK_DOMAIN: " localhost ",
        VITE_ASTERISK_EXTENSION: " 2001 ",
        VITE_ASTERISK_PASSWORD: "demo2001",
        VITE_ASTERISK_DESTINATION: " 1000 ",
      }),
    ).toEqual({
      server: "ws://localhost:8088/ws",
      domain: "localhost",
      extension: "2001",
      password: "demo2001",
      destination: "1000",
      timeoutMs: 8000,
    });
  });

  it("rejects missing browser Asterisk configuration", () => {
    expect(() =>
      readSipCallConfig({
        VITE_ASTERISK_WS_URL: "ws://localhost:8088/ws",
        VITE_ASTERISK_DOMAIN: "localhost",
        VITE_ASTERISK_EXTENSION: "2001",
        VITE_ASTERISK_PASSWORD: "",
        VITE_ASTERISK_DESTINATION: "1000",
      }),
    ).toThrow("Missing browser Asterisk configuration: VITE_ASTERISK_PASSWORD");
  });
});
