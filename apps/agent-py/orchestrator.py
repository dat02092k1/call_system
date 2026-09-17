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


@dataclass(frozen=True)
class CustomerCallContext:
    name_customer: str


def normalize_prompt_value(value: str) -> str:
    return re.sub(r"[\r\n\t]+", " ", value).strip()[:120]


def get_call_orchestrator_url() -> str:
    return os.environ.get("CALL_ORCHESTRATOR_URL", "").strip() or DEFAULT_CALL_ORCHESTRATOR_URL


def _post_call_context(endpoint: str, payload: dict[str, str]) -> CustomerCallContext:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=2) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"Call orchestrator returned HTTP {response.status}")

        data = json.loads(response.read().decode("utf-8"))

    name_customer = normalize_prompt_value(str(data.get("nameCustomer", "")))
    if not name_customer:
        raise RuntimeError("Call orchestrator response is missing nameCustomer")

    return CustomerCallContext(name_customer=name_customer)


async def get_call_context(call_id: str, phone_number: str) -> CustomerCallContext:
    base_url = get_call_orchestrator_url().rstrip("/")
    endpoint = f"{base_url}/api/call-context"
    payload = {
        "callId": call_id,
        "phoneNumber": phone_number,
        "direction": "inbound",
    }

    return await asyncio.to_thread(_post_call_context, endpoint, payload)


def participant_attributes(participant: object) -> Mapping[str, str]:
    attributes = getattr(participant, "attributes", None)
    if isinstance(attributes, Mapping):
        return attributes
    return {}


async def prepare_inbound_call_context(participant: object) -> CustomerCallContext:
    identity = str(getattr(participant, "identity", "") or "")
    attributes = participant_attributes(participant)
    call_id = attributes.get("sip.callID") or f"call-{identity}"
    phone_number = attributes.get("sip.phoneNumber") or identity

    try:
        return await get_call_context(call_id, phone_number)
    except (OSError, urllib.error.URLError, TimeoutError, RuntimeError, ValueError, json.JSONDecodeError) as error:
        print(f"Call orchestrator lookup failed; using fallback customer context: {error}")
        return CustomerCallContext(name_customer=FALLBACK_CUSTOMER_NAME)
