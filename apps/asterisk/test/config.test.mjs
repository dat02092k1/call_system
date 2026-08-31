import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = (name) =>
  readFile(new URL(`../config/${name}`, import.meta.url), "utf8");

test("pins disjoint SIP and RTP ports", async () => {
  const [pjsip, rtp, http] = await Promise.all([
    config("pjsip.conf"),
    config("rtp.conf"),
    config("http.conf"),
  ]);
  assert.match(pjsip, /bind=0\.0\.0\.0:5060/);
  assert.match(rtp, /rtpstart=12000/);
  assert.match(rtp, /rtpend=12100/);
  assert.match(http, /bindport=8088/);
});

test("defines separate browser and MicroSIP identities", async () => {
  const pjsip = await config("pjsip.conf");
  assert.match(pjsip, /\[2001\][\s\S]*?webrtc=yes/);
  assert.match(pjsip, /username=2001/);
  assert.match(pjsip, /password=demo2001/);
  assert.match(pjsip, /\[2002\][\s\S]*?context=from-demo/);
  assert.match(pjsip, /username=2002/);
  assert.match(pjsip, /password=demo2002/);
});

test("routes extension 1000 to native JSON slin16 media", async () => {
  const [extensions, client, channel] = await Promise.all([
    config("extensions.conf"),
    config("websocket_client.conf"),
    config("chan_websocket.conf"),
  ]);
  assert.match(
    extensions,
    /Dial\(WebSocket\/voicebridge\/c\(slin16\)f\(json\),60\)/,
  );
  assert.match(client, /uri=ws:\/\/127\.0\.0\.1:8091\/media/);
  assert.match(client, /connection_type=per_call_config/);
  assert.match(channel, /control_message_format=json/);
});

test("loads every runtime module required by the call path", async () => {
  const modules = await config("modules.conf");
  for (const name of [
    "chan_pjsip.so",
    "res_pjsip.so",
    "res_http_websocket.so",
    "res_pjsip_transport_websocket.so",
    "chan_websocket.so",
  ]) {
    assert.match(modules, new RegExp(`load => ${name.replace(".", "\\.")}`));
  }
});
