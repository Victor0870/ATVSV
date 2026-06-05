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
  deleteDoc
} from "./firebase-config.js";

let users = [];
let checklistItems = [];
let editingChecklistId = null;

document.addEventListener("DOMContentLoaded", initAdminPage);

function initAdminPage() {
  bindEvents();
  observeAuth();
}

function bindEvents() {
  document.getElementById("adminLogoutBtn").addEventListener("click", logout);
  document.getElementById("addChecklistBtn").addEventListener("click", openChecklistModal);
  document.getElementById("cancelChecklistBtn").addEventListener("click", closeChecklistModal);
  document.getElementById("saveChecklistBtn").addEventListener("click", saveChecklist);
  document.getElementById("reloadChecklistBtn").addEventListener("click", loadChecklist);
  document.getElementById("checklistModalBackdrop").addEventListener("click", closeChecklistModal);
}

function observeAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      location.href = "./index.html";
      return;
    }

    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (!userDoc.exists()) {
        alert("Không tìm thấy hồ sơ user");
        return;
      }

      const profile = userDoc.data();
      if (profile.role !== "admin") {
        alert("Bạn không có quyền truy cập trang quản trị");
        location.href = "./index.html";
        return;
      }

      await loadUsers();
      await loadChecklist();
    } catch (error) {
      console.error("Lỗi xác thực Admin:", error);
    }
  });
}

async function loadUsers() {
  const snap = await getDocs(collection(db, "users"));
  users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderUserTable();
}

function renderUserTable() {
  const tbody = document.getElementById("userTableBody");
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-table">Không có người dùng nào.</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map((u) => {
    return `
      <tr>
        <td>${escapeHtml(u.email || "-")}</td>
        <td>${escapeHtml(u.hoTen || "-")}</td>
        <td>${escapeHtml(u.taiKhoan || "-")}</td>
        <td>${escapeHtml(u.khuVuc || "-")}</td>
        <td>${escapeHtml(u.chiNhanh || "-")}</td>
        <td>
          <select class="role-select" data-id="${u.id}">
            <option value="user" ${u.role === "user" ? "selected" : ""}>user</option>
            <option value="manager" ${u.role === "manager" ? "selected" : ""}>manager</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option>
          </select>
        </td>
        <td>
          <span class="topbar-tag ${u.status === "active" ? "" : "hidden"}" style="background:#e8f5e9; color:#2e7d32; border-color:#c8e6c9">Hoạt động</span>
          <span class="topbar-tag ${u.status === "inactive" ? "" : "hidden"}" style="background:#ffe0b2; color:#ef6c00; border-color:#ffe0b2">Chờ duyệt</span>
        </td>
        <td>
          <button class="ghost-btn small-btn btn-toggle-status" data-id="${u.id}" data-status="${u.status}">
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
      await updateDoc(doc(db, "users", uid), { role: newRole });
      await loadUsers();
    });
  });

  document.querySelectorAll(".btn-toggle-status").forEach(button => {
    button.addEventListener("click", async (e) => {
      const uid = e.target.getAttribute("data-id");
      const currentStatus = e.target.getAttribute("data-status");
      const newStatus = currentStatus === "active" ? "inactive" : "active";
      await updateDoc(doc(db, "users", uid), { status: newStatus });
      await loadUsers();
    });
  });
}

async function loadChecklist() {
  const snap = await getDocs(collection(db, "checklistItems"));
  checklistItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderChecklistTable();
}

function renderChecklistTable() {
  const tbody = document.getElementById("checklistTableBody");
  if (!tbody) return;

  if (!checklistItems.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-table">Chưa có checklist</td></tr>`;
    return;
  }

  tbody.innerHTML = checklistItems.map(item => {
    return `
      <tr>
        <td>${escapeHtml(item.category || "-")}</td>
        <td>${escapeHtml(item.text || "-")}</td>
        <td>${escapeHtml(item.area || "-")}</td>
        <td>${item.order || 0}</td>
        <td>${item.active ? "Hoạt động" : "Tắt"}</td>
        <td>
          <button class="edit-chk-btn" data-id="${item.id}">Sửa</button>
          <button class="delete-chk-btn" data-id="${item.id}" style="color:var(--danger)">Xóa</button>
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

  document.querySelectorAll(".delete-chk-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-id");
      deleteChecklist(id);
    });
  });
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
  if (!confirm("Xóa câu hỏi này?")) return;
  await deleteDoc(doc(db, "checklistItems", id));
  await loadChecklist();
}

function openChecklistModal() {
  document.getElementById("checklistModal").classList.remove("hidden");
}

function closeChecklistModal() {
  editingChecklistId = null;
  document.getElementById("checkCategory").value = "";
  document.getElementById("checkText").value = "";
  document.getElementById("checkArea").value = "ALL";
  document.getElementById("checkOrder").value = "";
  document.getElementById("checklistModal").classList.add("hidden");
}

async function saveChecklist() {
  const category = document.getElementById("checkCategory").value.trim();
  const text = document.getElementById("checkText").value.trim();
  const area = document.getElementById("checkArea").value;
  const order = Number(document.getElementById("checkOrder").value || 0);

  if (!category || !text) {
    alert("Vui lòng nhập đầy đủ");
    return;
  }

  const data = { category, text, area, order, active: true };

  if (editingChecklistId) {
    await updateDoc(doc(db, "checklistItems", editingChecklistId), data);
  } else {
    const id = "check_" + Date.now();
    await setDoc(doc(db, "checklistItems", id), data);
  }

  closeChecklistModal();
  await loadChecklist();
}

async function logout() {
  await signOut(auth);
  location.href = "./index.html";
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}