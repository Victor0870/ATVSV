# Bảo mật hệ thống ATVSV E-Checksheet

Tài liệu này mô tả các biện pháp bảo mật đã triển khai và hướng dẫn IT vận hành.

## Tóm tắt kiến trúc

| Thành phần | Công nghệ |
|------------|-----------|
| Frontend | HTML/JS tĩnh (GitHub Pages) |
| Auth | Firebase Authentication (email/password) |
| Database | Cloud Firestore |
| File ảnh NG | Firebase Storage |
| Logic nhạy cảm | Cloud Functions (`functions/`) |

## Các biện pháp đã triển khai

### 1. Firestore Security Rules (`firestore.rules`)

- Phân quyền theo vai trò: `user`, `manager`, `admin`
- User chỉ đọc/ghi dữ liệu thuộc `khuVuc` của mình (submissions, remediation)
- **Không cho client tạo/sửa** document `users` — chỉ Cloud Functions (Admin SDK)
- Collection `audit_logs`: chỉ admin đọc; chỉ Functions ghi

### 2. Cloud Functions (`functions/index.js`)

| Function | Mục đích |
|----------|----------|
| `completeRegistration` | Tạo hồ sơ user sau đăng ký Auth; ép `role=user`, `status=pending` |
| `adminUpdateUser` | Admin đổi role/status; ghi `audit_logs`; chặn sửa admin khác / tự hạ quyền |

### 3. Firebase Storage (`storage.rules`)

- Chỉ file `image/*`, tối đa **2 MB**
- User chỉ upload vào thư mục của chính mình
- Admin/Manager đọc được ảnh minh chứng

### 4. Ảnh minh chứng

- **Không lưu URL công khai** vào Firestore (chỉ lưu `path`)
- Khi xem báo cáo/dashboard: tải URL qua SDK (kiểm tra `storage.rules` + Auth)
- Dữ liệu cũ có `url` vẫn tương thích ngược

### 5. Trang Quản trị

- Xác nhận (`confirm`) trước khi đổi **vai trò** hoặc **trạng thái** user
- Mọi thay đổi qua `adminUpdateUser` (có audit log)

### 6. Firebase App Check (tùy chọn, khuyến nghị production)

- Code sẵn trong `firebase-config.js`
- IT cần: Firebase Console → **App Check** → đăng ký Web app → reCAPTCHA v3
- Điền `APP_CHECK_RECAPTCHA_SITE_KEY` trong `firebase-config.js`
- Bật enforcement cho Firestore, Storage, Functions

## Triển khai (IT)

```bash
# Cài dependencies Functions (lần đầu)
cd functions
npm install
cd ..

# Deploy rules + functions
firebase deploy --only firestore:rules,storage:rules,functions
```

**Lưu ý:** Sau khi deploy rules mới, **đăng ký user** và **phân quyền admin** bắt buộc phải qua Cloud Functions. Nếu chưa deploy functions, các thao tác này sẽ lỗi.

### Lỗi deploy Functions (IAM / Cloud Build)

Nếu gặp: *"missing permission on the build service account"*:

1. Đăng nhập Google Cloud Console với tài khoản **Owner** dự án `e-checksheet-atvsv-c1d45`
2. Vào **IAM** → tìm service account `PROJECT_NUMBER@cloudbuild.gserviceaccount.com`
3. Gán role **Cloud Build Service Account** (`roles/cloudbuild.builds.builder`) hoặc **Editor** tạm thời
4. Chạy lại: `firebase deploy --only functions --force`

Sau deploy thành công:

```bash
firebase functions:list
```

Phải thấy `completeRegistration` và `adminUpdateUser` ở region `asia-southeast1`.

## Kiểm toán (audit_logs)

Mỗi lần admin đổi role/status, Firestore ghi document trong `audit_logs`:

- `action`, `targetUserId`, `performedBy`, `previousRole`/`newRole`, `previousStatus`/`newStatus`, `createdAt`

IT xem tại: Firebase Console → Firestore → `audit_logs`.

## API Key Firebase trên client

`apiKey` trong `firebase-config.js` là **bình thường** với ứng dụng web. Bảo vệ thực tế:

- Security Rules
- App Check (khuyến nghị bật)
- Giới hạn API key theo domain (Google Cloud Console)

## Checklist cho IT trước go-live

- [ ] Deploy `firestore.rules`, `storage.rules`, `functions`
- [ ] Bật App Check + điền reCAPTCHA site key
- [ ] Kiểm tra đăng ký → phê duyệt → đăng nhập → gửi checklist → xem ảnh NG
- [ ] Kiểm tra admin đổi role/status có hộp thoại xác nhận + bản ghi `audit_logs`
- [ ] Xác nhận user thường **không** đọc được submission khu vực khác
- [ ] Theo dõi quota Firebase Console sau 1 tuần pilot

## Liên hệ phát triển

Repository: https://github.com/Victor0870/ATVSV
