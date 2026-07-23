# Local LiveKit Call System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Docker Compose development stack in which two browser clients can join the same LiveKit room and make an audio call.

**Architecture:** Docker Compose runs the official LiveKit server, an Express/TypeScript token API, and a React/Vite web client. The API owns signing credentials and returns room-scoped tokens; browsers connect directly to LiveKit and publish microphone tracks.

**Tech Stack:** Docker Compose, LiveKit Server, Node.js 22, TypeScript, Express, Vitest, Supertest, React 19, Vite, LiveKit React Components, Testing Library, and Playwright.

## Global Constraints

- One `docker compose up --build` command starts the complete stack.
- The first release is audio-only and contains no authentication, persistence, recording, SIP, video, screen sharing, or AI agent.
- Display names contain 1–64 trimmed characters and no control characters.
- Room names match `[A-Za-z0-9_-]{1,64}`.
- Access tokens expire after 10 minutes and grant access only to the requested room.
- The LiveKit API secret must never enter the browser bundle.
- Local credentials are development-only and must be documented as unsafe for production.

## File Map

- `.env.example`: documented local configuration.
- `.gitignore`: secret, dependency, build, test, and editor exclusions.
- `compose.yaml`: the three-service local stack and health checks.
- `README.md`: setup, use, test, troubleshooting, and production warnings.
- `apps/token-api/src/config.ts`: validated server configuration.
- `apps/token-api/src/validation.ts`: input normalization and validation.
- `apps/token-api/src/token.ts`: LiveKit token creation.
- `apps/token-api/src/app.ts`: Express routes and safe error responses.
- `apps/token-api/src/server.ts`: HTTP process entrypoint.
- `apps/token-api/test/app.test.ts`: API behavior and token-claim tests.
- `apps/web/src/api.ts`: typed token API client.
- `apps/web/src/components/JoinForm.tsx`: disconnected-state form.
- `apps/web/src/components/CallRoom.tsx`: room lifecycle, participants, and controls.
- `apps/web/src/App.tsx`: application state boundary.
- `apps/web/src/styles.css`: responsive, accessible presentation.
- `apps/web/src/test/*.test.tsx`: UI behavior tests.
- `e2e/call.spec.ts`: two-context real-room smoke test.
- `playwright.config.ts`: smoke-test configuration.

---

### Task 1: Token API

**Files:**
- Create: `apps/token-api/package.json`
- Create: `apps/token-api/tsconfig.json`
- Create: `apps/token-api/Dockerfile`
- Create: `apps/token-api/src/config.ts`
- Create: `apps/token-api/src/validation.ts`
- Create: `apps/token-api/src/token.ts`
- Create: `apps/token-api/src/app.ts`
- Create: `apps/token-api/src/server.ts`
- Test: `apps/token-api/test/app.test.ts`

**Interfaces:**
- Consumes: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `PORT`, and optional `CORS_ORIGIN`.
- Produces: `GET /health` and `POST /api/token` with body `{ roomName: string, displayName: string }`.
- Token response: `{ token: string, identity: string, displayName: string, roomName: string }`.
- Error response: `{ error: string, fields?: Record<string, string> }`.

- [ ] **Step 1: Create the API package and write failing endpoint tests**

Write tests that construct `createApp()` with a deterministic `issueToken` dependency. Assert health status, validation errors, normalized values, unique identities, room-scoped decoded claims, CORS behavior, and generic `500` responses.

- [ ] **Step 2: Run the API tests and verify the missing implementation failure**

Run: `npm install && npm test` from `apps/token-api`.

Expected: tests fail because `src/app.ts` and its dependencies do not exist.

- [ ] **Step 3: Implement validation, token issuance, routes, and process startup**

Implement:

```ts
export type TokenRequest = { roomName: string; displayName: string };
export function validateTokenRequest(input: unknown):
  | { ok: true; value: TokenRequest }
  | { ok: false; fields: Record<string, string> };
```

Use `crypto.randomUUID()` in the identity, `new AccessToken(key, secret, { identity, name, ttl: "10m" })`, and `addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true })`.

- [ ] **Step 4: Run type checking and API tests**

Run: `npm run typecheck && npm test` from `apps/token-api`.

Expected: all checks pass.

- [ ] **Step 5: Commit the independently working API**

```bash
git add apps/token-api
git commit -m "feat: add LiveKit token API"
```

---

