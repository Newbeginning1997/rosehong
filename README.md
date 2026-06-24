# Quét Dữ Liệu Doanh Nghiệp XNK

Tool tìm lead doanh nghiệp từ Google Maps thông qua SerpApi, quản lý danh sách khách hàng và gửi email tiếp cận ngay trong một giao diện CRM gọn.

## Chức năng chính

- Tìm lead theo từ khóa, địa điểm và SerpApi key.
- Tự lưu SerpApi key trên trình duyệt nếu người dùng bật tùy chọn lưu.
- Lấy tên công ty, số điện thoại, email, website, địa chỉ, rating và link Google Maps.
- Nếu lead có website, tool tự quét email công khai từ trang chủ và các trang liên hệ phổ biến.
- Quản lý trạng thái lead: mới, đã liên hệ, quan tâm, follow up, chốt, mất.
- Ghi chú, chọn từng lead, xóa lead, gửi email cho lead đã chọn.
- Mở nhanh Zalo Desktop/Web theo số điện thoại của lead khi máy có hỗ trợ Zalo.
- Xuất Excel `.xls` và CSV với từng cột rõ ràng.
- Đăng nhập, đăng xuất và cấp user cho người khác sử dụng.
- Admin Console để xem tổng user, user hoạt động/bị khóa, lead/email theo từng user.
- Admin có thể tạo user, chọn vai trò `user` hoặc `admin`, khóa/mở tài khoản và đổi mật khẩu.
- Dữ liệu lead và lịch sử email được tách theo từng user.

## Chạy trên máy local

Yêu cầu Node.js 18 trở lên. Trên máy hiện tại có thể chạy bằng Node tại `D:\Nodejs\node.exe`.

```powershell
D:\Nodejs\node.exe server.mjs
```

Sau đó mở:

```text
http://127.0.0.1:8080
```

Nếu muốn đổi cổng:

```powershell
$env:PORT="8090"
D:\Nodejs\node.exe server.mjs
```

## Tài khoản admin mặc định

Khi dữ liệu chưa có user nào, tool tự tạo admin mặc định:

```text
Email: admin@xnk.local
Password: admin123456
```

Khi đưa lên mạng, không dùng mật khẩu mặc định. Hãy đặt biến môi trường trước lần chạy đầu tiên:

```powershell
$env:ADMIN_EMAIL="email-cua-ban@example.com"
$env:ADMIN_PASSWORD="mat-khau-manh"
```

## Đưa tool lên mạng

Khuyến nghị deploy bản đầu tiên lên Render Web Service kèm Persistent Disk. Project đã có sẵn `render.yaml` và hướng dẫn chi tiết tại `docs/deploy-render.md`.

Biến môi trường chính khi deploy:

```text
HOST=0.0.0.0
ADMIN_EMAIL=email-cua-ban@example.com
ADMIN_PASSWORD=mat-khau-manh
LEAD_SCANNER_DATA_DIR=/var/data
OPEN_BROWSER=0
```

Render sẽ tự cấp `PORT`, không cần tự đặt `PORT` trên Render.

Lệnh chạy:

```bash
npm start
```

Với bản dùng nội bộ hoặc ít user, file JSON hiện tại là đủ. Nếu triển khai cho nhiều user thật sự, bước tiếp theo nên chuyển dữ liệu sang PostgreSQL/SQLite, thêm backup tự động và cấu hình domain HTTPS.

## Gửi email

1. Tích chọn lead cần gửi email.
2. Mở cấu hình email và nhập SMTP host, port, email gửi đi, email đăng nhập và mật khẩu email/app password.
3. Nhập tiêu đề và nội dung email.
4. Bấm gửi email cho lead đã chọn.

Với Gmail, trường mật khẩu email thường phải là App Password, không phải mật khẩu Gmail thường.

## Gói phân phối

Windows:

```text
release/windows/QuetDuLieuDoanhNghiepXNK-Setup.exe
```

macOS Apple Silicon:

```text
release/mac/QuetDuLieuDoanhNghiepXNK-mac-arm64.tar.gz
```

macOS Intel:

```text
release/mac/QuetDuLieuDoanhNghiepXNK-mac-x64.tar.gz
```

## Nguyên tắc sử dụng

- Chỉ quét dữ liệu công khai và phục vụ nghiên cứu B2B hợp pháp.
- Tôn trọng điều khoản sử dụng, robots.txt và giới hạn tốc độ của website.
- Không dùng để spam hàng loạt.
- Luôn lưu nguồn dữ liệu để kiểm chứng lại lead.

