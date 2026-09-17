# Asterisk SIP Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real, source-built Asterisk 22.11.0 SIP gateway so SIP.js and MicroSIP can call extension `1000` and reach the existing LiveKit/Gemini voice bot without removing any current demo path.

**Architecture:** Asterisk terminates SIP/WebRTC, authenticates extensions `2001` and `2002`, transcodes caller media to `slin16`, and opens one native JSON `chan_websocket` media connection per call to the existing Voice Bridge. Voice Bridge continues to create the LiveKit room and publish bidirectional PCM audio; the existing Agent Worker, Call Orchestrator, Gemini Live S2S, and Egress services remain unchanged.

**Tech Stack:** Asterisk 22.11.0 built from official source, PJSIP, `chan_websocket`, SIP.js 0.21.2, React 19, TypeScript 5.8, Vitest, Docker Compose, LiveKit, Gemini Live native audio

**Spec:** `docs/superpowers/specs/2026-08-31-asterisk-sip-gateway-design.md`

## Global Constraints

- Preserve browser direct WebRTC, browser Mock Asterisk, MicroSIP to LiveKit SIP on `5070`, Egress recording, Call Orchestrator lookup, and Gemini Live native audio.
- Build Asterisk from the pinned official `22.11.0` source archive and verify the published SHA-256 checksum during the image build.
- Use extension `2001` / password `demo2001` for SIP.js, extension `2002` / password `demo2002` for MicroSIP, and called extension `1000`.
- Route Asterisk media with `Dial(WebSocket/voicebridge/c(slin16)f(json))` to `ws://127.0.0.1:8091/media`.
- Use Asterisk SIP port `5060`, HTTP/WebSocket port `8088`, and RTP range `12000-12100`; do not change LiveKit SIP port `5070` or RTP range `10000-10100`.
- Keep Mock Asterisk as an automated test harness; do not replace or repurpose it.
- Do not add `transfer_to_agent` to Asterisk-originated calls in this increment.
- Treat all fixed credentials and plain `ws://` URLs as local-demo values only; document HTTPS/WSS, secret provisioning, TURN/ICE, firewall, and fraud controls as production requirements.

---

## File Map

### New Asterisk service

- `apps/asterisk/Dockerfile`: reproducible multi-stage source build and minimal runtime image.
- `apps/asterisk/package.json`: zero-dependency Node test command for static configuration contracts.
- `apps/asterisk/test/config.test.mjs`: asserts ports, credentials, modules, codec, dialplan, and media endpoint.
- `apps/asterisk/config/asterisk.conf`: runtime paths and console behavior.
- `apps/asterisk/config/modules.conf`: explicit module load list.
- `apps/asterisk/config/pjsip.conf`: transports and the two authenticated demo endpoints.
- `apps/asterisk/config/extensions.conf`: extension `1000` routing.
- `apps/asterisk/config/rtp.conf`: isolated RTP range and ICE support.
- `apps/asterisk/config/http.conf`: SIP WebSocket listener on `8088`.
- `apps/asterisk/config/websocket_client.conf`: per-call outbound connection to Voice Bridge.
- `apps/asterisk/config/chan_websocket.conf`: native JSON control format.
- `apps/asterisk/config/logger.conf`: useful console logs without debug floods.
- `apps/asterisk/scripts/healthcheck.sh`: verifies the core and required modules through the Asterisk CLI.

### Voice Bridge compatibility

- `apps/voice-bridge/test/fixtures/asterisk-media-start.json`: representative native Asterisk JSON event.
- `apps/voice-bridge/test/protocol.test.ts`: contract test proving the existing parser accepts the native event and flow control.

### Browser SIP client

- `apps/web/src/asterisk/sipTypes.ts`: repository-owned states, configuration, and injectable SIP client interfaces.
- `apps/web/src/asterisk/SipCallClient.ts`: SIP.js adapter for connect, register, invite, remote audio, hangup, timeouts, and cleanup.
- `apps/web/src/test/SipCallClient.test.ts`: adapter behavior with a fake SIP.js primitive.
- `apps/web/src/components/RealAsteriskCall.tsx`: stateful call screen for the real PBX path.
- `apps/web/src/test/RealAsteriskCall.test.tsx`: call screen lifecycle tests.

### Integration

- `apps/web/package.json` and `apps/web/package-lock.json`: pin `sip.js@0.21.2`.
- `apps/web/src/App.tsx`: select the new real-Asterisk screen while keeping existing screens.
- `apps/web/src/components/JoinForm.tsx`: add the third call button.
- `apps/web/src/test/JoinForm.test.tsx`: verify all three modes and shared name validation.
- `apps/web/src/styles.css`: three-button layout and real-PBX status styling.
- `compose.yaml`: add Asterisk and pass browser SIP configuration without changing existing services.
- `.env.example`: document local Asterisk/Vite defaults.
- `README.md`: setup, architecture, testing, MicroSIP registration, browser call, troubleshooting, and production boundary.

---

### Task 1: Source-Built Asterisk Container and Configuration Contract

