export function createWebCallRoomName(
  timestamp = Date.now(),
  randomValue = Math.random(),
): string {
  const suffix = Math.floor(randomValue * 1_000_000).toString(36);
  return `web-call-${timestamp}-${suffix}`;
}
