# BÁO CÁO KHẢO SÁT TOBYFLOW MCP VÀ BẢNG ĐỐI CHIẾU CHỨC NĂNG

Tài liệu này được lập để khảo sát toàn diện giao thức **TobyFlow Model Context Protocol (MCP)**, kiến trúc tích hợp trên máy Windows, và bảng đối chiếu chi tiết giữa các chức năng tạo video của TobyFlow với MCP thực tế.

---

## 1. TỔNG QUAN KIẾN TRÚC TOBYFLOW VÀ MCP

TobyFlow là một tiện ích mở rộng trên trình duyệt Chromium (Google Chrome, Edge, Brave) phục vụ tự động hóa và chạy hàng loạt (batch generation) trên các nền tảng AI sinh video và hình ảnh (Google Flow, ChatGPT/Sora, Grok, Luma, Runway, Kling...).

**Đặc điểm kiến trúc quan trọng:**
1. **TobyFlow không tự sinh video độc lập từ server riêng của nó:** TobyFlow điều khiển các phiên làm việc và tài khoản của người dùng đã đăng nhập sẵn trên trình duyệt.
2. **Vai trò của MCP (Model Context Protocol):** Cung cấp giao diện chuẩn (JSON-RPC 2.0 qua SSE hoặc Stdio bridge `mcp-remote`) để các AI Agent hoặc ứng dụng bên ngoài điều khiển quy trình tạo video, gửi prompt, theo dõi job và nhận kết quả mà không cần thao tác click chuột thủ công.
3. **Cơ chế xác thực:** Token được cấp phát riêng từ **TobyFlow Extension -> Settings -> tab MCP -> Create new token**. Token này được gửi trong header `Authorization: Bearer <token>`.

---

## 2. BẢNG ĐỐI CHIẾU TÍNH NĂNG (FEATURE MATRIX)

| STT | Nhóm chức năng | 1. Chức năng có trong MCP & Dùng được | 2. Chức năng có trong TobyFlow nhưng MCP KHÔNG có | 3. Phụ thuộc Provider / Model / Quota |
|---|---|---|---|---|
| **1** | **Tạo video từ văn bản (Text-to-Video)** | **HỖ TRỢ:** Gọi tool `gen_video` với tham số `prompt`, `aspect_ratio` (16:9, 9:16, 1:1), `provider`, `count`. | Giao diện điều chỉnh thanh trượt Motion Studio, Seed ngẫu nhiên nâng cao. | Quota prompt còn lại trên tài khoản provider (Google Flow credits, Grok quota...). |
| **2** | **Tạo video từ ảnh (Image-to-Video)** | **HỖ TRỢ:** Truyền URL hoặc đường dẫn ảnh tham chiếu qua tham số `reference_image`. | Trình cắt ghép (Crop), căn chỉnh khung hình trước khi gửi vào Flow. | Một số model hoặc provider không hỗ trợ ảnh tham chiếu (ví dụ Grok text-only mode). |
| **3** | **Khung hình Đầu / Cuối (First / Last Frame)** | **HỖ TRỢ (khi provider cho phép):** Tham số `start_frame` và `end_frame`. | Công cụ vẽ mặt nạ (Inpainting mask) trên ảnh đầu. | Chỉ khả dụng trên các model nội suy khung hình (như Luma Dream Machine, Kling). |
| **4** | **Tiếp nối video (Continuation)** | **HỖ TRỢ:** Cờ `continuation: true` kèm ID video gốc. | Ghép nhiều clip trực tiếp trên timeline của TobyFlow. | Provider phải hỗ trợ tính năng Video Extension (kéo dài thêm 4s-5s). |
| **5** | **Workflow nhiều bước (Multi-step)** | **HỖ TRỢ:** Có thể chạy từng bước thông qua ứng dụng bằng cách xác thực file bước trước tồn tại trước khi làm input bước sau. | Canvas kéo thả 9 loại node trực quan (`@node` syntax), node Telegram bot, node ghi chú (Note). | Giới hạn số lượng tác vụ đồng thời (concurrency limit) để tránh bị rate limit. |
| **6** | **Theo dõi tiến độ & Trạng thái** | **HỖ TRỢ:** Tool `get_job` với `job_id`, trả về trạng thái (`pending`, `running`, `completed`, `failed`), tiến độ `%` và danh sách kết quả. | Thông báo âm thanh trên trình duyệt khi hoàn thành một tác vụ. | Phụ thuộc vào tốc độ hàng đợi hàng chờ (queue delay) của máy chủ provider. |
| **7** | **Hủy tác vụ (Cancel Job)** | **HỖ TRỢ 1 PHẦN:** Hủy theo dõi ở phía ứng dụng client. MCP không đảm bảo hủy được lệnh đã gửi sâu vào GPU của provider. | Nút dừng khẩn cấp toàn bộ tab trình duyệt trong extension. | Một số provider tính quota ngay khi lệnh đã vào hàng đợi render. |
| **8** | **Tải và Quản lý file kết quả** | **HỖ TRỢ:** MCP trả về danh sách URL kết quả; ứng dụng tải về staging và chỉ lưu video người dùng chọn vào thư mục đích. | Tùy chọn tự động gom file theo cấu trúc thư mục của TobyFlow Extension. | Dung lượng ổ đĩa cục bộ của người dùng và quyền ghi thư mục đích. |

