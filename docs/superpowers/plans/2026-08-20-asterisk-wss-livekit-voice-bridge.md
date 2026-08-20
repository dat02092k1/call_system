# Asterisk WSS LiveKit Voice Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive Asterisk-compatible WebSocket media path that carries stable bidirectional PCM audio between the browser and the existing LiveKit Gemini voice agent without removing or changing existing call paths.

**Architecture:** A new Mock Asterisk service accepts a demo browser WebSocket and opens an Asterisk `chan_websocket`-compatible media connection to a new Voice Bridge. The Voice Bridge joins one LiveKit room per call as a backend participant, publishes caller PCM through `@livekit/rtc-node`, subscribes to Agent audio at 16 kHz mono, and returns it over WebSocket. Existing browser WebRTC, LiveKit SIP, transfer, Orchestrator, and Egress behavior stays in place.

**Tech Stack:** TypeScript, Node.js 22, `ws`, `@livekit/rtc-node` 0.13.x, `livekit-server-sdk` 2.17.x, React 19, Web Audio API, AudioWorklet, Vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-20-asterisk-wss-livekit-voice-bridge-design.md`

## Global Constraints

- Implement additively; do not remove or replace the direct browser WebRTC flow or LiveKit SIP/MicroSIP flow.
- Keep Gemini Live realtime speech-to-speech; do not add separate STT or TTS.
- Keep existing SIP `transfer_to_agent` unchanged and do not expose transfer to Asterisk WSS calls.
- Use `slin16`: signed PCM 16-bit little-endian, mono, 16 kHz.
- Map one Asterisk channel to one bridge session, one LiveKit room, and one bridge participant.
- Limit audio buffering to approximately 500 ms and drop oldest audio on overflow.
- Never log API secrets, access tokens, or raw audio payloads.
- Preserve the pre-existing modification to `apps/agent/package-lock.json` in the original worktree.
- Develop and verify the feature in an isolated Git worktree.

## Planned File Structure

### New Voice Bridge service

- `apps/voice-bridge/package.json`: scripts and runtime dependencies.
- `apps/voice-bridge/package-lock.json`: reproducible dependency graph.
- `apps/voice-bridge/tsconfig.json`: NodeNext TypeScript build.
- `apps/voice-bridge/Dockerfile`: build and production runtime image.
- `apps/voice-bridge/src/config.ts`: validated environment configuration.
- `apps/voice-bridge/src/protocol.ts`: Asterisk text-event parsing and safe identifiers.
- `apps/voice-bridge/src/audioQueue.ts`: bounded async audio queue with drop counters.
- `apps/voice-bridge/src/livekitSession.ts`: one call's LiveKit participant and audio tracks.
- `apps/voice-bridge/src/server.ts`: HTTP health endpoint and WebSocket lifecycle.
- `apps/voice-bridge/test/config.test.ts`: config tests.
- `apps/voice-bridge/test/protocol.test.ts`: protocol and identifier tests.
- `apps/voice-bridge/test/audioQueue.test.ts`: queue/backpressure tests.
- `apps/voice-bridge/test/server.test.ts`: WebSocket session lifecycle tests using an injected session factory.

### New Mock Asterisk service

- `apps/mock-asterisk/package.json`: scripts and dependencies.
- `apps/mock-asterisk/package-lock.json`: reproducible dependency graph.
- `apps/mock-asterisk/tsconfig.json`: NodeNext TypeScript build.
- `apps/mock-asterisk/Dockerfile`: build and runtime image.
- `apps/mock-asterisk/src/protocol.ts`: browser messages and Asterisk `MEDIA_START` creation.
- `apps/mock-asterisk/src/server.ts`: browser WebSocket to Voice Bridge proxy and health endpoint.
- `apps/mock-asterisk/test/protocol.test.ts`: start-event tests.
- `apps/mock-asterisk/test/server.test.ts`: binary forwarding and cleanup tests.

### Existing components changed additively

- `apps/agent/src/orchestrator.ts`: resolve `telephony.*` attributes after `sip.*` attributes.
- `apps/agent/test/orchestrator.test.ts`: prove SIP precedence, bridge metadata, and fallback.
- `apps/web/src/asterisk/pcm.ts`: PCM conversion and streaming resampling helpers.
- `apps/web/src/asterisk/AsteriskCallClient.ts`: microphone, WebSocket, AudioWorklet, playback, and cleanup.
- `apps/web/src/asterisk/types.ts`: call state and demo protocol types.
- `apps/web/public/pcm-capture-worklet.js`: capture Float32 microphone blocks off the UI thread.
- `apps/web/src/components/AsteriskCall.tsx`: active-call UI.
- `apps/web/src/components/JoinForm.tsx`: additive Asterisk Mock call button.
- `apps/web/src/App.tsx`: exclusive direct-WebRTC or Asterisk-Mock session state.
- `apps/web/src/styles.css`: new call-mode styling using the existing white/red theme.
- `apps/web/src/test/asteriskPcm.test.ts`: PCM/resampler tests.
- `apps/web/src/test/AsteriskCall.test.tsx`: component state and hangup tests.
- `apps/web/src/test/JoinForm.test.tsx`: both call actions and validation.
- `compose.yaml`: add Voice Bridge and Mock Asterisk services.
- `.env.example`: document new local URLs and buffer configuration.
- `README.md`: architecture, startup, test procedure, regression checks, and troubleshooting.

---

### Task 1: Preserve Agent behavior while accepting bridge metadata

**Files:**
- Modify: `apps/agent/src/orchestrator.ts`
- Modify: `apps/agent/test/orchestrator.test.ts`

**Interfaces:**
- Consumes: `SipParticipantInfo.attributes: Record<string, string>`.
- Produces: `resolveInboundCallIdentity(participant): { callId: string; phoneNumber: string }`, used by `prepareInboundCallContext`.

- [ ] **Step 1: Write failing metadata-precedence tests**

Add tests proving that SIP values win, bridge attributes work without SIP attributes, and identity fallback remains:

```ts
expect(resolveInboundCallIdentity({
  identity: "caller-bridge-1",
  attributes: {
    "telephony.callId": "bridge-1",
    "telephony.phoneNumber": "0900000001",
  },
})).toEqual({ callId: "bridge-1", phoneNumber: "0900000001" });

