# HƯỚNG DẪN SỬ DỤNG - TOBYFLOW STUDIO WINDOWS (PHIÊN BẢN CÀI ĐẶT & TỰ ĐỘNG CẬP NHẬT)

Ứng dụng **TobyFlow Studio** trên Windows đã được nâng cấp toàn diện thành ứng dụng desktop Windows độc lập (.exe), tối ưu cho chế độ **AutoFlow Pro** tự động hóa 100%:
- **Cài đặt 1-click**: Tải file `TobyFlow-Studio-Setup-*.exe` từ GitHub Releases và sử dụng ngay.
- **Không yêu cầu môi trường phức tạp**: Không cần cài đặt trước Node.js, không cần mở file `.bat`, và đã tích hợp sẵn `ffprobe.exe` trong bộ cài (không cần cài đặt FFmpeg riêng).
- **Cập nhật ngay trong ứng dụng**: Kiểm tra, tải và cài đặt bản cập nhật mới trực tiếp từ GitHub Releases chỉ bằng 1 nút bấm.
- **Tự động lưu video theo ngày**: Tự động phát hiện khi video tải xong từ Chrome/TobyFlow và sao chép vào thư mục ngày `YYYY-MM-DD` (giờ Asia/Bangkok). Hoàn toàn **không cần token MCP**.

---

## 1. CÀI ĐẶT ỨNG DỤNG LẦN ĐẦU

### Bước 1: Tải bộ cài đặt từ GitHub Releases
1. Truy cập trang GitHub Releases của dự án (mục **Releases**).
2. Tải file cài đặt chính thức: `TobyFlow-Studio-Setup-2.0.0.exe`.

### Bước 2: Chạy bộ cài đặt trên Windows
1. Nhấp đúp vào file `TobyFlow-Studio-Setup-2.0.0.exe`.
2. **Lưu ý về cảnh báo Windows SmartScreen (Ứng dụng chưa ký số thương mại - Unsigned):**
   - Vì phần mềm được phát hành dạng mã nguồn mở không dùng chứng chỉ số có phí của Microsoft, Windows SmartScreen có thể hiển thị thông báo màu xanh dương: *"Windows protected your PC"* / *"Windows đã bảo vệ PC của bạn"*.
   - **Cách xử lý:** Bấm vào dòng chữ **"More info"** (Thêm thông tin) -> Chọn nút **"Run anyway"** (Vẫn chạy).
3. Trình cài đặt sẽ tạo lối tắt **TobyFlow Studio** trên màn hình Desktop và trong menu Start của Windows.
4. Mở ứng dụng từ Desktop để sử dụng.

---

## 2. NGUYÊN LÝ HOẠT ĐỘNG AUTOFLOW PRO

Quy trình tự động hóa khép kín:
```
[Chrome + TobyFlow Extension] ──> [Auto Download về thư mục máy] ──> [Studio tự quét & kiểm tra ffprobe] ──> [Tự động sao chép vào <Thư mục đích>\YYYY-MM-DD\]
```

