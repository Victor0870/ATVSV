import {
  auth,
  db,
  onAuthStateChanged,
  signOut,
  doc,
  getDoc,
  updateDoc,
  collection,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp
} from "./firebase-config.js";

let users = [];
let checklistItems = [];
let editingChecklistId = null;
let toastTimer = null;

document.addEventListener("DOMContentLoaded", initAdminPage);

function initAdminPage() {
  bindEvents();
  observeAuth();
}

function bindEvents() {
  document.getElementById("adminLogoutBtn")?.addEventListener("click", logout);
  document.getElementById("addChecklistBtn")?.addEventListener("click", handleAddChecklist);
  document.getElementById("cancelChecklistBtn")?.addEventListener("click", closeChecklistModal);
  document.getElementById("saveChecklistBtn")?.addEventListener("click", saveChecklist);
  document.getElementById("reloadChecklistBtn")?.addEventListener("click", loadChecklist);
  document.getElementById("checklistModalBackdrop")?.addEventListener("click", closeChecklistModal);
}

function observeAuth() {
  showPageLoader(true, "Đang kiểm tra quyền truy cập...");
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      location.href = "./index.html";
      return;
    }

    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (!userDoc.exists()) {
        showToast("Không tìm thấy hồ sơ người dùng trong hệ thống.", "error");
        setTimeout(() => { location.href = "./index.html"; }, 1500);
        return;
      }

      const profile = userDoc.data();
      
      // CẢI TIẾN A: Kiểm tra nghiêm ngặt cả trạng thái active và role admin
      if (profile.status !== "active") {
        showToast("Tài khoản admin của bạn chưa được kích hoạt.", "error");
        setTimeout(() => { location.href = "./index.html"; }, 1500);
        return;
      }
      if (profile.role !== "admin") {
        showToast("Bạn không có quyền truy cập trang quản trị.", "error");
        setTimeout(() => { location.href = "./index.html"; }, 1500);
        return;
      }

      // Loader tổng quản lý, tránh nhấp nháy ở các hàm con khi gọi từ init
      await Promise.all([loadUsers(false), loadChecklist(false)]);
    } catch (error) {
      console.error(error);
      showToast("Lỗi kiểm tra phiên làm việc", "error");
      location.href = "./index.html";
    } finally {
      showPageLoader(false);
    }
  });
}

async function loadUsers(toggleLoader = true) {
  try {
    if (toggleLoader) showPageLoader(true, "Đang tải người dùng...");
    const snap = await getDocs(collection(db, "users"));
    users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderUserTable();
  } catch (error) {
    console.error(error);
    showToast("Không thể tải danh sách thành viên", "error");
  } finally {
    if (toggleLoader) showPageLoader(false);
  }
}

function renderUserTable() {
  const tbody = document.getElementById("userTableBody");
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-table">Chưa có thành viên nào đăng ký.</td></tr>`;
    return;
  }

  // CẢI TIẾN B: Lấy UID của admin hiện tại đang đăng nhập
  const currentUid = auth.currentUser?.uid;

  tbody.innerHTML = users.map((u) => {
    const isSelf = u.id === currentUid;
    return `
      <tr>
        <td>${escapeHtml(u.email || "-")}</td>
        <td>${escapeHtml(u.hoTen || "-")}</td>
        <td>${escapeHtml(u.taiKhoan || "-")}</td>
        <td>${escapeHtml(u.khuVuc || "-")}</td>
        <td>
          <select class="role-select" data-id="${u.id}" ${isSelf ? "disabled" : ""}>
            <option value="user" ${u.role === "user" ? "selected" : ""}>user</option>
            <option value="manager" ${u.role === "manager" ? "selected" : ""}>manager</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
          </select>
        </td>
        <td>
          <span class="topbar-tag" style="background:${u.status === "active" ? "#f3fff7" : "#fff4f4"}; color:${u.status === "active" ? "var(--success)" : "var(--danger)"}; border-color:${u.status === "active" ? "#ffd5d9" : "#f1f1f1"}">
            ${u.status === "active" ? "Hoạt động" : "Chờ duyệt"}
          </span>
        </td>
        <td>
          <button class="ghost-btn small-btn btn-toggle-status" data-id="${u.id}" data-status="${u.status}" ${isSelf ? "disabled" : ""}>
            ${u.status === "active" ? "Khóa" : "Duyệt"}
          </button>
        </td>
      </tr>
    `;
  }).join("");

  setupUserTableEvents();
}

