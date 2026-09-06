# Production readiness và runbook

## Gate trước khi nhận khách

- Chạy `./scripts/test-all.sh`, deploy staging, rồi `./scripts/e2e-check.sh` với camera thật.
- Test signup/login/logout, phân tách hai account, live token hết hạn, viewer limit, PTZ+stop, motion→AI→R2 clip→Telegram, RunPod job và Stripe webhook/portal.
- Xác nhận go2rtc/AI chỉ nghe loopback; hostname site chỉ tới relay; Cloudflare Access chỉ dành cho operator/admin.
- Secrets production nằm trong Cloudflare Pages secrets; Telegram/RunPod BYOK được mã hóa. Rotate mọi token từng xuất hiện trong chat/log/source.
- Bật scheduled maintenance, kiểm tra tunnel/DNS quota và cảnh báo tunnel mồ côi.
- Có uptime monitor cho `/api/health`, dashboard, một synthetic live-flow staging; log retention và cảnh báo `5xx`, tunnel offline, R2 upload fail, Telegram fail.
- Chốt retention R2/event/biometric, consent/privacy, xóa dữ liệu, export và restore test. Biometric embedding là dữ liệu nhạy cảm.
- Backup Turso và diễn tập restore; document RPO/RTO và người trực sự cố.

## Những phần còn thiếu để gọi là production hoàn chỉnh

1. Scoped API/service tokens và RBAC cho AI agent; hiện account token là toàn quyền.
2. Rate limiting toàn API, audit log cho login/control/destructive actions, request correlation ID.
3. Idempotency key cho tạo site/tunnel/job và cơ chế reconcile khi Cloudflare thành công nhưng DB ghi lỗi.
4. Camera discovery/vendor profiles; hiện installer giả định stream `cam1` và RTSP path do renderer quy định.
5. Installer transactional/rollback, JSON-safe credential input, prerequisite validation đầy đủ và signed release/update channel.
6. Automated browser E2E với camera simulator plus real-hardware acceptance matrix (macOS/Linux, camera vendors).
7. Data lifecycle: clip expiration, account deletion, biometric deletion/export and legal/privacy review.
8. Capacity/load test cho concurrent WebRTC, relay CPU/RAM/bandwidth, R2/Turso/Cloudflare quotas và 1,000-site assumptions.

Không cho agent tự động xóa site hoặc thay billing/integration secrets trước khi mục 1–3 hoàn tất.

## Deploy

```bash
cd /Users/nhannguyen/Desktop/cameraaiwork
./scripts/test-all.sh
./scripts/deploy-pages.sh
./scripts/e2e-check.sh
```

Deploy script chạy test, migration và Pages deploy. Telegram/RunPod là BYOK của khách trên dashboard. Stripe/Cloudflare/Turso/R2/maintenance/signing/encryption secrets là platform-owned.

## Rollback và sự cố

- Pages: redeploy artifact/commit tốt gần nhất; schema migration chỉ additive, không tự drop column/table.
- Site release: checkout tag tốt gần nhất và restart go2rtc/relay/AI; giữ nguyên `.env` và `cameras.json`.
- Tunnel compromise: re-provision token, restart connector, verify old token invalid; không expose go2rtc.
- Account token compromise: logout/revoke key, tạo key mới và rà audit/log hiện có.
- R2/Turso outage: giữ alert path best-effort, báo degraded; không xóa/recreate bucket/database trong incident.

Mức ưu tiên: cô lập tenant hoặc credential leak là P0; dashboard/live diện rộng là P1; clip/AI/Telegram degraded nhưng live còn chạy là P2.