1. **Tạo video trong Chrome:** Bạn tạo video qua tiện ích mở rộng TobyFlow trên Chrome và bật tính năng **Auto Download**. Chrome sẽ tải các video thành phẩm về máy.
2. **Tự động theo dõi & Quét liên tục:** Studio tự động giám sát thư mục tải về (kể cả các thư mục con như `tobyflow-01\`, `batch-A\`).
3. **Kiểm tra độ tin cậy:**
   - Tự động bỏ qua file `.crdownload`, `.part`, `.tmp` đang tải dở.
   - Chờ dung lượng file ổn định.
   - Sử dụng công cụ `ffprobe` tích hợp sẵn để thẩm định tính toàn vẹn của stream video (loại bỏ 100% file hỏng, file giả mạo).
4. **Tự động sao chép theo ngày:**
   - Tự động tạo thư mục con theo ngày hiện tại: `<Thư mục gốc đích>\YYYY-MM-DD\` (theo múi giờ Asia/Bangkok).
   - Đặt tên file chống trùng lặp: `YYYY-MM-DD_HH-mm-ss_001.mp4`. Nếu lưu nhiều video cùng thời điểm, tự động tăng hậu tố `_001`, `_002`, `_003`... **tuyệt đối không bao giờ ghi đè**.
5. **Bảo tồn dữ liệu:** Giữ nguyên 100% file gốc trong thư mục tải về.

---

## 3. CẤU HÌNH THƯ MỤC LẦN ĐẦU TIÊN

Trong giao diện Studio, mở thẻ **Cài đặt & Thư mục (Settings)**:

### 1. Thư mục nguồn (Downloads của Chrome / TobyFlow):
- Bấm **"Duyệt..."** để chọn thư mục tải về trên máy bạn (Ví dụ: `C:\Users\Admin\Downloads`).
- *Mẹo tìm nhanh thư mục tải về:* Trong Chrome, nhấn **`Ctrl + J`** -> tìm một video đã tải -> bấm **"Hiển thị trong thư mục"** (Show in folder).

### 2. Thư mục gốc lưu trữ chính thức:
- Bấm **"Duyệt..."** để chọn ổ đĩa hoặc thư mục bạn muốn lưu trữ video lâu dài (Ví dụ: `E:\Videos\TobyFlow`).
- Khi cấu hình xong, bấm **"Lưu Cấu Hình Thư Mục"**.

### 3. Chế độ Tự Động Lưu (Auto-Save):
- Mặc định tùy chọn **"Bật chế độ Tự Động Lưu Video"** đã được tích chọn.
- Sau khi cấu hình xong, bạn chỉ cần giữ Studio mở khi làm việc với Chrome; video tải về sẽ tự động chuyển vào thư mục ngày mà không cần phải bấm bất kỳ nút nào.

---

## 4. KIỂM TRA & CẬP NHẬT PHIÊN BẢN MỚI (IN-APP UPDATE)

TobyFlow Studio tích hợp sẵn tính năng tự động cập nhật từ GitHub Releases:

1. Vào thẻ **Cài đặt & Thư mục** -> Tìm mục **Cập Nhật TobyFlow Studio**.
2. Bấm nút **"🔄 Kiểm tra cập nhật"**:
   - Nếu bạn đang ở bản mới nhất, hệ thống sẽ báo: *"Bạn đang sử dụng phiên bản mới nhất"*.
   - Nếu có phiên bản mới trên GitHub Releases (ví dụ `v2.1.0`), ứng dụng sẽ hiển thị số phiên bản và nội dung cải tiến (Release Notes).
3. Bấm **"📥 Tải bản cập nhật mới"**:
   - Thanh tiến trình sẽ hiển thị % tải xuống và dung lượng MB đã tải theo thời gian thực.
4. Khi tải xong, bấm **"⚡ Cài đặt & Khởi động lại"**:
   - Studio sẽ tự động hoàn tất mọi tác vụ sao chép video đang thực hiện dở dang để bảo vệ dữ liệu.
   - Tự động đóng server, cài đặt bản cập nhật và khởi động lại ứng dụng.
   - Toàn bộ cấu hình thư mục, lịch sử lưu trữ và các video đã lưu được giữ nguyên 100% trong thư mục `%APPDATA%\tobyflow-studio`.

---

## 5. DÀNH CHO NHÀ PHÁT TRIỂN / QUẢN TRỊ VIÊN

### Cấu trúc mã nguồn:
- `main/`: Mã nguồn tiến trình chính Electron (`index.js`, `preload.js`, `serverManager.js`, `updater.js`, `dataMigration.js`).
- `bin/`: Chứa file nhị phân `ffprobe.exe` (Win64) cùng tài liệu bản quyền LGPL/GPL v3.
- `public/`: Giao diện ứng dụng độc lập hiện đại (`index.html`, `style.css`, `app.js`).
- `server.js` & `library.js`: Máy chủ HTTP cục bộ và thư viện xử lý logic quét thư mục, chống trùng, ffprobe.
- `tests/`: Bộ kiểm thử tự động nội bộ (14 bài test mock kiểm tra độ tin cậy).

### Lệnh phát triển & đóng gói:
```cmd
# Chạy ứng dụng Electron ở chế độ phát triển
npm start

# Chạy kiểm thử tự động
npm test

# Đóng gói bộ cài đặt Setup.exe (Windows x64)
npm run build
```

### Xuất bản phiên bản mới lên GitHub Releases:
Dự án đã tích hợp sẵn GitHub Actions Workflow (`.github/workflows/release.yml`). Để phát hành phiên bản mới:
1. Cập nhật số phiên bản trong `package.json` (ví dụ `2.0.1`).
2. Tạo git tag tương ứng và đẩy lên GitHub:
   ```cmd
   git tag v2.0.1
   git push origin v2.0.1
   ```
3. GitHub Actions sẽ tự động kiểm thử toàn bộ dự án, biên dịch bộ cài `TobyFlow-Studio-Setup-2.0.1.exe`, tạo file `latest.yml` và xuất bản lên GitHub Releases. Mọi người dùng đang mở TobyFlow Studio sẽ nhận được thông báo cập nhật ngay lập tức!
