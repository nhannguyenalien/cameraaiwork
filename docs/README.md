# CameraAI documentation

Trang public: `https://<dashboard-domain>/docs/`. API contract public: `https://<dashboard-domain>/openapi.yaml`.

- [Kiến trúc](./ARCHITECTURE.md): trust boundaries và luồng dữ liệu.
- [API](./API.md): quick start, auth, errors và quy tắc an toàn cho agent.
- [OpenAPI](./openapi.yaml): contract machine-readable, canonical source cho `/openapi.yaml` production.
- [Cài máy tại site](./INSTALL-SITE.md): camera prerequisites, private-repo deploy key, install, verify, update và rollback.
- [Deploy](./DEPLOY.md): cấu hình platform và lệnh triển khai.
- [Production runbook](./PRODUCTION.md): release gate, monitoring, rollback và phần còn thiếu.
- [Kế hoạch/trạng thái](./PLAN.md): tiến độ implementation hiện tại.

## Cho AI agent

Nạp `https://<dashboard>/openapi.yaml` làm tool schema, dùng bearer token trong secret store và tuân thủ `x-agent-risk`. Account token hiện chưa có scope; mặc định chỉ đọc và luôn yêu cầu người dùng xác nhận thao tác destructive, financial hoặc secret-write. Xem [API](./API.md#agent-safety-contract).

OpenAPI mô tả API đã triển khai, không mô tả ý tưởng tương lai. Khi đổi route/schema: sửa `docs/openapi.yaml`, đồng bộ `apps/pages/public/openapi.yaml`, chạy `./scripts/test-all.sh`, rồi cập nhật ví dụ liên quan.