**Files:**
- Create: `apps/asterisk/package.json`
- Create: `apps/asterisk/test/config.test.mjs`
- Create: `apps/asterisk/Dockerfile`
- Create: `apps/asterisk/config/asterisk.conf`
- Create: `apps/asterisk/config/modules.conf`
- Create: `apps/asterisk/config/pjsip.conf`
- Create: `apps/asterisk/config/extensions.conf`
- Create: `apps/asterisk/config/rtp.conf`
- Create: `apps/asterisk/config/http.conf`
- Create: `apps/asterisk/config/websocket_client.conf`
- Create: `apps/asterisk/config/chan_websocket.conf`
- Create: `apps/asterisk/config/logger.conf`
- Create: `apps/asterisk/scripts/healthcheck.sh`

**Interfaces:**
- Consumes: Voice Bridge media endpoint `ws://127.0.0.1:8091/media` and the native Asterisk JSON/PCM contract in `apps/voice-bridge/src/protocol.ts`.
- Produces: PJSIP/WebSocket listener `ws://localhost:8088/ws`, SIP listener `127.0.0.1:5060`, authenticated endpoints `2001` and `2002`, and dialplan extension `1000`.

- [ ] **Step 1: Add the failing static configuration tests**

Create `apps/asterisk/package.json`:

```json
{
  "name": "local-asterisk-gateway",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "test": "node --test test/*.test.mjs"
  }
}
```

Create `apps/asterisk/test/config.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = (name) =>
  readFile(new URL(`../config/${name}`, import.meta.url), "utf8");

test("pins disjoint SIP and RTP ports", async () => {
  const [pjsip, rtp, http] = await Promise.all([
    config("pjsip.conf"),
    config("rtp.conf"),
    config("http.conf"),
  ]);
  assert.match(pjsip, /bind=0\.0\.0\.0:5060/);
  assert.match(rtp, /rtpstart=12000/);
  assert.match(rtp, /rtpend=12100/);
  assert.match(http, /bindport=8088/);
});

test("defines separate browser and MicroSIP identities", async () => {
  const pjsip = await config("pjsip.conf");
  assert.match(pjsip, /\[2001\][\s\S]*?webrtc=yes/);
  assert.match(pjsip, /username=2001/);
  assert.match(pjsip, /password=demo2001/);
  assert.match(pjsip, /\[2002\][\s\S]*?context=from-demo/);
  assert.match(pjsip, /username=2002/);
  assert.match(pjsip, /password=demo2002/);
});

test("routes extension 1000 to native JSON slin16 media", async () => {
  const [extensions, client, channel] = await Promise.all([
    config("extensions.conf"),
    config("websocket_client.conf"),
    config("chan_websocket.conf"),
  ]);
  assert.match(
    extensions,
    /Dial\(WebSocket\/voicebridge\/c\(slin16\)f\(json\),60\)/,
  );
  assert.match(client, /uri=ws:\/\/127\.0\.0\.1:8091\/media/);
  assert.match(client, /connection_type=per_call_config/);
  assert.match(channel, /control_message_format=json/);
});

test("loads every runtime module required by the call path", async () => {
  const modules = await config("modules.conf");
  for (const name of [
    "chan_pjsip.so",
    "res_pjsip.so",
    "res_http_websocket.so",
    "res_pjsip_transport_websocket.so",
    "chan_websocket.so",
  ]) {
    assert.match(modules, new RegExp(`load => ${name.replace(".", "\\.")}`));
  }
});
```

- [ ] **Step 2: Run the test and confirm the configuration does not exist yet**

Run from repository root:

```powershell
docker run --rm -v "${PWD}/apps/asterisk:/workspace" -w /workspace node:22-alpine npm test
```

Expected: FAIL with `ENOENT` for `apps/asterisk/config/*.conf`.

- [ ] **Step 3: Add the exact Asterisk configuration**

Use these effective settings; comments may explain them but must not change the values:

```ini
; pjsip.conf
[global]
type=global
user_agent=TCBS-Local-Asterisk

[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060

[transport-tcp]
type=transport
protocol=tcp
bind=0.0.0.0:5060

[transport-ws]
type=transport
protocol=ws
bind=0.0.0.0

[2001]
type=endpoint
transport=transport-ws
context=from-demo
disallow=all
allow=ulaw,alaw
auth=auth-2001
aors=2001
webrtc=yes
dtls_auto_generate_cert=yes
media_use_received_transport=yes
rtcp_mux=yes
ice_support=yes

[auth-2001]
type=auth
auth_type=userpass
username=2001
password=demo2001

[2001]
type=aor
max_contacts=1
remove_existing=yes

[2002]
type=endpoint
transport=transport-udp
context=from-demo
disallow=all
allow=ulaw,alaw
auth=auth-2002
aors=2002
direct_media=no

[auth-2002]
type=auth
auth_type=userpass
username=2002
password=demo2002

[2002]
type=aor
max_contacts=1
remove_existing=yes
```

```ini
; extensions.conf
[from-demo]
exten => 1000,1,NoOp(Route authenticated demo caller to Voice Bridge)
 same => n,Answer()
 same => n,Dial(WebSocket/voicebridge/c(slin16)f(json),60)
 same => n,Hangup()

exten => _X!,1,Playback(invalid)
 same => n,Hangup()
```

```ini
; websocket_client.conf
[voicebridge]
type=websocket_client
uri=ws://127.0.0.1:8091/media
protocols=media
connection_type=per_call_config
connection_timeout=5000
```

```ini
; chan_websocket.conf
[global]
control_message_format=json
```

```ini
; http.conf
[general]
enabled=yes
bindaddr=0.0.0.0
bindport=8088
```

