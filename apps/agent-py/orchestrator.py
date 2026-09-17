import asyncio
import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Mapping


FALLBACK_CUSTOMER_NAME = "Quý khách"
DEFAULT_CALL_ORCHESTRATOR_URL = "http://call-orchestrator:3002"

ORCHESTRATOR_ERRORS = (
    OSError,
    urllib.error.URLError,
    TimeoutError,
    RuntimeError,
    ValueError,
    json.JSONDecodeError,
)


@dataclass(frozen=True)
class CustomerCallContext:
    name_customer: str


@dataclass(frozen=True)
class TransferTarget:
    available: bool
    transfer_to: str
    agent_name: str


def normalize_prompt_value(value: str) -> str:
    return re.sub(r"[\r\n\t]+", " ", value).strip()[:120]


def get_call_orchestrator_url() -> str:
    return os.environ.get("CALL_ORCHESTRATOR_URL", "").strip() or DEFAULT_CALL_ORCHESTRATOR_URL


def _post_json(path: str, payload: dict[str, str]) -> dict:
    endpoint = f"{get_call_orchestrator_url().rstrip('/')}{path}"
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=2) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"Call orchestrator returned HTTP {response.status}")

        return json.loads(response.read().decode("utf-8"))


async def get_call_context(call_id: str, phone_number: str) -> CustomerCallContext:
    payload = {
        "callId": call_id,
        "phoneNumber": phone_number,
        "direction": "inbound",
    }
    data = await asyncio.to_thread(_post_json, "/api/call-context", payload)

    name_customer = normalize_prompt_value(str(data.get("nameCustomer", "")))
    if not name_customer:
        raise RuntimeError("Call orchestrator response is missing nameCustomer")

    return CustomerCallContext(name_customer=name_customer)


async def get_transfer_target(call_id: str, phone_number: str, reason: str) -> TransferTarget:
    payload = {
        "callId": call_id,
        "phoneNumber": phone_number,
        "reason": reason.strip(),
    }
    data = await asyncio.to_thread(_post_json, "/api/transfer-target", payload)

    return TransferTarget(
        available=bool(data.get("available")),
        transfer_to=str(data.get("transferTo", "")),
        agent_name=str(data.get("agentName", "")),
    )


def participant_attributes(participant: object) -> Mapping[str, str]:
    attributes = getattr(participant, "attributes", None)
    if isinstance(attributes, Mapping):
        return attributes
    return {}


def resolve_inbound_call_identity(participant: object) -> tuple[str, str]:
    """Ưu tiên attribute của LiveKit SIP, sau đó tới Asterisk voice bridge (`telephony.*`)."""
    identity = str(getattr(participant, "identity", "") or "")
    attributes = participant_attributes(participant)

    call_id = (
        attributes.get("sip.callID")
        or attributes.get("telephony.callId")
        or f"call-{identity}"
    )
    phone_number = (
        attributes.get("sip.phoneNumber")
        or attributes.get("telephony.phoneNumber")
        or identity
    )
    return call_id, phone_number


async def prepare_inbound_call_context(participant: object) -> CustomerCallContext:
    call_id, phone_number = resolve_inbound_call_identity(participant)

    try:
        return await get_call_context(call_id, phone_number)
    except ORCHESTRATOR_ERRORS as error:
        print(f"Call orchestrator lookup failed; using fallback customer context: {error}")
        return CustomerCallContext(name_customer=FALLBACK_CUSTOMER_NAME)
