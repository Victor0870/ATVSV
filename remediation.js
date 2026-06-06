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
  query,
  orderBy,
  limit,
  getDocs,
  Timestamp
} from "./firebase-config.js";
import {
  ALL_BRANCHES_AREA,
  fetchBranches,
  buildReportFilterOptions,
  getActiveBranchNames
} from "./areas-service.js";
import {
  ALLOWED_REMEDIATION_ROLES,
  buildStatusFilterOptions,
  getRemediationStatusMeta,
  findRelatedUnresolvedIssues,
  getEffectiveDiscovery,
  getIssueElapsedMs,
  formatDurationVi,
  getIssueDurationLabel,
  parseIssueDateText,
  timestampToMillis
} from "./remediation-service.js";

const ISSUE_QUERY_LIMIT = 500;

let currentUserProfile = null;
let allIssues = [];
let filteredIssues = [];
let branchNames = [];
let editingIssueId = null;
let editingIssueContext = null;
let toastTimer = null;

document.addEventListener("DOMContentLoaded", initRemediationPage);

function initRemediationPage() {
  try {
    bindRemediationEvents();
    observeRemediationAuth();
  } catch (error) {
    console.error(error);
    showAccessDenied("Không thể khởi tạo trang. Vui lòng tải lại hoặc liên hệ quản trị viên.");
  }
}

function bindRemediationEvents() {
  document.getElementById("applyIssueFilterBtn").addEventListener("click", applyIssueFilters);
  document.getElementById("resetIssueFilterBtn").addEventListener("click", resetIssueFilters);
  document.getElementById("remediationLogoutBtn").addEventListener("click", handleLogout);
  document.getElementById("saveIssueBtn").addEventListener("click", saveIssue);
  document.getElementById("cancelIssueBtn").addEventListener("click", closeIssueModal);
  document.getElementById("issueModalBackdrop").addEventListener("click", closeIssueModal);
  document.getElementById("unresolvedIssueBtn").addEventListener("click", openUnresolvedPickerModal);
  document.getElementById("clearCarryoverBtn").addEventListener("click", clearCarryoverLink);
  document.getElementById("closeUnresolvedPickerBtn").addEventListener("click", closeUnresolvedPickerModal);
  document.getElementById("unresolvedPickerBackdrop").addEventListener("click", closeUnresolvedPickerModal);
  document.getElementById("unresolvedPickerBody").addEventListener("click", (event) => {
    const btn = event.target.closest(".btn-select-unresolved");
    if (!btn) return;
    applyCarryoverFromIssue(btn.dataset.issueId);
  });
  document.getElementById("issueStatus")?.addEventListener("change", () => {
    const issue = allIssues.find((item) => item.id === editingIssueId);
    if (issue) renderIssueDiscoveryInfo(issue);
  });
  document.getElementById("closeImageModalBtn").addEventListener("click", closeImageModal);
  document.getElementById("imageModalBackdrop").addEventListener("click", closeImageModal);

  document.getElementById("issueTableBody").addEventListener("click", (event) => {
    const btn = event.target.closest(".btn-open-issue");
    if (!btn) return;
    openIssueModal(btn.dataset.issueId);
  });

  document.getElementById("issueModalReadonly").addEventListener("click", (event) => {
    const image = event.target.closest(".report-detail-image");
    if (image) {
      openImageModal(image.dataset.fullSrc);
    }
  });
}

function observeRemediationAuth() {
  showPageLoader(true, "Đang kiểm tra quyền truy cập...");

  onAuthStateChanged(auth, async (user) => {
    try {
      if (!user) {
        showAccessDenied("Bạn chưa đăng nhập. Vui lòng đăng nhập trước.");
        return;
      }

      const profile = await loadCurrentUserProfile(user.uid);
      currentUserProfile = profile;
      ensureRemediationAccess(profile);
      showRemediationScreen();

      await loadFilterOptions();
      await loadIssues();

      const params = new URLSearchParams(window.location.search);
      const issueId = params.get("issue");
      if (issueId) {
        openIssueModal(issueId);
      }
    } catch (error) {
      console.error(error);
      showAccessDenied(error.message || "Bạn không có quyền truy cập trang này.");
    } finally {
      showPageLoader(false);
    }
  });
}

async function loadCurrentUserProfile(uid) {
  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) {
    throw new Error("Không tìm thấy hồ sơ người dùng.");
  }

  const data = userSnap.data();
  return {
    uid,
    email: data.email || "",
    hoTen: data.hoTen || "",
    role: data.role || "user",
    status: data.status || "inactive"
  };
}