```ini
; rtp.conf
[general]
rtpstart=12000
rtpend=12100
icesupport=yes
```

Use explicit load lines while leaving automatic dependency loading enabled, so required modules are visible in review without maintaining a fragile copy of Asterisk's complete dependency graph:

```ini
; modules.conf
[modules]
autoload=yes
load => res_http_websocket.so
load => res_websocket_client.so
load => res_pjsip.so
load => res_pjsip_authenticator_digest.so
load => res_pjsip_endpoint_identifier_user.so
load => res_pjsip_registrar.so
load => res_pjsip_transport_websocket.so
load => chan_pjsip.so
load => chan_websocket.so
load => app_dial.so
load => app_playback.so
load => codec_alaw.so
load => codec_ulaw.so
load => codec_resample.so
```

```ini
; asterisk.conf
[directories]
astetcdir => /etc/asterisk
astmoddir => /usr/lib/asterisk/modules
astvarlibdir => /var/lib/asterisk
astdbdir => /var/lib/asterisk
astkeydir => /var/lib/asterisk
astdatadir => /var/lib/asterisk
astagidir => /var/lib/asterisk/agi-bin
astspooldir => /var/spool/asterisk
astrundir => /var/run/asterisk
astlogdir => /var/log/asterisk

[options]
runuser = asterisk
rungroup = asterisk
nocolor = yes
```

```ini
; logger.conf
[general]
dateformat=%F %T

[logfiles]
console => notice,warning,error
messages => notice,warning,error
```

- [ ] **Step 4: Make the static contract green**

Run:

```powershell
docker run --rm -v "${PWD}/apps/asterisk:/workspace" -w /workspace node:22-alpine npm test
```

Expected: 4 tests PASS.

- [ ] **Step 5: Add the pinned multi-stage source build**

Create `apps/asterisk/Dockerfile` with this build sequence:

```dockerfile
FROM debian:bookworm-slim AS build
ARG ASTERISK_VERSION=22.11.0
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl file git pkg-config python3 \
    libcurl4-openssl-dev libedit-dev libjansson-dev libnewt-dev \
    libsqlite3-dev libssl-dev libxml2-dev libncurses-dev uuid-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSLO "https://downloads.asterisk.org/pub/telephony/asterisk/releases/asterisk-${ASTERISK_VERSION}.tar.gz" \
    && curl -fsSLO "https://downloads.asterisk.org/pub/telephony/asterisk/releases/asterisk-${ASTERISK_VERSION}.sha256" \
    && sha256sum -c "asterisk-${ASTERISK_VERSION}.sha256" \
    && tar -xzf "asterisk-${ASTERISK_VERSION}.tar.gz"
WORKDIR /src/asterisk-${ASTERISK_VERSION}
RUN ./configure --with-jansson-bundled --with-pjproject-bundled \
    && make menuselect.makeopts \
    && menuselect/menuselect --disable BUILD_NATIVE menuselect.makeopts \
    && make -j"$(nproc)" \
    && make DESTDIR=/opt/asterisk-root install

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl libcurl4 libedit2 libjansson4 libsqlite3-0 \
    libssl3 libxml2 libncurses6 libuuid1 \
    && groupadd --system asterisk \
    && useradd --system --gid asterisk --home-dir /var/lib/asterisk asterisk \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /opt/asterisk-root/ /
COPY config/ /etc/asterisk/
COPY scripts/healthcheck.sh /usr/local/bin/asterisk-healthcheck
RUN chmod 0555 /usr/local/bin/asterisk-healthcheck \
    && mkdir -p /var/lib/asterisk /var/spool/asterisk /var/log/asterisk /var/run/asterisk \
    && chown -R asterisk:asterisk /var/lib/asterisk /var/spool/asterisk /var/log/asterisk /var/run/asterisk \
    && chmod -R go-w /etc/asterisk
USER asterisk
EXPOSE 5060/tcp 5060/udp 8088/tcp 12000-12100/udp
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 CMD ["asterisk-healthcheck"]
CMD ["asterisk", "-f", "-U", "asterisk", "-G", "asterisk", "-vvv"]
```

Create `apps/asterisk/scripts/healthcheck.sh`:

```sh
#!/bin/sh
set -eu
asterisk -rx "core show version" >/dev/null
asterisk -rx "module show like chan_websocket.so" | grep -q "Running"
asterisk -rx "module show like chan_pjsip.so" | grep -q "Running"
asterisk -rx "http show status" | grep -q "Enabled and Bound"
```

- [ ] **Step 6: Build the image and verify the runtime modules**

Run:

```powershell
docker build --progress=plain -t call-system-asterisk:test apps/asterisk
docker run --rm -d --name call-system-asterisk-test --network host call-system-asterisk:test
docker exec call-system-asterisk-test asterisk-healthcheck
docker exec call-system-asterisk-test asterisk -rx "pjsip show endpoints"
docker stop call-system-asterisk-test
```

Expected: image build succeeds after checksum verification; health check exits `0`; endpoint output includes `2001` and `2002`.

- [ ] **Step 7: Commit the container**

```powershell
git add apps/asterisk
git commit -m "feat: add source-built Asterisk gateway"
```

---

### Task 2: Native Asterisk Media Protocol Compatibility

