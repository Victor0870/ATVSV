import {
  auth,
  db,
  authPersistenceReady,
  initAppCheck,
  onAuthStateChanged,
  signOut,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  collection,
  getDocs
} from "./firebase-config.js";
import { fetchChecklistItems, fetchChecklistCategories, sortChecklistItems, getNextOrderInCategory, getItemsInCategory, FALLBACK_CATEGORIES } from "./checklist-service.js";
import {
  fetchBranches,
  FALLBACK_BRANCHES,
  buildChecklistAreaOptions
} from "./areas-service.js";
import { initI18n, t, onLanguageChange, applyI18n, getLang } from "./i18n.js?v=20250622";

let users = [];
let checklistItems = [];
let checklistCategories = [];
let categoriesSource = "fallback";
let branchList = [];
let branchesSource = "fallback";
let userFilter = "all";
let searchQuery = "";
let editingChecklistId = null;
let toastTimer = null;
let authReady = false;
let isLoadingAdminData = false;

document.addEventListener("DOMContentLoaded", initAdminPage);

async function initAdminPage() {
  initI18n();
  await initAppCheck();
  setCurrentDate();
  bindEvents();

  onLanguageChange(() => {
    document.querySelectorAll("[data-original-text]").forEach((el) => {
      delete el.dataset.originalText;
    });
    applyI18n();
    setCurrentDate();
    renderUserTable();
    renderCategoryList();
    renderChecklistTable();
    renderBranchTable();
  });

  await authPersistenceReady;
  observeAuth();
}

