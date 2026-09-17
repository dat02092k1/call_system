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

function harness(timeoutMs = 5000) {
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
      timeoutMs,
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

async function waitUntil(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (check()) return;
    await Promise.resolve();
  }
  throw new Error("condition was not reached");
}

function pendingPromise() {
  let resolve!: () => void;
  const promise = new Promise<void>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

async function establishCall(result: ReturnType<typeof harness>): Promise<void> {
  const starting = result.client.start("Nguyen Van A");
  await waitUntil(() => vi.mocked(result.user.register).mock.calls.length === 1);
  result.options().delegate.onRegistered?.();
  await waitUntil(() => vi.mocked(result.user.call).mock.calls.length === 1);
  result.options().delegate.onCallAnswered?.();
  await starting;
}

describe("SipCallClient", () => {
  it("waits for registered and answered lifecycle outcomes", async () => {
    const { client, user, states, options } = harness();

    const starting = client.start("Nguyen Van A");
    await waitUntil(() => vi.mocked(user.register).mock.calls.length === 1);
    await Promise.resolve();
    await Promise.resolve();

    expect(user.connect).toHaveBeenCalledOnce();
    expect(user.register).toHaveBeenCalledOnce();
    expect(user.call).not.toHaveBeenCalled();
    expect(states.map((state) => state.status)).toEqual(["registering"]);

    options().delegate.onRegistered?.();
    await waitUntil(() => vi.mocked(user.call).mock.calls.length === 1);

    expect(user.call).toHaveBeenCalledWith("sip:1000@localhost");
    expect(options().aor).toBe("sip:2001@localhost");
    expect(options().media.remote.audio).toBeInstanceOf(HTMLAudioElement);
    expect(states.map((state) => state.status)).toEqual([
      "registering",
      "calling",
    ]);

    options().delegate.onCallAnswered?.();
    await starting;

    expect(states.at(-1)).toEqual({ status: "active" });
  });

  it("fails when registration is rejected after register resolves", async () => {
    const { client, user, states, options } = harness();

    const starting = client.start("Nguyen Van A");
    await waitUntil(() => vi.mocked(user.register).mock.calls.length === 1);
    options().delegate.onUnregistered?.();
    await starting;

    expect(user.call).not.toHaveBeenCalled();
    expect(states.at(-1)).toEqual({
      status: "failed",
      message: "Asterisk t\u1eeb ch\u1ed1i \u0111\u0103ng k\u00fd m\u00e1y nh\u00e1nh 2001.",
    });
  });

  it("fails when the outgoing call ends before it is answered", async () => {
    const { client, user, states, options } = harness();

    const starting = client.start("Nguyen Van A");
    await waitUntil(() => vi.mocked(user.register).mock.calls.length === 1);
    options().delegate.onRegistered?.();
    await waitUntil(() => vi.mocked(user.call).mock.calls.length === 1);
    options().delegate.onCallHangup?.();
    await starting;

    expect(states.at(-1)).toEqual({
      status: "failed",
      message: "Asterisk t\u1eeb ch\u1ed1i ho\u1eb7c k\u1ebft th\u00fac cu\u1ed9c g\u1ecdi tr\u01b0\u1edbc khi tr\u1ea3 l\u1eddi.",
    });
  });

  it("times out while waiting for confirmed registration", async () => {
    vi.useFakeTimers();
    try {
      const { client, user, states } = harness(50);

      const starting = client.start("Nguyen Van A");
      await vi.advanceTimersByTimeAsync(50);
      await starting;

      expect(user.call).not.toHaveBeenCalled();
      expect(states.at(-1)).toEqual({
        status: "failed",
        message: "Asterisk kh\u00f4ng ph\u1ea3n h\u1ed3i trong th\u1eddi gian cho ph\u00e9p.",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out while waiting for the outgoing call to be answered", async () => {
    vi.useFakeTimers();
    try {
      const { client, user, states, options } = harness(50);

      const starting = client.start("Nguyen Van A");
      await vi.advanceTimersByTimeAsync(0);
      options().delegate.onRegistered?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(user.call).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(50);
      await starting;

      expect(states.at(-1)).toEqual({
        status: "failed",
        message: "Asterisk kh\u00f4ng ph\u1ea3n h\u1ed3i trong th\u1eddi gian cho ph\u00e9p.",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("hangs up, unregisters, disconnects, and detaches remote media", async () => {
    const result = harness();
    const { client, user, remoteAudio, states, pause } = result;

    await establishCall(result);
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
    const result = harness();
    const { client, states, options } = result;
    await establishCall(result);
    await client.hangup();

    options().delegate.onServerDisconnect?.(new Error("network disconnected"));

    expect(states.at(-1)).toEqual({ status: "ended" });
  });

  it("reports an unexpected errorless server disconnect as failed", async () => {
    const result = harness();
    const { client, user, remoteAudio, pause, states, options } = result;
    await establishCall(result);

    options().delegate.onServerDisconnect?.();
    await waitUntil(() => vi.mocked(user.disconnect).mock.calls.length === 1);
    await client.hangup();

    expect(states.at(-1)).toEqual({
      status: "failed",
      message: "Không thể kết nối cuộc gọi qua Asterisk.",
    });
    expect(user.hangup).toHaveBeenCalledOnce();
    expect(user.unregister).toHaveBeenCalledOnce();
    expect(user.disconnect).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledOnce();
    expect(remoteAudio.srcObject).toBeNull();
  });

  it("does not continue registration after disconnect during connect", async () => {
    const result = harness();
    const { client, user, states, options } = result;
    const connecting = pendingPromise();
    vi.mocked(user.connect).mockReturnValueOnce(connecting.promise);

    const starting = client.start("Nguyen Van A");
    options().delegate.onServerDisconnect?.(new Error("network disconnected"));
    connecting.resolve();
    await flushMicrotasks();
    options().delegate.onUnregistered?.();
    await starting;

    expect(user.register).not.toHaveBeenCalled();
    expect(user.call).not.toHaveBeenCalled();
    expect(states.at(-1)?.status).toBe("failed");
  });

  it("does not enter calling after disconnect during registration", async () => {
    const result = harness();
    const { client, user, states, options } = result;
    const registering = pendingPromise();
    vi.mocked(user.register).mockReturnValueOnce(registering.promise);

    const starting = client.start("Nguyen Van A");
    await waitUntil(() => vi.mocked(user.register).mock.calls.length === 1);
    options().delegate.onServerDisconnect?.(new Error("network disconnected"));
    registering.resolve();
    options().delegate.onRegistered?.();
    await flushMicrotasks();
    options().delegate.onCallAnswered?.();
    await starting;

    expect(user.call).not.toHaveBeenCalled();
    expect(states.at(-1)?.status).toBe("failed");
    expect(states.some((state) => state.status === "calling")).toBe(false);
  });

  it("does not enter active after disconnect during call setup", async () => {
    const result = harness();
    const { client, user, states, options } = result;
    const calling = pendingPromise();
    vi.mocked(user.call).mockReturnValueOnce(calling.promise);

    const starting = client.start("Nguyen Van A");
    await waitUntil(() => vi.mocked(user.register).mock.calls.length === 1);
    options().delegate.onRegistered?.();
    await waitUntil(() => vi.mocked(user.call).mock.calls.length === 1);
    calling.resolve();
    options().delegate.onCallAnswered?.();
    options().delegate.onServerDisconnect?.(new Error("network disconnected"));
    await starting;

    expect(states.at(-1)?.status).toBe("failed");
    expect(states.some((state) => state.status === "active")).toBe(false);
  });

  it("cleans up and ends after a remote hangup of an active call", async () => {
    const result = harness();
    const { client, user, states, options } = result;
    await establishCall(result);

    options().delegate.onCallHangup?.();
    await client.hangup();

    expect(user.disconnect).toHaveBeenCalledOnce();
    expect(states.at(-1)).toEqual({ status: "ended" });
  });

  it("rejects a second start on the same client", async () => {
    const result = harness(20);
    const { client, user, states } = result;
    await establishCall(result);

    await expect(client.start("Nguyen Van B")).rejects.toThrow(
      "SipCallClient can only be started once.",
    );

    expect(user.connect).toHaveBeenCalledOnce();
    expect(states.at(-1)).toEqual({ status: "active" });
  });

  it("continues stalled cleanup and detaches media", async () => {
    vi.useFakeTimers();
    try {
      const result = harness();
      const { client, user, remoteAudio, pause, states } = result;
      vi.mocked(user.hangup).mockImplementation(
        () => new Promise<void>(() => undefined),
      );

      await establishCall(result);
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
    const result = harness();
    const { client, states, options } = result;
    await establishCall(result);
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
