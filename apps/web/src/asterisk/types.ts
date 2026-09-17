export type AsteriskCallDetails = {
  displayName: string;
  phoneNumber: string;
};

export type AsteriskCallState =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "active"; callId: string }
  | { status: "failed"; message: string }
  | { status: "ended" };