function setCurrentDate() {
  const el = document.getElementById("currentDate");
  if (!el) return;

  const options = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
  const locale = getLang() === "en" ? "en-US" : "vi-VN";
  el.textContent = new Date().toLocaleDateString(locale, options);
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
  document.getElementById("reloadChecklistBtn").addEventListener("click", reloadChecklistData);
  document.getElementById("saveChecklistBtn").addEventListener("click", saveChecklist);
  document.getElementById("cancelChecklistBtn").addEventListener("click", closeChecklistModal);
  document.getElementById("checklistModalBackdrop").addEventListener("click", closeChecklistModal);

  document.getElementById("addCategoryBtn").addEventListener("click", openCategoryModal);
  document.getElementById("saveCategoryBtn").addEventListener("click", saveCategory);
  document.getElementById("cancelCategoryBtn").addEventListener("click", closeCategoryModal);
  document.getElementById("categoryModalBackdrop").addEventListener("click", closeCategoryModal);

  document.getElementById("addBranchBtn").addEventListener("click", openBranchModal);
  document.getElementById("reloadBranchesBtn").addEventListener("click", () => reloadBranchData());
  document.getElementById("saveBranchBtn").addEventListener("click", saveBranch);
  document.getElementById("cancelBranchBtn").addEventListener("click", closeBranchModal);
  document.getElementById("branchModalBackdrop").addEventListener("click", closeBranchModal);

  document.querySelectorAll(".admin-nav-item[data-section]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      setActiveNav(link.dataset.section);
      const sectionId = {
        users: "usersSection",
        checklist: "checklistSection",
        branches: "branchesSection"
      }[link.dataset.section] || "usersSection";
      document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function observeAuth() {
  showPageLoader(true, t("common.checkingAccess"));

  onAuthStateChanged(auth, async (user) => {
    if (isLoadingAdminData) return;

    try {
      if (!user) {
        if (authReady) {
          location.href = "./index.html";
        }
        return;
      }

      authReady = true;
      isLoadingAdminData = true;

      const userDoc = await getDoc(doc(db, "users", user.uid));

      if (!userDoc.exists()) {
        showTableError("userTableBody", 7, t("admin.profileNotFound"));
        showToast(t("admin.profileNotFound"), "error");
        setTimeout(() => { location.href = "./index.html"; }, 2000);
        return;
      }

      const profile = userDoc.data();
      const role = String(profile.role || "").trim().toLowerCase();
      const status = String(profile.status || "").trim().toLowerCase();

      if (role !== "admin") {
        showTableError("userTableBody", 7, t("admin.noAdminRole"));
        showToast(t("admin.noAdminAccess"), "error");
        setTimeout(() => { location.href = "./index.html"; }, 2000);
        return;
      }

      if (status !== "active") {
        showTableError("userTableBody", 7, t("admin.adminNotActive"));
        showToast(t("admin.adminNotActive"), "error");
        setTimeout(() => { location.href = "./index.html"; }, 2000);
        return;
      }

      updateAdminSidebar(user, profile);
      await loadUsers(false);
      await reloadBranchData(false);
      await reloadChecklistData(false);
    } catch (error) {
      console.error(error);
      const message = getFirestoreErrorMessage(error);
      showTableError("userTableBody", 7, message);
      showTableError("checklistTableBody", 6, message);
      showToast(message, "error");
    } finally {
      isLoadingAdminData = false;
      showPageLoader(false);
    }
  });
}

function showTableError(tbodyId, colspan, message) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="${colspan}" class="empty-table">${escapeHtml(message)}</td></tr>`;
}

function getFirestoreErrorMessage(error) {
  const code = error?.code || "";

  if (code === "permission-denied") {
    return t("admin.loadPermissionDenied");
  }

  return error?.message || t("admin.loadFailed");
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
  if (showLoader) showPageLoader(true, t("admin.syncingUsers"));
  try {
    const snap = await getDocs(collection(db, "users"));
    users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    updateStats();
    renderUserTable();
  } catch (error) {
    console.error(error);
    const message = getFirestoreErrorMessage(error);
    showTableError("userTableBody", 7, message);
    showToast(message, "error");
    throw error;
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
            ? t("admin.noPendingUsers")
            : searchQuery
              ? t("admin.noFilterMatch")
              : t("admin.noUsers")
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
        <button type="button" class="btn-action approve btn-approve" data-id="${userId}">${t("common.approve")}</button>
        <button type="button" class="btn-action reject btn-reject" data-id="${userId}">${t("common.reject")}</button>
      </div>
    `;
  }

  if (status === "active") {
    return `
      <div class="action-buttons">
        <span class="admin-reviewed-note">${t("admin.statusActive")}</span>
        <button type="button" class="btn-action lock btn-lock" data-id="${userId}">${t("common.lock")}</button>
      </div>
    `;
  }

  return `
    <div class="action-buttons">
      <button type="button" class="btn-action unlock btn-unlock" data-id="${userId}">${t("common.unlock")}</button>
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

      const user = users.find((u) => u.id === userId);
      const displayName = user?.hoTen || user?.email || t("common.account");

      if (user?.role === "admin" && userId !== auth.currentUser?.uid) {
        e.target.value = currentRole;
        showToast(t("security.cannotModifyOtherAdmin"), "error");
        return;
      }

      const confirmed = confirm(
        t("security.confirmRoleChange", { name: displayName, role: newRole })
      );
      if (!confirmed) {
        e.target.value = currentRole;
        return;
      }

      try {
        await adminChangeUserRole(userId, newRole, user);
        showToast(t("admin.roleUpdated"), "success");
        await loadUsers();
      } catch (error) {
        console.error(error);
        e.target.value = currentRole;
        showToast(error.message || t("admin.roleUpdateFailed"), "error");
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
  const displayName = user?.hoTen || user?.email || t("common.account");

  if (user?.role === "admin" && userId !== auth.currentUser?.uid) {
    showToast(t("security.cannotModifyOtherAdmin"), "error");
    return;
  }

  let newStatus;
  let message;
  let toastType = "success";
  let confirmKey = "security.confirmStatusChange";

  switch (action) {
    case "approve":
      newStatus = "active";
      message = `${t("common.approve")}: ${displayName}`;
      confirmKey = "security.confirmApprove";
      break;
    case "reject":
      newStatus = "locked";
      message = `${t("common.reject")}: ${displayName}`;
      toastType = "info";
      confirmKey = "security.confirmReject";
      break;
    case "lock":
      newStatus = "locked";
      message = `${t("common.lock")}: ${displayName}`;
      toastType = "info";
      confirmKey = "security.confirmLock";
      break;
    case "unlock":
      newStatus = "active";
      message = `${t("common.unlock")}: ${displayName}`;
      confirmKey = "security.confirmUnlock";
      break;
    default:
      return;
  }

  const confirmed = confirm(t(confirmKey, { name: displayName }));
  if (!confirmed) return;

  try {
    await adminChangeUserStatus(userId, newStatus, user, action);
    showToast(message, toastType);
    await loadUsers();
  } catch (error) {
    console.error(error);
    showToast(error.message || t("admin.statusUpdateFailed"), "error");
  }
}

async function adminChangeUserRole(userId, newRole, targetUser) {
  const currentAdmin = auth.currentUser;
  if (!currentAdmin) {
    throw new Error(t("auth.error.permissionDenied"));
  }

  const previousRole = String(targetUser?.role || "user").toLowerCase();

  await updateDoc(doc(db, "users", userId), {
    role: newRole,
    updatedAt: serverTimestamp()
  });

  await writeAdminAuditLog({
    action: "changeRole",
    targetUserId: userId,
    targetEmail: targetUser?.email || "",
    targetHoTen: targetUser?.hoTen || "",
    performedBy: currentAdmin.uid,
    performedByEmail: currentAdmin.email || "",
    previousRole,
    newRole
  });
}

async function adminChangeUserStatus(userId, newStatus, targetUser, triggerAction) {
  const currentAdmin = auth.currentUser;
  if (!currentAdmin) {
    throw new Error(t("auth.error.permissionDenied"));
  }

  const previousStatus = String(targetUser?.status || "pending").toLowerCase();

  await updateDoc(doc(db, "users", userId), {
    status: newStatus,
    updatedAt: serverTimestamp()
  });

  await writeAdminAuditLog({
    action: "changeStatus",
    targetUserId: userId,
    targetEmail: targetUser?.email || "",
    targetHoTen: targetUser?.hoTen || "",
    performedBy: currentAdmin.uid,
    performedByEmail: currentAdmin.email || "",
    previousStatus,
    newStatus,
    triggerAction
  });
}

async function writeAdminAuditLog(entry) {
  try {
    await addDoc(collection(db, "audit_logs"), {
      ...entry,
      reason: entry.reason || "",
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.warn("Không thể ghi audit_logs:", error);
  }
}

function normalizeStatus(status) {
  if (status === "inactive") return "pending";
  return status || "pending";
}

function getStatusLabel(status) {
  switch (status) {
    case "active":
      return t("admin.statusActive");
    case "locked":
      return t("admin.statusLocked");
    default:
      return t("admin.statusPending");
  }
}

function formatCreatedAt(createdAt) {
  if (!createdAt) return "-";

  try {
    const date = createdAt.toDate ? createdAt.toDate() : new Date(createdAt.seconds * 1000);
    const locale = getLang() === "en" ? "en-US" : "vi-VN";
    return date.toLocaleString(locale, {
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
  showToast(t("admin.loggingOut"), "info");
  await signOut(auth);
  location.href = "./index.html";
}

function showPageLoader(show, text = t("common.loading")) {
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

async function reloadChecklistData(showLoader = true) {
  if (showLoader) showPageLoader(true, t("admin.loadingChecklist"));
  try {
    await loadCategories();

    const { items } = await fetchChecklistItems({
      includeInactive: true,
      throwOnError: true,
      categories: checklistCategories
    });
    checklistItems = items;

    if (categoriesSource !== "firestore") {
      await seedInitialCategories();
    } else {
      await syncCategoriesFromItems();
    }

    await loadCategories();
    const refreshed = await fetchChecklistItems({
      includeInactive: true,
      throwOnError: true,
      categories: checklistCategories
    });
    checklistItems = refreshed.items;

    renderCategoryList();
    renderChecklistTable();
    populateCategorySelect();
    populateCheckAreaSelect();
  } catch (error) {
    console.error(error);
    const message = getFirestoreErrorMessage(error);
    showTableError("checklistTableBody", 6, message);
    showToast(message, "error");
    throw error;
  } finally {
    if (showLoader) showPageLoader(false);
  }
}

async function loadCategories() {
  const result = await fetchChecklistCategories({ throwOnError: true });
  checklistCategories = result.categories;
  categoriesSource = result.source;
  return result;
}

async function seedInitialCategories() {
  const fallbackOrderMap = new Map(
    FALLBACK_CATEGORIES.map((category) => [category.name, Number(category.order) || 0])
  );

  let namesToSeed = [];
  if (checklistItems.length) {
    const seen = new Set();
    sortChecklistItems(checklistItems, FALLBACK_CATEGORIES).forEach((item) => {
      if (item.category && !seen.has(item.category)) {
        seen.add(item.category);
        namesToSeed.push(item.category);
      }
    });
  } else {
    namesToSeed = FALLBACK_CATEGORIES.map((category) => category.name);
  }

  for (let index = 0; index < namesToSeed.length; index += 1) {
    const name = namesToSeed[index];
    const id = `cat_seed_${index + 1}_${Date.now()}`;
    await setDoc(doc(db, "checklistCategories", id), {
      name,
      order: fallbackOrderMap.get(name) || index + 1,
      createdAt: serverTimestamp()
    });
  }
}

async function syncCategoriesFromItems() {
  const existingNames = new Set(checklistCategories.map((c) => c.name));
  const itemNames = [...new Set(checklistItems.map((i) => i.category).filter(Boolean))];
  let added = false;

  for (const name of itemNames) {
    if (existingNames.has(name)) continue;

    const nextOrder = checklistCategories.length
      ? Math.max(...checklistCategories.map((c) => Number(c.order) || 0)) + 1
      : 1;

    const id = `cat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await setDoc(doc(db, "checklistCategories", id), {
      name,
      order: nextOrder,
      createdAt: serverTimestamp()
    });
    added = true;
  }

  if (added) {
    await loadCategories();
  }
}

