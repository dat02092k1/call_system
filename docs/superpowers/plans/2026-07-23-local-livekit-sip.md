# Local LiveKit SIP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép softphone trên cùng máy Windows gọi trực tiếp vào LiveKit SIP local và nói chuyện hai chiều với Gemini Agent.

**Architecture:** Redis được dùng chung bởi LiveKit Server và LiveKit SIP. Một bootstrap command idempotent trong package Token API tạo inbound trunk và individual dispatch rule; softphone gửi direct SIP INVITE tới host port 5070, caller trở thành SIP participant trong room `sip-call-*`, rồi Agent Worker hiện tại được auto-dispatch.

**Tech Stack:** Docker Compose, Redis 7, LiveKit Server 1.13, LiveKit SIP, Node.js 22, TypeScript, `livekit-server-sdk`, Vitest.

## Global Constraints

- Chỉ demo local trên cùng máy Windows; không PSTN, DID, provider, 3CX hoặc Asterisk.
- Softphone gọi direct SIP URI bằng TCP; LiveKit SIP không nhận `REGISTER`.
- SIP signaling dùng port `5070`; RTP dùng UDP `10000-10100`.
- Dùng development credentials hiện tại `devkey` / `secret`.
- Bootstrap phải idempotent theo tên `local-softphone-trunk` và `local-softphone-dispatch`.
- Không commit Git hoặc tạo worktree.

---

### Task 1: SIP bootstrap domain logic

**Files:**
- Create: `apps/token-api/src/sipBootstrap.ts`
- Create: `apps/token-api/test/sipBootstrap.test.ts`
- Modify: `apps/token-api/package.json`

**Interfaces:**
- Produces: `ensureSipResources(client: SipAdminClient): Promise<{ trunkId: string; dispatchRuleId: string; trunkCreated: boolean; dispatchRuleCreated: boolean }>`
- Produces: `runSipBootstrap(environment?: NodeJS.ProcessEnv): Promise<void>`
- Consumes: `SipClient` from `livekit-server-sdk`.

- [ ] **Step 1: Write failing tests for create and reuse paths**

Create fakes for:

```ts
type SipAdminClient = Pick<
  SipClient,
  "listSipInboundTrunk" | "createSipInboundTrunk" |
  "listSipDispatchRule" | "createSipDispatchRule"
>;
```

Assert that an empty client creates:

```ts
createSipInboundTrunk("local-softphone-trunk", [])
createSipDispatchRule(
  { type: "individual", roomPrefix: "sip-call-" },
  { name: "local-softphone-dispatch", trunkIds: ["ST_test"] },
)
```

Assert that matching names reuse existing IDs and call neither create method.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
docker run --rm -v "${PWD}:/workspace" -w /workspace/apps/token-api node:22-alpine npm test -- sipBootstrap.test.ts
```

Expected: failure because `src/sipBootstrap.ts` does not exist.

- [ ] **Step 3: Implement the minimal idempotent bootstrap**

Use constants:

```ts
export const SIP_TRUNK_NAME = "local-softphone-trunk";
export const SIP_DISPATCH_RULE_NAME = "local-softphone-dispatch";
export const SIP_ROOM_PREFIX = "sip-call-";
```

`runSipBootstrap` requires `LIVEKIT_HTTP_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`, constructs `SipClient`, retries list/create up to 20 times with a one-second delay, and logs only resource IDs/status.

Add:

```json
"sip:bootstrap": "tsx src/sipBootstrap.ts"
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```powershell
docker run --rm -v "${PWD}:/workspace" -w /workspace/apps/token-api node:22-alpine sh -c "npm test && npm run typecheck"
```

Expected: all tests pass and TypeScript exits 0.

### Task 2: Redis and LiveKit SIP Compose services

**Files:**
- Modify: `compose.yaml`

**Interfaces:**
- Consumes: existing `devkey` / `secret`, LiveKit ports and Agent service.
- Produces: `redis`, `sip`, and `sip-bootstrap` Compose services.

- [ ] **Step 1: Add Redis and connect LiveKit Server**

Add `redis:7-alpine` with port `6379`, persistence-free local configuration, `redis-cli ping` health check, and `restart: unless-stopped`.

