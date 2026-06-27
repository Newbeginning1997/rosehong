# Netlify Free Deploy

Bản Netlify là bản online free/local-only:

- Không dùng database.
- Không lưu lead trên server.
- Người dùng nhập SerpApi key, quét lead, rồi xuất CSV/XLS về máy.
- SerpApi key chỉ lưu trên trình duyệt nếu người dùng tự tick lưu key.
- API `/api/search` chạy bằng Netlify Function để gọi SerpApi.
- Có thể bật mật khẩu truy cập chung bằng biến môi trường `ACCESS_PASSWORD` trên Netlify.

## Deploy

1. Vào Netlify > Add new site > Import an existing project.
2. Chọn GitHub repo này.
3. Build settings:
   - Build command: để trống
   - Publish directory: `netlify`
   - Functions directory: `netlify/functions`
4. Environment variables tùy chọn:
   - `ACCESS_PASSWORD`: mật khẩu chung cho vài người dùng.
5. Deploy.