expect(resolveInboundCallIdentity({
  identity: "caller",
  attributes: {
    "sip.callID": "sip-1",
    "sip.phoneNumber": "0911111111",
    "telephony.callId": "bridge-1",
    "telephony.phoneNumber": "0900000001",
  },
})).toEqual({ callId: "sip-1", phoneNumber: "0911111111" });
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- orchestrator.test.ts`

Expected: FAIL because `resolveInboundCallIdentity` is not exported.

- [ ] **Step 3: Implement the resolver and reuse it**

```ts
export function resolveInboundCallIdentity(participant: SipParticipantInfo) {
  return {
    callId:
      participant.attributes["sip.callID"] ||
      participant.attributes["telephony.callId"] ||
      `call-${participant.identity}`,
    phoneNumber:
      participant.attributes["sip.phoneNumber"] ||
      participant.attributes["telephony.phoneNumber"] ||
      participant.identity,
  };
}
```

Call this resolver from `prepareInboundCallContext`. Do not alter the `sip.callID` condition in `apps/agent/src/agent.ts`, so only LiveKit SIP participants receive `transfer_to_agent`.

- [ ] **Step 4: Run Agent tests and typecheck**

Run: `npm test && npm run typecheck`

Expected: all Agent tests PASS.

- [ ] **Step 5: Commit the backward-compatible metadata change**

```bash
git add apps/agent/src/orchestrator.ts apps/agent/test/orchestrator.test.ts
git commit -m "feat(agent): accept Asterisk bridge call metadata"
```

### Task 2: Build Voice Bridge protocol and bounded queue primitives

**Files:**
- Create: `apps/voice-bridge/package.json`
- Create: `apps/voice-bridge/package-lock.json`
- Create: `apps/voice-bridge/tsconfig.json`
- Create: `apps/voice-bridge/src/config.ts`
- Create: `apps/voice-bridge/src/protocol.ts`
- Create: `apps/voice-bridge/src/audioQueue.ts`
- Create: `apps/voice-bridge/test/config.test.ts`
- Create: `apps/voice-bridge/test/protocol.test.ts`
- Create: `apps/voice-bridge/test/audioQueue.test.ts`

**Interfaces:**
- Produces: `parseMediaControl(text: string): MediaControlEvent`.
- Produces: `normalizeLiveKitId(value: string): string`.
- Produces: `pcmBytesToSamples(bytes: Uint8Array): Int16Array`.
- Produces: `BoundedAsyncQueue<T>` with `push`, `shift`, `close`, `droppedCount`, and `size`.
- Produces: `loadConfig(env): VoiceBridgeConfig`.

- [ ] **Step 1: Scaffold the package and install pinned-compatible dependencies**

Use Node 22 ESM scripts and these dependencies:

```json
{
  "dependencies": {
    "@livekit/rtc-node": "^0.13.33",
    "livekit-server-sdk": "^2.17.0",
    "ws": "^8.18.3"
  },
  "devDependencies": {
    "@types/node": "^22.15.30",
    "@types/ws": "^8.18.1",
    "typescript": "^5.8.3",
    "vitest": "^3.2.4"
  }
}
```

Run: `npm install`

Expected: `package-lock.json` is created.

- [ ] **Step 2: Write failing protocol, PCM, config, and bounded-queue tests**

Tests must cover valid `MEDIA_START`, invalid JSON, wrong codec, duplicate-unsafe IDs, odd PCM byte lengths, FIFO ordering, oldest-frame drop, waiter wake-up, and idempotent close.

Example assertions:

```ts
expect(parseMediaControl(JSON.stringify({
  event: "MEDIA_START",
  connection_id: "connection-1",
  channel_id: "channel-1",
  format: "slin16",
  optimal_frame_size: 640,
  ptime: 20,
}))).toMatchObject({ event: "MEDIA_START", format: "slin16" });

