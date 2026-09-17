export type SipCallState =
  | { status: "idle" }
  | { status: "registering" }
  | { status: "calling" }
  | { status: "active" }
  | { status: "ended" }
  | { status: "failed"; message: string };

export type SipCallConfig = {
  server: string;
  domain: string;
  extension: string;
  password: string;
  destination: string;
  timeoutMs: number;
};

export type SipUserDelegate = {
  onCallAnswered?: () => void;
  onCallHangup?: () => void;
  onRegistered?: () => void;
  onUnregistered?: () => void;
  onServerDisconnect?: (error?: Error) => void;
};

export type SipUserOptions = {
  aor: string;
  delegate: SipUserDelegate;
  media: {
    constraints: { audio: true; video: false };
    remote: { audio: HTMLAudioElement };
  };
  userAgentOptions: {
    authorizationPassword: string;
    authorizationUsername: string;
    displayName: string;
  };
};

export type SipUser = {
  connect(): Promise<void>;
  register(): Promise<void>;
  call(destination: string): Promise<void>;
  hangup(): Promise<void>;
  unregister(): Promise<void>;
  disconnect(): Promise<void>;
};

export type SipUserFactory = (
  server: string,
  options: SipUserOptions,
) => SipUser;
