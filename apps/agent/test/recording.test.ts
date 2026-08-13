import { EncodedFileType } from "livekit-server-sdk";
import { describe, expect, it, vi } from "vitest";
import { startRoomAudioRecording } from "../src/recording.js";

describe("startRoomAudioRecording", () => {
  it("starts an audio-only room recording as an MP3 in the mounted output directory", async () => {
    const startRoomCompositeEgress = vi.fn().mockResolvedValue({
      egressId: "EG_demo",
    });

    const result = await startRoomAudioRecording(
      "sip-call-demo",
      { startRoomCompositeEgress },
    );

    expect(result).toEqual({ egressId: "EG_demo" });
    expect(startRoomCompositeEgress).toHaveBeenCalledOnce();

    const [roomName, output, options] =
      startRoomCompositeEgress.mock.calls[0];
    expect(roomName).toBe("sip-call-demo");
    expect(options).toEqual({ audioOnly: true });
    expect(output.file.fileType).toBe(EncodedFileType.MP3);
    expect(output.file.filepath).toBe(
      "/out/{room_name}-{time}.mp3",
    );
  });
});
