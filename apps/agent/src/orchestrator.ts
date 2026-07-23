export type CallContextRequest = {
  callId: string;
  phoneNumber: string;
  direction: "inbound";
};

export type CustomerCallContext = {
  nameCustomer: string;
};

export type CallOrchestratorClient = {
  getCallContext(
    request: CallContextRequest,
  ): Promise<CustomerCallContext>;
};

type FetchImplementation = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export function createCallOrchestratorClient(
  baseUrl: string,
  fetchImplementation: FetchImplementation = fetch,
): CallOrchestratorClient {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/api/call-context`;

  return {
    async getCallContext(request) {
      const response = await fetchImplementation(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(2_000),
      });

      if (!response.ok) {
        throw new Error(
          `Call orchestrator returned HTTP ${response.status}`,
        );
      }

      const body = (await response.json()) as Partial<CustomerCallContext>;
      const nameCustomer = body.nameCustomer?.trim();
      if (!nameCustomer) {
        throw new Error("Call orchestrator response is missing nameCustomer");
      }

      return { nameCustomer };
    },
  };
}

export type SipParticipantInfo = {
  identity: string;
  attributes: Record<string, string>;
};

export async function prepareInboundCallContext(
  participant: SipParticipantInfo,
  client: CallOrchestratorClient,
): Promise<CustomerCallContext> {
  const callId =
    participant.attributes["sip.callID"] || `call-${participant.identity}`;
  const phoneNumber =
    participant.attributes["sip.phoneNumber"] || participant.identity;

  try {
    return await client.getCallContext({
      callId,
      phoneNumber,
      direction: "inbound",
    });
  } catch (error) {
    console.warn(
      "Call orchestrator lookup failed; using fallback customer context",
      error instanceof Error ? error.message : error,
    );
    return { nameCustomer: "Quý khách" };
  }
}
