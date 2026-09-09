# Kế hoạch xây dựng ứng dụng Flutter CameraAI

## 1. Mục tiêu

Xây dựng một ứng dụng Flutter cho iOS và Android dùng chung backend, tài khoản và dữ liệu với dashboard web hiện tại tại `camera.schoolsai.work`.

Ứng dụng mobile là một API client. Ứng dụng không kết nối trực tiếp tới PostgreSQL và không chứa `DATABASE_URL`, relay secret, khóa Cloudflare hoặc khóa tích hợp AI. Cloudflare Pages Functions tiếp tục là lớp duy nhất đọc/ghi database, kiểm tra tenant và ký quyền xem camera.

## 2. Hiện trạng được dùng làm nguồn sự thật

- API contract: `docs/openapi.yaml`.
- Backend: Cloudflare Pages Functions trong `apps/pages/functions`.
- Database runtime hiện tại: Neon PostgreSQL qua `DATABASE_URL` và `@neondatabase/serverless`.
- Xác thực: bearer token có thể thu hồi, nhận từ login/signup và gửi bằng `Authorization: Bearer <token>`.
- Media: ảnh/video sự kiện được tải qua endpoint có bearer auth; live view dùng URL capability có hạn 5 phút.
- Relay tại site: go2rtc + relay + Cloudflare Tunnel.

Lưu ý: một số tài liệu cũ còn nhắc Turso. Flutter phải bám theo code runtime đang dùng Neon; nên cập nhật các tài liệu cũ riêng để tránh cấu hình sai.

## 3. Phạm vi sản phẩm

### MVP — bản dùng được hằng ngày

1. Đăng nhập, đăng ký, đăng xuất và khôi phục phiên từ secure storage.
2. Trang tổng quan: gói hiện tại, số site/camera và trạng thái hệ thống.
3. Danh sách camera theo site, thumbnail snapshot và trạng thái online/offline.
4. Chi tiết camera:
   - live view bằng signed URL trong WebView;
   - PTZ;
   - bật/tắt ghi hình khi phát hiện người;
   - bật/tắt đèn nếu camera hỗ trợ;
   - push-to-talk với file audio nhỏ hơn 3 MB.
5. Danh sách sự kiện dùng cursor pagination, lọc theo site/camera/người/thời gian/trạng thái.
6. Chi tiết sự kiện: ảnh, video, người xuất hiện, ghi chú, đã xem/chưa xem.
7. Danh sách người, ảnh đại diện và đặt/đổi tên.
8. AI Agent chat, hiển thị proposal và yêu cầu người dùng xác nhận trước mọi action ghi.
9. Cài đặt tài khoản và mở Stripe Checkout/Customer Portal bằng trình duyệt ngoài.

### Sau MVP

- Push notification cho sự kiện mới.
- Native WebRTC nếu WebView không đạt yêu cầu về độ trễ, audio hoặc độ ổn định.
- Background refresh, cache offline có giới hạn và download clip.
- Onboarding/cài relay, quét và thêm camera hoàn toàn trên mobile.
- Deep links, biometric unlock và tablet layout.

### Không đưa vào app khách hàng

- `/api/motion`, `/api/internal/maintenance` và `/api/install/claim`.
- Relay secret, tunnel token, `DATABASE_URL` và khóa provider đã mã hóa.
- Truy cập bảng database trực tiếp.

## 4. Kiến trúc Flutter đề xuất

```text
Flutter UI
  -> Feature controllers / state
  -> Repositories
  -> Typed API client
  -> Cloudflare Pages API
  -> Neon PostgreSQL / R2 / site relay
```

Đề xuất cấu trúc feature-first:

```text
apps/mobile/
  lib/
    app/                 router, theme, bootstrap
    core/
      api/               HTTP client, auth interceptor, API error
      auth/              session lifecycle, secure token storage
      config/            API base URL/flavor
      media/             protected image/video helpers
    features/
      auth/
      dashboard/
      cameras/
      events/
      people/
      agent/
      settings/
    shared/              reusable widgets and utilities
  test/
  integration_test/
```

Lựa chọn ban đầu:

- State management: Riverpod.
- Navigation: `go_router` với auth guard.
- HTTP: Dio; một interceptor gắn bearer token, chuẩn hóa `{error: ...}`, timeout và retry có chọn lọc.
- Models: Freezed + json_serializable hoặc OpenAPI generation sau khi schema response được siết chặt.
- Token: `flutter_secure_storage`; không lưu token trong SharedPreferences hoặc log.
- Live: `webview_flutter`, mỗi lần mở màn hình gọi `POST /live`, tự xin URL mới khi capability hết hạn.
- Video sự kiện: player nhận dữ liệu/header có bearer auth; kiểm thử HTTP Range trên iOS/Android trước khi khóa thư viện.
- Billing: `url_launcher`, quay lại app bằng app lifecycle/deep link rồi refresh account.
- Talk: `record` tạo định dạng relay/camera chấp nhận, gửi raw body với Content-Type `audio/*`.

## 5. Luồng dữ liệu và bảo mật

### Đăng nhập

1. App gọi `POST /api/auth/login`.
2. Lưu `apiKey` vào Keychain/Android Keystore.
3. Mọi request account thêm bearer header.
4. Khi nhận 401: xóa phiên, đưa về login; không tự lặp login.
5. Logout gọi API trước, sau đó luôn xóa token local.

Backend hiện tạo một hàng `api_keys` mới cho mỗi lần login. Trước public release nên bổ sung quản lý phiên/thiết bị hoặc TTL để tránh tích lũy token dài hạn.

### Live camera

1. App gọi `POST /api/cameras/{site}/{camera}/live` bằng bearer token.
2. Backend trả URL capability 5 phút và viewer limit.
3. WebView mở URL relay; URL chỉ giữ trong memory.
4. Khi app background hoặc rời màn hình: đóng WebView để giải phóng viewer slot.
5. Khi capability gần hết hạn hoặc relay trả 401: xin capability mới một lần.

### Media có bảo vệ

- Ảnh sự kiện/snapshot phải được tải bằng HTTP client có bearer header rồi render từ bytes/cache riêng.
- Cache phải có giới hạn dung lượng và được xóa khi logout.
- Video cần giữ Authorization trong request và hỗ trợ Range; không biến bearer token thành query parameter.

### Retry

- Chỉ tự retry GET và các request idempotent khi timeout/429/502/503.
- Không tự retry signup, tạo site/camera, PTZ, talk, billing hoặc agent confirmed action nếu chưa biết kết quả.
- Dùng exponential backoff có giới hạn và cho phép người dùng thử lại thủ công.

## 6. Mapping màn hình với API

| Màn hình | API chính |
|---|---|
| Login/Signup | `POST /api/auth/login`, `/signup`, `/logout` |
| Home | `GET /api/settings/account`, `/api/sites`, `/api/cameras` |
| Camera grid | `GET /api/cameras`, camera `/snapshot`, `/status` |
| Camera detail | camera `/live`, `/ptz`, `/controls`, `/talk`, `/settings` |
| Events | `GET /api/events`, event detail/image/video, `PATCH /api/events/{id}` |
| People | `GET /api/people`, `PATCH /api/people/{id}`, protected event image |
| AI Agent | `POST /api/agent/chat`, confirmed action contract |
| Settings | account, integrations status, storage, billing checkout/portal |

## 7. Các gap backend cần xử lý trước hoặc trong MVP

1. Tài liệu DB không đồng nhất: `ARCHITECTURE.md`/README còn nói Turso trong khi runtime dùng Neon.
2. OpenAPI có nhiều response `additionalProperties: true`; cần mô tả field cụ thể để generate Dart models ổn định.
3. Chưa có refresh token, expiry hoặc device-session management; bearer hiện là khóa dài hạn cho toàn account.
4. Chưa có endpoint đổi/quên mật khẩu dành cho flow mobile rõ ràng.
5. Chưa có push notification registration/device token API.
6. Cần xác nhận format audio mà relay/camera hỗ trợ trên cả iOS và Android.
7. Cần spike video protected Range và go2rtc WebView trên thiết bị thật, nhất là iOS.
8. CORS không ảnh hưởng native app nhưng ATS iOS/network security Android và TLS của relay hostname phải được kiểm tra.