function setupUserTableEvents() {
  document.querySelectorAll(".role-select").forEach(select => {
    select.addEventListener("change", async (e) => {
      const uid = e.target.getAttribute("data-id");
      const newRole = e.target.value;
      try {
        showPageLoader(true, "Đang cập nhật vai trò...");
        await updateDoc(doc(db, "users", uid), { role: newRole, updatedAt: serverTimestamp() });
        showToast("Đã cập nhật vai trò thành công", "success");
        await loadUsers(false);
      } catch (error) {
        console.error(error);
        showToast("Không thể cập nhật vai trò", "error");
      } finally {
        showPageLoader(false);
      }
    });
  });

  document.querySelectorAll(".btn-toggle-status").forEach(button => {
    button.addEventListener("click", async (e) => {
      const uid = e.target.getAttribute("data-id");
      const currentStatus = e.target.getAttribute("data-status");
      const newStatus = currentStatus === "active" ? "inactive" : "active";
      try {
        showPageLoader(true, "Đang xử lý trạng thái...");
        await updateDoc(doc(db, "users", uid), { status: newStatus, updatedAt: serverTimestamp() });
        showToast("Cập nhật trạng thái tài khoản thành công", "success");
        await loadUsers(false);
      } catch (error) {
        console.error(error);
        showToast("Lỗi thay đổi trạng thái", "error");
      } finally {
        showPageLoader(false);
      }
    });
  });
}

async function loadChecklist(toggleLoader = true) {
  try {
    if (toggleLoader) showPageLoader(true, "Đang tải dữ liệu checklist...");
    const snap = await getDocs(collection(db, "checklistItems"));
    checklistItems = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    renderChecklistTable();
  } catch (error) {
    console.error(error);
    showToast("Không thể lấy danh mục câu hỏi", "error");
  } finally {
    if (toggleLoader) showPageLoader(false);
  }
}

function renderChecklistTable() {
  const tbody = document.getElementById("checklistTableBody");
  if (!tbody) return;

  if (!checklistItems.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-table">Chưa có câu hỏi nào được khởi tạo.</td></tr>`;
    return;
  }

  tbody.innerHTML = checklistItems.map(item => {
    return `
      <tr>
        <td>${escapeHtml(item.category || "-")}</td>
        <td>${escapeHtml(item.text || "-")}</td>
        <td>${escapeHtml(item.area || "-")}</td>
        <td>${item.order || 0}</td>
        <td>
          <span class="topbar-tag" style="background:${item.active ? "#f3fff7" : "#f4f6f9"}; color:${item.active ? "var(--success)" : "var(--muted)"}; border-color:#edf1f5">
            ${item.active ? "Hoạt động" : "Tắt"}
          </span>
        </td>
        <td>
          <button class="ghost-btn small-btn edit-chk-btn" data-id="${item.id}">Sửa</button>
          <button class="ghost-btn small-btn toggle-active-chk-btn" data-id="${item.id}" data-active="${item.active}">
            ${item.active ? "Tắt" : "Bật"}
          </button>
          <button class="ghost-btn small-btn delete-chk-btn" data-id="${item.id}" style="color:var(--danger)">Xóa</button>
        </td>
      </tr>
    `;
  }).join("");

  setupChecklistTableEvents();
}

