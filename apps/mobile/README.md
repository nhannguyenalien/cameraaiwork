# CameraAI Mobile

Flutter client dùng API hiện có của CameraAI. App không truy cập database trực
tiếp; backend API tiếp tục là lớp duy nhất đọc/ghi database dùng chung.

## Đã có

- Đăng nhập và đăng ký bằng email/mật khẩu.
- Lưu API key trong Android Keystore / iOS Keychain.
- Tự khôi phục phiên khi mở app.
- Dashboard hiển thị gói tài khoản, usage và danh sách camera.
- Chi tiết camera với snapshot hiện tại và kiểm tra online/offline.
- Live WebRTC/MSE bằng capability URL ngắn hạn từ backend.
- Điều khiển PTZ, zoom và về vị trí gốc khi camera hỗ trợ.
- Danh sách sự kiện phân trang, lọc theo camera, người và loại sự kiện.
- Xem ảnh và phát video sự kiện riêng tư bằng bearer token.
- Xác nhận sự kiện, ghi chú, tìm người đã nhận diện và đặt/đổi tên.
- Pull-to-refresh, trạng thái loading/error và đăng xuất.

## Chạy app

Mặc định app gọi production API:

```bash
flutter run
```

Đổi API bằng Dart define:

```bash
flutter run --dart-define=API_BASE_URL=https://camera.schoolsai.work
```

Với backend local, dùng địa chỉ máy host mà simulator/emulator truy cập được.
Ví dụ Android Emulator thường dùng `http://10.0.2.2:8788`. HTTP local cần cấu
hình cleartext/ATS riêng; production phải dùng HTTPS.

## Kiểm tra

```bash
flutter analyze
flutter test
```

## Build trên GitHub

Workflow `Mobile CI` dùng Flutter 3.44.9 và Java 17 để analyze, test và build
Android APK. Sau khi workflow chạy thành công, tải artifact
`cameraai-android-apk` trong trang Actions của lần chạy tương ứng.

APK hiện dùng signing key debug để thử nghiệm nội bộ. Cần cấu hình release
keystore bằng GitHub Secrets trước khi phát hành lên Google Play.