function renderCategoryList() {
  const container = document.getElementById("categoryList");
  const hint = document.getElementById("categoryDragHint");
  if (!container) return;

  if (!checklistCategories.length) {
    if (hint) hint.classList.add("hidden");
    container.innerHTML = `<span class="category-empty-note">${escapeHtml(t("admin.noCategories"))}</span>`;
    return;
  }

  if (hint) hint.classList.remove("hidden");

  container.innerHTML = checklistCategories
    .map(
      (category) => `
        <span
          class="category-chip"
          draggable="true"
          data-id="${escapeHtml(category.id)}"
          title="${escapeHtml(t("admin.dragToSort"))}"
        >
          <span class="category-chip-grip" aria-hidden="true">⋮⋮</span>
          ${escapeHtml(category.name)}
        </span>
      `
    )
    .join("");

  setupCategoryDragDrop();
}

function setupCategoryDragDrop() {
  const container = document.getElementById("categoryList");
  if (!container) return;

  let draggedId = null;

  container.querySelectorAll(".category-chip").forEach((chip) => {
    chip.addEventListener("dragstart", (event) => {
      draggedId = chip.dataset.id;
      chip.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedId);
    });

    chip.addEventListener("dragend", () => {
      chip.classList.remove("dragging");
      container.querySelectorAll(".category-chip").forEach((item) => {
        item.classList.remove("drag-over");
      });
      draggedId = null;
    });

    chip.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (chip.dataset.id !== draggedId) {
        chip.classList.add("drag-over");
      }
    });

    chip.addEventListener("dragleave", () => {
      chip.classList.remove("drag-over");
    });

    chip.addEventListener("drop", (event) => {
      event.preventDefault();
      chip.classList.remove("drag-over");
      const targetId = chip.dataset.id;
      if (!draggedId || !targetId || draggedId === targetId) return;
      reorderCategories(draggedId, targetId);
    });
  });
}

