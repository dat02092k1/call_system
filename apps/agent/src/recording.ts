import {
  EncodedFileOutput,
  EncodedFileType,
  type EgressInfo,
} from "livekit-server-sdk";

export type RoomRecordingClient = {
  startRoomCompositeEgress: (
    roomName: string,
    output: { file: EncodedFileOutput },
    options: { audioOnly: boolean },
  ) => Promise<EgressInfo>;
};

export async function startRoomAudioRecording(
  roomName: string,
  client: RoomRecordingClient,
): Promise<EgressInfo> {
  const file = new EncodedFileOutput({
    fileType: EncodedFileType.MP3,
    filepath: "/out/{room_name}-{time}.mp3",
  });

  return client.startRoomCompositeEgress(
    roomName,
    { file },
    { audioOnly: true },
  );
}