const queue = new BoundedAsyncQueue<number>(2);
queue.push(1); queue.push(2); queue.push(3);
expect(await queue.shift()).toBe(2);
expect(queue.droppedCount).toBe(1);
```

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test`

Expected: FAIL because the primitives do not exist.

- [ ] **Step 4: Implement minimal validated primitives**

`MEDIA_START` requires non-empty `connection_id` and `channel_id`, `format === "slin16"`, positive even `optimal_frame_size`, and positive `ptime`. `MEDIA_XOFF`, `MEDIA_XON`, and `DTMF_END` are recognized. Unknown valid JSON events become `{ event: "UNKNOWN", name }`.

`BoundedAsyncQueue.push` drops the oldest queued value when full; `shift` waits while open and returns `undefined` after close and drain.

- [ ] **Step 5: Run Voice Bridge primitive tests and typecheck**

Run: `npm test && npm run typecheck`

Expected: all primitive tests PASS.

- [ ] **Step 6: Commit the service foundation**

```bash
git add apps/voice-bridge
git commit -m "feat(voice-bridge): add media protocol primitives"
```

### Task 3: Implement one-call LiveKit media session

**Files:**
- Create: `apps/voice-bridge/src/livekitSession.ts`
- Create: `apps/voice-bridge/test/livekitSession.test.ts`

**Interfaces:**
- Consumes: `MediaStartEvent`, binary PCM, and `VoiceBridgeConfig` from Task 2.
- Produces: `LiveKitCallSession.start()`, `pushCallerAudio(bytes)`, `setAsteriskWritable(writable)`, and `close(reason)`.
- Produces: `createLiveKitCallSession(options)` factory used by the WebSocket server.