---

## 3. DANH SÁCH TOOL VÀ SCHEMA MCP DỰ KIẾN TỪ TOBYFLOW

Dựa trên tài liệu chính thức và chuẩn Model Context Protocol:

### Tool 1: `gen_video`
- **Mô tả:** Khởi tạo tác vụ sinh video với prompt và các tham số tùy chọn.
- **Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "prompt": { "type": "string", "description": "Nội dung mô tả video" },
    "provider": { "type": "string", "enum": ["flow", "grok", "chatgpt", "luma", "runway", "kling"], "default": "flow" },
    "model": { "type": "string", "description": "Tên model cụ thể (tùy chọn)" },
    "aspect_ratio": { "type": "string", "enum": ["16:9", "9:16", "1:1", "4:3"], "default": "16:9" },
    "count": { "type": "integer", "default": 1, "description": "Số lượng video kết quả yêu cầu" },
    "reference_image": { "type": "string", "description": "Đường dẫn hoặc URL ảnh tham chiếu" },
    "start_frame": { "type": "string", "description": "Ảnh khung hình bắt đầu" },
    "end_frame": { "type": "string", "description": "Ảnh khung hình kết thúc" },
    "continuation": { "type": "boolean", "default": false }
  },
  "required": ["prompt"]
}
```
- **Output:** `{ "job_id": "string", "status": "submitting" | "running" }`

### Tool 2: `get_job`
- **Mô tả:** Kiểm tra trạng thái và lấy kết quả của tác vụ đã gửi.
- **Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "job_id": { "type": "string", "description": "Mã tác vụ trả về từ gen_video" }
  },
  "required": ["job_id"]
}
```
- **Output:**
```json
{
  "job_id": "string",
  "status": "pending" | "running" | "completed" | "failed",
  "progress": 0-100,
  "outputs": ["https://.../video1.mp4", "https://.../video2.mp4"],
  "error": "Thông báo lỗi nếu thất bại"
}
```

---

## 4. QUY TRÌNH AN TOÀN FILE VÀ ĐẶT TÊN THEO GIỜ VIỆT NAM (ASIA/BANGKOK)

1. **Thư mục Staging tạm thời:**
   - File kết quả từ MCP được tải về thư mục staging nội bộ `data/staging/` trước.
   - Kiểm tra kích thước file (> 0 bytes) và tính toàn vẹn của header video trước khi hiển thị cho người dùng.
2. **Quyền lựa chọn của người dùng (Bắt buộc):**
   - Video chưa được tích chọn **hoàn toàn không được xuất hiện trong thư mục đích**.
   - Hỗ trợ "Chọn tất cả" và "Bỏ chọn tất cả".
3. **Quy tắc đặt tên file (Asia/Bangkok UTC+7):**
   - Mẫu mặc định: `YYYY-MM-DD_HH-mm-ss_001.mp4`
   - Thuật toán chống trùng lặp: Luôn kiểm tra xem file đã tồn tại trong thư mục đích chưa; nếu có, tự động tăng số thứ tự lên `_002.mp4`, `_003.mp4`... Đảm bảo **không bao giờ ghi đè file cũ**.
4. **Ghi file nguyên tử (Atomic write):**
   - Ghi vào file tạm `.ten_file.mp4.part` trong thư mục đích.
   - Đổi tên thành tên file chính thức sau khi xác nhận toàn vẹn.

---

## 5. CÁC ĐIỀU KIỆN THỰC TẾ ĐỂ ỨNG DỤNG HOẠT ĐỘNG
- **Google Chrome** và **TobyFlow Extension** phải đang mở.
- Tab nhà cung cấp (ví dụ Google Flow hoặc Grok) phải đã đăng nhập và còn quota.
- Nếu mất kết nối, token hết hạn hoặc hết quota, ứng dụng sẽ hiện thông báo chi tiết và giữ nguyên hàng đợi để người dùng có thể bấm "Thử lại" sau khi nạp quota hoặc đăng nhập lại.