**Files:**
- Create: `apps/voice-bridge/test/fixtures/asterisk-media-start.json`
- Modify: `apps/voice-bridge/test/protocol.test.ts`

**Interfaces:**
- Consumes: Asterisk JSON `MEDIA_START`, `MEDIA_XOFF`, `MEDIA_XON`, and `DTMF_END` events.
- Produces: a regression contract proving `parseMediaControl(text: string): MediaControlEvent` accepts native Asterisk payloads without changing production parsing behavior.

- [ ] **Step 1: Add a fixture-backed failing test**

Create `apps/voice-bridge/test/fixtures/asterisk-media-start.json` only after first adding this test, so the initial failure is an unresolved fixture:

```ts
import { readFile } from "node:fs/promises";

it("parses the native JSON emitted by Asterisk chan_websocket", async () => {
  const payload = await readFile(
    new URL("./fixtures/asterisk-media-start.json", import.meta.url),
    "utf8",
  );
  expect(parseMediaControl(payload)).toEqual({
    event: "MEDIA_START",
    connectionId: "8f41dd0e-4c5a-4c43-ae2d-6f08d5b9ec31",
    channelId: "1741a49a-9d4f-4fd5-8efe-49f3785a64a2",
    format: "slin16",
    optimalFrameSize: 640,
    ptime: 20,
    channelVariables: {
      CALLERID_NUM: "2001",
      EXTEN: "1000",
    },
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
docker run --rm -v "${PWD}/apps/voice-bridge:/workspace" -w /workspace node:22-alpine sh -c "npm ci && npm test -- protocol.test.ts"
```

Expected: FAIL with `ENOENT` for `asterisk-media-start.json`.

- [ ] **Step 3: Add the representative native payload**

```json
{
  "event": "MEDIA_START",
  "connection_id": "8f41dd0e-4c5a-4c43-ae2d-6f08d5b9ec31",
  "channel_id": "1741a49a-9d4f-4fd5-8efe-49f3785a64a2",
  "channel": "WebSocket/voicebridge-00000001",
  "format": "slin16",
  "optimal_frame_size": 640,
  "ptime": 20,
  "channel_variables": {
    "CALLERID_NUM": "2001",
    "EXTEN": "1000"
  }
}
```

- [ ] **Step 4: Run the complete Voice Bridge suite**

Run:

```powershell
docker run --rm -v "${PWD}/apps/voice-bridge:/workspace" -w /workspace node:22-alpine sh -c "npm ci && npm test && npm run typecheck"
```

Expected: all tests PASS and TypeScript exits `0` without production changes.

- [ ] **Step 5: Commit the compatibility fixture**

```powershell
git add apps/voice-bridge/test
git commit -m "test: cover native Asterisk media control"
```

---

### Task 3: SIP.js Adapter with Deterministic Lifecycle

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/package-lock.json`
- Create: `apps/web/src/asterisk/sipTypes.ts`
- Create: `apps/web/src/asterisk/SipCallClient.ts`
- Create: `apps/web/src/test/SipCallClient.test.ts`

**Interfaces:**
- Consumes: SIP WebSocket URL, SIP domain, extension, password, destination, remote `<audio>` element, and a state callback.
- Produces: `SipCallClient.start(displayName: string): Promise<void>`, `SipCallClient.hangup(): Promise<void>`, `readSipCallConfig(env): SipCallConfig`, and `SipCallState` values `idle | registering | calling | active | ended | failed`.

- [ ] **Step 1: Pin SIP.js**

Run:

```powershell
docker run --rm -v "${PWD}/apps/web:/workspace" -w /workspace node:22-alpine npm install --save-exact sip.js@0.21.2
```

Expected: `package.json` contains `"sip.js": "0.21.2"` and the lockfile is updated.

- [ ] **Step 2: Define repository-owned SIP types**

Create `apps/web/src/asterisk/sipTypes.ts`:

```ts
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
```

- [ ] **Step 3: Add failing adapter tests**

Create `apps/web/src/test/SipCallClient.test.ts` with a fake implementing every `SipUser` method. Assert these exact behaviors:

```ts
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
  const { client, user, remoteAudio, states } = harness();
  await client.start("Nguyen Van A");
  await client.hangup();
  expect(user.hangup).toHaveBeenCalledOnce();
  expect(user.unregister).toHaveBeenCalledOnce();
  expect(user.disconnect).toHaveBeenCalledOnce();
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
```

Define the test harness in the same file so the tests do not mock the SIP.js module globally:

```ts
function harness() {
  const states: SipCallState[] = [];
  const remoteAudio = document.createElement("audio");
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
    options: () => {
      if (!capturedOptions) throw new Error("SIP options were not captured");
      return capturedOptions;
    },
  };
}
```

- [ ] **Step 4: Run tests and verify the adapter is missing**

Run:

```powershell
docker run --rm -v "${PWD}/apps/web:/workspace" -w /workspace node:22-alpine sh -c "npm ci && npm test -- SipCallClient.test.ts"
```

Expected: FAIL because `SipCallClient.ts` does not exist.

- [ ] **Step 5: Implement the minimal SIP.js adapter**

Create `apps/web/src/asterisk/SipCallClient.ts` with:

```ts
import { Web } from "sip.js";
import type {
  SipCallConfig,
  SipCallState,
  SipUser,
  SipUserFactory,
  SipUserOptions,
} from "./sipTypes";