- [ ] **Step 1: Write failing session tests against injected RTC adapters**

Define narrow adapters so unit tests do not need a real LiveKit server:

```ts
export type RtcCallAdapter = {
  connect(input: RtcConnectInput): Promise<void>;
  publishCallerFrame(samples: Int16Array): Promise<void>;
  onAgentFrame(handler: (samples: Int16Array) => void): void;
  onDisconnected(handler: () => void): void;
  disconnect(): Promise<void>;
};
```

Prove that session start publishes `telephony.provider`, `telephony.callId`, and `telephony.phoneNumber`; caller frames are processed sequentially; output is withheld during XOFF; overflow drops old frames; and close is idempotent.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npm test -- livekitSession.test.ts`

Expected: FAIL because the session is not implemented.

- [ ] **Step 3: Implement the RTC adapter using `@livekit/rtc-node`**

The production adapter must:

```ts
const source = new AudioSource(16000, 1);
const track = LocalAudioTrack.createAudioTrack("caller-audio", source);
await room.localParticipant.publishTrack(track, options);

const stream = new AudioStream(remoteTrack, {
  sampleRate: 16000,
  numChannels: 1,
  frameSizeMs: 20,
});
```

Use `ParticipantKind.AGENT` to select Agent audio. Use an `AccessToken` with room join, publish, and subscribe grants plus the `telephony.*` attributes. Await `AudioSource.captureFrame` in a single inbound pump.

- [ ] **Step 4: Implement the bounded inbound and outbound pumps**

Inbound frames become `AudioFrame(samples, 16000, 1, samples.length)`. Outbound frames are copied before being handed to WebSocket code. Track and report `inboundDroppedFrames` and `outboundDroppedFrames` on close.

- [ ] **Step 5: Run session tests and typecheck**

Run: `npm test && npm run typecheck`

Expected: all Voice Bridge tests PASS.

- [ ] **Step 6: Commit the LiveKit media session**

```bash
git add apps/voice-bridge/src/livekitSession.ts apps/voice-bridge/test/livekitSession.test.ts
git commit -m "feat(voice-bridge): bridge PCM audio into LiveKit"
```

### Task 4: Expose the Voice Bridge WebSocket server

**Files:**
- Create: `apps/voice-bridge/src/server.ts`
- Create: `apps/voice-bridge/test/server.test.ts`
- Create: `apps/voice-bridge/Dockerfile`

**Interfaces:**
- Consumes: `createLiveKitCallSession` from Task 3.
- Produces: `createVoiceBridgeServer(options)` and executable server entrypoint.
- Exposes: `GET /health` and WebSocket upgrade path `/media` on port `8091`.

- [ ] **Step 1: Write failing HTTP and WebSocket lifecycle tests**

Tests inject a fake call-session factory and assert:

- `/health` returns `200` and `{"status":"ok"}`.
- non-`/media` upgrades are rejected.
- missing `MEDIA_START` closes after the configured timeout.
- first valid `MEDIA_START` creates and starts exactly one session.
- duplicate `MEDIA_START` closes with a protocol error.
- binary before start is rejected.
- binary after start reaches `pushCallerAudio`.
- XOFF/XON reaches `setAsteriskWritable(false/true)`.
- socket close calls session close once.

- [ ] **Step 2: Run server tests and verify failure**

Run: `npm test -- server.test.ts`

Expected: FAIL because the server does not exist.

- [ ] **Step 3: Implement the server and structured logs**

Use one Node HTTP server and `WebSocketServer({ noServer: true })`. Reject invalid states with a small JSON error text frame and an appropriate close code. Log only identifiers, state transitions, counters, and error messages.

- [ ] **Step 4: Add a two-stage Docker image**

Build with `node:22-bookworm-slim`, run `npm ci`, compile TypeScript, install production dependencies in the runtime stage, expose `8091`, and start `dist/src/server.js`.

- [ ] **Step 5: Run tests, typecheck, and build**

Run: `npm test && npm run typecheck && npm run build`

Expected: all commands PASS.

- [ ] **Step 6: Commit the Voice Bridge server**

```bash
git add apps/voice-bridge
git commit -m "feat(voice-bridge): expose Asterisk media websocket"
```

### Task 5: Implement the interactive Mock Asterisk proxy

**Files:**
- Create: `apps/mock-asterisk/package.json`
- Create: `apps/mock-asterisk/package-lock.json`
- Create: `apps/mock-asterisk/tsconfig.json`
- Create: `apps/mock-asterisk/src/protocol.ts`
- Create: `apps/mock-asterisk/src/server.ts`
- Create: `apps/mock-asterisk/test/protocol.test.ts`
- Create: `apps/mock-asterisk/test/server.test.ts`
- Create: `apps/mock-asterisk/Dockerfile`

**Interfaces:**
- Produces: browser JSON messages `call.start`, `call.ready`, `call.failed`, and `call.ended`.
- Produces: `createMediaStartEvent(call): string` for the Voice Bridge.
- Exposes: `GET /health` and WebSocket `/call` on port `8090`.
- Connects to: `ws://voice-bridge:8091/media`.