function ensureRemediationAccess(profile) {
  if (profile.status !== "active") {
    throw new Error("Tài khoản của bạn chưa được kích hoạt.");
  }

  const role = String(profile.role || "").trim().toLowerCase();
  if (!ALLOWED_REMEDIATION_ROLES.includes(role)) {
    throw new Error("Chỉ Admin và Manager mới được quản lý hành động khắc phục.");
  }
}

function showAccessDenied(message) {
  document.getElementById("remediationScreen").classList.add("hidden");
  document.getElementById("remediationAccessDenied").classList.remove("hidden");
  document.getElementById("remediationAccessMessage").textContent = message;
}

function showRemediationScreen() {
  document.getElementById("remediationAccessDenied").classList.add("hidden");
  document.getElementById("remediationScreen").classList.remove("hidden");
}

async function loadFilterOptions() {
  const { branches } = await fetchBranches();
  branchNames = getActiveBranchNames(branches);

  document.getElementById("filterIssueStatus").innerHTML = buildStatusFilterOptions("ALL");
  document.getElementById("filterIssueArea").innerHTML = buildReportFilterOptions(branches, "ALL");
}

function getIssueFilters() {
  return {
    status: document.getElementById("filterIssueStatus").value,
    area: document.getElementById("filterIssueArea").value,
    keyword: document.getElementById("filterIssueKeyword").value.trim().toLowerCase()
  };
}

function applyIssueFilters() {
  filteredIssues = applyClientIssueFilters(allIssues, getIssueFilters());
  renderIssueStats(filteredIssues);
  renderIssueTable();
  updateIssueCountText();
}

function resetIssueFilters() {
  document.getElementById("filterIssueStatus").value = "ALL";
  document.getElementById("filterIssueArea").value = "ALL";
  document.getElementById("filterIssueKeyword").value = "";
  applyIssueFilters();
}

async function loadIssues() {
  showPageLoader(true, "Đang tải danh sách issue...");

  try {
    const issuesRef = collection(db, "remediationIssues");
    const q = query(issuesRef, orderBy("createdAt", "desc"), limit(ISSUE_QUERY_LIMIT));
    const snapshot = await getDocs(q);

    allIssues = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));

    applyIssueFilters();

    if (snapshot.size >= ISSUE_QUERY_LIMIT) {
      showToast(`Đang hiển thị tối đa ${ISSUE_QUERY_LIMIT} issue gần nhất.`, "info");
    }
  } catch (error) {
    console.error(error);
    showTableError("issueTableBody", 6, "Không thể tải danh sách issue.");
    showToast("Không thể tải danh sách issue.", "error");
  } finally {
    showPageLoader(false);
  }
}

function applyClientIssueFilters(issues, filters) {
  return issues.filter((issue) => {
    const matchStatus = filters.status === "ALL" || issue.status === filters.status;
    const matchArea = matchesIssueAreaFilter(issue.khuVuc, filters.area);
    const searchTarget = [
      issue.submissionId,
      issue.hoTen,
      issue.question,
      issue.note,
      issue.responsible,
      issue.khuVuc
    ]
      .join(" ")
      .toLowerCase();
    const matchKeyword = !filters.keyword || searchTarget.includes(filters.keyword);

    return matchStatus && matchArea && matchKeyword;
  });
}

function matchesIssueAreaFilter(issueArea, filterArea) {
  if (!filterArea || filterArea === "ALL") return true;
  if (filterArea === issueArea) return true;
  if (filterArea === ALL_BRANCHES_AREA) {
    return issueArea === ALL_BRANCHES_AREA || branchNames.includes(issueArea);
  }
  return false;
}

function renderIssueStats(issues) {
  const counts = { open: 0, in_progress: 0, done: 0 };

  issues.forEach((issue) => {
    const status = issue.status || "open";
    if (counts[status] != null) {
      counts[status] += 1;
    }
  });

  document.getElementById("statIssueOpen").textContent = counts.open;
  document.getElementById("statIssueProgress").textContent = counts.in_progress;
  document.getElementById("statIssueDone").textContent = counts.done;
  document.getElementById("statIssueTotal").textContent = issues.length;
}

