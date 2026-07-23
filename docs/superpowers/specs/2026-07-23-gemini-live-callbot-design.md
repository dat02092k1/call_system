# Gemini Live Callbot Design

## Objective

Extend the existing local LiveKit audio-call demo with a Vietnamese AI callbot. When a human participant creates a room, LiveKit automatically dispatches one backend agent participant into that room. The agent greets the caller and holds a low-latency, interruptible voice conversation through the Google Gemini Live API.

## Scope

This demo includes:

- One automatically dispatched agent per newly created room
- Vietnamese speech input and output
- A proactive Vietnamese greeting
- Direct speech-to-speech inference with Gemini Live
- Natural interruption handling using Gemini's built-in voice activity detection
- A fourth Docker Compose service for the agent worker
- Frontend identification of the AI participant
- Safe configuration through `GOOGLE_API_KEY`
- Agent health, configuration, and UI tests

This demo excludes:

- SIP or PSTN phone numbers
- Authentication and authorization
- Persistent transcripts or call history
- Business tools, RAG, or external actions
- Human-agent handoff
- Production deployment and scaling
- Multiple agent personas

## Architecture

### Existing services

The existing services keep their current responsibilities:

- `livekit` handles rooms, WebRTC media, participants, and agent dispatch.
- `token-api` issues room-scoped participant tokens.
- `web` captures the caller's microphone, renders remote audio, and displays room participants.

### Agent worker

A new Node.js and TypeScript `agent` service runs the LiveKit Agents framework and the Google Gemini plugin. It connects to the LiveKit server over the Docker network at `ws://livekit:7880` using the local `devkey` and `secret`.

The worker does not set an agent dispatch name. LiveKit therefore applies automatic dispatch and assigns the worker to every newly created room. This is intentional for the prototype because every room requires the same bot. Explicit dispatch will replace it if the application later needs different agents or room-specific metadata.

Each dispatched job creates a new `AgentSession` backed by:

- Model: `gemini-2.5-flash-native-audio-preview-12-2025`
- Voice: `Puck`
- Response modality: audio
- Turn detection: Gemini Live built-in voice activity detection
- API credential: `GOOGLE_API_KEY`

The agent joins as an agent-kind participant and uses the display name `Trợ lý AI`.

## Call Flow

1. The user opens the existing web client, enters a display name and room name, and requests a token.
2. The user connects to LiveKit and publishes the microphone.
3. Creating the room triggers LiveKit automatic agent dispatch.
4. The registered worker accepts the job and joins the room as `Trợ lý AI`.
5. The worker starts a Gemini Live session and connects room audio to the realtime model.
6. After the agent session starts, the agent generates one proactive Vietnamese greeting: “Xin chào, tôi là trợ lý AI. Tôi có thể giúp gì cho bạn?”
7. Gemini receives the caller's audio and publishes generated speech back through the agent participant.
8. If the caller starts speaking while the agent is responding, built-in activity detection interrupts the response and processes the new turn.
9. When the room job ends, the worker closes the Gemini session and releases its LiveKit resources while remaining available for new jobs.

## Agent Behavior

The system instructions require the agent to:

- Communicate only in Vietnamese unless it must repeat a proper name or technical term
- Use short, natural sentences suitable for a spoken conversation
- Ask one clear follow-up question when the caller's request is ambiguous
- Avoid Markdown, lists, URLs, and code formatting in spoken responses
- Never claim that it performed an external action because this demo has no tools
- Admit uncertainty instead of inventing facts
- Allow the caller to interrupt
- Avoid repeating the greeting after reconnects within the same job
- Respond politely when the caller wants to stop

## Frontend Changes

The participant view will use LiveKit's participant kind to distinguish agents from humans.

For an agent participant, the UI will:

- Display `Trợ lý AI` as the participant name
- Display an `AI` badge
- Use a distinct avatar treatment
- Continue showing its microphone state

While only the local caller is present, the room status reads `Đang chờ Trợ lý AI tham gia…`. When the agent joins, the normal participant count is shown. If the agent has not appeared after 15 seconds, the UI displays a non-blocking diagnostic message instructing the developer to inspect `docker compose logs agent`.

The existing join, mute, leave, and remote-audio behavior remains unchanged.

## Configuration and Secrets

The root `.env` file contains:

```env
GOOGLE_API_KEY=replace_with_your_google_ai_studio_key
```

`.env.example` contains only the non-secret example value shown above. `.env` remains ignored by Git.

Docker Compose passes `GOOGLE_API_KEY` only to the agent container. The token API, web service, LiveKit service, image layers, frontend bundle, logs, and error responses must not expose it.

The agent also receives:

- `LIVEKIT_URL=ws://livekit:7880`
- `LIVEKIT_API_KEY=devkey`
- `LIVEKIT_API_SECRET=secret`

The development credentials remain local-only and are not safe for production.

## Health and Error Handling

The agent process validates all required environment variables before registering with LiveKit. A missing or blank value stops startup with a message naming the missing variable but never prints its value.

The agent service exposes its framework health endpoint to Docker Compose. Compose waits for LiveKit before starting the worker and restarts the worker after process failure.

Runtime behavior:

- Invalid or quota-exhausted Google credentials cause the current job to fail with a sanitized log message.
- Transient Gemini or LiveKit disconnections use the framework's normal reconnect and job lifecycle behavior.
- A failed job does not terminate the worker process unless the failure is process-wide.
- If the agent crashes during this prototype, Docker restarts the worker. The current caller may need to leave and create a new room.
- Leaving the room ends the agent job and closes model resources.

## Testing

### Agent tests

Automated tests cover:

- Required environment validation
- The selected Gemini model and voice configuration
- Vietnamese system instructions
- The exact proactive greeting
- One greeting per agent job
- Sanitized failure logging

Model construction and the session boundary are injected so unit tests do not call the Gemini API.

### Frontend tests

Automated tests cover:

- Agent-kind participants render as `Trợ lý AI`
- The AI badge and agent avatar treatment
- The waiting message before the agent arrives
- The 15-second diagnostic state
- Existing human participant and call-control behavior remains valid

### Infrastructure checks

Verification includes:

- Docker Compose configuration parsing
- Successful agent image build
- Agent health state
- Worker registration in LiveKit logs
- Existing API and web tests, type checks, and build

### Live integration check

With a valid free-tier Google AI Studio key:

1. Start the complete stack with `docker compose up --build`.
2. Join a new room from the browser.
3. Confirm `Trợ lý AI` appears within 10 seconds.
4. Confirm the proactive Vietnamese greeting is audible.
5. Speak Vietnamese and receive an audible Vietnamese response.
6. Interrupt the agent while it is speaking and confirm it handles the new turn.
7. Leave the room and confirm the job exits while the worker remains healthy.

## Completion Criteria

The callbot demo is complete when:

- One Docker Compose command starts LiveKit, the token API, web client, and agent worker.
- The Google API key is provided only through `.env` to the agent service.
- Every newly created room receives exactly one agent.
- The bot is visibly identified as `Trợ lý AI`.
- The bot proactively greets the caller in Vietnamese.
- Two-way Vietnamese voice conversation and interruption work.
- Leaving the room cleans up the agent job.
- All automated tests, type checks, builds, health checks, and the live integration check pass.
