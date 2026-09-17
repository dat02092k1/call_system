import json

from livekit import api
from livekit.agents import (
    AgentServer,
    AgentSession,
    ConversationItemAddedEvent,
    JobContext,
    JobRequest,
    UserInputTranscribedEvent,
    cli,
    SessionUsageUpdatedEvent,
)
from livekit.plugins import google

from agent import GeminiVoiceAssistant
from orchestrator import prepare_inbound_call_context


server = AgentServer(host="0.0.0.0", port=8081)


async def accept_request(request: JobRequest):
    await request.accept(name="Trợ lý AI")


async def start_room_audio_recording(room_name: str) -> None:
    """Ghi âm cả phòng ra MP3 trong volume /out của service egress."""
    try:
        async with api.LiveKitAPI() as livekit:
            info = await livekit.egress.start_room_composite_egress(
                api.RoomCompositeEgressRequest(
                    room_name=room_name,
                    audio_only=True,
                    file=api.EncodedFileOutput(
                        file_type=api.EncodedFileType.MP3,
                        filepath="/out/{room_name}-{time}.mp3",
                    ),
                )
            )
        print(f"[recording] started room={room_name} egress_id={info.egress_id}")
    except Exception as error:  # noqa: BLE001 - hỏng ghi âm không được chặn cuộc gọi
        print(f"[recording] failed to start room={room_name}: {error}")


def log_transcript(call_id: str, room_name: str, speaker: str, text: str) -> None:
    print(
        json.dumps(
            {
                "event": "conversation-transcript",
                "callId": call_id,
                "roomName": room_name,
                "speaker": speaker,
                "text": text,
            },
            ensure_ascii=False,
        )
    )


@server.rtc_session(on_request=accept_request)
async def entrypoint(ctx: JobContext):
    print(f"Connecting to room: {ctx.room.name}")
    await ctx.connect()
    room_name = ctx.room.name or "unknown-room"
    await start_room_audio_recording(room_name)

    participant = await ctx.wait_for_participant()
    customer_context = await prepare_inbound_call_context(participant)
    call_id = participant.attributes.get("sip.callID") or participant.identity

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

    @session.on("user_input_transcribed")
    def on_user_input_transcribed(ev: UserInputTranscribedEvent):
        text = ev.transcript.strip()
        if ev.is_final and text:
            log_transcript(call_id, room_name, "customer", text)

    @session.on("conversation_item_added")
    def on_conversation_item_added(ev: ConversationItemAddedEvent):
        if getattr(ev.item, "role", None) != "assistant":
            return
        text = (getattr(ev.item, "text_content", None) or "").strip()
        if text:
            log_transcript(call_id, room_name, "assistant", text)

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
