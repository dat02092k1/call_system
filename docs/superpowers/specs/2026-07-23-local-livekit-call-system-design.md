# Local LiveKit Call System Design

## Objective

Build a local, audio-only, browser-to-browser calling system using LiveKit. A developer must be able to start the complete stack with one `docker compose up --build` command and join the same call from two browser tabs or browser instances.

This first version establishes a clean base for future video, authentication, recording, SIP telephony, and AI-agent features without implementing them prematurely.

## Scope

The first version includes:

- Room-name and display-name entry
- Browser microphone capture
- Browser-to-browser audio
- Join and leave controls
- Microphone mute and unmute
- A connected-participant list
- Connection and error status
- Docker Compose orchestration for every service
- Automated API, frontend, configuration, and browser smoke tests

The first version excludes:

- User accounts and production authentication
- Persistent users, rooms, or call history
- Video and screen sharing
- Recording and media export
- SIP or PSTN calling
- AI agents
- Production deployment configuration

## Architecture

The system has three independently deployable services.

### LiveKit server

The LiveKit container provides WebSocket signaling and WebRTC media routing. It uses fixed local-development API credentials supplied through environment configuration and exposes the required signaling and media ports to the host.

The local deployment is intentionally single-node. Production clustering, TLS termination, TURN infrastructure, and regional routing are outside this design.

### Token API

A Node.js and TypeScript Express service issues LiveKit access tokens with a 10-minute lifetime. The client sends a room name and display name to `POST /api/token`. The API validates both values, creates a unique participant identity, and signs a token that grants permission only to join the requested room. `GET /health` returns the service health state.

The API secret remains server-side and is never included in the browser bundle. The service also exposes a health endpoint used by Docker Compose.

### Web client

A React, TypeScript, and Vite application provides the user interface. It uses LiveKit's React components and JavaScript client SDK to connect to a room, publish microphone audio, subscribe to remote audio, track participants, and expose call controls.

The web service runs in its own development container. The browser accesses it on `http://localhost:5173`.

## Data Flow

1. The user opens the local React application.
2. The user enters a display name and room name and selects **Join call**.
3. The client requests an access token from the token API.
4. The token API validates the request and returns a short-lived, room-scoped token with a unique participant identity.
5. The client connects directly to the LiveKit server using the token.
6. After microphone permission is granted, the client publishes the local microphone track.
7. Other clients in the same room subscribe to the published audio track.
8. LiveKit events update connection state and the participant list.
9. Muting disables publication of microphone audio without leaving the room.
10. Leaving disconnects the client, releases its local media tracks, and returns the UI to the join form.

## User Interface

The disconnected view contains:

- Display-name input
- Room-name input
- Join-call button
- Inline validation and connection errors

The connected view contains:

- Current room name
- Connection status
- Participant cards showing display name and microphone state
- A message when the caller is alone
- Mute or unmute button
- Leave-call button

The UI prioritizes clear call state and basic accessibility over visual complexity. Controls have text labels, keyboard access, focus states, and status announcements where appropriate.

## Configuration

The project includes a committed `.env.example` documenting all required values. Developers copy it to `.env` for local use. Docker Compose passes private values only to services that need them and exposes public service URLs to the web client.

Local development credentials are explicitly marked unsafe for production. No production secrets are committed.

The browser connects through host-visible URLs such as `localhost`, not Docker-internal service names. Containers use Docker service discovery for their own service-to-service health checks.

## Validation and Error Handling

The token API accepts a JSON object and extracts only `roomName` and `displayName`. It validates:

- Room and display names are strings
- The trimmed display name contains 1–64 characters and no control characters
- The trimmed room name matches `[A-Za-z0-9_-]{1,64}`
- Unknown request fields do not affect token claims

Invalid input receives a structured `400` response. Unexpected failures receive a generic `500` response without leaking secrets. A participant identity includes a generated unique suffix, allowing multiple tabs to use the same display name.

The client provides actionable feedback for:

- Invalid form values
- Token API unavailability or rejection
- Microphone permission denial
- LiveKit connection failure
- Connecting, connected, reconnecting, and disconnected states

Join operations cannot be submitted repeatedly while a connection attempt is active. Failed joins clean up partially acquired media or room resources before allowing a retry.

## Testing and Verification

### Token API

Automated tests cover:

- Health response
- Valid token issuance
- Required-field validation
- Length and character validation
- Unique participant identities
- Safe handling of internal errors
- Decoding issued tokens to verify room and permission claims

### Web client

Component tests cover:

- Join-form validation
- Disabled state during connection
- Display of connection errors
- Connected call controls
- Mute and leave interactions
- Empty-room and participant-list states

### Infrastructure

Verification includes:

- Docker Compose configuration parsing
- Successful image builds
- Container health checks
- LiveKit signaling availability
- Token API availability from the browser-facing network

### Browser smoke test

An automated smoke test launches two isolated browser contexts, grants microphone permission with synthetic media, joins both to the same room, and verifies that:

- Both participants reach the connected state
- Each client sees two participants
- Microphone tracks are published
- Mute state propagates to the other client
- Leaving removes the participant from the remaining client's list

## Completion Criteria

The feature is complete when a developer can:

1. Copy `.env.example` to `.env`.
2. Run `docker compose up --build`.
3. Open two browser instances at the documented local URL.
4. Join both using the same room name.
5. Hear browser-to-browser audio.
6. Observe participant presence and microphone state.
7. Mute, unmute, leave, and rejoin without restarting the stack.
8. Run the documented automated verification commands successfully.
