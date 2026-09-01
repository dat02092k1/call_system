import { Web } from "sip.js";
import type {
  SipCallConfig,
  SipCallState,
  SipUser,
  SipUserFactory,
  SipUserOptions,
} from "./sipTypes";

const defaultFactory: SipUserFactory = (server, options) =>
  new Web.SimpleUser(server, options satisfies Web.SimpleUserOptions) as SipUser;

function failureMessage(error: unknown, extension: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|403|forbidden|unauthorized|registration rejected/i.test(message)) {
    return `Asterisk từ chối đăng ký máy nhánh ${extension}.`;
  }
  if (/call rejected/i.test(message)) {
    return "Asterisk từ chối hoặc kết thúc cuộc gọi trước khi trả lời.";
  }
  if (/timeout/i.test(message)) {
    return "Asterisk không phản hồi trong thời gian cho phép.";
  }
  return "Không thể kết nối cuộc gọi qua Asterisk.";
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

class StartCancelledError extends Error {}

export class SipCallClient {
  private user?: SipUser;
  private closing?: Promise<void>;
  private cancelPendingStart?: () => void;
  private generation = 0;
  private intentionallyDisconnected = false;
  private started = false;
  private state: SipCallState = { status: "idle" };

  constructor(
    private readonly config: SipCallConfig,
    private readonly remoteAudio: HTMLAudioElement,
    private readonly onStateChange: (state: SipCallState) => void,
    private readonly createUser: SipUserFactory = defaultFactory,
  ) {}

  async start(displayName: string): Promise<void> {
    if (this.started) {
      throw new Error("SipCallClient can only be started once.");
    }
    this.started = true;
    this.intentionallyDisconnected = false;
    const generation = ++this.generation;
    this.setState({ status: "registering" });
    const registration = deferred<void>();
    const answer = deferred<void>();
    const cancelled = deferred<void>();
    const cancellation = cancelled.promise.then(() => {
      throw new StartCancelledError();
    });
    const cancelStart = () => cancelled.resolve();
    this.cancelPendingStart = cancelStart;
    let answered = false;
    let user: SipUser;
    const options: SipUserOptions = {
      aor: `sip:${this.config.extension}@${this.config.domain}`,
      delegate: {
        onCallAnswered: () => {
          if (!this.isCurrent(generation, user)) return;
          answered = true;
          answer.resolve();
        },
        onCallHangup: () => {
          if (!this.isCurrent(generation, user)) return;
          if (answered) {
            this.finish(generation, user);
            return;
          }
          this.fail(generation, user, new Error("call rejected"));
        },
        onRegistered: () => {
          if (this.isCurrent(generation, user)) registration.resolve();
        },
        onUnregistered: () => {
          if (this.isCurrent(generation, user)) {
            registration.reject(new Error("registration rejected"));
          }
        },
        onServerDisconnect: (error) => {
          if (!this.isCurrent(generation, user)) return;
          this.fail(generation, user, error);
        },
      },
      media: {
        constraints: { audio: true, video: false },
        remote: { audio: this.remoteAudio },
      },
      userAgentOptions: {
        authorizationPassword: this.config.password,
        authorizationUsername: this.config.extension,
        displayName,
      },
    };
    user = this.createUser(this.config.server, options);
    this.user = user;
    try {
      await withTimeout(
        Promise.race([user.connect(), cancellation]),
        this.config.timeoutMs,
      );
      this.ensureCurrent(generation, user);
      await withTimeout(
        Promise.race([
          Promise.all([user.register(), registration.promise]).then(
            () => undefined,
          ),
          cancellation,
        ]),
        this.config.timeoutMs,
      );
      this.ensureCurrent(generation, user);
      this.setState({ status: "calling" });
      await withTimeout(
        Promise.race([
          Promise.all([
            user.call(`sip:${this.config.destination}@${this.config.domain}`),
            answer.promise,
          ]).then(() => undefined),
          cancellation,
        ]),
        this.config.timeoutMs,
      );
      this.ensureCurrent(generation, user);
      this.setState({ status: "active" });
    } catch (error) {
      if (!(error instanceof StartCancelledError) && this.isCurrent(generation, user)) {
        this.fail(generation, user, error);
      }
      await this.closing;
    } finally {
      if (this.cancelPendingStart === cancelStart) {
        this.cancelPendingStart = undefined;
      }
    }
  }

  hangup(): Promise<void> {
    this.intentionallyDisconnected = true;
    this.generation += 1;
    this.cancelPendingStart?.();
    const wasTerminal = this.isTerminal();
    const closing = this.beginCleanup(this.user);
    if (wasTerminal) return closing;
    return closing.then(() => {
      if (!this.isTerminal()) this.setState({ status: "ended" });
    });
  }

  private setState(state: SipCallState): void {
    this.state = state;
    this.onStateChange(state);
  }

  private isTerminal(): boolean {
    return this.state.status === "ended" || this.state.status === "failed";
  }

  private isCurrent(generation: number, user: SipUser): boolean {
    return (
      this.generation === generation &&
      this.user === user &&
      !this.intentionallyDisconnected &&
      !this.isTerminal()
    );
  }

  private ensureCurrent(generation: number, user: SipUser): void {
    if (!this.isCurrent(generation, user)) throw new StartCancelledError();
  }

  private fail(generation: number, user: SipUser, error: unknown): void {
    if (!this.isCurrent(generation, user)) return;
    this.generation += 1;
    this.cancelPendingStart?.();
    this.setState({
      status: "failed",
      message: failureMessage(error, this.config.extension),
    });
    void this.beginCleanup(user);
  }

  private finish(generation: number, user: SipUser): void {
    if (!this.isCurrent(generation, user)) return;
    this.generation += 1;
    this.cancelPendingStart?.();
    this.setState({ status: "ended" });
    void this.beginCleanup(user);
  }

  private beginCleanup(user: SipUser | undefined): Promise<void> {
    this.closing ??= this.cleanup(user);
    return this.closing;
  }

  private async cleanup(user: SipUser | undefined): Promise<void> {
    if (this.user === user) this.user = undefined;
    if (user) {
      await withTimeout(user.hangup(), this.config.timeoutMs).catch(() => undefined);
      await withTimeout(user.unregister(), this.config.timeoutMs).catch(() => undefined);
      await withTimeout(user.disconnect(), this.config.timeoutMs).catch(() => undefined);
    }
    this.remoteAudio.pause();
    this.remoteAudio.srcObject = null;
  }
}

export function readSipCallConfig(
  env: Record<string, string | undefined>,
): SipCallConfig {
  const names = [
    "VITE_ASTERISK_WS_URL",
    "VITE_ASTERISK_DOMAIN",
    "VITE_ASTERISK_EXTENSION",
    "VITE_ASTERISK_PASSWORD",
    "VITE_ASTERISK_DESTINATION",
  ] as const;
  for (const name of names) {
    if (!env[name]?.trim()) {
      throw new Error(`Missing browser Asterisk configuration: ${name}`);
    }
  }
  return {
    server: env.VITE_ASTERISK_WS_URL!.trim(),
    domain: env.VITE_ASTERISK_DOMAIN!.trim(),
    extension: env.VITE_ASTERISK_EXTENSION!.trim(),
    password: env.VITE_ASTERISK_PASSWORD!,
    destination: env.VITE_ASTERISK_DESTINATION!.trim(),
    timeoutMs: 8000,
  };
}