function setupChecklistTableEvents() {
  document.querySelectorAll(".edit-chk-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-id");
      editChecklist(id);
    });
  });

  document.querySelectorAll(".toggle-active-chk-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.getAttribute("data-id");
      const currentActive = e.target.getAttribute("data-active") === "true";
      try {
        showPageLoader(true, "Đang thay đổi trạng thái câu hỏi...");
        await updateDoc(doc(db, "checklistItems", id), { active: !currentActive, updatedAt: serverTimestamp() });
        showToast("Thay đổi trạng thái câu hỏi thành công", "success");
        await loadChecklist(false);
      } catch (error) {
        console.error(error);
        showToast("Không thể thay đổi trạng thái", "error");
      } finally {
        showPageLoader(false);
      }
    });
  });

  document.querySelectorAll(".delete-chk-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-id");
      deleteChecklist(id);
    });
  });
}

function handleAddChecklist() {
  editingChecklistId = null;
  document.getElementById("checkCategory").value = "";
  document.getElementById("checkText").value = "";
  document.getElementById("checkArea").value = "ALL";
  document.getElementById("checkOrder").value = "";
  openChecklistModal();
}

function editChecklist(id) {
  const item = checklistItems.find(i => i.id === id);
  if (!item) return;

  editingChecklistId = id;
  document.getElementById("checkCategory").value = item.category || "";
  document.getElementById("checkText").value = item.text || "";
  document.getElementById("checkArea").value = item.area || "ALL";
  document.getElementById("checkOrder").value = item.order || 0;

  openChecklistModal();
}

async function deleteChecklist(id) {
  if (!confirm("Bạn có chắc chắn muốn xóa vĩnh viễn câu hỏi này?")) return;
  try {
    showPageLoader(true, "Đang thực hiện xóa...");
    await deleteDoc(doc(db, "checklistItems", id));
    showToast("Đã xóa câu hỏi thành công", "success");
    await loadChecklist(false);
  } catch (error) {
    console.error(error);
    showToast("Không thể xóa hạng mục kiểm tra", "error");
  } finally {
    showPageLoader(false);
  }
}

function openChecklistModal() {
  document.getElementById("checklistModal")?.classList.remove("hidden");
}

function closeChecklistModal() {
  editingChecklistId = null;
  document.getElementById("checkCategory").value = "";
  document.getElementById("checkText").value = "";
  document.getElementById("checkArea").value = "ALL";
  document.getElementById("checkOrder").value = "";
  document.getElementById("checklistModal")?.classList.add("hidden");
}

async function saveChecklist() {
  const category = document.getElementById("checkCategory").value.trim();
  const text = document.getElementById("checkText").value.trim();
  const area = document.getElementById("checkArea").value;
  const order = Number(document.getElementById("checkOrder").value || 0);

  // CẢI TIẾN C: Loại bỏ hoàn toàn alert() và thay thế bằng showToast UX đẹp mắt
  if (!category || !text) {
    showToast("Vui lòng điền đầy đủ thông tin bắt buộc!", "error");
    return;
  }

  try {
    showPageLoader(true, "Đang lưu dữ liệu...");
    const existingItem = checklistItems.find((i) => i.id === editingChecklistId);
    
    const data = {
      category,
      text,
      area,
      order,
      active: existingItem?.active ?? true,
      updatedAt: serverTimestamp()
    };

    if (editingChecklistId) {
      await updateDoc(doc(db, "checklistItems", editingChecklistId), data);
      showToast("Cập nhật thông tin thành công", "success");
    } else {
      const id = "check_" + Date.now();
      await setDoc(doc(db, "checklistItems", id), { ...data, createdAt: serverTimestamp() });
      showToast("Tạo câu hỏi mới thành công", "success");
    }

    closeChecklistModal();
    await loadChecklist(false);
  } catch (error) {
    console.error(error);
    showToast("Thao tác lưu thất bại", "error");
  } finally {
    showPageLoader(false);
  }
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
  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 3200);
}

async function logout() {
  try {
    await signOut(auth);
    location.href = "./index.html";
  } catch (error) {
    showToast("Lỗi đăng xuất", "error");
  }
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}