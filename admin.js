import {
  auth,
  db,
  onAuthStateChanged,
  signOut,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  getDocs
} from "./firebase-config.js";
import { fetchChecklistItems } from "./checklist-service.js";

let users = [];
let checklistItems = [];
let userFilter = "all";
let searchQuery = "";
let editingChecklistId = null;
let toastTimer = null;

document.addEventListener("DOMContentLoaded", initAdminPage);

function initAdminPage() {
  setCurrentDate();
  bindEvents();
  observeAuth();
}

function setCurrentDate() {
  const el = document.getElementById("currentDate");
  if (!el) return;

  const options = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
  el.textContent = new Date().toLocaleDateString("vi-VN", options);
}

function bindEvents() {
  document.getElementById("adminLogoutBtn").addEventListener("click", logout);
  document.getElementById("filterAllBtn").addEventListener("click", () => setUserFilter("all"));
  document.getElementById("filterPendingBtn").addEventListener("click", () => setUserFilter("pending"));
  document.getElementById("userSearchInput").addEventListener("input", (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderUserTable();
  });

  document.getElementById("addChecklistBtn").addEventListener("click", () => openChecklistModal());
  document.getElementById("reloadChecklistBtn").addEventListener("click", loadChecklist);
  document.getElementById("saveChecklistBtn").addEventListener("click", saveChecklist);
  document.getElementById("cancelChecklistBtn").addEventListener("click", closeChecklistModal);
  document.getElementById("checklistModalBackdrop").addEventListener("click", closeChecklistModal);

  document.querySelectorAll(".admin-nav-item[data-section]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      setActiveNav(link.dataset.section);
      document.getElementById(link.dataset.section === "checklist" ? "checklistSection" : "usersSection")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
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

      updateAdminSidebar(user, profile);
      await Promise.all([loadUsers(false), loadChecklist(false)]);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Không thể tải trang quản trị", "error");
    } finally {
      showPageLoader(false);
    }
  });
}

function updateAdminSidebar(firebaseUser, profile) {
  const name = profile.hoTen || "Administrator";
  const email = firebaseUser.email || profile.email || "";

  document.getElementById("adminUserName").textContent = name;
  document.getElementById("adminUserEmail").textContent = email;
  document.getElementById("adminUserInitials").textContent = getInitials(name);
}

function getInitials(name) {
  const parts = String(name || "AD").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "AD";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

async function loadUsers(showLoader = true) {
  if (showLoader) showPageLoader(true, "Đang đồng bộ hóa danh sách người dùng...");
  try {
    const snap = await getDocs(collection(db, "users"));
    users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    updateStats();
    renderUserTable();
  } finally {
    if (showLoader) showPageLoader(false);
  }
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
  return normalizeStatus(status) === "pending";
}

function getFilteredUsers() {
  let list = userFilter === "pending" ? getPendingUsers() : users;

  if (searchQuery) {
    list = list.filter((u) => {
      const haystack = [u.email, u.taiKhoan, u.hoTen, u.khuVuc]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return haystack.includes(searchQuery);
    });
  }

  return list;
}

function updateStats() {
  const pendingCount = getPendingUsers().length;
  const activeCount = users.filter((u) => normalizeStatus(u.status) === "active").length;

  document.getElementById("statPending").textContent = String(pendingCount);
  document.getElementById("statActive").textContent = String(activeCount);

  const badge = document.getElementById("pendingCountBadge");
  badge.textContent = String(pendingCount);
  badge.classList.toggle("hidden", pendingCount === 0);
}

function renderUserTable() {
  const tbody = document.getElementById("userTableBody");
  if (!tbody) return;

  const list = getFilteredUsers();

  if (!list.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-table">${
          userFilter === "pending"
            ? "Không có tài khoản nào đang chờ duyệt."
            : searchQuery
              ? "Không tìm thấy người dùng nào phù hợp với điều kiện lọc."
              : "Chưa có người dùng nào."
        }</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = list.map((u) => renderUserRow(u)).join("");
  setupUserTableEvents();
}

function renderUserRow(u) {
  const status = normalizeStatus(u.status);
  const dateStr = formatCreatedAt(u.createdAt);

  return `
    <tr>
      <td class="user-email-cell">
        <strong>${escapeHtml(u.email || "-")}</strong>
        <span>@${escapeHtml(u.taiKhoan || "-")}</span>
      </td>
      <td>${escapeHtml(u.hoTen || "-")}</td>
      <td>${escapeHtml(u.khuVuc || "-")}</td>
      <td>
        <select class="role-select" data-id="${u.id}" data-current="${u.role || "user"}">
          <option value="user" ${u.role === "user" ? "selected" : ""}>Thành viên</option>
          <option value="manager" ${u.role === "manager" ? "selected" : ""}>Manager</option>
          <option value="admin" ${u.role === "admin" ? "selected" : ""}>Admin</option>
        </select>
      </td>
      <td><span class="status-badge status-${status}">${getStatusLabel(status)}</span></td>
      <td>${dateStr}</td>
      <td>${renderActionButtons(u.id, status)}</td>
    </tr>
  `;
}

function renderActionButtons(userId, status) {
  if (status === "pending") {
    return `
      <div class="action-buttons">
        <button type="button" class="btn-action approve btn-approve" data-id="${userId}">Phê duyệt</button>
        <button type="button" class="btn-action reject btn-reject" data-id="${userId}">Từ chối</button>
      </div>
    `;
  }

  if (status === "active") {
    return `
      <div class="action-buttons">
        <span class="admin-reviewed-note">Đã kiểm duyệt</span>
        <button type="button" class="btn-action lock btn-lock" data-id="${userId}">Khóa</button>
      </div>
    `;
  }

  return `
    <div class="action-buttons">
      <button type="button" class="btn-action unlock btn-unlock" data-id="${userId}">Mở khóa</button>
    </div>
  `;
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
        showToast("Đã cập nhật vai trò người dùng", "success");
        await loadUsers();
      } catch (error) {
        console.error(error);
        e.target.value = currentRole;
        showToast("Không thể cập nhật vai trò", "error");
      }
    });
  });

  document.querySelectorAll(".btn-approve").forEach((button) => {
    button.addEventListener("click", () => handleStatusChange(button.dataset.id, "approve"));
  });

  document.querySelectorAll(".btn-reject").forEach((button) => {
    button.addEventListener("click", () => handleStatusChange(button.dataset.id, "reject"));
  });

  document.querySelectorAll(".btn-lock").forEach((button) => {
    button.addEventListener("click", () => handleStatusChange(button.dataset.id, "lock"));
  });

  document.querySelectorAll(".btn-unlock").forEach((button) => {
    button.addEventListener("click", () => handleStatusChange(button.dataset.id, "unlock"));
  });
}

