# Cài máy tại site và kết nối camera

Mỗi địa điểm dùng một máy luôn bật, một Named Tunnel và một hostname. go2rtc và AI chỉ bind loopback; khách xem live bằng URL ký ngắn hạn do SaaS cấp. Khách hàng không cần Cloudflare account hay Cloudflare Access.

## 1. Chuẩn bị

- Máy macOS hoặc Linux 64-bit, cùng LAN với camera, chạy 24/7; khuyến nghị Ethernet và DHCP reservation/static IP cho camera.
- Node.js 20+, Git, Python 3.10+ có `venv`, `curl`; Linux cần `sudo`. Homebrew cần có trên macOS nếu chưa cài `cloudflared`.
- Camera bật RTSP và ONVIF, có tài khoản camera riêng cho CameraAI. Xác nhận IP, ONVIF port, username/password. MVP hiện yêu cầu nhập IP; chưa tự quét camera trong LAN.
- Mạng cho phép outbound HTTPS/WSS tới Cloudflare, GitHub, dashboard và dịch vụ package. Không mở port inbound/router.
- Một account CameraAI và API key lấy sau khi đăng nhập dashboard.

Vì repository đang private, cấu hình deploy key chỉ-đọc trên máy site trước khi cài:

```bash
ssh-keygen -t ed25519 -C cameraai-site -f "$HOME/.ssh/cameraai_deploy" -N ''
cat "$HOME/.ssh/cameraai_deploy.pub"
# Thêm public key vào GitHub repository > Settings > Deploy keys (không bật write).
printf 'Host github.com\n  IdentityFile ~/.ssh/cameraai_deploy\n  IdentitiesOnly yes\n' >> "$HOME/.ssh/config"
chmod 600 "$HOME/.ssh/config"
ssh -T git@github.com
```

## 2. Cài đặt

```bash
cd "$HOME"
git clone --depth 1 git@github.com:nhannguyenalien/cameraaiwork.git
cd cameraaiwork
CAMERAAIWORK_REPO=git@github.com:nhannguyenalien/cameraaiwork.git \
CAMERAAIWORK_API=https://cameraaiwork.pages.dev \
./apps/relay/install.sh
```

Script hỏi API key, tên site, IP và thông tin ONVIF; sau đó đăng ký site/camera, nhận tunnel token, cài go2rtc/relay/AI và service tự khởi động. Không gửi Telegram, RunPod, Stripe hoặc Cloudflare token xuống máy site; khách cấu hình Telegram/RunPod trong dashboard.

Mật khẩu camera có dấu nháy/backslash cần kiểm tra lại `apps/relay/cameras.json` sau cài. Ưu tiên mật khẩu mạnh nhưng tương thích JSON; installer sẽ được harden thêm trước rollout không giám sát.

## 3. Kiểm tra tại site

macOS:

```bash
launchctl list | grep cameraaiwork
tail -n 100 /tmp/cameraaiwork-go2rtc.log
tail -n 100 /tmp/cameraaiwork-relay.log
tail -n 100 /tmp/cameraaiwork-ai.log
curl -fsS http://127.0.0.1:1984/api/streams
curl -fsS http://127.0.0.1:4000/health
```

Linux:

```bash
systemctl --no-pager --full status cameraaiwork-go2rtc cameraaiwork-relay cameraaiwork-ai
journalctl -u cameraaiwork-relay -n 100 --no-pager
curl -fsS http://127.0.0.1:1984/api/streams
curl -fsS http://127.0.0.1:4000/health
```

Sau đó vào dashboard: camera phải xuất hiện, live mở được, PTZ di chuyển rồi dừng, tạo motion event, clip R2 xem được và Telegram nhận cảnh báo. Chỉ test một lần sau khi tunnel lên 10–30 giây.

## 4. Vận hành và nâng cấp

```bash
cd "$HOME/cameraaiwork"
git pull --ff-only
./scripts/test-all.sh
# chạy lại installer để render config/cập nhật dependency nếu release yêu cầu
```

Không sửa file sinh ra ngoài `apps/relay/.env` và `apps/relay/cameras.json`. Sao lưu hai file này bằng kho bí mật; chúng chứa relay/tunnel/camera secrets. Khi mất máy, thu hồi tunnel token bằng cách xóa/re-provision site, đổi mật khẩu camera rồi cài lại.

## Troubleshooting

- Camera offline: ping IP, kiểm tra RTSP/ONVIF được bật và cùng VLAN; thử luồng trực tiếp bằng VLC trước.
- Dashboard có camera nhưng live lỗi: xem go2rtc rồi relay log; kiểm tra `CLOUDFLARE_TUNNEL_TOKEN` và outbound WSS.
- PTZ lỗi nhưng live chạy: camera/profile có thể không hỗ trợ ONVIF PTZ hoặc ONVIF port khác.
- AI không lên: kiểm tra Python/venv, dung lượng đĩa và AI log. Motion recording vẫn phải hoạt động độc lập.
- `429`: đã đạt viewer limit của gói. Đóng tab/viewer cũ hoặc nâng gói.
- Không clone được: deploy key chưa được gắn vào private repo hoặc SSH config chưa dùng đúng key.

Rollback an toàn: giữ checkout release trước, quay lại tag/commit đã biết, cài lại dependencies và restart ba services. Không xóa site trên dashboard để rollback vì thao tác đó xóa tunnel, camera và event metadata.
