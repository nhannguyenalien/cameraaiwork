# Deploy checklist

Checklist này là cổng phát hành cho MVP một-hostname/site. Không đánh dấu hoàn
tất chỉ dựa trên unit test; các mục camera/R2/Telegram cần thiết bị thật.

## Trước deploy

- Thu hồi mọi PAT/API token từng xuất hiện trong chat hoặc log; cập nhật token
  Cloudflare mới vào Pages, không lưu trong repo.
- Kiểm tra `.dev.vars` có đủ Turso và Cloudflare values, nhưng không in giá trị.
- Tạo R2 bucket `cameraaiwork-events` và binding production `EVENTS_BUCKET`.
- Đặt Pages secrets: `TURSO_AUTH_TOKEN`, `CLOUDFLARE_API_TOKEN`,
  `CUSTOMER_SECRETS_KEY`, `MAINTENANCE_SECRET`; Stripe secrets chỉ khi bật billing.
- Đặt GitHub Actions secrets `DASHBOARD_URL` và `MAINTENANCE_SECRET` với cùng
  maintenance secret của Pages.

```bash
cd /Users/nhannguyen/Desktop/cameraaiwork
./scripts/test-all.sh
git diff --check
```

## Deploy

Script chạy test, migration Turso an toàn rồi mới deploy Pages:

```bash
cd /Users/nhannguyen/Desktop/cameraaiwork
./scripts/deploy-pages.sh
```

Sau khi site được cấp điện và relay đã cập nhật:

```bash
cd /Users/nhannguyen/Desktop/cameraaiwork
CAMERAAIWORK_API=https://camera.schoolsai.work ./scripts/e2e-check.sh
```

Sau E2E tự động, kiểm tra trên dashboard: live WebRTC, PTZ, một motion event có
clip phát được từ R2, AI nhận diện người và Telegram nhận alert. Reboot máy site
rồi lặp lại E2E để xác nhận các service tự khởi động.

## Tiêu chí dừng/rollback

Dừng rollout site mới nếu migration lỗi, health endpoint không trả 200, signed
live bị bypass, endpoint `/internal/*` truy cập được không cần token, clip R2
không phát được, hoặc viewer limit không được áp dụng. Không rollback schema bằng
xóa cột; deploy lại bản Pages trước đó và giữ migration dạng additive để bảo toàn
dữ liệu. Tunnel/DNS mới tạo lỗi phải được xóa bằng API site hoặc maintenance job,
không xóa hàng loạt theo wildcard.
