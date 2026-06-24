# Chiến lược nguồn dữ liệu

Mục tiêu của phần mềm là tạo danh sách khách hàng B2B có khả năng mua hàng xuất nhập khẩu, không phải thu thập dữ liệu đại trà.

## Nhóm nguồn ưu tiên

1. **Hiệp hội ngành hàng**
   - Ví dụ: hiệp hội cà phê, hạt điều, thủy sản, gỗ, dệt may.
   - Ưu điểm: lead thường đúng ngành, dễ phân loại vai trò.

2. **Hội chợ và triển lãm**
   - Danh sách exhibitor/visitor/sponsor thường có công ty, quốc gia, website.
   - Phù hợp để tìm nhà nhập khẩu, phân phối và bán buôn.

3. **Danh bạ doanh nghiệp có điều khoản rõ ràng**
   - Ưu tiên nguồn có API hoặc cho phép sử dụng dữ liệu cho nghiên cứu thương mại.

4. **Cổng dữ liệu doanh nghiệp mở**
   - Dùng để xác minh công ty tồn tại, địa chỉ và ngành đăng ký.

5. **Trade data trả phí**
   - Dùng khi cần biết lịch sử nhập khẩu, cảng, shipment hoặc đối tác mua hàng.

## Cách chấm điểm nên dùng

- Có website chính thức: tăng điểm.
- Có email hoặc số điện thoại công khai: tăng điểm.
- Có từ khóa sản phẩm: tăng mạnh.
- Có từ khóa vai trò như importer, distributor, wholesale, sourcing: tăng mạnh.
- Website chỉ là blog, tuyển dụng, công thức nấu ăn hoặc tin tức: giảm điểm.

## Tránh rủi ro

- Không quét sau đăng nhập nếu không có quyền.
- Không cố vượt captcha hoặc giới hạn chống bot.
- Không thu thập dữ liệu cá nhân không cần thiết.
- Không gửi email hàng loạt nếu chưa có quy trình tuân thủ luật chống spam của thị trường mục tiêu.