- [ ] **Step 1: Write failing protocol tests**

Validate browser start input:

```json
{"type":"call.start","displayName":"Nguyen Van A","phoneNumber":"0900000001"}
```

Assert that generated Asterisk JSON uses `format: "slin16"`, `optimal_frame_size: 640`, `ptime: 20`, and includes `CALLER_NUMBER` plus `CALLER_NAME` channel variables.

- [ ] **Step 2: Write failing proxy lifecycle tests**

Run two in-process WebSocket servers and prove:

- browser start opens one bridge socket and emits one `MEDIA_START`.
- browser binary is forwarded only after the bridge is ready.
- bridge binary is returned unchanged to the browser.
- closing either side closes the paired side.
- invalid browser JSON emits `call.failed` and closes.

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test`

Expected: FAIL because the mock service does not exist.

- [ ] **Step 4: Implement the protocol and proxy**

Generate channel and connection IDs with `crypto.randomUUID()`. Bound pre-ready caller audio to 25 frames and drop oldest on overflow. Do not parse or log binary payloads.

- [ ] **Step 5: Add Docker image and verify package**

Use a Node 22 Alpine two-stage image, expose `8090`, then run:

`npm test && npm run typecheck && npm run build`

Expected: all commands PASS.

- [ ] **Step 6: Commit Mock Asterisk**

```bash
git add apps/mock-asterisk
git commit -m "feat(mock-asterisk): add interactive websocket call proxy"
```

### Task 6: Add the frontend Asterisk Mock audio client

**Files:**
- Create: `apps/web/public/pcm-capture-worklet.js`
- Create: `apps/web/src/asterisk/types.ts`
- Create: `apps/web/src/asterisk/pcm.ts`
- Create: `apps/web/src/asterisk/AsteriskCallClient.ts`
- Create: `apps/web/src/test/asteriskPcm.test.ts`
- Create: `apps/web/src/test/AsteriskCallClient.test.ts`

**Interfaces:**
- Produces: `StreamingLinearResampler(inputRate, outputRate).process(input)`.
- Produces: `float32ToPcm16(input): Int16Array`.
- Produces: `AsteriskCallClient` with `start(details)`, `hangup()`, and state callback.
- Consumes: `VITE_MOCK_ASTERISK_URL`, default `ws://localhost:8090/call`.

- [ ] **Step 1: Write failing PCM conversion and streaming-resampler tests**

Assert clamping and signed conversion for `-1`, `0`, `1`; assert a continuous 48 kHz waveform processed in multiple chunks yields approximately one third as many 16 kHz samples without resetting phase at each chunk.

- [ ] **Step 2: Run PCM tests and verify failure**

Run: `npm test -- asteriskPcm.test.ts`

Expected: FAIL because PCM helpers do not exist.

- [ ] **Step 3: Implement PCM helpers and AudioWorklet**