Change LiveKit command to include:

```yaml
--redis-host redis:6379
```

Make LiveKit depend on healthy Redis.

- [ ] **Step 2: Add LiveKit SIP**

Add `livekit/sip:latest` with `network_mode: host` and `SIP_CONFIG_BODY`:

```yaml
api_key: devkey
api_secret: secret
ws_url: ws://host.docker.internal:7880
redis:
  address: host.docker.internal:6379
sip_port: 5070
rtp_port: 10000-10100
use_external_ip: false
health_port: 8082
logging:
  level: debug
```

The service depends on healthy Redis and started LiveKit, and restarts unless stopped.

- [ ] **Step 3: Add one-shot bootstrap service**

Reuse the Token API image, override command with `npm run sip:bootstrap`, set `LIVEKIT_HTTP_URL=http://livekit:7880`, and depend on Redis/LiveKit. Use `restart: "no"`.

- [ ] **Step 4: Validate Compose**

Run:

```powershell
docker compose config --quiet
docker compose build token-api agent web
```

Expected: configuration and all builds exit 0.

### Task 3: Start and verify the SIP control plane

**Files:**
- Modify only if diagnostics prove a configuration defect.

**Interfaces:**
- Consumes: services from Task 2.
- Produces: one inbound trunk and one dispatch rule usable by direct SIP calls.

- [ ] **Step 1: Verify Docker Desktop host networking**

Run a short container using `--network host` and confirm a host-bound test port is reachable. If Docker reports host networking disabled, stop and instruct the user to enable Docker Desktop → Settings → Resources → Network → Enable host networking.

- [ ] **Step 2: Start the stack**

Run:

```powershell
docker compose up -d --build
docker compose ps
docker compose logs --no-color --tail 100 redis livekit sip sip-bootstrap agent
```

Expected: Redis, LiveKit, SIP and Agent stay running; bootstrap exits 0; worker log contains `registered worker`.

- [ ] **Step 3: Verify idempotency**

Run:

```powershell
docker compose run --rm sip-bootstrap
```

Expected: log reports reuse of the existing trunk and dispatch rule, with no duplicate creation.

- [ ] **Step 4: Inspect LiveKit SIP resources**

Use `SipClient.listSipInboundTrunk()` and `listSipDispatchRule()` through the bootstrap command/logging to confirm exactly one matching trunk and rule, and that the rule references the trunk ID.

### Task 4: Documentation and manual softphone handoff

**Files:**
- Modify: `README.md`
- Modify: `.env.example` only if a new configurable value is introduced.

**Interfaces:**
- Consumes: verified Compose service names, ports and direct SIP URI.
- Produces: complete local setup and troubleshooting instructions.

- [ ] **Step 1: Update architecture diagrams**

Add Redis, Softphone and LiveKit SIP to the Mermaid architecture. Add an inbound SIP sequence from `INVITE` through dispatch, room creation, Agent greeting, RTP audio, and `BYE`.

- [ ] **Step 2: Add Docker Desktop and softphone setup**

Document host networking prerequisite and direct call target:

```text
sip:1000@127.0.0.1:5070;transport=tcp
```

State explicitly that no SIP account/registration is configured.

- [ ] **Step 3: Add troubleshooting**

Cover: host networking disabled, `REGISTER` failure, no SIP INVITE, ringing without answer, one-way/no audio, Windows Firewall, bootstrap duplicate protection, and relevant `docker compose logs` commands.

- [ ] **Step 4: Run final verification**

Run fresh:

```powershell
docker compose config --quiet
docker run --rm -v "${PWD}:/workspace" -w /workspace/apps/token-api node:22-alpine sh -c "npm test && npm run typecheck"
docker run --rm -v "${PWD}:/workspace" -w /workspace/apps/agent node:22-bookworm-slim sh -c "npm test && npm run typecheck && npm run build"
docker run --rm -v "${PWD}:/workspace" -w /workspace/apps/web node:22-alpine sh -c "npm test && npm run typecheck && npm run build"
docker compose ps
```

Expected: every command exits 0; service health/log evidence is reported separately from the manual softphone audio test.