async function reorderCategories(draggedId, targetId) {
  const fromIndex = checklistCategories.findIndex((category) => category.id === draggedId);
  const toIndex = checklistCategories.findIndex((category) => category.id === targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

  if (checklistCategories.some((category) => String(category.id).startsWith("fallback_"))) {
    showToast(t("admin.categoryNotSynced"), "error");
    return;
  }

  const reordered = [...checklistCategories];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);

  checklistCategories = reordered.map((category, index) => ({
    ...category,
    order: index + 1
  }));

  renderCategoryList();
  renderChecklistTable();
  populateCategorySelect(document.getElementById("checkCategory")?.value || "");

  try {
    showPageLoader(true, t("admin.updatingCategoryOrder"));
    await Promise.all(
      checklistCategories.map((category, index) =>
        updateDoc(doc(db, "checklistCategories", category.id), {
          order: index + 1,
          updatedAt: serverTimestamp()
        })
      )
    );
    showToast(t("admin.categoryOrderUpdated"), "success");
  } catch (error) {
    console.error(error);
    showToast(t("admin.categoryOrderFailed"), "error");
    await reloadChecklistData(false);
  } finally {
    showPageLoader(false);
  }
}

function populateCategorySelect(selectedValue = "") {
  const select = document.getElementById("checkCategory");
  if (!select) return;

  if (!checklistCategories.length) {
    select.innerHTML = `<option value="">${escapeHtml(t("admin.createCategoryFirst"))}</option>`;
    return;
  }

  select.innerHTML = [
    `<option value="">${t("common.select")}</option>`,
    ...checklistCategories.map((category) => {
      const selected = category.name === selectedValue ? "selected" : "";
      return `<option value="${escapeHtml(category.name)}" ${selected}>${escapeHtml(category.name)}</option>`;
    })
  ].join("");
}