### Task 2: React Call Client

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/tsconfig.app.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/Dockerfile`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/api.ts`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/components/JoinForm.tsx`
- Create: `apps/web/src/components/CallRoom.tsx`
- Create: `apps/web/src/styles.css`
- Create: `apps/web/src/test/setup.ts`
- Test: `apps/web/src/test/JoinForm.test.tsx`
- Test: `apps/web/src/test/App.test.tsx`

**Interfaces:**
- Consumes: `VITE_TOKEN_API_URL`, `VITE_LIVEKIT_URL`, and `POST /api/token`.
- Produces: accessible join, connection status, participant list, mute/unmute, and leave UI.
- `requestToken(input: TokenRequest): Promise<TokenResponse>` is the only frontend API boundary.

- [ ] **Step 1: Create the web package and write failing form/application tests**

Test trimmed submission, invalid room names, disabled submit state, API failure display, and transition from join form to call view after a successful token response.

- [ ] **Step 2: Run tests and verify the missing component failure**

Run: `npm install && npm test` from `apps/web`.

Expected: tests fail because application components do not exist.

- [ ] **Step 3: Implement the typed API client and join form**

`requestToken` sends JSON, checks `response.ok`, parses structured API errors, and throws an `Error` with user-safe text. `JoinForm` uses the same display and room constraints as the API and prevents duplicate submission.

- [ ] **Step 4: Implement explicit LiveKit room lifecycle**

Create one `Room` per connected session, provide it through `RoomContext.Provider`, connect with the returned token, enable the microphone, render remote audio with `RoomAudioRenderer`, and disconnect on leave or unmount. Use LiveKit participant hooks/events to render local and remote microphone state.

- [ ] **Step 5: Run frontend tests, type checking, and production build**

Run: `npm run typecheck && npm test && npm run build` from `apps/web`.

Expected: all tests pass and Vite emits `dist/`.

- [ ] **Step 6: Commit the independently testable client**

```bash
git add apps/web
git commit -m "feat: add browser audio call client"
```

---

### Task 3: Docker Compose Stack

**Files:**
- Create: `.env.example`
- Create: `.gitignore`
- Create: `compose.yaml`
- Modify: `apps/token-api/Dockerfile`
- Modify: `apps/web/Dockerfile`

**Interfaces:**
- Consumes: a root `.env` copied from `.env.example`.
- Produces: web on `http://localhost:5173`, token API on `http://localhost:3001`, LiveKit signaling on `ws://localhost:7880`, ICE/TCP on `7881`, and ICE/UDP on `7882/udp`.

- [ ] **Step 1: Write the Compose configuration and environment example**

Use `livekit/livekit-server` with `--dev --bind 0.0.0.0`. Pass `devkey` and `secret` only to LiveKit and the API. Configure API and web health checks using Node-based HTTP requests available in the Node image.

- [ ] **Step 2: Validate Compose interpolation**

Run: `Copy-Item .env.example .env; docker compose config --quiet`.

Expected: exit code 0 with no interpolation warnings.

- [ ] **Step 3: Build all images**

Run: `docker compose build`.

Expected: API and web images build successfully and dependency lockfiles are used.

- [ ] **Step 4: Start the stack and inspect health**

Run: `docker compose up -d`.

Then run: `docker compose ps`.

Expected: all three services are running; API and web are healthy.

- [ ] **Step 5: Verify service endpoints**

Run:

```powershell
Invoke-RestMethod http://localhost:3001/health
Invoke-WebRequest http://localhost:5173 -UseBasicParsing
Invoke-WebRequest http://localhost:7880 -UseBasicParsing
```

Expected: API returns `{ status: "ok" }`, web returns HTTP 200, and LiveKit responds on port 7880.

- [ ] **Step 6: Commit the runnable container stack**

```bash
git add .env.example .gitignore compose.yaml apps/token-api/Dockerfile apps/web/Dockerfile
git commit -m "feat: run LiveKit call stack with Docker Compose"
```

---

### Task 4: End-to-End Call Test

**Files:**
- Create: `package.json`
- Create: `playwright.config.ts`
- Create: `e2e/call.spec.ts`

**Interfaces:**
- Consumes: the running Compose stack at `http://localhost:5173`.
- Produces: `npm run test:e2e`, verifying two independent participants and propagated microphone state.

- [ ] **Step 1: Add a failing two-context browser test**

Create two Chromium contexts with microphone permission and fake media flags. Join both with room `smoke-room`, assert each sees two participant cards, mute the first, assert the second sees the muted state, leave the first, and assert the second sees one participant.

- [ ] **Step 2: Install Playwright dependencies and confirm the initial failure**

Run: `npm install && npx playwright install chromium && npm run test:e2e`.

Expected: fail if any UI selector or call behavior is incomplete.

- [ ] **Step 3: Correct only the call behavior exposed by the smoke test**

Keep stable accessible names and `data-testid="participant-<identity>"` identifiers. Wait on participant events rather than fixed timeouts.

- [ ] **Step 4: Re-run the smoke test**

Run: `npm run test:e2e`.

Expected: one passing Chromium test with two connected participants.

- [ ] **Step 5: Commit the smoke test**

```bash
git add package.json package-lock.json playwright.config.ts e2e
git commit -m "test: verify two-party LiveKit call"
```

---

### Task 5: Documentation and Final Verification

**Files:**
- Create: `README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the completed stack and its commands.
- Produces: a copy-paste local setup guide and troubleshooting reference.

- [ ] **Step 1: Write the operating guide**

Document prerequisites, `.env` creation, `docker compose up --build`, opening two browsers, headphone usage to avoid feedback, test commands, logs, shutdown, microphone permissions, Windows Docker Desktop networking, and the explicit production-security limitations.

- [ ] **Step 2: Run all static and unit verification**

Run API type checking/tests and web type checking/tests/build.

Expected: every command exits 0.

- [ ] **Step 3: Rebuild and run the clean Compose stack**

Run: `docker compose down`, `docker compose up --build -d`, and `docker compose ps`.

Expected: clean startup with healthy API and web services.

- [ ] **Step 4: Run the real browser smoke test**

Run: `npm run test:e2e`.

Expected: all Playwright tests pass.

- [ ] **Step 5: Inspect the final change set**

Run: `git status --short` and `git diff --check`.

Expected: only intended files remain and no whitespace errors are reported.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md .gitignore
git commit -m "docs: add local call system guide"
```