Các gap 1–3 là ưu tiên cao; không nên ship public khi chưa quyết định vòng đời session.

## 8. Kế hoạch triển khai

### Phase 0 — Contract và spike kỹ thuật (2–3 ngày)

- Chốt production/staging base URL.
- Đồng bộ tài liệu DB và đánh dấu endpoint internal.
- Tạo Postman/curl smoke set từ OpenAPI.
- Spike trên thiết bị thật: WebView live, protected video Range, push-to-talk.
- Ghi lại request/response mẫu và các field nullable.

Điều kiện hoàn tất: login, snapshot, live, video và PTZ chạy được trên ít nhất một Android và một iPhone thật.

### Phase 1 — Flutter foundation (2–3 ngày)

- Tạo `apps/mobile`, flavors dev/staging/prod và CI analyze/test.
- Theme, localization vi/en, router và dependency injection.
- API client, secure session store, error mapping và logging đã redact.
- Models/repositories cho account, site, camera, event và person.

### Phase 2 — Auth + camera core (4–6 ngày)

- Login/signup/logout, restore session và 401 handling.
- Home/camera grid, snapshot, online status và pull-to-refresh.
- Camera detail, lifecycle live view, PTZ và record-on-person.
- Empty/loading/error states và accessibility cơ bản.

### Phase 3 — Events + people (4–5 ngày)

- Cursor pagination, filters và protected thumbnails.
- Event detail, Range video, acknowledge/note.
- People list/search/filter, preview và rename.
- Cache policy và xóa cache khi logout.

### Phase 4 — Agent + settings + billing (3–5 ngày)

- Agent chat và lịch sử cục bộ tối đa theo contract.
- Proposal card, review dữ liệu và explicit confirmation cho write action.
- Account usage, integration status và billing external browser flow.
- Talk/controls nếu spike Phase 0 đạt yêu cầu.

### Phase 5 — Hardening và release beta (4–6 ngày)

- Unit/widget/integration tests và API contract tests.
- Test mạng chậm, mất mạng, token lỗi, relay offline, viewer limit và app lifecycle.
- Crash reporting/analytics theo chính sách riêng tư.
- iOS permissions/ATS, Android permissions/network config, signing và store metadata.
- Internal beta/TestFlight trước khi public rollout.

Ước lượng MVP beta: khoảng 3–5 tuần cho một lập trình viên Flutter, nếu backend gap về session và media không phát sinh redesign.

## 9. Chiến lược kiểm thử

- Unit: model parsing, repository, cursor pagination, retry và expiry calculation.
- Widget: auth guard, camera states, event filters, proposal confirmation.
- Contract: chạy fixtures từ API thật và phát hiện OpenAPI drift.
- Integration: login -> camera list -> snapshot -> live -> PTZ; events -> image/video; agent proposal -> confirm.
- Device matrix tối thiểu: một iPhone thật, một Android thật, Wi-Fi LAN và 4G/5G ngoài site.
- Security: token không xuất hiện trong URL/log/crash report; tenant A không đọc được tài nguyên tenant B.

## 10. Thứ tự ưu tiên backlog đầu tiên

1. Sửa contract/tài liệu DB và chốt session lifecycle.
2. Spike live/video/talk trên thiết bị thật.
3. Scaffold Flutter + CI + flavors.
4. Auth và API core.
5. Camera grid/detail/live/PTZ.
6. Events và people.
7. Agent confirmation.
8. Settings/billing.
9. Push notification và native WebRTC sau MVP.

## 11. Điểm cần xem lại khi hệ thống lớn lên

- Native WebRTC/TURN telemetry thay cho WebView.
- Scoped mobile tokens, refresh-token rotation, device revocation và RBAC.
- WebSocket/SSE hoặc push thay cho polling trạng thái/sự kiện.
- CDN/cache policy cho media và retention theo plan.
- OpenAPI code generation bắt buộc trong CI.
- Tách admin/onboarding app khỏi app xem camera nếu quyền vận hành ngày càng phức tạp.