The worklet posts copied Float32 microphone blocks to the main thread. The controller resamples continuously to 16 kHz, converts to PCM16, and sends binary WebSocket messages. Request media with:

```ts
navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
});
```

- [ ] **Step 4: Write failing client lifecycle tests with browser API fakes**

Prove that `start` opens the socket, sends `call.start`, starts capture after `call.ready`, schedules response PCM for playback, and `hangup` closes WebSocket, MediaStream tracks, worklet nodes, and AudioContext exactly once.

- [ ] **Step 5: Implement `AsteriskCallClient`**

Maintain an output `nextPlaybackTime` and schedule 16 kHz mono `AudioBufferSourceNode`s with a small lead time. Reset the schedule if it falls substantially behind current time so old audio cannot accumulate.

- [ ] **Step 6: Run frontend unit tests and typecheck**

Run: `npm test && npm run typecheck`

Expected: all frontend tests PASS.

- [ ] **Step 7: Commit the browser audio client**

```bash
git add apps/web/public/pcm-capture-worklet.js apps/web/src/asterisk apps/web/src/test/asteriskPcm.test.ts apps/web/src/test/AsteriskCallClient.test.ts
git commit -m "feat(web): add Asterisk mock audio client"
```

### Task 7: Add the frontend call mode and preserve direct WebRTC

**Files:**
- Create: `apps/web/src/components/AsteriskCall.tsx`
- Create: `apps/web/src/test/AsteriskCall.test.tsx`
- Modify: `apps/web/src/components/JoinForm.tsx`
- Modify: `apps/web/src/test/JoinForm.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: `AsteriskCallClient` from Task 6.
- Adds: `JoinForm.onAsteriskCall(details)` without changing `onJoin(details)`.
- Adds: mutually exclusive App modes `idle`, `webrtc`, and `asterisk`.

- [ ] **Step 1: Write failing UI tests**

Tests assert that entering one customer name can invoke either `Gọi WebRTC` or `Gọi qua Asterisk Mock`, validation applies to both, only one active mode renders, and the Asterisk hangup action returns to the join screen.

- [ ] **Step 2: Run focused UI tests and verify failure**

Run: `npm test -- JoinForm.test.tsx AsteriskCall.test.tsx`

Expected: FAIL because the second mode and component do not exist.

- [ ] **Step 3: Implement mode selection and active-call component**

Retain the existing direct call callback. Add a secondary red-outline button for Asterisk Mock and an active call screen that displays connecting, active, failed, and ended states plus one hangup button.

- [ ] **Step 4: Add responsive styling in the existing TCBS theme**

Reuse the white, red, typography, spacing, and call-control tokens already in `styles.css`. Do not introduce a new visual system or external UI dependency.

- [ ] **Step 5: Run frontend tests, typecheck, and build**

Run: `npm test && npm run typecheck && npm run build`

Expected: all commands PASS.

- [ ] **Step 6: Commit the additive frontend mode**

```bash
git add apps/web/src/App.tsx apps/web/src/components apps/web/src/styles.css apps/web/src/test
git commit -m "feat(web): add Asterisk mock call mode"
```

### Task 8: Wire Docker Compose and local configuration

**Files:**
- Modify: `compose.yaml`
- Modify: `.env.example`

**Interfaces:**
- Voice Bridge health: `http://localhost:8091/health`.
- Mock Asterisk health: `http://localhost:8090/health`.
- Frontend config: `VITE_MOCK_ASTERISK_URL=ws://localhost:8090/call`.

- [ ] **Step 1: Add Voice Bridge service**

Configure LiveKit credentials, `LIVEKIT_URL=ws://livekit:7880`, port `8091`, a 5-second media-start timeout, a 20-second Agent-start timeout, and a 500 ms audio buffer. Depend on LiveKit being started.

- [ ] **Step 2: Add Mock Asterisk service**

Configure `VOICE_BRIDGE_URL=ws://voice-bridge:8091/media`, expose `8090`, add a health check, and depend on Voice Bridge health.

