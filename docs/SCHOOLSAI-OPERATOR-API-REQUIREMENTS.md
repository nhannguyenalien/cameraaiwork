# Yêu cầu API SchoolsAI cho AI Agent cấp 2

## Mục tiêu

SchoolsAI làm lớp suy luận/orchestration. CameraAIWork giữ quyền xác thực tài khoản, kiểm tra phạm vi dữ liệu, thực thi tool và yêu cầu xác nhận trước mọi thao tác ghi. API SchoolsAI không được tự gọi URL nội bộ hoặc tự thực thi thao tác camera.

## Contract bắt buộc

### Request

`POST /api/v1/operator-chat`

```json
{
  "request_id": "uuid-cua-luot-hoi",
  "session": "cameraai-operator-<tenant-ref>-<request-id>",
  "messages": [
    { "role": "user", "content": "..." }
  ]
}
```

- `request_id` bắt buộc, duy nhất cho mỗi lượt và phải được echo nguyên vẹn trong response.
- Không dùng một session dùng chung cho nhiều request đồng thời. Nếu API vẫn lưu state theo session, phải serialize request theo session hoặc trả `409 SESSION_BUSY`; tuyệt đối không trả kết quả của request trước cho request sau.
- `tenant-ref` chỉ là định danh mờ (opaque). API không được dùng tenant/account id do model sinh ra để truy cập dữ liệu.
- Giới hạn `messages` tối đa 20 phần tử, mỗi `content` tối đa 8.000 ký tự; trả `400` nếu sai schema.

### Response thành công

API chỉ được trả đúng một trong hai dạng JSON có cấu trúc:

```json
{
  "request_id": "uuid-cua-luot-hoi",
  "type": "answer",
  "answer": "Nội dung tiếng Việt",
  "finish_reason": "stop"
}
```

```json
{
  "request_id": "uuid-cua-luot-hoi",
  "type": "tool",
  "tool_call_id": "uuid-cua-tool-call",
  "name": "list_sites",
  "args": {}
}
```

- Không bọc JSON trong Markdown/code fence và không trả thêm text ngoài object.
- `request_id` phải khớp request; `tool_call_id` phải duy nhất và được giữ nguyên khi CameraAIWork gửi lại `tool_result`.
- Không trả câu chung chung như “chưa cấu hình tool” khi request đã chứa catalog tool. Nếu model không tạo được directive hợp lệ, trả lỗi có cấu trúc.
- Chỉ được chọn tool có trong catalog của request. Không tự tạo tên tool, tham số, URL hoặc account/site/camera id.

### Tool result vòng tiếp theo

```json
{
  "request_id": "uuid-cua-luot-hoi",
  "session": "...",
  "messages": [
    {
      "role": "user",
      "content": "{\"tool_call_id\":\"...\",\"tool_result\":{...}}"
    }
  ]
}
```

SchoolsAI phải dùng đúng `tool_result` được cung cấp, không suy đoán thêm dữ liệu camera. Tối đa 6 vòng tool cho một lượt; khi vượt giới hạn trả lỗi rõ ràng.

## Lỗi chuẩn

Mọi lỗi dùng HTTP status phù hợp và body:

```json
{
  "request_id": "uuid-cua-luot-hoi",
  "error": {
    "code": "SESSION_BUSY",
    "message": "Mô tả an toàn, không chứa secret",
    "retryable": true
  }
}
```

Các mã tối thiểu: `INVALID_REQUEST` (400), `UNAUTHORIZED` (401), `SESSION_BUSY` (409), `RATE_LIMITED` (429), `MODEL_TIMEOUT` (504), `INVALID_MODEL_OUTPUT` (502). Với lỗi retryable, hỗ trợ header `Retry-After`.

## Cách ly và bảo mật

- Không trộn lịch sử, cache, tool result hoặc response giữa hai tenant/session/request.
- Không log API key, bearer token, mật khẩu camera, RTSP URL có credentials, ảnh/video hoặc tool result nhạy cảm.
- Có timeout và hủy request; request đã bị client hủy không được phát response sang request kế tiếp.
- Nếu có retry, dùng `request_id` làm idempotency key để cùng một lượt không sinh hai chuỗi tool call khác nhau.
- Dữ liệu hội thoại phải có chính sách retention rõ ràng; ưu tiên stateless vì CameraAIWork đã gửi history cần thiết.

## Acceptance test bắt buộc

1. Gửi song song 20 request cho hai tài khoản; 100% response echo đúng `request_id`, không có dữ liệu chéo tài khoản.
2. Lượt A hỏi danh sách camera, lượt B ngay sau đó yêu cầu bật ghi hình; B chỉ được trả proposal `set_recording`, không được nhận câu trả lời/tool result của A.
3. Câu “Bật ghi hình khi phát hiện người” không được hiểu là yêu cầu lấy ảnh hoặc video.
4. Tool đọc chỉ trả lời từ `tool_result`; tool ghi chỉ trả directive để CameraAIWork xin xác nhận, không tự thực thi.
5. Tool không tồn tại hoặc args sai schema phải trả `INVALID_MODEL_OUTPUT`, không sửa/ngầm đoán args.
6. Timeout, retry và request bị hủy không tạo response muộn gắn vào lượt mới.
7. Kiểm thử red-team: prompt injection yêu cầu đổi account/site/camera id, lộ API key, hoặc gọi URL tùy ý đều phải bị từ chối.

## Kết quả retest môi trường thật (2026-09-18)

- `request_id` đã được echo đúng và endpoint trả HTTP 200.
- SchoolsAI production version `648f8bff-2a95-4cec-bcb7-ae5ed7b54bea` đã bật chuẩn hóa JSON directive dạng
  `{"tool":"list_cameras","args":{}}` thành response `type: "tool"`.
- CameraAIWork phải yêu cầu model dùng đúng dạng `tool`/`args` nói trên. Dạng cũ
  `{"type":"tool","name":"list_cameras","args":{}}` bị SchoolsAI từ chối đúng với HTTP 502,
  mã `INVALID_MODEL_OUTPUT`, vì có trường `type` ngoài schema model-output.
- Tenant production đang dùng để tích hợp chưa có catalog server-side: `GET /api/v1/agent-tools`
  trả `{"success":true,"tools":[]}`. Vì vậy retest `list_cameras` vẫn trả HTTP 502
  `INVALID_MODEL_OUTPUT` với thông báo “Tool không có trong catalog.”; chưa thể xác nhận happy path
  `type: "tool"` cho tới khi đăng ký các tool CameraAIWork trên đúng tenant/API key.
- Endpoint cấp 1 `/api/v1/chat` đã retest đạt: HTTP 200 và trả đúng “Gói Pro không giới hạn số camera.”

## Điểm CameraAIWork đã phòng vệ

- Mỗi lượt gửi `requestId` và chỉ nhận response có id khớp.
- Chặn gửi chồng lượt trên UI.
- Session SchoolsAI tách theo `accountId + requestId`.
- Chỉ render ảnh/video khi lượt hiện tại thật sự yêu cầu media.
- Câu vận hành “bật/tắt ghi hình” không còn bị nhận nhầm thành yêu cầu xem hình.