const defaultFactory: SipUserFactory = (server, options) =>
  new Web.SimpleUser(server, options as Web.SimpleUserOptions) as SipUser;

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

  constructor(
    private readonly config: SipCallConfig,
    private readonly remoteAudio: HTMLAudioElement,
    private readonly onStateChange: (state: SipCallState) => void,
    private readonly createUser: SipUserFactory = defaultFactory,
  ) {}

  async start(displayName: string): Promise<void> {
    this.onStateChange({ status: "registering" });
    const options: SipUserOptions = {
      aor: `sip:${this.config.extension}@${this.config.domain}`,
      delegate: {
        onCallAnswered: () => this.onStateChange({ status: "active" }),
        onCallHangup: () => void this.hangup(),
        onServerDisconnect: (error) => {
          if (error) {
            this.onStateChange({
              status: "failed",
              message: failureMessage(error, this.config.extension),
            });
          }
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
      this.onStateChange({ status: "calling" });
      await withTimeout(
        this.user.call(`sip:${this.config.destination}@${this.config.domain}`),
        this.config.timeoutMs,
      );
    } catch (error) {
      this.onStateChange({
        status: "failed",
        message: failureMessage(error, this.config.extension),
      });
      await this.cleanup(false);
    }
  }

  hangup(): Promise<void> {
    this.closing ??= this.cleanup(true);
    return this.closing;
  }

  private async cleanup(reportEnded: boolean): Promise<void> {
    const user = this.user;
    this.user = undefined;
    if (user) {
      await user.hangup().catch(() => undefined);
      await user.unregister().catch(() => undefined);
      await user.disconnect().catch(() => undefined);
    }
    this.remoteAudio.pause();
    this.remoteAudio.srcObject = null;
    if (reportEnded) this.onStateChange({ status: "ended" });
  }
}
```

Add this environment parser in the same module so tests can call it without mutating `import.meta.env`:

```ts
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
```

- [ ] **Step 6: Run adapter tests and type checking**

Run:

```powershell
docker run --rm -v "${PWD}/apps/web:/workspace" -w /workspace node:22-alpine sh -c "npm ci && npm test -- SipCallClient.test.ts && npm run typecheck"
```

Expected: adapter tests PASS and TypeScript exits `0`.

- [ ] **Step 7: Commit the adapter**

```powershell
git add apps/web/package.json apps/web/package-lock.json apps/web/src/asterisk apps/web/src/test/SipCallClient.test.ts
git commit -m "feat: add SIP.js call adapter"
```

---

### Task 4: Real Asterisk Call Screen and Third Call Mode

**Files:**
- Create: `apps/web/src/components/RealAsteriskCall.tsx`
- Create: `apps/web/src/test/RealAsteriskCall.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/JoinForm.tsx`
- Modify: `apps/web/src/test/JoinForm.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `SipCallClient`, `SipCallState`, and the five `VITE_ASTERISK_*` values.
- Produces: `RealAsteriskCall({ displayName, onLeave, createClient? })` and `JoinForm.onRealAsteriskCall(details)` while keeping `onJoin` and `onAsteriskCall` unchanged.

- [ ] **Step 1: Extend JoinForm tests before changing the component**

Pass `onRealAsteriskCall={vi.fn()}` to every existing `JoinForm` render. Add:

```ts
it("offers all three call modes and starts the real Asterisk path", async () => {
  const user = userEvent.setup();
  const onRealAsteriskCall = vi.fn();
  render(
    <JoinForm
      onJoin={vi.fn()}
      onAsteriskCall={vi.fn()}
      onRealAsteriskCall={onRealAsteriskCall}
      busy={false}
      error=""
    />,
  );
  await user.type(screen.getByLabelText("Tên khách hàng"), "Nguyen Van A");
  expect(screen.getByRole("button", { name: "Gọi trực tiếp WebRTC" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Gọi qua Asterisk Mock" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Gọi qua Asterisk thật" }));
  expect(onRealAsteriskCall).toHaveBeenCalledWith(
    expect.objectContaining({ displayName: "Nguyen Van A" }),
  );
});
```

- [ ] **Step 2: Add the failing call-screen test**

Create `apps/web/src/test/RealAsteriskCall.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SipCallState } from "../asterisk/sipTypes";
import { RealAsteriskCall } from "../components/RealAsteriskCall";

describe("RealAsteriskCall", () => {
  it("starts, displays active state, and hangs up once", async () => {
    const user = userEvent.setup();
    const start = vi.fn().mockResolvedValue(undefined);
    const hangup = vi.fn().mockResolvedValue(undefined);
    const onLeave = vi.fn();
    let update: (state: SipCallState) => void = () => undefined;
    render(
      <RealAsteriskCall
        displayName="Nguyen Van A"
        onLeave={onLeave}
        createClient={(_audio, onStateChange) => {
          update = onStateChange;
          return { start, hangup };
        }}
      />,
    );
    expect(start).toHaveBeenCalledWith("Nguyen Van A");
    expect(screen.getByText("Đang đăng ký máy nhánh…")).toBeVisible();
    act(() => update({ status: "active" }));
    expect(screen.getByText("Cuộc gọi qua Asterisk đang hoạt động")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Kết thúc" }));
    expect(hangup).toHaveBeenCalledOnce();
    expect(onLeave).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: Run the focused UI tests and confirm missing props/components**

Run:

```powershell
docker run --rm -v "${PWD}/apps/web:/workspace" -w /workspace node:22-alpine sh -c "npm ci && npm test -- JoinForm.test.tsx RealAsteriskCall.test.tsx"
```

Expected: FAIL because `onRealAsteriskCall` and `RealAsteriskCall` do not exist.

- [ ] **Step 4: Add the third JoinForm action**

Extend the prop type and component destructuring:

```ts
onRealAsteriskCall: (details: CallDetails) => Promise<void> | void;
```

Add a `callRealAsterisk()` function that reuses `callDetails()` and renders this third button next to the existing two:

```tsx
<button
  className="secondary-button real-asterisk-button"
  disabled={busy}
  type="button"
  onClick={callRealAsterisk}
>
  Gọi qua Asterisk thật
</button>
```

- [ ] **Step 5: Implement the real call screen**

Create `RealAsteriskCall.tsx` with these local interfaces and lifecycle:

```tsx
type RealCallClient = {
  start(displayName: string): Promise<void>;
  hangup(): Promise<void>;
};

type RealAsteriskCallProps = {
  displayName: string;
  onLeave: () => void;
  createClient?: (
    audio: HTMLAudioElement,
    onStateChange: (state: SipCallState) => void,
  ) => RealCallClient;
};

const [state, setState] = useState<SipCallState>({ status: "idle" });
const audioRef = useRef<HTMLAudioElement>(null);
const clientRef = useRef<RealCallClient | undefined>(undefined);
const leavingRef = useRef(false);

useEffect(() => {
  const audio = audioRef.current;
  if (!audio) return;
  const client = createClient
    ? createClient(audio, setState)
    : new SipCallClient(
        readSipCallConfig(import.meta.env),
        audio,
        setState,
      );
  clientRef.current = client;
  void client.start(displayName);
  return () => {
    if (!leavingRef.current) void client.hangup();
  };
}, [createClient, displayName]);

async function leave() {
  if (leavingRef.current) return;
  leavingRef.current = true;
  await clientRef.current?.hangup();
  onLeave();
}
```

Render `<audio ref={audioRef} autoPlay />`. Use state-specific Vietnamese copy:

- `idle` / `registering`: `Đang đăng ký máy nhánh…`
- `calling`: `Đang gọi số 1000…`
- `active`: `Cuộc gọi qua Asterisk đang hoạt động`
- `ended`: `Cuộc gọi đã kết thúc`
- `failed`: title `Không thể gọi qua Asterisk` and `state.message`

The header pill must say `Asterisk thật`; the detail for `active` must say audio travels through `SIP.js → Asterisk → Voice Bridge → LiveKit`.

- [ ] **Step 6: Wire App without replacing either existing mode**

Add `realAsteriskCaller: string | null`. Preserve the existing `session` and `asteriskCaller` branches, then render `RealAsteriskCall` when the new state is set. Pass:

```tsx
onRealAsteriskCall={(details) => {
  setError("");
  setRealAsteriskCaller(details.displayName);
}}
```

- [ ] **Step 7: Make the three-button layout responsive**

Change `.call-mode-buttons` to `grid-template-columns: repeat(3, minmax(0, 1fr))`; keep the existing one-column rule below `520px`; add a two-column breakpoint from `521px` through `900px`. Do not change TCBS colors or the existing call screens.

- [ ] **Step 8: Run all web checks**

Run:

```powershell
docker run --rm -v "${PWD}/apps/web:/workspace" -w /workspace node:22-alpine sh -c "npm ci && npm test && npm run typecheck && npm run build"
```

Expected: every web test PASS, typecheck exits `0`, and Vite build succeeds.

- [ ] **Step 9: Commit the UI**

```powershell
git add apps/web/src
git commit -m "feat: add real Asterisk web call mode"
```

---

### Task 5: Compose and Environment Wiring

**Files:**
- Modify: `compose.yaml`
- Modify: `.env.example`
- Create: `apps/asterisk/test/compose.test.mjs`

**Interfaces:**
- Consumes: the Asterisk image from Task 1 and browser config from Task 3.
- Produces: healthy Compose service `asterisk`; host listeners `5060`, `8088`, and `12000-12100/udp`; Vite configuration for the third call mode.

- [ ] **Step 1: Add a failing Compose contract test**

Create `apps/asterisk/test/compose.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const compose = await readFile(
  new URL("../../../compose.yaml", import.meta.url),
  "utf8",
);

test("adds Asterisk without removing existing gateways", () => {
  for (const service of ["asterisk:", "sip:", "mock-asterisk:", "voice-bridge:"]) {
    assert.match(compose, new RegExp(`^  ${service}`, "m"));
  }
  assert.match(compose, /asterisk:[\s\S]*?network_mode: host/);
  assert.match(compose, /asterisk:[\s\S]*?apps\/asterisk/);
});

test("passes all browser SIP settings", () => {
  for (const name of [
    "VITE_ASTERISK_WS_URL",
    "VITE_ASTERISK_DOMAIN",
    "VITE_ASTERISK_EXTENSION",
    "VITE_ASTERISK_PASSWORD",
    "VITE_ASTERISK_DESTINATION",
  ]) {
    assert.match(compose, new RegExp(name));
  }
});
```

- [ ] **Step 2: Verify the Compose contract fails**

Run:

```powershell
docker run --rm -v "${PWD}:/workspace" -w /workspace/apps/asterisk node:22-alpine npm test
```

Expected: existing config tests pass and both Compose tests FAIL because the service and Vite values are absent.

- [ ] **Step 3: Add the real Asterisk service**

Add to `compose.yaml` without changing `sip` or `mock-asterisk`:

```yaml
  asterisk:
    build:
      context: ./apps/asterisk
      args:
        ASTERISK_VERSION: 22.11.0
    network_mode: host
    volumes:
      - ./apps/asterisk/config:/etc/asterisk:ro
      - asterisk-spool:/var/spool/asterisk
      - asterisk-logs:/var/log/asterisk
    depends_on:
      voice-bridge:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "asterisk-healthcheck"]
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 10s
    restart: unless-stopped