async function handleStatusChange(userId, action) {
  const user = users.find((u) => u.id === userId);
  const displayName = user?.hoTen || user?.email || "người dùng";

  let newStatus;
  let message;
  let toastType = "success";

  switch (action) {
    case "approve":
      newStatus = "active";
      message = `Đã phê duyệt tài khoản: ${displayName}`;
      break;
    case "reject":
      newStatus = "locked";
      message = `Đã từ chối cấp quyền cho: ${displayName}`;
      toastType = "info";
      break;
    case "lock":
      newStatus = "locked";
      message = `Đã khóa tài khoản: ${displayName}`;
      toastType = "info";
      break;
    case "unlock":
      newStatus = "active";
      message = `Đã mở khóa tài khoản: ${displayName}`;
      break;
    default:
      return;
  }

  try {
    await updateDoc(doc(db, "users", userId), {
      status: newStatus,
      updatedAt: serverTimestamp()
    });
    showToast(message, toastType);
    await loadUsers();
  } catch (error) {
    console.error(error);
    showToast(error.message || "Không thể cập nhật trạng thái", "error");
  }
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

function formatCreatedAt(createdAt) {
  if (!createdAt) return "-";

  try {
    const date = createdAt.toDate ? createdAt.toDate() : new Date(createdAt.seconds * 1000);
    return date.toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "-";
  }
}

async function logout() {
  showToast("Đang đăng xuất...", "info");
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

function setActiveNav(section) {
  document.querySelectorAll(".admin-nav-item[data-section]").forEach((link) => {
    link.classList.toggle("active", link.dataset.section === section);
  });
}

async function loadChecklist(showLoader = true) {
  if (showLoader) showPageLoader(true, "Đang tải checklist...");
  try {
    const { items } = await fetchChecklistItems({ includeInactive: true });
    checklistItems = items;
    document.getElementById("statChecklist")?.textContent = String(
      checklistItems.filter((i) => i.active !== false).length
    );
    renderChecklistTable();
  } catch (error) {
    console.error(error);
    showToast("Không thể tải checklist", "error");
  } finally {
    if (showLoader) showPageLoader(false);
  }
}

function renderChecklistTable() {
  const tbody = document.getElementById("checklistTableBody");
  if (!tbody) return;

  if (!checklistItems.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-table">Chưa có câu hỏi checklist. Bấm "Thêm câu hỏi" để bắt đầu.</td></tr>`;
    return;
  }

  tbody.innerHTML = checklistItems
    .map((item) => {
      const isActive = item.active !== false;
      return `
        <tr>
          <td>${escapeHtml(item.category || "-")}</td>
          <td class="checklist-text-cell">${escapeHtml(item.text || "-")}</td>
          <td>${escapeHtml(item.area || "ALL")}</td>
          <td>${Number(item.order) || 0}</td>
          <td>
            <span class="status-badge status-${isActive ? "active" : "locked"}">
              ${isActive ? "Đang dùng" : "Đã tắt"}
            </span>
          </td>
          <td>
            <div class="action-buttons">
              <button type="button" class="btn-action btn-edit-checklist" data-id="${item.id}">Sửa</button>
              <button type="button" class="btn-action reject btn-toggle-checklist" data-id="${item.id}" data-active="${isActive}">
                ${isActive ? "Tắt" : "Bật"}
              </button>
              <button type="button" class="btn-action reject btn-delete-checklist" data-id="${item.id}">Xóa</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  setupChecklistTableEvents();
}

function setupChecklistTableEvents() {
  document.querySelectorAll(".btn-edit-checklist").forEach((btn) => {
    btn.addEventListener("click", () => editChecklist(btn.dataset.id));
  });

  document.querySelectorAll(".btn-toggle-checklist").forEach((btn) => {
    btn.addEventListener("click", () => toggleChecklistActive(btn.dataset.id, btn.dataset.active === "true"));
  });

  document.querySelectorAll(".btn-delete-checklist").forEach((btn) => {
    btn.addEventListener("click", () => deleteChecklist(btn.dataset.id));
  });
}

function openChecklistModal(item = null) {
  editingChecklistId = item?.id || null;

  document.getElementById("checklistModalTitle").textContent = item
    ? "Sửa câu hỏi checklist"
    : "Thêm câu hỏi checklist";

  document.getElementById("checkCategory").value = item?.category || "";
  document.getElementById("checkText").value = item?.text || "";
  document.getElementById("checkArea").value = item?.area || "ALL";
  document.getElementById("checkOrder").value = item?.order || getNextChecklistOrder();
  document.getElementById("checkActive").checked = item ? item.active !== false : true;

  document.getElementById("checklistModal").classList.remove("hidden");
}

function closeChecklistModal() {
  editingChecklistId = null;
  document.getElementById("checkCategory").value = "";
  document.getElementById("checkText").value = "";
  document.getElementById("checkArea").value = "ALL";
  document.getElementById("checkOrder").value = "";
  document.getElementById("checkActive").checked = true;
  document.getElementById("checklistModal").classList.add("hidden");
}

function getNextChecklistOrder() {
  if (!checklistItems.length) return 1;
  return Math.max(...checklistItems.map((i) => Number(i.order) || 0)) + 1;
}

function editChecklist(id) {
  const item = checklistItems.find((i) => i.id === id);
  if (!item) return;
  openChecklistModal(item);
}

async function saveChecklist() {
  const category = document.getElementById("checkCategory").value.trim();
  const text = document.getElementById("checkText").value.trim();
  const area = document.getElementById("checkArea").value;
  const order = Number(document.getElementById("checkOrder").value || 0);
  const active = document.getElementById("checkActive").checked;

  if (!category || !text) {
    showToast("Vui lòng nhập đầy đủ danh mục và nội dung câu hỏi", "error");
    return;
  }

  if (!order || order < 1) {
    showToast("Thứ tự hiển thị phải lớn hơn 0", "error");
    return;
  }

  const data = {
    category,
    text,
    area,
    order,
    active,
    updatedAt: serverTimestamp()
  };

  try {
    showPageLoader(true, "Đang lưu câu hỏi...");

    if (editingChecklistId) {
      await updateDoc(doc(db, "checklistItems", editingChecklistId), data);
      showToast("Đã cập nhật câu hỏi checklist", "success");
    } else {
      const id = `check_${Date.now()}`;
      await setDoc(doc(db, "checklistItems", id), {
        ...data,
        createdAt: serverTimestamp()
      });
      showToast("Đã thêm câu hỏi checklist mới", "success");
    }

    closeChecklistModal();
    await loadChecklist(false);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Không thể lưu câu hỏi", "error");
  } finally {
    showPageLoader(false);
  }
}

async function toggleChecklistActive(id, currentlyActive) {
  try {
    await updateDoc(doc(db, "checklistItems", id), {
      active: !currentlyActive,
      updatedAt: serverTimestamp()
    });
    showToast(currentlyActive ? "Đã tắt câu hỏi" : "Đã bật câu hỏi", "success");
    await loadChecklist(false);
  } catch (error) {
    console.error(error);
    showToast("Không thể cập nhật trạng thái câu hỏi", "error");
  }
}

async function deleteChecklist(id) {
  const item = checklistItems.find((i) => i.id === id);
  if (!item) return;

  const confirmed = confirm(`Xóa câu hỏi:\n"${item.text}"?\n\nThao tác này không thể hoàn tác.`);
  if (!confirmed) return;

  try {
    showPageLoader(true, "Đang xóa câu hỏi...");
    await deleteDoc(doc(db, "checklistItems", id));
    showToast("Đã xóa câu hỏi checklist", "success");
    await loadChecklist(false);
  } catch (error) {
    console.error(error);
    showToast("Không thể xóa câu hỏi", "error");
  } finally {
    showPageLoader(false);
  }
}
