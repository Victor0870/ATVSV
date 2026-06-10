# Bảo mật hệ thống ATVSV E-Checksheet

Tài liệu này mô tả các biện pháp bảo mật đã triển khai 

## Tóm tắt kiến trúc

| Thành phần | Công nghệ |
|------------|-----------|
| Frontend | HTML/JS tĩnh (GitHub Pages) |
| Auth | Firebase Authentication (email/password) |
| Database | Cloud Firestore |
| File ảnh NG | Firebase Storage |
| Logic nhạy cảm | Cloud Functions (`functions/`) |

## Các biện pháp đã triển khai

### 1. Firestore Security Rules 

> File `firestore.rules` và `storage.rules` **không** nằm trên GitHub (`.gitignore`). Chỉ deploy từ máy có bản local qua `firebase deploy`.

- Phân quyền theo vai trò: `user`, `manager`, `admin`
- User chỉ đọc/ghi dữ liệu thuộc `khuVuc` của mình (submissions, remediation)
- **Không cho client tạo/sửa** document `users` — chỉ Cloud Functions (Admin SDK)
- Collection `audit_logs`: chỉ admin đọc; chỉ Functions ghi

### 2. Cloud Functions (`functions/index.js`)

| Function | Mục đích |
|----------|----------|
| `completeRegistration` | Tạo hồ sơ user sau đăng ký Auth; ép `role=user`, `status=pending` |
| `adminUpdateUser` | Admin đổi role/status; ghi `audit_logs`; chặn sửa admin khác / tự hạ quyền |

Cả hai function dùng `enforceAppCheck: true` — từ chối request không có token App Check hợp lệ.

### 3. Firebase Storage

- Chỉ file `image/*`, tối đa **2 MB**
- User chỉ upload vào thư mục của chính mình
- Admin/Manager đọc được ảnh

### 4. Ảnh 

- **Không lưu URL công khai** vào Firestore (chỉ lưu `path`)
- Khi xem báo cáo/dashboard: tải URL qua SDK (kiểm tra `storage.rules` + Auth)
- Dữ liệu cũ có `url` vẫn tương thích ngược

### 5. Trang Quản trị

- Xác nhận (`confirm`) trước khi đổi **vai trò** hoặc **trạng thái** user
- Mọi thay đổi qua `adminUpdateUser` (có audit log)

### 6. Firebase App Check 

- Code sẵn trong `firebase-config.js`
- Bật enforcement cho Firestore, Storage, Functions

## Kiểm toán (audit_logs)

Mỗi lần admin đổi role/status, Firestore ghi document trong `audit_logs`:

- `action`, `targetUserId`, `performedBy`, `previousRole`/`newRole`, `previousStatus`/`newStatus`, `createdAt`

## API Key Firebase trên client

`apiKey` trong `firebase-config.js` là **bình thường** với ứng dụng web. Bảo vệ thực tế:

- Security Rules
- App Check 
- Giới hạn API key theo domain (Google Cloud Console)

