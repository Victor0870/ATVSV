import {
  auth,
  db,
  onAuthStateChanged,
  signOut,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  collection,
  getDocs
} from "./firebase-config.js";

let users = [];
let userFilter = "all";
let toastTimer = null;

document.addEventListener("DOMContentLoaded", initAdminPage);

function initAdminPage() {
  bindEvents();
  observeAuth();
}

function bindEvents() {
  document.getElementById("adminLogoutBtn").addEventListener("click", logout);
  document.getElementById("filterAllBtn").addEventListener("click", () => setUserFilter("all"));
  document.getElementById("filterPendingBtn").addEventListener("click", () => setUserFilter("pending"));
}

function observeAuth() {
  showPageLoader(true, "Đang kiểm tra quyền truy cập...");

  onAuthStateChanged(auth, async (user) => {
    try {
      if (!user) {
        location.href = "./index.html";
        return;
      }

      const userDoc = await getDoc(doc(db, "users", user.uid));

      if (!userDoc.exists()) {
        showToast("Không tìm thấy hồ sơ người dùng", "error");
        setTimeout(() => { location.href = "./index.html"; }, 1500);
        return;
      }

      const profile = userDoc.data();

      if (String(profile.role || "").trim().toLowerCase() !== "admin") {
        showToast("Bạn không có quyền truy cập trang quản trị", "error");
        setTimeout(() => { location.href = "./index.html"; }, 1500);
        return;
      }

      if (profile.status !== "active") {
        showToast("Tài khoản admin chưa được kích hoạt", "error");
        setTimeout(() => { location.href = "./index.html"; }, 1500);
        return;
      }

      await loadUsers();
    } catch (error) {
      console.error(error);
      showToast(error.message || "Không thể tải trang quản trị", "error");
    } finally {
      showPageLoader(false);
    }
  });
}

async function loadUsers() {
  const snap = await getDocs(collection(db, "users"));
  users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  updatePendingBadge();
  renderUserTable();
}

function setUserFilter(filter) {
  userFilter = filter;

  document.getElementById("filterAllBtn").classList.toggle("active", filter === "all");
  document.getElementById("filterPendingBtn").classList.toggle("active", filter === "pending");

  renderUserTable();
}

function getPendingUsers() {
  return users.filter((u) => isPendingStatus(u.status));
}

function isPendingStatus(status) {
  return status === "pending" || status === "inactive";
}

function updatePendingBadge() {
  const badge = document.getElementById("pendingCountBadge");
  const count = getPendingUsers().length;

  if (!badge) return;

  badge.textContent = String(count);
  badge.classList.toggle("hidden", count === 0);
}

function renderUserTable() {
  const tbody = document.getElementById("userTableBody");
  if (!tbody) return;

  const list = userFilter === "pending" ? getPendingUsers() : users;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-table">${
      userFilter === "pending"
        ? "Không có tài khoản nào đang chờ duyệt."
        : "Chưa có người dùng nào."
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map((u) => {
      const dateStr = formatCreatedAt(u.createdAt);
      const status = normalizeStatus(u.status);
      const statusLabel = getStatusLabel(status);
      const actionLabel = getActionLabel(status);

      return `
        <tr>
          <td>${escapeHtml(u.email || "-")}</td>
          <td>${escapeHtml(u.hoTen || "-")}</td>
          <td>${escapeHtml(u.taiKhoan || "-")}</td>
          <td>${escapeHtml(u.khuVuc || "-")}</td>
          <td>
            <select class="role-select" data-id="${u.id}" data-current="${u.role || "user"}">
              <option value="user" ${u.role === "user" ? "selected" : ""}>User</option>
              <option value="manager" ${u.role === "manager" ? "selected" : ""}>Manager</option>
              <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
            </select>
          </td>
          <td>
            <span class="status-badge status-${status}">${statusLabel}</span>
          </td>
          <td>${dateStr}</td>
          <td>
            <div class="action-buttons">
              <button type="button" class="btn-action btn-toggle-status" data-id="${u.id}" data-status="${status}">
                ${actionLabel}
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  setupUserTableEvents();
}

function setupUserTableEvents() {
  document.querySelectorAll(".role-select").forEach((select) => {
    select.addEventListener("change", async (e) => {
      const userId = e.target.dataset.id;
      const newRole = e.target.value;
      const currentRole = e.target.dataset.current;

      if (newRole === currentRole) return;

      try {
        await updateDoc(doc(db, "users", userId), {
          role: newRole,
          updatedAt: serverTimestamp()
        });
        showToast("Đã cập nhật vai trò", "success");
        await loadUsers();
      } catch (error) {
        console.error(error);
        e.target.value = currentRole;
        showToast("Không thể cập nhật vai trò", "error");
      }
    });
  });

  document.querySelectorAll(".btn-toggle-status").forEach((button) => {
    button.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const userId = btn.dataset.id;
      const currentStatus = btn.dataset.status;

      try {
        await toggleUserStatus(userId, currentStatus);
      } catch (error) {
        console.error(error);
        showToast(error.message || "Không thể cập nhật trạng thái", "error");
      }
    });
  });
}

async function toggleUserStatus(userId, currentStatus) {
  const status = normalizeStatus(currentStatus);
  let newStatus;
  let message;

  if (isPendingStatus(status)) {
    newStatus = "active";
    message = "Đã phê duyệt tài khoản";
  } else if (status === "active") {
    newStatus = "locked";
    message = "Đã khóa tài khoản";
  } else {
    newStatus = "active";
    message = "Đã mở khóa tài khoản";
  }

  await updateDoc(doc(db, "users", userId), {
    status: newStatus,
    updatedAt: serverTimestamp()
  });

  showToast(message, "success");
  await loadUsers();
}

function normalizeStatus(status) {
  if (status === "inactive") return "pending";
  return status || "pending";
}

function getStatusLabel(status) {
  switch (status) {
    case "active":
      return "Hoạt động";
    case "locked":
      return "Bị khóa";
    default:
      return "Chờ duyệt";
  }
}

function getActionLabel(status) {
  if (isPendingStatus(status)) return "Phê duyệt";
  if (status === "active") return "Khóa";
  return "Mở khóa";
}

function formatCreatedAt(createdAt) {
  if (!createdAt) return "-";

  try {
    const date = createdAt.toDate ? createdAt.toDate() : new Date(createdAt.seconds * 1000);
    return date.toLocaleDateString("vi-VN");
  } catch {
    return "-";
  }
}

async function logout() {
  await signOut(auth);
  location.href = "./index.html";
}

function showPageLoader(show, text = "Đang xử lý...") {
  const loader = document.getElementById("pageLoader");
  const loaderText = document.getElementById("pageLoaderText");
  if (!loader) return;

  if (loaderText) loaderText.textContent = text;
  loader.classList.toggle("hidden", !show);
}

function showToast(message, type = "info") {
  const toast = document.getElementById("toast");
  if (!toast) return;

  toast.className = `toast ${type}`;
  toast.textContent = message;
  toast.classList.remove("hidden");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3200);
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}