- [ ] **Step 3: Pass browser-visible Mock Asterisk URL to web**

Set `VITE_MOCK_ASTERISK_URL=${VITE_MOCK_ASTERISK_URL:-ws://localhost:8090/call}` and depend on Mock Asterisk health without removing the Token API dependency.

- [ ] **Step 4: Validate the Compose model**

Run: `docker compose config`

Expected: exit code 0; existing `sip`, `egress`, `agent`, `web`, and new services are present.

- [ ] **Step 5: Build the new service images**

Run: `docker compose build voice-bridge mock-asterisk web agent`

Expected: all four images build successfully.

- [ ] **Step 6: Commit Compose wiring**

```bash
git add compose.yaml .env.example
git commit -m "feat(compose): wire Asterisk voice bridge demo"
```

### Task 9: Document and verify all call paths

**Files:**
- Modify: `README.md`

**Interfaces:**
- Documents the same ports, environment variables, protocol boundaries, and test actions implemented in Tasks 1-8.

- [ ] **Step 1: Update the architecture and sequence diagrams**

Show direct WebRTC, LiveKit SIP, and Mock Asterisk WSS as three parallel ingress paths. Show WSS only between Mock/real Asterisk and Voice Bridge, and WebRTC between Voice Bridge and LiveKit.

- [ ] **Step 2: Add exact startup and health commands**

Include:

```powershell
docker compose up -d --build
Invoke-RestMethod http://127.0.0.1:8090/health
Invoke-RestMethod http://127.0.0.1:8091/health
docker compose logs -f mock-asterisk voice-bridge livekit agent
```

- [ ] **Step 3: Add interactive Asterisk Mock test instructions**

Document opening `http://localhost:5173`, entering a name, selecting `Gọi qua Asterisk Mock`, granting microphone access, hearing the greeting, speaking to Gemini, running for five minutes, hanging up, and checking `recordings`.

- [ ] **Step 4: Document regression tests and limitations**

State that MicroSIP remains on `1000@127.0.0.1:5070`, direct WebRTC remains available, SIP transfer remains SIP-only, Mock Asterisk is not a PBX, and production replaces the mock with Asterisk `chan_websocket` plus WSS security.

- [ ] **Step 5: Run all automated verification**

Run in each package:

```powershell
Set-Location apps/token-api; npm test; npm run typecheck
Set-Location ../agent; npm test; npm run typecheck; npm run build
Set-Location ../call-orchestrator; npm test
Set-Location ../voice-bridge; npm test; npm run typecheck; npm run build
Set-Location ../mock-asterisk; npm test; npm run typecheck; npm run build
Set-Location ../web; npm test; npm run typecheck; npm run build
```

Expected: every command exits 0.

- [ ] **Step 6: Run Compose smoke verification**

Run:

```powershell
docker compose up -d --build
docker compose ps
Invoke-RestMethod http://127.0.0.1:8090/health
Invoke-RestMethod http://127.0.0.1:8091/health
```

Expected: Voice Bridge and Mock Asterisk are healthy and existing services retain their previous healthy/up states.

- [ ] **Step 7: Perform manual interactive acceptance**

Use the Asterisk Mock browser mode to verify greeting, bidirectional speech, barge-in, no caller echo, five-minute stable latency, clean hangup, and Egress output. Then smoke-test the direct WebRTC button and MicroSIP path.

- [ ] **Step 8: Commit documentation and final verification fixes**

```bash
git add README.md
git commit -m "docs: document Asterisk WSS voice bridge demo"
```

## Self-Review

- Spec coverage: every included component, protocol, metadata rule, buffering rule, lifecycle requirement, regression requirement, and acceptance criterion maps to Tasks 1-9.
- Deferred ARI and Asterisk transfer work is not included; the existing SIP transfer condition remains unchanged.
- All created interfaces have a producing task before their consuming task.
- No task overwrites the original worktree's modified `apps/agent/package-lock.json`.

