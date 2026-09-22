# Changelog

Ghi các thay đổi ảnh hưởng tới relay/AI worker chạy tại site — mỗi lần build bundle
(`scripts/build-relay-bundle.sh`) nên thêm một mục mới ở đây trước khi deploy.
Dashboard đọc file này để hiện "có gì mới" khi site có bản cập nhật.

## 2026-09-12

- Camera không hỗ trợ ONVIF (đời cũ, chỉ RTSP) giờ vẫn phát hiện người được: relay
  tự chụp ảnh + gọi AI worker định kỳ (`PERSON_POLL_INTERVAL_MS`, mặc định 5s) thay vì
  đợi motion event từ ONVIF. Bật bằng cờ `hasOnvif: false` trên camera, hoặc tick
  "Camera cũ, không hỗ trợ ONVIF" khi thêm camera trên dashboard.
- Dashboard có nút "Đẩy update" cho từng site (Cài đặt → Site đã kết nối) — chạy
  `update.sh` từ xa qua relay, không cần SSH tay. Vẫn cần bấm xác nhận (không tự động).
- Bundle build giờ nhúng thông tin version (commit, ngày, có thay đổi chưa commit hay
  không) để dashboard so sánh bản đang chạy tại site với bản mới nhất.
