# Gemini Live Callbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an automatically dispatched Vietnamese Gemini Live voice agent to the existing local LiveKit Docker demo.

**Architecture:** A new Node.js agent worker registers with the self-hosted LiveKit server without an agent name, causing prototype automatic dispatch for every new room. Each job creates a Gemini native-audio `AgentSession`; the existing browser renders the agent participant and its remote audio.

**Tech Stack:** Node.js 22, TypeScript, LiveKit Agents 1.x, LiveKit Google plugin 1.x, Gemini Live API, Vitest, React 19, and Docker Compose.

## Global Constraints

- Use `gemini-2.5-flash-native-audio-preview-12-2025` with voice `Puck`.
- The bot speaks concise Vietnamese and greets once per job.
- `GOOGLE_API_KEY` is passed only to the agent container through `.env`.
- Automatic dispatch is prototype-only and intentionally applies to every new room.
- Existing human calling, mute, leave, and remote-audio behavior must remain valid.
- Do not add SIP, persistence, tools, RAG, authentication, or production deployment.
- Do not create branches or Git commits; the user explicitly requested direct implementation.

---

### Task 1: Tested Agent Configuration

**Files:**
- Create: `apps/agent/package.json`
- Create: `apps/agent/tsconfig.json`
- Create: `apps/agent/src/config.ts`
- Create: `apps/agent/src/prompt.ts`
- Test: `apps/agent/test/config.test.ts`
- Test: `apps/agent/test/prompt.test.ts`

**Interfaces:**
- `loadConfig(environment?: NodeJS.ProcessEnv): AgentConfig`
- `AgentConfig`: `{ livekitUrl, livekitApiKey, livekitApiSecret, googleApiKey, model, voice }`
- `AGENT_INSTRUCTIONS: string`
- `GREETING_INSTRUCTIONS: string`

- [ ] **Step 1: Write failing configuration and prompt tests**

Assert that missing credentials name the missing variable without leaking other values, valid input maps to the exact model and voice, instructions require Vietnamese voice-friendly output, and greeting instructions contain the approved Vietnamese greeting.

- [ ] **Step 2: Run the tests in a Node Docker container**

Run:

```powershell
docker run --rm -v "${PWD}:/workspace" -w /workspace/apps/agent node:22-bookworm-slim sh -c "npm install && npm test"
```

Expected: tests fail because the configuration and prompt modules do not exist.

- [ ] **Step 3: Implement the smallest passing configuration and prompt modules**

Required configuration values are `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `GOOGLE_API_KEY`. Export constants for model `gemini-2.5-flash-native-audio-preview-12-2025` and voice `Puck`.

- [ ] **Step 4: Verify tests and TypeScript**

Run `npm test && npm run typecheck` in the same Node container.

Expected: all checks pass.

---

### Task 2: LiveKit Agent Worker

**Files:**
- Create: `apps/agent/src/session.ts`
- Create: `apps/agent/src/agent.ts`
- Create: `apps/agent/Dockerfile`
- Create: `apps/agent/.dockerignore`
- Test: `apps/agent/test/session.test.ts`

**Interfaces:**
- `createSessionOptions(config: AgentConfig)` produces the exact Google realtime model options.
- The default export of `src/agent.ts` is a `defineAgent()` module.
- `ServerOptions.requestFunc` accepts each job with display name `Trợ lý AI`.
- `ServerOptions.agentName` remains unset to preserve automatic dispatch.

- [ ] **Step 1: Write a failing session-options test**

Assert the returned plain options include exact `model`, `voice`, `apiKey`, audio modality defaults, and Vietnamese instructions. Keep this unit boundary provider-independent so tests do not call Google.

- [ ] **Step 2: Run the test and confirm the intended failure**

Expected: failure because `createSessionOptions` is absent.

- [ ] **Step 3: Implement the realtime agent entrypoint**

Use:

```ts
const session = new voice.AgentSession({
  llm: new google.beta.realtime.RealtimeModel(createSessionOptions(config)),
});
await session.start({
  agent: new voice.Agent({ instructions: AGENT_INSTRUCTIONS }),
  room: ctx.room,
});
await session.generateReply({ instructions: GREETING_INSTRUCTIONS });
```

Start the CLI with `new ServerOptions({ agent: fileURLToPath(import.meta.url), requestFunc })`, leaving `agentName` unset. Run the container command as `node dist/agent.js start`.

- [ ] **Step 4: Install dependencies, compile, and run unit tests**

Run `npm install`, `npm test`, `npm run typecheck`, and `npm run build` inside `node:22-bookworm-slim`.

Expected: all commands exit 0.

---

### Task 3: Agent-Aware Frontend

**Files:**
- Modify: `apps/web/src/components/CallRoom.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/test/participantView.test.ts`

**Interfaces:**
- `toParticipantView(participant, localParticipant)` maps LiveKit participants into UI data.
- `ParticipantView` gains `isAgent: boolean`.
- Agent display label is always `Trợ lý AI`.

- [ ] **Step 1: Extract participant mapping and write failing tests**

Use small structural participant fixtures to assert:

- human name remains unchanged;
- agent kind maps to `Trợ lý AI`;
- agent view has `isAgent: true`.

- [ ] **Step 2: Run web tests and verify the new assertions fail**

Run `npm test` inside the existing Node Docker test command.

- [ ] **Step 3: Implement agent card and waiting states**

Add an `AI` badge, distinct agent card/avatar styles, `Đang chờ Trợ lý AI tham gia…` while no agent exists, and a 15-second diagnostic message. Clear the timer when an agent arrives or the component unmounts.

- [ ] **Step 4: Run web tests, type checking, and build**

Expected: all existing and new tests pass; Vite build succeeds.

---

### Task 4: Compose Integration and Live Check

**Files:**
- Modify: `compose.yaml`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Agent receives `LIVEKIT_URL=ws://livekit:7880`, local LiveKit credentials, and `${GOOGLE_API_KEY}`.
- Agent framework health endpoint is available on container port `8081`.

- [ ] **Step 1: Add the agent service**

Build `./apps/agent`, depend on `livekit`, pass only required environment variables, add a health check on `http://localhost:8081`, and use `restart: unless-stopped`.

- [ ] **Step 2: Document key setup**

Add `GOOGLE_API_KEY=replace_with_your_google_ai_studio_key` to `.env.example`. Document copying `.env.example` to `.env`, replacing the key, rebuilding, joining a fresh room, and checking `docker compose logs agent`.

- [ ] **Step 3: Validate and rebuild**

Run:

```powershell
docker compose config --quiet
docker compose up --build -d
docker compose ps
```

Expected: four services run and the token API, web, and agent report healthy.

- [ ] **Step 4: Verify worker registration and all automated checks**

Inspect `docker compose logs agent` for successful worker registration. Re-run agent tests/type checks/build, API tests/type checks, and web tests/type checks/build.

- [ ] **Step 5: Perform the live call check**

Join a new room from `http://localhost:5173`, verify `Trợ lý AI` appears, hear the Vietnamese greeting, speak and receive a Vietnamese response, interrupt one response, then leave and confirm the worker remains healthy.

