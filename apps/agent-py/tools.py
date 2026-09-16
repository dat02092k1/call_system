from livekit.agents import RunContext, function_tool
from livekit.agents.beta.tools import EndCallTool

from vectordb import VectorDB


vector_db = VectorDB()


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


@function_tool
async def transfer_call(ctx: RunContext) -> None:
    """Tool để chuyển tiếp cuộc gọi cho tổng đài viên nếu khách hàng có nhu cầu hoặc gặp câu hỏi không thể trả lời dựa vào context."""
    await ctx.session.generate_reply(
        instructions="Thông báo sẽ chuyển tiếp cuộc gọi cho nhân viên tổng đài."
    )

    if hasattr(ctx, "session") and ctx.session:
        await ctx.session.aclose()
    elif hasattr(ctx, "room") and ctx.room:
        await ctx.room.disconnect()



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