```

Declare top-level named volumes `asterisk-spool:` and `asterisk-logs:`. Extend the `web.environment` block:

```yaml
      VITE_ASTERISK_WS_URL: ${VITE_ASTERISK_WS_URL:-ws://localhost:8088/ws}
      VITE_ASTERISK_DOMAIN: ${VITE_ASTERISK_DOMAIN:-localhost}
      VITE_ASTERISK_EXTENSION: ${VITE_ASTERISK_EXTENSION:-2001}
      VITE_ASTERISK_PASSWORD: ${VITE_ASTERISK_PASSWORD:-demo2001}
      VITE_ASTERISK_DESTINATION: ${VITE_ASTERISK_DESTINATION:-1000}
```

Add `asterisk: condition: service_healthy` to `web.depends_on` while retaining `token-api` and `mock-asterisk`.

- [ ] **Step 4: Document the local environment values**

Append to `.env.example`:

```dotenv
# Local browser SIP.js demo. These values are shipped to the browser.
VITE_ASTERISK_WS_URL=ws://localhost:8088/ws
VITE_ASTERISK_DOMAIN=localhost
VITE_ASTERISK_EXTENSION=2001
VITE_ASTERISK_PASSWORD=demo2001
VITE_ASTERISK_DESTINATION=1000
```

- [ ] **Step 5: Validate static and rendered Compose configuration**

Run:

```powershell
docker run --rm -v "${PWD}:/workspace" -w /workspace/apps/asterisk node:22-alpine npm test
docker compose --env-file .env.example config --quiet
docker compose --env-file .env.example config --services
```

Expected: tests PASS; Compose validation exits `0`; services list includes all existing services plus `asterisk`.

- [ ] **Step 6: Start the integration slice and check health**

Run:

```powershell
docker compose up -d --build redis livekit egress call-orchestrator agent voice-bridge mock-asterisk asterisk token-api web
docker compose ps
docker compose exec -T asterisk asterisk -rx "http show status"
docker compose exec -T asterisk asterisk -rx "pjsip show endpoints"
docker compose exec -T asterisk asterisk -rx "dialplan show 1000@from-demo"
```

Expected: Asterisk is healthy; HTTP is bound to `0.0.0.0:8088`; endpoints `2001` and `2002` exist; extension `1000` contains the WebSocket dial operation. Existing services remain running.

- [ ] **Step 7: Commit Compose wiring**

```powershell
git add compose.yaml .env.example apps/asterisk/test/compose.test.mjs
git commit -m "feat: wire Asterisk into local compose"
```

---

### Task 6: Setup, Call Flow, and Troubleshooting Documentation

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: all implemented ports, identities, commands, and acceptance criteria.
- Produces: a clean-clone setup path and two real-Asterisk test procedures.

- [ ] **Step 1: Update the architecture diagram**

Add `Browser SIP.js` and `MicroSIP 2002` inputs to a new `Asterisk 22.11.0` node, then connect Asterisk to Voice Bridge with `WebSocket JSON + slin16`. Keep separate arrows for direct browser WebRTC, Mock Asterisk, and LiveKit SIP `5070` so readers can see that none were removed.

- [ ] **Step 2: Add clean-clone startup instructions**

Document these exact commands from repository root:

```powershell
Copy-Item .env.example .env
# Edit .env and set GOOGLE_API_KEY to the real Google AI Studio key.
docker compose up -d --build
docker compose ps
docker compose logs -f asterisk voice-bridge agent
```

State that Docker Desktop host networking must be enabled, ports `5060`, `5070`, `7880-7882`, `8088`, `8090`, `8091`, `10000-10100/udp`, and `12000-12100/udp` must be free, and the browser must allow microphone access.

- [ ] **Step 3: Add browser and MicroSIP call procedures**

Browser procedure:

1. Open `http://localhost:5173`.
2. Enter a customer name.
3. Click `Gọi qua Asterisk thật`.
4. Allow microphone access.
5. Wait for `Cuộc gọi qua Asterisk đang hoạt động`, hear the TCBS greeting, speak Vietnamese, then click `Kết thúc`.

MicroSIP procedure:

- SIP server/domain: `127.0.0.1`
- Port: `5060`
- Username/login: `2002`
- Password: `demo2002`
- Transport: `UDP`
- Media encryption: `Disabled` for this local demo
- Enabled codecs: `G.711 u-law` and `G.711 A-law`
- Called number: `1000`

Explicitly distinguish this from the preserved LiveKit SIP direct call `1000@127.0.0.1:5070`.

- [ ] **Step 4: Add verification and troubleshooting commands**

```powershell
docker compose exec -T asterisk asterisk -rx "pjsip show contacts"
docker compose exec -T asterisk asterisk -rx "core show channels verbose"
docker compose exec -T asterisk asterisk -rx "http show status"
docker compose logs --tail 200 asterisk voice-bridge agent egress
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 5060,5070,8088,8091
Get-NetUDPEndpoint | Where-Object LocalPort -in 5060,5070
```

Map common symptoms to checks: browser not registering → `http show status` and port `8088`; MicroSIP unauthorized → endpoint credentials; no audio → RTP ports, Windows firewall, codec list, and Voice Bridge logs; bot absent → Agent/Gemini logs; call works but no recording → Egress logs and `recordings/`.

- [ ] **Step 5: Add the production boundary**

State that fixed browser credentials and `ws://` are for localhost only. Production needs HTTPS/WSS, trusted certificates, DTLS-SRTP, short-lived authenticated provisioning, NAT/external media settings, TURN where required, SIP/RTP allowlists, rate limits, fraud controls, secret management, metrics/call traces, pinned images/SBOM scanning, and initially a dedicated Linux VM with host networking.

- [ ] **Step 6: Verify documentation references real configuration**

Run:

```powershell
rg -n "Asterisk 22\.11\.0|Gọi qua Asterisk thật|2001|2002|5060|8088|12000-12100|LiveKit SIP|Asterisk Mock|production" README.md
git diff --check
```

Expected: every required term appears and `git diff --check` reports no whitespace errors.

- [ ] **Step 7: Commit documentation**

```powershell
git add README.md
git commit -m "docs: add real Asterisk demo guide"
```

---

### Task 7: Full Regression and Manual End-to-End Acceptance

**Files:**
- Modify only files required to correct failures discovered by the commands below; do not broaden scope.

**Interfaces:**
- Consumes: the complete Compose stack and a valid `GOOGLE_API_KEY` in `.env`.
- Produces: evidence that all four legacy paths still exist and that browser/MicroSIP Asterisk calls carry two-way audio and record successfully.

- [ ] **Step 1: Run every repository-owned automated suite**

Run each app using its checked-in scripts:

```powershell
docker run --rm -v "${PWD}/apps/token-api:/workspace" -w /workspace node:22-alpine sh -c "npm ci && npm test && npm run typecheck"
docker run --rm -v "${PWD}/apps/call-orchestrator:/workspace" -w /workspace node:22-alpine sh -c "npm ci && npm test && npm run typecheck"
docker run --rm -v "${PWD}/apps/agent:/workspace" -w /workspace node:22-alpine sh -c "npm ci && npm test && npm run typecheck"
docker run --rm -v "${PWD}/apps/voice-bridge:/workspace" -w /workspace node:22-alpine sh -c "npm ci && npm test && npm run typecheck"
docker run --rm -v "${PWD}/apps/mock-asterisk:/workspace" -w /workspace node:22-alpine sh -c "npm ci && npm test && npm run typecheck"
docker run --rm -v "${PWD}/apps/web:/workspace" -w /workspace node:22-alpine sh -c "npm ci && npm test && npm run typecheck && npm run build"
docker run --rm -v "${PWD}:/workspace" -w /workspace/apps/asterisk node:22-alpine npm test
docker compose config --quiet
```

Expected: all tests, typechecks, builds, and Compose validation exit `0`.

- [ ] **Step 2: Rebuild and inspect runtime health**

Run:

```powershell
docker compose up -d --build
docker compose ps
docker compose exec -T asterisk asterisk-healthcheck
docker compose exec -T asterisk asterisk -rx "module show like websocket"
```

Expected: core services are healthy; output includes running HTTP transport and `chan_websocket` modules.

- [ ] **Step 3: Verify the real browser Asterisk path manually**

Perform the README browser procedure. Confirm:

- extension `2001` appears in `pjsip show contacts`;
- Asterisk logs show a call to `1000` and a `WebSocket/voicebridge-*` channel;
- Voice Bridge logs show an `asterisk-*` LiveKit room;
- the caller hears the TCBS greeting and completes two Vietnamese turns with Gemini;
- browser hangup removes the Asterisk channel and LiveKit caller without restarting Voice Bridge;
- `recordings/` receives a non-empty MP3.

- [ ] **Step 4: Verify the real MicroSIP Asterisk path manually**

Register extension `2002` and call `1000`. Confirm the same two-way audio, cleanup, and recording evidence as the browser path.

- [ ] **Step 5: Run legacy smoke tests**

From the unchanged web UI, make one `Gọi trực tiếp WebRTC` call and one `Gọi qua Asterisk Mock` call. Then use the existing MicroSIP direct-IP procedure against `1000@127.0.0.1:5070`. Confirm all three still reach the Gemini bot.

- [ ] **Step 6: Inspect final state and commit only corrective changes**

Run:

```powershell
git status --short
git diff --check
git log --oneline -7
```

Expected: no uncommitted implementation changes remain, no whitespace errors exist, and the recent history contains separate commits for the container, protocol fixture, SIP adapter, UI, Compose, and docs. If acceptance exposed a defect, add its focused regression test, fix it, rerun the affected suite, and commit with `fix: <specific behavior>` before declaring completion.
