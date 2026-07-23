# Thiết kế LiveKit SIP local

## Mục tiêu

Bổ sung inbound SIP vào hệ thống hiện tại để một softphone chạy trên cùng máy Windows có thể gọi trực tiếp vào LiveKit, được đưa vào một room riêng và trò chuyện với Gemini Agent bằng audio hai chiều.

Phạm vi này chỉ dùng cho demo local. Không kết nối PSTN, không mua số DID và không dùng 3CX/Asterisk.

## Kiến trúc

```text
Softphone Windows
  │ SIP INVITE: 5070
  │ RTP audio: 10000-10100/UDP
  ▼
LiveKit SIP
  │
  ├── Redis
  ▼
LiveKit Server
  │
  ├── SIP caller participant
  └── Gemini agent participant
          │
          ▼
      Gemini Live
```

Các service Web, Token API và Agent Worker hiện tại tiếp tục hoạt động.

## Docker và networking

- Thêm service `redis`.
- Cấu hình LiveKit Server dùng Redis thay cho lệnh `--dev` đơn lẻ.
- Thêm service `livekit/sip`.
- SIP service dùng host networking theo hướng dẫn chạy local chính thức.
- SIP kết nối tới LiveKit qua `host.docker.internal:7880`.
- SIP kết nối tới Redis qua `host.docker.internal:6379`.
- `use_external_ip` tắt cho demo private/local.
- Softphone gọi trực tiếp `sip:1000@127.0.0.1:5070;transport=tcp`.
- SIP signaling dùng TCP trên Docker Desktop/Windows; RTP audio vẫn dùng UDP.
- LiveKit SIP không nhận `REGISTER`; softphone không đăng ký extension.
- Docker Desktop phải bật host networking.

## Bootstrap trunk và dispatch rule

Một one-shot service `sip-bootstrap` dùng `livekit-server-sdk`:

1. Đợi LiveKit API sẵn sàng.
2. Tìm inbound trunk theo tên ổn định `local-softphone-trunk`.
3. Chỉ tạo trunk nếu chưa tồn tại.
4. Tìm dispatch rule theo tên `local-softphone-dispatch`.
5. Chỉ tạo individual dispatch rule nếu chưa tồn tại.
6. Dùng room prefix `sip-call-`.
7. Log ID của trunk/rule để hỗ trợ debug.

Bootstrap phải idempotent khi chạy lại `docker compose up`.

Room do SIP dispatch tạo sẽ kích hoạt automatic agent dispatch hiện có. Agent tham gia với tên `Trợ lý AI`, mở Gemini realtime session và chủ động phát lời chào.

## Xử lý lỗi

- Bootstrap retry có giới hạn khi LiveKit chưa sẵn sàng; hết retry thì exit khác 0.
- Agent và SIP log không được in secret.
- Trunk/rule trùng tên được tái sử dụng.
- README phân biệt lỗi SIP signaling với lỗi RTP audio.
- Nếu host networking chưa bật, hướng dẫn dừng và bật trong Docker Desktop.
- Windows Firewall có thể cần cho phép SIP/RTP local.

## Kiểm thử

Automated:

- Unit test cho mapping cấu hình trunk/rule và logic tái sử dụng.
- Test/typecheck/build các ứng dụng hiện có.
- `docker compose config`.
- Health check Redis, LiveKit SIP, Agent, Token API và Web.
- Kiểm tra list SIP chỉ có một trunk và một dispatch rule sau hai lần bootstrap.

Manual:

1. Softphone gọi direct SIP URI.
2. SIP participant và Agent xuất hiện trong room.
3. Người gọi nghe lời chào tiếng Việt.
4. Audio hai chiều hoạt động.
5. Hangup kết thúc participant/session.

## Ngoài phạm vi

- Số điện thoại thật và PSTN.
- SIP provider, DID, 3CX hoặc Asterisk.
- Outbound calling.
- TLS/SRTP và triển khai Internet.
- High availability hoặc nhiều SIP node.
