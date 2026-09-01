import { SimpleUser } from "sip.js/lib/platform/web/simple-user/simple-user.js";
import type { SimpleUserOptions } from "sip.js/lib/platform/web/simple-user/simple-user-options.js";
import type {
  SipCallConfig,
  SipCallState,
  SipUser,
  SipUserFactory,
  SipUserOptions,
} from "./sipTypes";

const defaultFactory: SipUserFactory = (server, options) =>
  new SimpleUser(server, options satisfies SimpleUserOptions) as SipUser;

function failureMessage(error: unknown, extension: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|403|forbidden|unauthorized/i.test(message)) {
    return `Asterisk từ chối đăng ký máy nhánh ${extension}.`;
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

export class SipCallClient {
  private user?: SipUser;
  private closing?: Promise<void>;
  private intentionallyDisconnected = false;
  private state: SipCallState = { status: "idle" };

  constructor(
    private readonly config: SipCallConfig,
    private readonly remoteAudio: HTMLAudioElement,
    private readonly onStateChange: (state: SipCallState) => void,
    private readonly createUser: SipUserFactory = defaultFactory,
  ) {}

  async start(displayName: string): Promise<void> {
    this.intentionallyDisconnected = false;
    this.setState({ status: "registering" });
    const options: SipUserOptions = {
      aor: `sip:${this.config.extension}@${this.config.domain}`,
      delegate: {
        onCallAnswered: () => {
          if (this.intentionallyDisconnected || this.isTerminal()) return;
          this.setState({ status: "active" });
        },
        onCallHangup: () => void this.hangup(),
        onServerDisconnect: (error) => {
          if (this.intentionallyDisconnected || this.state.status === "failed") return;
          this.setState({
            status: "failed",
            message: failureMessage(error, this.config.extension),
          });
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
    this.user = this.createUser(this.config.server, options);
    try {
      await withTimeout(this.user.connect(), this.config.timeoutMs);
      await withTimeout(this.user.register(), this.config.timeoutMs);
      this.setState({ status: "calling" });
      await withTimeout(
        this.user.call(`sip:${this.config.destination}@${this.config.domain}`),
        this.config.timeoutMs,
      );
    } catch (error) {
      this.setState({
        status: "failed",
        message: failureMessage(error, this.config.extension),
      });
      await this.cleanup(false);
    }
  }

  hangup(): Promise<void> {
    this.intentionallyDisconnected = true;
    this.closing ??= this.cleanup(true);
    return this.closing;
  }

  private setState(state: SipCallState): void {
    this.state = state;
    this.onStateChange(state);
  }

  private isTerminal(): boolean {
    return this.state.status === "ended" || this.state.status === "failed";
  }

  private async cleanup(reportEnded: boolean): Promise<void> {
    const user = this.user;
    this.user = undefined;
    if (user) {
      await withTimeout(user.hangup(), this.config.timeoutMs).catch(() => undefined);
      await withTimeout(user.unregister(), this.config.timeoutMs).catch(() => undefined);
      await withTimeout(user.disconnect(), this.config.timeoutMs).catch(() => undefined);
    }
    this.remoteAudio.pause();
    this.remoteAudio.srcObject = null;
    if (reportEnded) this.setState({ status: "ended" });
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