function openCategoryModal() {
  document.getElementById("newCategoryName").value = "";
  document.getElementById("categoryModal").classList.remove("hidden");
}

function closeCategoryModal() {
  document.getElementById("categoryModal").classList.add("hidden");
}

async function saveCategory() {
  const name = document.getElementById("newCategoryName").value.trim();
  if (!name) {
    showToast(t("admin.enterCategoryName"), "error");
    return;
  }

  if (checklistCategories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    showToast(t("admin.categoryExists"), "error");
    return;
  }

  try {
    showPageLoader(true, t("admin.creatingCategory"));
    const nextOrder = checklistCategories.length
      ? Math.max(...checklistCategories.map((c) => Number(c.order) || 0)) + 1
      : 1;
    const id = `cat_${Date.now()}`;

    await setDoc(doc(db, "checklistCategories", id), {
      name,
      order: nextOrder,
      createdAt: serverTimestamp()
    });

    closeCategoryModal();
    showToast(t("admin.categoryCreated"), "success");
    await reloadChecklistData(false);
  } catch (error) {
    console.error(error);
    showToast(error.message || t("admin.categoryCreateFailed"), "error");
  } finally {
    showPageLoader(false);
  }
}

function getChecklistRowsForRender() {
  const rows = [];
  const sorted = sortChecklistItems(checklistItems, checklistCategories);

  sorted.forEach((item) => {
    const category = item.category || "Khác";
    const siblings = getItemsInCategory(sorted, category);
    const siblingIndex = siblings.findIndex((s) => s.id === item.id);

    rows.push({
      item,
      canMoveUp: siblingIndex > 0,
      canMoveDown: siblingIndex < siblings.length - 1
    });
  });

  return rows;
}

