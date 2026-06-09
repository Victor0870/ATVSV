const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();

const REGION = "asia-southeast1";

const callableOptions = {
  region: REGION,
  enforceAppCheck: true
};

setGlobalOptions({ maxInstances: 10, region: REGION });

const db = admin.firestore();

const ALLOWED_ROLES = new Set(["user", "manager", "admin"]);
const ALLOWED_STATUSES = new Set(["pending", "inactive", "active", "locked"]);

async function getCallerProfile(uid) {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

function assertActiveAdmin(profile) {
  if (!profile || String(profile.role || "").toLowerCase() !== "admin") {
    throw new HttpsError("permission-denied", "Chỉ admin mới được thực hiện thao tác này.");
  }
  if (String(profile.status || "").toLowerCase() !== "active") {
    throw new HttpsError("permission-denied", "Tài khoản admin chưa được kích hoạt.");
  }
}

async function writeAuditLog(entry) {
  await db.collection("audit_logs").add({
    ...entry,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

function sanitizeText(value, maxLen = 200) {
  return String(value || "")
    .trim()
    .slice(0, maxLen);
}

/**
 * Called after Firebase Auth sign-up. Creates user profile with enforced role/status.
 */
exports.completeRegistration = onCall(callableOptions, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Bạn cần đăng nhập để hoàn tất đăng ký.");
  }

  const uid = request.auth.uid;
  const data = request.data || {};
  const email = sanitizeText(data.email || request.auth.token.email || "", 320).toLowerCase();
  const taiKhoan = sanitizeText(data.taiKhoan, 80);
  const hoTen = sanitizeText(data.hoTen, 200);
  const khuVuc = sanitizeText(data.khuVuc, 120);

  if (!email || !taiKhoan || !hoTen || !khuVuc) {
    throw new HttpsError("invalid-argument", "Thiếu thông tin đăng ký bắt buộc.");
  }

  const userRef = db.doc(`users/${uid}`);
  const existing = await userRef.get();
  if (existing.exists) {
    throw new HttpsError("already-exists", "Hồ sơ người dùng đã tồn tại.");
  }

  await userRef.set({
    uid,
    email,
    taiKhoan,
    hoTen,
    khuVuc,
    role: "user",
    status: "pending",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { ok: true };
});

/**
 * Admin-only: change user role or status with audit trail and guard rails.
 */
exports.adminUpdateUser = onCall(callableOptions, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Bạn cần đăng nhập.");
  }

  const caller = await getCallerProfile(request.auth.uid);
  assertActiveAdmin(caller);

  const data = request.data || {};
  const action = sanitizeText(data.action, 40);
  const targetUserId = sanitizeText(data.userId, 128);
  const reason = sanitizeText(data.reason, 500);

  if (!targetUserId || !action) {
    throw new HttpsError("invalid-argument", "Thiếu tham số thao tác.");
  }

  const targetRef = db.doc(`users/${targetUserId}`);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new HttpsError("not-found", "Không tìm thấy người dùng.");
  }

  const target = { id: targetSnap.id, ...targetSnap.data() };
  const targetRole = String(target.role || "user").toLowerCase();
  const callerId = request.auth.uid;

  if (targetRole === "admin" && targetUserId !== callerId) {
    throw new HttpsError("permission-denied", "Không thể thay đổi tài khoản admin khác.");
  }

  const updates = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  let auditAction = action;
  let auditDetail = {};

  if (action === "changeRole") {
    const newRole = String(data.newRole || "").toLowerCase();
    if (!ALLOWED_ROLES.has(newRole)) {
      throw new HttpsError("invalid-argument", "Vai trò không hợp lệ.");
    }

    if (targetUserId === callerId && newRole !== "admin") {
      throw new HttpsError("permission-denied", "Admin không thể tự hạ quyền của chính mình.");
    }

    updates.role = newRole;
    auditDetail = { previousRole: targetRole, newRole };
  } else if (
    action === "changeStatus" ||
    ["approve", "reject", "lock", "unlock"].includes(action)
  ) {
    let newStatus = String(data.newStatus || "").toLowerCase();

    if (!newStatus) {
      if (action === "approve" || action === "unlock") newStatus = "active";
      if (action === "reject" || action === "lock") newStatus = "locked";
    }

    if (!ALLOWED_STATUSES.has(newStatus)) {
      throw new HttpsError("invalid-argument", "Trạng thái không hợp lệ.");
    }

    if (targetRole === "admin" && targetUserId !== callerId && newStatus === "locked") {
      throw new HttpsError("permission-denied", "Không thể khóa tài khoản admin khác.");
    }

    updates.status = newStatus;
    auditAction = "changeStatus";
    auditDetail = {
      previousStatus: String(target.status || "pending").toLowerCase(),
      newStatus,
      triggerAction: action
    };
  } else {
    throw new HttpsError("invalid-argument", "Hành động không được hỗ trợ.");
  }

  await targetRef.update(updates);

  await writeAuditLog({
    action: auditAction,
    targetUserId,
    targetEmail: target.email || "",
    targetHoTen: target.hoTen || "",
    performedBy: callerId,
    performedByEmail: caller.email || "",
    reason,
    ...auditDetail
  });

  return { ok: true };
});
