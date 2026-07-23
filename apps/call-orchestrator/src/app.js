import { createServer } from "node:http";

const sendJson = (response, statusCode, body) => {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
};

const readJsonBody = async (request) => {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) {
      throw new Error("request body is too large");
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

export function createCallOrchestratorServer() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (
      request.method === "POST" &&
      request.url === "/api/call-context"
    ) {
      try {
        const body = await readJsonBody(request);
        const callId = body?.callId?.trim();
        const phoneNumber = body?.phoneNumber?.trim();
        const direction = body?.direction?.trim();

        if (!callId || !phoneNumber || !direction) {
          sendJson(response, 400, {
            error: "callId, phoneNumber and direction are required",
          });
          return;
        }

        console.log(
          JSON.stringify({
            event: "call-context-prepared",
            callId,
            phoneNumber,
            direction,
          }),
        );
        sendJson(response, 200, { nameCustomer: "Nguyễn Văn A" });
      } catch {
        sendJson(response, 400, { error: "invalid JSON request body" });
      }
      return;
    }

    sendJson(response, 404, { error: "not found" });
  });
}
