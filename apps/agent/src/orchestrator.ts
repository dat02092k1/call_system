export type CallContextRequest = {
  callId: string;
  phoneNumber: string;
  direction: "inbound";
};

export type CustomerCallContext = {
  nameCustomer: string;
};

export type TransferTargetRequest = {
  callId: string;
  phoneNumber: string;
  reason: string;
};

export type TransferTarget =
  | { available: false }
  | {
      available: true;
      transferTo: string;
      agentName: string;
    };

export type CallOrchestratorClient = {
  getCallContext(
    request: CallContextRequest,
  ): Promise<CustomerCallContext>;
  getTransferTarget(request: TransferTargetRequest): Promise<TransferTarget>;
};

type FetchImplementation = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export function createCallOrchestratorClient(
  baseUrl: string,
  fetchImplementation: FetchImplementation = fetch,
): CallOrchestratorClient {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  return {
    async getCallContext(request) {
      const response = await fetchImplementation(
        `${normalizedBaseUrl}/api/call-context`,
        {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(2_000),
        },
      );

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

    async getTransferTarget(request) {
      const response = await fetchImplementation(
        `${normalizedBaseUrl}/api/transfer-target`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(2_000),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Call orchestrator returned HTTP ${response.status}`,
        );
      }

      const body = (await response.json()) as Partial<TransferTarget>;
      if (body.available === false) {
        return { available: false };
      }

      const transferTo =
        "transferTo" in body ? body.transferTo?.trim() : undefined;
      const agentName =
        "agentName" in body ? body.agentName?.trim() : undefined;
      if (body.available !== true || !transferTo || !agentName) {
        throw new Error("Call orchestrator returned an invalid transfer target");
      }

      return { available: true, transferTo, agentName };
    },
  };
}

export type SipParticipantInfo = {
  identity: string;
  attributes: Record<string, string>;
};

export async function prepareInboundCallContext(
  participant: SipParticipantInfo,
  client: Pick<CallOrchestratorClient, "getCallContext">,
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
