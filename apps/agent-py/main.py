from livekit.agents import (
    AgentServer,
    AgentSession,
    JobContext,
    JobRequest,
    cli,
    SessionUsageUpdatedEvent,
)
from livekit.plugins import google

from agent import GeminiVoiceAssistant
from orchestrator import prepare_inbound_call_context


server = AgentServer(host="0.0.0.0", port=8081)


async def accept_request(request: JobRequest):
    await request.accept(name="Trợ lý AI")


@server.rtc_session(on_request=accept_request)
async def entrypoint(ctx: JobContext):
    print(f"Connecting to room: {ctx.room.name}")
    await ctx.connect()
    participant = await ctx.wait_for_participant()
    customer_context = await prepare_inbound_call_context(participant)

    session = AgentSession(
        tts=google.beta.GeminiTTS(
            model="gemini-3.1-flash-tts-preview",
            voice_name="Aoede",
        ),
    )

    async def log_usage():
        for usage in session.usage.model_usage:
            print(f"{usage.provider}/{usage.model}: {usage}")

    ctx.add_shutdown_callback(log_usage)

    @session.on("session_usage_updated")
    def on_session_usage_updated(ev: SessionUsageUpdatedEvent):
        for usage in ev.usage.model_usage:
            print(f"{usage.provider}/{usage.model}: {usage}")

    await session.start(
        agent=GeminiVoiceAssistant(customer_context.name_customer),
        room=ctx.room,
    )
    print("Agent session fully established and listening.")

    await session.say(
        "Kính chào quý khách, em là trợ lý thông minh của Công ty Cổ phần Chứng khoán Kỹ thương TCBS, em có thể giúp gì cho quý khách ạ?",
        allow_interruptions=True,
    )


if __name__ == "__main__":
    cli.run_app(server)