function renderChecklistTable() {
  const tbody = document.getElementById("checklistTableBody");
  if (!tbody) return;

  if (!checklistItems.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-table">${escapeHtml(t("admin.noChecklistQuestions"))}</td></tr>`;
    return;
  }

  const rows = getChecklistRowsForRender();

  tbody.innerHTML = rows
    .map(({ item, canMoveUp, canMoveDown }) => {
      const isActive = item.active !== false;
      return `
        <tr>
          <td>${escapeHtml(item.category || "-")}</td>
          <td class="checklist-text-cell">${escapeHtml(item.text || "-")}</td>
          <td class="checklist-area-cell">${escapeHtml(item.area || "ALL")}</td>
          <td class="checklist-order-cell">
            <div class="order-buttons">
              <button type="button" class="order-btn btn-move-up" data-id="${item.id}" ${canMoveUp ? "" : "disabled"} title="${escapeHtml(t("admin.moveUp"))}">▲</button>
              <button type="button" class="order-btn btn-move-down" data-id="${item.id}" ${canMoveDown ? "" : "disabled"} title="${escapeHtml(t("admin.moveDown"))}">▼</button>
            </div>
          </td>
          <td class="checklist-status-cell">
            <span class="status-badge status-${isActive ? "active" : "locked"}">
              ${isActive ? t("admin.inUse") : t("admin.disabled")}
            </span>
          </td>
          <td class="checklist-actions-cell">
            <div class="action-buttons checklist-action-buttons">
              <button type="button" class="btn-action btn-edit-checklist" data-id="${item.id}">${t("common.edit")}</button>
              <button type="button" class="btn-action reject btn-toggle-checklist" data-id="${item.id}" data-active="${isActive}">
                ${isActive ? t("common.disable") : t("common.enable")}
              </button>
              <button type="button" class="btn-action reject btn-delete-checklist" data-id="${item.id}">${t("common.delete")}</button>
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

  document.querySelectorAll(".btn-move-up").forEach((btn) => {
    btn.addEventListener("click", () => moveChecklistItem(btn.dataset.id, "up"));
  });

  document.querySelectorAll(".btn-move-down").forEach((btn) => {
    btn.addEventListener("click", () => moveChecklistItem(btn.dataset.id, "down"));
  });
}

async function moveChecklistItem(id, direction) {
  const item = checklistItems.find((i) => i.id === id);
  if (!item) return;

  const siblings = getItemsInCategory(checklistItems, item.category);
  const currentIndex = siblings.findIndex((s) => s.id === id);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (targetIndex < 0 || targetIndex >= siblings.length) return;

  const current = siblings[currentIndex];
  const target = siblings[targetIndex];

  try {
    showPageLoader(true, t("admin.updatingOrder"));
    await Promise.all([
      updateDoc(doc(db, "checklistItems", current.id), {
        order: Number(target.order) || targetIndex + 1,
        updatedAt: serverTimestamp()
      }),
      updateDoc(doc(db, "checklistItems", target.id), {
        order: Number(current.order) || currentIndex + 1,
        updatedAt: serverTimestamp()
      })
    ]);
    await reloadChecklistData(false);
    showToast(t("admin.questionOrderUpdated"), "success");
  } catch (error) {
    console.error(error);
    showToast(t("admin.questionOrderFailed"), "error");
  } finally {
    showPageLoader(false);
  }
}

function openChecklistModal(item = null) {
  if (!checklistCategories.length) {
    showToast(t("admin.createCategoryFirst"), "error");
    openCategoryModal();
    return;
  }

  editingChecklistId = item?.id || null;

  document.getElementById("checklistModalTitle").textContent = item
    ? t("admin.editQuestionTitle")
    : t("admin.addQuestionTitle");

  populateCategorySelect(item?.category || "");
  populateCheckAreaSelect(item?.area || "ALL");
  document.getElementById("checkText").value = item?.text || "";
  document.getElementById("checkActive").checked = item ? item.active !== false : true;

  document.getElementById("checklistModal").classList.remove("hidden");
}

function closeChecklistModal() {
  editingChecklistId = null;
  populateCategorySelect("");
  populateCheckAreaSelect("ALL");
  document.getElementById("checkText").value = "";
  document.getElementById("checkActive").checked = true;
  document.getElementById("checklistModal").classList.add("hidden");
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
  const active = document.getElementById("checkActive").checked;

  if (!category || !text) {
    showToast(t("admin.fillQuestionForm"), "error");
    return;
  }

  const existingItem = editingChecklistId
    ? checklistItems.find((i) => i.id === editingChecklistId)
    : null;

  let order;
  if (existingItem && existingItem.category === category) {
    order = Number(existingItem.order) || getNextOrderInCategory(checklistItems, category);
  } else {
    order = getNextOrderInCategory(checklistItems, category);
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
    showPageLoader(true, t("admin.savingQuestion"));

    if (editingChecklistId) {
      await updateDoc(doc(db, "checklistItems", editingChecklistId), data);
      showToast(t("admin.questionUpdated"), "success");
    } else {
      const id = `check_${Date.now()}`;
      await setDoc(doc(db, "checklistItems", id), {
        ...data,
        createdAt: serverTimestamp()
      });
      showToast(t("admin.questionAdded"), "success");
    }

    closeChecklistModal();
    await reloadChecklistData(false);
  } catch (error) {
    console.error(error);
    showToast(error.message || t("admin.questionSaveFailed"), "error");
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
    showToast(currentlyActive ? t("admin.questionDisabled") : t("admin.questionEnabled"), "success");
    await reloadChecklistData(false);
  } catch (error) {
    console.error(error);
    showToast(t("admin.questionStatusFailed"), "error");
  }
}

async function deleteChecklist(id) {
  const item = checklistItems.find((i) => i.id === id);
  if (!item) return;

  const confirmed = confirm(`Xóa câu hỏi:\n"${item.text}"?\n\nThao tác này không thể hoàn tác.`);
  if (!confirmed) return;

  try {
    showPageLoader(true, t("admin.deletingQuestion"));
    await deleteDoc(doc(db, "checklistItems", id));
    showToast(t("admin.questionDeleted"), "success");
    await reloadChecklistData(false);
  } catch (error) {
    console.error(error);
    showToast(t("admin.questionDeleteFailed"), "error");
  } finally {
    showPageLoader(false);
  }
}

function populateCheckAreaSelect(selectedValue = "ALL") {
  const select = document.getElementById("checkArea");
  if (!select) return;
  select.innerHTML = buildChecklistAreaOptions(branchList, selectedValue);
}

async function reloadBranchData(showLoader = true) {
  if (showLoader) showPageLoader(true, t("admin.loadingBranches"));
  try {
    await loadBranches();

    if (branchesSource !== "firestore") {
      await seedInitialBranches();
      await loadBranches();
    }

    renderBranchTable();
    populateCheckAreaSelect(document.getElementById("checkArea")?.value || "ALL");
  } catch (error) {
    console.error(error);
    const message = getFirestoreErrorMessage(error);
    showTableError("branchTableBody", 4, message);
    showToast(message, "error");
    throw error;
  } finally {
    if (showLoader) showPageLoader(false);
  }
}

async function loadBranches() {
  const result = await fetchBranches({ includeInactive: true, throwOnError: true });
  branchList = result.branches;
  branchesSource = result.source;
  return result;
}

async function seedInitialBranches() {
  for (let index = 0; index < FALLBACK_BRANCHES.length; index += 1) {
    const branch = FALLBACK_BRANCHES[index];
    const id = `branch_seed_${index + 1}_${Date.now()}`;
    await setDoc(doc(db, "branches", id), {
      name: branch.name,
      order: Number(branch.order) || index + 1,
      active: true,
      createdAt: serverTimestamp()
    });
  }
}

function renderBranchTable() {
  const tbody = document.getElementById("branchTableBody");
  if (!tbody) return;

  if (!branchList.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-table">${escapeHtml(t("admin.noBranches"))}</td></tr>`;
    return;
  }

  tbody.innerHTML = branchList
    .map((branch) => {
      const isActive = branch.active !== false;
      return `
        <tr>
          <td>${escapeHtml(branch.name || "-")}</td>
          <td class="text-center">${Number(branch.order) || 0}</td>
          <td>
            <span class="status-badge status-${isActive ? "active" : "locked"}">
              ${isActive ? t("admin.inUse") : t("admin.disabled")}
            </span>
          </td>
          <td class="checklist-actions-cell">
            <div class="action-buttons checklist-action-buttons">
              <button type="button" class="btn-action reject btn-toggle-branch" data-id="${branch.id}" data-active="${isActive}">
                ${isActive ? t("common.disable") : t("common.enable")}
              </button>
              <button type="button" class="btn-action reject btn-delete-branch" data-id="${branch.id}">${t("common.delete")}</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  setupBranchTableEvents();
}

function setupBranchTableEvents() {
  document.querySelectorAll(".btn-toggle-branch").forEach((btn) => {
    btn.addEventListener("click", () => toggleBranchActive(btn.dataset.id, btn.dataset.active === "true"));
  });

  document.querySelectorAll(".btn-delete-branch").forEach((btn) => {
    btn.addEventListener("click", () => deleteBranch(btn.dataset.id));
  });
}

function openBranchModal() {
  document.getElementById("newBranchName").value = "";
  document.getElementById("branchModal").classList.remove("hidden");
}

function closeBranchModal() {
  document.getElementById("branchModal").classList.add("hidden");
}

async function saveBranch() {
  const name = document.getElementById("newBranchName").value.trim();
  if (!name) {
    showToast(t("admin.enterBranchName"), "error");
    return;
  }

  if (branchList.some((branch) => branch.name.toLowerCase() === name.toLowerCase())) {
    showToast(t("admin.branchExists"), "error");
    return;
  }

  try {
    showPageLoader(true, t("admin.addingBranch"));
    const nextOrder = branchList.length
      ? Math.max(...branchList.map((branch) => Number(branch.order) || 0)) + 1
      : 1;

    await setDoc(doc(db, "branches", `branch_${Date.now()}`), {
      name,
      order: nextOrder,
      active: true,
      createdAt: serverTimestamp()
    });

    closeBranchModal();
    showToast(t("admin.branchAdded"), "success");
    await reloadBranchData(false);
  } catch (error) {
    console.error(error);
    showToast(error.message || t("admin.branchAddFailed"), "error");
  } finally {
    showPageLoader(false);
  }
}

async function toggleBranchActive(id, currentlyActive) {
  try {
    await updateDoc(doc(db, "branches", id), {
      active: !currentlyActive,
      updatedAt: serverTimestamp()
    });
    showToast(currentlyActive ? t("admin.branchDisabled") : t("admin.branchEnabled"), "success");
    await reloadBranchData(false);
  } catch (error) {
    console.error(error);
    showToast(t("admin.branchStatusFailed"), "error");
  }
}

async function deleteBranch(id) {
  const branch = branchList.find((item) => item.id === id);
  if (!branch) return;

  const usersInBranch = users.filter((user) => user.khuVuc === branch.name).length;
  const warning = usersInBranch
    ? `\n\nCó ${usersInBranch} tài khoản đang gắn chi nhánh này.`
    : "";

  const confirmed = confirm(`Xóa chi nhánh "${branch.name}"?${warning}\n\nThao tác này không thể hoàn tác.`);
  if (!confirmed) return;

  try {
    showPageLoader(true, t("admin.deletingBranch"));
    await deleteDoc(doc(db, "branches", id));
    showToast(t("admin.branchDeleted"), "success");
    await reloadBranchData(false);
  } catch (error) {
    console.error(error);
    showToast(t("admin.branchDeleteFailed"), "error");
  } finally {
    showPageLoader(false);
  }
}
