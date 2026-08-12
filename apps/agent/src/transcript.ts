import type {
  ConversationItemAddedEvent,
  UserInputTranscribedEvent,
} from "@livekit/agents";

export type TranscriptLogEntry = {
  event: "conversation-transcript";
  callId: string;
  roomName: string;
  speaker: "customer" | "assistant";
  text: string;
};

type TranscriptContext = {
  callId: string;
  roomName: string;
};

type TranscriptWriter = (entry: TranscriptLogEntry) => void;

const defaultWriter: TranscriptWriter = (entry) => {
  console.log(JSON.stringify(entry));
};

export function createTranscriptLogHandlers(
  context: TranscriptContext,
  write: TranscriptWriter = defaultWriter,
) {
  return {
    onUserInputTranscribed(event: UserInputTranscribedEvent) {
      const text = event.transcript.trim();
      if (!event.isFinal || !text) return;

      write({
        event: "conversation-transcript",
        ...context,
        speaker: "customer",
        text,
      });
    },

    onConversationItemAdded(event: ConversationItemAddedEvent) {
      if (event.item.type !== "message" || event.item.role !== "assistant") {
        return;
      }

      const text = event.item.textContent?.trim();
      if (!text) return;

      write({
        event: "conversation-transcript",
        ...context,
        speaker: "assistant",
        text,
      });
    },
  };
}