function renderIssueTable() {
  const tbody = document.getElementById("issueTableBody");
  if (!tbody) return;

  if (!filteredIssues.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-table">Không có issue phù hợp với bộ lọc.</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredIssues
    .map((issue) => {
      const statusMeta = getRemediationStatusMeta(issue.status);
      const elapsedMs = getIssueElapsedMs(issue, getIssuesByIdMap());
      const carryoverBadge = issue.isUnresolvedCarryover
        ? `<span class="issue-carryover-tag">Lỗi cũ chưa xử lý xong</span>`
        : "";

      return `
        <tr>
          <td>
            <strong>${escapeHtml(issue.submissionId || "-")}</strong>
            ${carryoverBadge}
            <div class="issue-subtext">${escapeHtml(issue.submissionCreatedAtText || "-")}</div>
            <div class="issue-subtext">${escapeHtml(issue.hoTen || "-")}</div>
          </td>
          <td>${escapeHtml(issue.khuVuc || "-")}</td>
          <td class="checklist-text-cell">
            <div>${escapeHtml(issue.question || "-")}</div>
            ${issue.note ? `<div class="issue-subtext">${escapeHtml(issue.note)}</div>` : ""}
            <div class="issue-subtext">${escapeHtml(getIssueDurationLabel(issue.status))}: ${escapeHtml(formatDurationVi(elapsedMs))}</div>
          </td>
          <td>${escapeHtml(issue.responsible || "-")}</td>
          <td>
            <span class="remediation-status-badge ${statusMeta.badgeClass}">
              ${escapeHtml(statusMeta.label)}
            </span>
          </td>
          <td class="checklist-actions-cell">
            <button type="button" class="btn-action btn-open-issue" data-issue-id="${escapeHtml(issue.id)}">
              Xử lý
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function getIssuesByIdMap() {
  return new Map(allIssues.map((issue) => [issue.id, issue]));
}

function buildEditingContextFromIssue(issue) {
  const issuesById = getIssuesByIdMap();
  const discovery = getEffectiveDiscovery(issue, issuesById);

  return {
    linkedFromIssueId: issue.linkedFromIssueId || null,
    isUnresolvedCarryover: Boolean(issue.isUnresolvedCarryover),
    discoveredAt: discovery.discoveredAt || issue.discoveredAt || null,
    discoveredAtText: discovery.discoveredAtText || issue.submissionCreatedAtText || ""
  };
}

function renderIssueDiscoveryInfo(issue) {
  const container = document.getElementById("issueDiscoveryInfo");
  if (!container || !issue || !editingIssueContext) return;

  const issuesById = getIssuesByIdMap();
  const elapsedMs = getIssueElapsedMs(
    {
      ...issue,
      ...editingIssueContext,
      status: document.getElementById("issueStatus")?.value || issue.status
    },
    issuesById
  );
  const currentStatus = document.getElementById("issueStatus")?.value || issue.status;

  const linkedNote = editingIssueContext.isUnresolvedCarryover
    ? `<div><strong>Liên kết lỗi cũ:</strong> ${escapeHtml(editingIssueContext.linkedFromIssueId || "-")}</div>`
    : "";

  container.innerHTML = `
    <div class="issue-discovery-grid">
      <div><strong>Thời gian phát hiện:</strong> ${escapeHtml(editingIssueContext.discoveredAtText || "-")}</div>
      <div><strong>${escapeHtml(getIssueDurationLabel(currentStatus))}:</strong> ${escapeHtml(formatDurationVi(elapsedMs))}</div>
      ${linkedNote}
    </div>
  `;
  container.classList.remove("hidden");
}

function updateCarryoverButtons() {
  const clearBtn = document.getElementById("clearCarryoverBtn");
  if (!clearBtn) return;
  clearBtn.classList.toggle("hidden", !editingIssueContext?.isUnresolvedCarryover);
}

function openIssueModal(issueId) {
  const issue = allIssues.find((item) => item.id === issueId);
  if (!issue) {
    showToast("Không tìm thấy issue.", "error");
    return;
  }

  editingIssueId = issueId;
  editingIssueContext = buildEditingContextFromIssue(issue);
  document.getElementById("issueModalTitle").textContent = `Issue: ${issue.submissionId || issueId}`;

  const images = Array.isArray(issue.images) ? issue.images : [];
  const imagesHtml = images.length
    ? `
      <div class="detail-image-grid">
        ${images
          .map(
            (img) => `
              <div class="detail-image-item">
                <img src="${img.url}" alt="Ảnh minh chứng" class="report-detail-image" data-full-src="${img.url}">
              </div>
            `
          )
          .join("")}
      </div>
    `
    : "";

  document.getElementById("issueModalReadonly").innerHTML = `
    <div class="issue-readonly-meta">
      <div><strong>Phiếu hiện tại:</strong> ${escapeHtml(issue.submissionId || "-")}</div>
      <div><strong>Thời gian báo cáo:</strong> ${escapeHtml(issue.submissionCreatedAtText || "-")}</div>
      <div><strong>Người báo cáo:</strong> ${escapeHtml(issue.hoTen || "-")} (${escapeHtml(issue.khuVuc || "-")})</div>
      <div><strong>Danh mục:</strong> ${escapeHtml(issue.category || "-")}</div>
      <div><strong>Câu hỏi:</strong> ${escapeHtml(issue.question || "-")}</div>
      ${issue.note ? `<div><strong>Mô tả lỗi:</strong> ${escapeHtml(issue.note)}</div>` : ""}
    </div>
    ${imagesHtml}
  `;

  document.getElementById("issuePlan").value = issue.plan || "";
  document.getElementById("issueAction").value = issue.action || "";
  document.getElementById("issueResponsible").value = issue.responsible || "";
  document.getElementById("issueStatus").value = issue.status || "open";

  renderIssueDiscoveryInfo(issue);
  updateCarryoverButtons();
  document.getElementById("issueModal").classList.remove("hidden");
}

function openUnresolvedPickerModal() {
  const currentIssue = allIssues.find((item) => item.id === editingIssueId);
  if (!currentIssue) return;

  const matches = findRelatedUnresolvedIssues(allIssues, currentIssue);
  const tbody = document.getElementById("unresolvedPickerBody");

  if (!matches.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-table">Không có lỗi NG chưa hoàn thành cùng chi nhánh và cùng câu hỏi.</td></tr>`;
  } else {
    tbody.innerHTML = matches
      .map((issue) => {
        const statusMeta = getRemediationStatusMeta(issue.status);
        const discovery = getEffectiveDiscovery(issue, getIssuesByIdMap());
        return `
          <tr>
            <td>
              <strong>${escapeHtml(issue.submissionId || "-")}</strong>
              <div class="issue-subtext">${escapeHtml(discovery.discoveredAtText || issue.submissionCreatedAtText || "-")}</div>
            </td>
            <td>
              <span class="remediation-status-badge ${statusMeta.badgeClass}">${escapeHtml(statusMeta.label)}</span>
            </td>
            <td>${escapeHtml(issue.responsible || "-")}</td>
            <td class="checklist-text-cell">${escapeHtml(issue.plan || "-")}</td>
            <td>
              <button type="button" class="btn-action btn-select-unresolved" data-issue-id="${escapeHtml(issue.id)}">
                Chọn
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  document.getElementById("unresolvedPickerModal").classList.remove("hidden");
}

function closeUnresolvedPickerModal() {
  document.getElementById("unresolvedPickerModal").classList.add("hidden");
}

function applyCarryoverFromIssue(sourceIssueId) {
  const currentIssue = allIssues.find((item) => item.id === editingIssueId);
  const sourceIssue = allIssues.find((item) => item.id === sourceIssueId);

  if (!currentIssue || !sourceIssue) {
    showToast("Không tìm thấy issue để liên kết.", "error");
    return;
  }

  const discovery = getEffectiveDiscovery(sourceIssue, getIssuesByIdMap());

  editingIssueContext = {
    linkedFromIssueId: sourceIssueId,
    isUnresolvedCarryover: true,
    discoveredAt: discovery.discoveredAt || sourceIssue.discoveredAt || null,
    discoveredAtText: discovery.discoveredAtText || sourceIssue.submissionCreatedAtText || ""
  };

  document.getElementById("issuePlan").value = sourceIssue.plan || "";
  document.getElementById("issueAction").value = sourceIssue.action || "";
  document.getElementById("issueResponsible").value = sourceIssue.responsible || "";
  document.getElementById("issueStatus").value =
    sourceIssue.status === "done" ? "in_progress" : sourceIssue.status || "in_progress";

  renderIssueDiscoveryInfo(currentIssue);
  updateCarryoverButtons();
  closeUnresolvedPickerModal();
  showToast("Đã sao chép thông tin khắc phục từ lỗi trước.", "success");
}

function clearCarryoverLink() {
  const currentIssue = allIssues.find((item) => item.id === editingIssueId);
  if (!currentIssue) return;

  const parsedDate = parseIssueDateText(currentIssue.submissionCreatedAtText);
  editingIssueContext = {
    linkedFromIssueId: null,
    isUnresolvedCarryover: false,
    discoveredAt: parsedDate ? Timestamp.fromDate(parsedDate) : currentIssue.discoveredAt || null,
    discoveredAtText: currentIssue.submissionCreatedAtText || currentIssue.discoveredAtText || ""
  };

  renderIssueDiscoveryInfo(currentIssue);
  updateCarryoverButtons();
  showToast("Đã bỏ liên kết lỗi cũ. Thời gian phát hiện tính theo báo cáo hiện tại.", "info");
}

function closeIssueModal() {
  editingIssueId = null;
  editingIssueContext = null;
  document.getElementById("issueDiscoveryInfo").classList.add("hidden");
  document.getElementById("clearCarryoverBtn").classList.add("hidden");
  document.getElementById("issueModal").classList.add("hidden");
}

async function saveIssue() {
  if (!editingIssueId || !editingIssueContext) return;

  const plan = document.getElementById("issuePlan").value.trim();
  const action = document.getElementById("issueAction").value.trim();
  const responsible = document.getElementById("issueResponsible").value.trim();
  const status = document.getElementById("issueStatus").value;

  if (status === "in_progress" && !plan && !responsible) {
    showToast("Khi chuyển sang Đang khắc phục, nên có kế hoạch hoặc người phụ trách.", "error");
    return;
  }

  if (status === "done" && !action) {
    showToast("Vui lòng nhập hành động khắc phục trước khi đánh dấu Hoàn thành.", "error");
    return;
  }

  try {
    showPageLoader(true, "Đang lưu cập nhật...");

    const updateData = {
      plan,
      action,
      responsible,
      status,
      linkedFromIssueId: editingIssueContext.linkedFromIssueId,
      isUnresolvedCarryover: editingIssueContext.isUnresolvedCarryover,
      discoveredAtText: editingIssueContext.discoveredAtText,
      updatedAt: serverTimestamp(),
      updatedBy: currentUserProfile?.email || currentUserProfile?.uid || ""
    };

    if (editingIssueContext.discoveredAt) {
      updateData.discoveredAt = editingIssueContext.discoveredAt;
    } else {
      const parsedDate = parseIssueDateText(editingIssueContext.discoveredAtText);
      if (parsedDate) {
        updateData.discoveredAt = Timestamp.fromDate(parsedDate);
      }
    }

    const discoveredMillis = timestampToMillis(updateData.discoveredAt) ||
      parseIssueDateText(editingIssueContext.discoveredAtText)?.getTime();

    if (status === "done") {
      updateData.completedAt = serverTimestamp();
      if (discoveredMillis) {
        updateData.resolutionDurationMs = Date.now() - discoveredMillis;
      }
    } else {
      updateData.completedAt = null;
      updateData.resolutionDurationMs = null;
    }

    await updateDoc(doc(db, "remediationIssues", editingIssueId), updateData);

    closeIssueModal();
    showToast("Đã cập nhật hành động khắc phục", "success");
    await loadIssues();
  } catch (error) {
    console.error(error);
    showToast("Không thể lưu cập nhật issue.", "error");
  } finally {
    showPageLoader(false);
  }
}

function updateIssueCountText() {
  document.getElementById("issueCountText").textContent = `${filteredIssues.length} kết quả`;
}

function showTableError(tbodyId, colspan, message) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="${colspan}" class="empty-table">${escapeHtml(message)}</td></tr>`;
}

async function handleLogout() {
  try {
    await signOut(auth);
    window.location.href = "./index.html";
  } catch (error) {
    console.error(error);
    showToast("Không thể đăng xuất.", "error");
  }
}

function openImageModal(src) {
  document.getElementById("imageModalPreview").src = src;
  document.getElementById("imageModal").classList.remove("hidden");
}

function closeImageModal() {
  document.getElementById("imageModalPreview").src = "";
  document.getElementById("imageModal").classList.add("hidden");
}

function showPageLoader(show, text = "Đang xử lý...") {
  const loader = document.getElementById("pageLoader");
  const loaderText = document.getElementById("pageLoaderText");
  if (loaderText) loaderText.textContent = text;
  loader?.classList.toggle("hidden", !show);
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

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}
