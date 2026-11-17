# HACHIHI Network & Electrical Designer

Ứng dụng thiết kế hạ tầng mạng (Topology), mặt bằng kỹ thuật (Floorplan), tủ **Server Rack 19 inch**, **Auto-Route** tuyến cáp tránh vật cản và xuất hồ sơ thi công chuẩn **ANSI/TIA-606-C** (Excel BOM, CAD DXF, SVG, HTML Viewer).

## Chế độ vận hành linh hoạt

1. **Chạy thuần trình duyệt / Static Hosting (Mở là dùng, lưu LocalStorage & PWA)**:
   - Giao diện thiết kế, kiểm tra kỹ thuật (PoE, tải Rack, IP/VLAN, trùng đè), Auto-Route và xuất hồ sơ hoạt động 100% offline không cần backend.
   - Lệnh phát triển thuần Vite:
     ```bash
     npm install
     npm run dev:vite
     ```
   - Build tĩnh để triển khai lên Cloudflare Pages, GitHub Pages, Netlify hoặc Nginx:
     ```bash
     npm run build
     ```
     Thư mục `dist/` hoàn toàn tĩnh. Khi không có backend `/api/gemini/chat`, trợ lý kỹ thuật tự động chuyển sang **Chế độ phân tích cục bộ (Offline Diagnostics)**.

2. **Chế độ Full-Stack hoặc Serverless kèm Trợ lý AI Gemini (Tùy chọn)**:
   - Chạy server Express tích hợp (cổng `3000`):
     ```bash
     npm run dev
     ```
   - Hoặc triển khai kèm Serverless Function có sẵn tại `/api/gemini/chat.ts`.
   - Cấu hình `GEMINI_API_KEY` (và tùy chọn `CHAT_API_SECRET`, `CHAT_RATE_LIMIT_PER_MIN`, `CHAT_RATE_LIMIT_PER_HOUR` trong biến môi trường) để kích hoạt endpoint `/api/gemini/chat` đã tích hợp sẵn giới hạn tần suất (rate-limit) và kiểm tra Origin.

## Biến môi trường (Tùy chọn cho Vercel / Full-Stack)

Tất cả các biến dưới đây đều **tùy chọn** cho chế độ vẽ và dự toán offline. Khi không cấu hình, ứng dụng tự ẩn tính năng AI trực tuyến và nút Góp ý.

| Biến môi trường | Phạm vi | Bắt buộc | Mặc định / Khi bỏ trống | Mô tả |
| --- | --- | --- | --- | --- |
| `GEMINI_API_KEY` | Server / Serverless | Không | Ẩn nút Trợ lý AI trực tuyến | Khóa API Gemini cho `/api/gemini/chat` |
| `GEMINI_MODEL` | Server / Serverless | Không | `gemini-4-hydrogen` | Mô hình Gemini cho chế độ phân tích sâu |
| `GEMINI_MODEL_FAST` | Server / Serverless | Không | `gemini-3.1-flash-lite` | Mô hình Gemini cho phản hồi nhanh |
| `APP_URL` | Server / Serverless | Không | Tự suy từ `Host` / `http://localhost:3000` | URL công khai dùng kiểm tra Origin cho API |
| `ALLOWED_FRAME_ANCESTORS` | Server (`server.ts`) | Không | `'self' https://hachihi.vn https://*.hachihi.vn` | Domain bổ sung được phép nhúng qua `frame-ancestors` |
| `CHAT_API_SECRET` | Server / Serverless | Không | Không khóa theo header bí mật | Token bảo vệ bổ sung qua `x-hachihi-secret` |
| `CHAT_RATE_LIMIT_PER_MIN` | Server / Serverless | Không | `15` | Số lượt chat tối đa / phút / IP |
| `CHAT_RATE_LIMIT_PER_HOUR` | Server / Serverless | Không | `60` | Số lượt chat tối đa / giờ / IP |
| `CHAT_DAILY_LIMIT` | Server / Serverless | Không | `500` | Tổng lượt chat tối đa / ngày toàn hệ thống |
| `UPSTASH_REDIS_REST_URL` | Server / Serverless | Không | Dùng bộ đếm RAM nội bộ | URL REST Upstash Redis cho rate-limit đa instance |
| `UPSTASH_REDIS_REST_TOKEN` | Server / Serverless | Không | Dùng bộ đếm RAM nội bộ | Token REST Upstash Redis |
| `PORT` | Server (`server.ts`) | Không | `3000` | Cổng HTTP của máy chủ Express |
| `VITE_FEEDBACK_FORM_URL` | Client (Vite build) | Không | Ẩn nút Góp ý | Link Google Form nhận góp ý beta |
| `VITE_FEEDBACK_ENTRY_VERSION` | Client (Vite build) | Không | Không điền sẵn | Mã `entry.*` trường Phiên bản trong Google Form |
| `VITE_FEEDBACK_ENTRY_BUILD` | Client (Vite build) | Không | Không điền sẵn | Mã `entry.*` trường Mã build trong Google Form |
| `VITE_FEEDBACK_ENTRY_MODE` | Client (Vite build) | Không | Không điền sẵn | Mã `entry.*` trường Chế độ thiết kế trong Google Form |
| `VITE_FEEDBACK_ENTRY_DEVICE` | Client (Vite build) | Không | Không điền sẵn | Mã `entry.*` trường Thiết bị (`Desktop`/`Tablet`/`Mobile`) |

## Phím tắt & Tính năng nổi bật

- `Ctrl+K` / `Cmd+K`: Mở **Bảng lệnh nhanh (Command Palette)** để tìm thiết bị, tuyến cáp, tủ Rack hoặc kích hoạt nhanh các lệnh thiết kế.
- **Auto-Route tuyến cáp thông minh**: Thuật toán tìm đường vuông góc tránh nút thiết bị & tủ Rack.
- **Bố cục 3 chế độ thích ứng theo khung chứa**:
  - **Rộng (`>=1280px`)**: 3 cột (Thư viện trái + Canvas + Thuộc tính phải), kéo đổi độ rộng và ghi nhớ theo thiết bị.
  - **Vừa (`768–1279px`)**: Canvas toàn phần + ngăn kéo trượt (Drawer) trái/phải.
  - **Hẹp (`<768px`)**: Canvas toàn màn hình + thanh điều hướng ngón cái phía dưới + Bottom Sheet 3 nấc kéo cho bảng thuộc tính.
- **Cảm ứng & Trợ năng**: Zoom/kéo 2 ngón (pinch & pan), chạm giữ mở menu ngữ cảnh, vùng bấm `>=44px`, mật độ Gọn/Thoải mái, Tương phản cao, Giảm chuyển động và đầy đủ nhãn `aria-*`.

## Kiểm thử

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```
