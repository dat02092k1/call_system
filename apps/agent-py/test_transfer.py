"""Self-check: chạy `python test_transfer.py` (không cần GOOGLE_API_KEY)."""
import sys
import types as _types

# VectorDB được khởi tạo ngay khi import tools.py và cần GOOGLE_API_KEY -> stub nó.
_stub = _types.ModuleType("vectordb")
_stub.VectorDB = lambda *a, **k: None
sys.modules.setdefault("vectordb", _stub)

from orchestrator import resolve_inbound_call_identity  # noqa: E402
from tools import SAFE_TRANSFER_DESTINATION, find_sip_participant  # noqa: E402


class FakeParticipant:
    def __init__(self, identity, attributes):
        self.identity = identity
        self.attributes = attributes


class FakeRoom:
    def __init__(self, participants):
        self.remote_participants = {p.identity: p for p in participants}


def test_safe_transfer_destination():
    assert SAFE_TRANSFER_DESTINATION.match("sip:2001@127.0.0.1:5092")
    assert SAFE_TRANSFER_DESTINATION.match("tel:+84901234567")
    assert not SAFE_TRANSFER_DESTINATION.match("http://evil.example")
    assert not SAFE_TRANSFER_DESTINATION.match("sip:2001@x\r\nInjected: header")
    assert not SAFE_TRANSFER_DESTINATION.match("")


def test_find_sip_participant():
    web = FakeParticipant("web-user", {})
    caller = FakeParticipant("sip-caller", {"sip.callID": "abc", "sip.phoneNumber": "+8490"})

    assert find_sip_participant(FakeRoom([web, caller])) is caller
    assert find_sip_participant(FakeRoom([web])) is None
    assert find_sip_participant(FakeRoom([])) is None


def test_resolve_inbound_call_identity():
    # LiveKit SIP
    sip = FakeParticipant("sip-1", {"sip.callID": "abc", "sip.phoneNumber": "+8490"})
    assert resolve_inbound_call_identity(sip) == ("abc", "+8490")

    # Asterisk voice bridge
    bridge = FakeParticipant(
        "caller-1",
        {"telephony.provider": "asterisk", "telephony.callId": "chan-9", "telephony.phoneNumber": "2001"},
    )
    assert resolve_inbound_call_identity(bridge) == ("chan-9", "2001")

    # sip.* thắng telephony.* khi có cả hai
    both = FakeParticipant("x", {"sip.callID": "s", "telephony.callId": "t"})
    assert resolve_inbound_call_identity(both)[0] == "s"

    # Web participant: không có attribute nào
    web = FakeParticipant("web-user", {})
    assert resolve_inbound_call_identity(web) == ("call-web-user", "web-user")


if __name__ == "__main__":
    test_safe_transfer_destination()
    test_find_sip_participant()
    test_resolve_inbound_call_identity()
    print("ok")
