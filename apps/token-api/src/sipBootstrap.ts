import { SipClient } from "livekit-server-sdk";
import { fileURLToPath } from "node:url";

export const SIP_TRUNK_NAME = "local-softphone-trunk";
export const SIP_DISPATCH_RULE_NAME = "local-softphone-dispatch";
export const SIP_ROOM_PREFIX = "sip-call-";
export const SIP_LOCAL_NUMBER = "1000";

export type SipAdminClient = Pick<
  SipClient,
  | "listSipInboundTrunk"
  | "createSipInboundTrunk"
  | "listSipDispatchRule"
  | "createSipDispatchRule"
>;

export type SipBootstrapResult = {
  trunkId: string;
  dispatchRuleId: string;
  trunkCreated: boolean;
  dispatchRuleCreated: boolean;
};

export type SipBootstrapConfig = {
  livekitHttpUrl: string;
  apiKey: string;
  apiSecret: string;
};

export function loadSipBootstrapConfig(
  environment: NodeJS.ProcessEnv = process.env,
): SipBootstrapConfig {
  const livekitHttpUrl = environment.LIVEKIT_HTTP_URL?.trim();
  const apiKey = environment.LIVEKIT_API_KEY?.trim();
  const apiSecret = environment.LIVEKIT_API_SECRET?.trim();

  if (!livekitHttpUrl || !apiKey || !apiSecret) {
    throw new Error(
      "LIVEKIT_HTTP_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required",
    );
  }

  return { livekitHttpUrl, apiKey, apiSecret };
}

const waitOneSecond = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 1_000);
  });

export async function retry<T>(
  operation: () => Promise<T>,
  attempts = 20,
  sleep: () => Promise<void> = waitOneSecond,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep();
      }
    }
  }

  throw lastError;
}

export async function ensureSipResources(
  client: SipAdminClient,
): Promise<SipBootstrapResult> {
  const trunks = await client.listSipInboundTrunk();
  let trunk = trunks.find(({ name }) => name === SIP_TRUNK_NAME);
  const trunkCreated = !trunk;

  if (!trunk) {
    trunk = await client.createSipInboundTrunk(SIP_TRUNK_NAME, [
      SIP_LOCAL_NUMBER,
    ]);
  }

  const rules = await client.listSipDispatchRule();
  let dispatchRule = rules.find(
    ({ name }) => name === SIP_DISPATCH_RULE_NAME,
  );
  const dispatchRuleCreated = !dispatchRule;

  if (!dispatchRule) {
    dispatchRule = await client.createSipDispatchRule(
      { type: "individual", roomPrefix: SIP_ROOM_PREFIX },
      {
        name: SIP_DISPATCH_RULE_NAME,
        trunkIds: [trunk.sipTrunkId],
      },
    );
  }

  return {
    trunkId: trunk.sipTrunkId,
    dispatchRuleId: dispatchRule.sipDispatchRuleId,
    trunkCreated,
    dispatchRuleCreated,
  };
}

export type SipClientFactory = (
  config: SipBootstrapConfig,
) => SipAdminClient;

const createSipClient: SipClientFactory = ({
  livekitHttpUrl,
  apiKey,
  apiSecret,
}) => new SipClient(livekitHttpUrl, apiKey, apiSecret);

export async function runSipBootstrap(
  environment: NodeJS.ProcessEnv = process.env,
  createClient: SipClientFactory = createSipClient,
): Promise<SipBootstrapResult> {
  const config = loadSipBootstrapConfig(environment);
  const client = createClient(config);
  return retry(() => ensureSipResources(client));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSipBootstrap()
    .then((result) => {
      console.log(
        JSON.stringify({
          event: "sip-bootstrap-complete",
          ...result,
        }),
      );
    })
    .catch((error: unknown) => {
      console.error(
        "SIP bootstrap failed:",
        error instanceof Error ? error.message : error,
      );
      process.exitCode = 1;
    });
}
