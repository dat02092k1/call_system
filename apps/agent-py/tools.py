import re

from livekit import api
from livekit.agents import RunContext, function_tool, get_job_context
from livekit.agents.beta.tools import EndCallTool

from orchestrator import ORCHESTRATOR_ERRORS, get_transfer_target
from vectordb import VectorDB


vector_db = VectorDB()

# Chỉ chấp nhận đích đến SIP/TEL hợp lệ, chặn header injection qua xuống dòng.
SAFE_TRANSFER_DESTINATION = re.compile(r"^(sip:|tel:)[^\s\r\n]{1,250}$", re.IGNORECASE)


@function_tool
async def search_documents(ctx: RunContext, query: str) -> str:
    """Tool để tìm kiếm thông tin về tài khoản, chứng khoán, giao dịch tiền của công ty Chứng khoán Kỹ thương.

    Args:
        query: Câu hỏi của khách hàng.
    """
    results = vector_db.search(query)
    if not results:
        return "Không tìm được câu trả lời liên quan, hãy thông báo tới khách hàng thông tin chưa được cập nhật."
    # Flatten into something the model can read back to the user
    return "\n\n".join(
        f"[{r['id']}] (score={r['score']:.3f})\n{r['content']}"
        for r in results
    )


def find_sip_participant(room):
    """Người gọi qua SIP trong phòng, nhận biết bằng attribute `sip.callID`."""
    for participant in room.remote_participants.values():
        if participant.attributes.get("sip.callID"):
            return participant
    return None


@function_tool
async def transfer_call(ctx: RunContext, reason: str) -> str:
    """Tool để chuyển tiếp cuộc gọi cho tổng đài viên nếu khách hàng có nhu cầu hoặc gặp câu hỏi không thể trả lời dựa vào context.

    Args:
        reason: Lý do nghiệp vụ cần chuyển sang tổng đài viên.
    """
    room = get_job_context().room
    participant = find_sip_participant(room)
    if participant is None:
        return "Không chuyển tiếp được, hãy hướng dẫn khách hàng liên hệ qua Zalo Techcom Securities."

    try:
        target = await get_transfer_target(
            participant.attributes["sip.callID"],
            participant.attributes.get("sip.phoneNumber") or participant.identity,
            reason,
        )
    except ORCHESTRATOR_ERRORS as error:
        print(f"[transfer] orchestrator lookup failed: {error}")
        return "Không chuyển tiếp được, hãy hướng dẫn khách hàng liên hệ qua Zalo Techcom Securities."

    if not target.available or not SAFE_TRANSFER_DESTINATION.match(target.transfer_to):
        return "Hiện không có tổng đài viên rảnh, hãy hướng dẫn khách hàng liên hệ qua Zalo Techcom Securities."

    await ctx.session.generate_reply(
        instructions="Thông báo sẽ chuyển tiếp cuộc gọi cho nhân viên tổng đài."
    )

    try:
        async with api.LiveKitAPI() as livekit:
            await livekit.sip.transfer_sip_participant(
                api.TransferSIPParticipantRequest(
                    participant_identity=participant.identity,
                    room_name=room.name,
                    transfer_to=target.transfer_to,
                    play_dialtone=True,
                )
            )
    except Exception as error:  # noqa: BLE001 - cold transfer không được làm sập session
        print(f"[transfer] cold transfer failed: {error}")
        return "Không chuyển tiếp được, hãy hướng dẫn khách hàng liên hệ qua Zalo Techcom Securities."

    return f"Đã chuyển cuộc gọi cho {target.agent_name or 'tổng đài viên'}."


end_call = EndCallTool(
    extra_description="Tool để kết thúc cuộc gọi",
    delete_room=True,
    end_instructions="Thông báo xin phép dừng cuộc gọi và chào tạm biệt khách hàng.",
)


tool_list = [
    search_documents,
    transfer_call,
    *end_call.tools,
]
