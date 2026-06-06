import {
  auth,
  db,
  authPersistenceReady,
  onAuthStateChanged,
  signOut,
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs
} from "./firebase-config.js";
import {
  ALL_BRANCHES_AREA,
  fetchBranches,
  getActiveBranchNames,
  buildReportFilterOptions,
  matchesReportAreaFilter
} from "./areas-service.js";
import { buildIssueId, getRemediationStatusMeta, formatDurationVi, getIssueElapsedMs, getIssueDurationLabel } from "./remediation-service.js";
import { initI18n, t, onLanguageChange, applyI18n } from "./i18n.js?v=20250610";

const ALLOWED_REPORT_ROLES = ["admin", "manager"];
const DEFAULT_QUERY_LIMIT = 300;
const REPORT_PAGE_SIZE = 8;

let currentFirebaseUser = null;
let currentUserProfile = null;
let allSubmissions = [];
let filteredSubmissions = [];
let reportBranches = [];
let reportBranchNames = [];
let selectedSubmissionId = null;
let currentReportPage = 1;
let toastTimer = null;

document.addEventListener("DOMContentLoaded", initReportPage);

function initReportPage() {
  initI18n();
  try {
    bindReportEvents();
    authPersistenceReady.then(() => observeReportAuthState());

    onLanguageChange(async () => {
      document.querySelectorAll("[data-original-text]").forEach((el) => {
        delete el.dataset.originalText;
      });
      applyI18n();
      await loadReportBranches();
      renderReportStats(filteredSubmissions);
      renderReportList();
      if (selectedSubmissionId) {
        renderReportDetail(selectedSubmissionId);
      }
      updateReportCountText();
    });
  } catch (error) {
    console.error(error);
    showAccessDenied(t("report.initFailed"));
    showPageLoader(false);
  }
}

function bindReportEvents() {
  document.getElementById("applyFilterBtn").addEventListener("click", applyFilters);
  document.getElementById("resetFilterBtn").addEventListener("click", resetFilters);
  document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);
  document.getElementById("reportLogoutBtn").addEventListener("click", handleLogout);

  document.getElementById("reportList").addEventListener("click", (event) => {
    const card = event.target.closest(".submission-card");
    if (!card) return;

    const submissionId = card.dataset.submissionId;
    selectedSubmissionId = submissionId;
    renderReportList();
    renderReportDetail(submissionId);
  });

  document.getElementById("reportPrevPageBtn").addEventListener("click", () => {
    goToReportPage(currentReportPage - 1);
  });

  document.getElementById("reportNextPageBtn").addEventListener("click", () => {
    goToReportPage(currentReportPage + 1);
  });

  document.getElementById("reportDetail").addEventListener("click", (event) => {
    const image = event.target.closest(".report-detail-image");
    if (image) {
      openImageModal(image.dataset.fullSrc);
    }
  });

  document.getElementById("closeImageModalBtn").addEventListener("click", closeImageModal);
  document.getElementById("imageModalBackdrop").addEventListener("click", closeImageModal);
}

function observeReportAuthState() {
  showPageLoader(true, t("report.checkingAccess"));

  onAuthStateChanged(auth, async (user) => {
    try {
      if (!user) {
        showAccessDenied(t("report.notLoggedIn"));
        return;
      }

      currentFirebaseUser = user;
      const profile = await loadCurrentUserProfile(user.uid);
      currentUserProfile = profile;

      ensureReportAccess(profile);
      showReportScreen(profile, user);

      await loadReportBranches();
      await loadReportData(getCurrentFilters());
    } catch (error) {
      console.error(error);
      showAccessDenied(error.message || t("report.noReportAccess"));
    } finally {
      showPageLoader(false);
    }
  });
}

async function loadCurrentUserProfile(uid) {
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    throw new Error(t("report.profileNotFoundFirestore"));
  }

  const data = userSnap.data();

  return {
    uid,
    email: data.email || "",
    taiKhoan: data.taiKhoan || "",
    hoTen: data.hoTen || "",
    khuVuc: data.khuVuc || "",
    role: data.role || "user",
    status: data.status || "inactive"
  };
}

function ensureReportAccess(profile) {
  if (!profile) {
    throw new Error(t("report.profileNotFound"));
  }

  if (profile.status !== "active") {
    throw new Error(t("report.accountInactive"));
  }

  const role = String(profile.role || "").trim().toLowerCase();
  if (!ALLOWED_REPORT_ROLES.includes(role)) {
    throw new Error(t("report.noReportAccess"));
  }
}

function getUserInitials(name) {
  const parts = String(name || "U")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  return String(name || "U").slice(0, 2).toUpperCase();
}

function showAccessDenied(message) {
  document.getElementById("reportLayout")?.classList.add("hidden");
  document.getElementById("reportAccessWrap")?.classList.remove("hidden");
  document.getElementById("reportAccessMessage").textContent = message;
}

function showReportScreen(profile, firebaseUser) {
  document.getElementById("reportAccessWrap")?.classList.add("hidden");
  document.getElementById("reportLayout")?.classList.remove("hidden");

  document.getElementById("reportUserName").textContent = profile.hoTen || "-";
  document.getElementById("reportUserEmail").textContent = firebaseUser.email || profile.email || "-";
  document.getElementById("reportUserRole").textContent = profile.role || "-";

  document.getElementById("sidebarReportUserName").textContent = profile.hoTen || "-";
  document.getElementById("sidebarReportUserEmail").textContent = firebaseUser.email || profile.email || "-";
  document.getElementById("reportUserInitials").textContent = getUserInitials(profile.hoTen);

  const isAdmin = String(profile.role || "").trim().toLowerCase() === "admin";
  document.getElementById("reportAdminLink")?.classList.toggle("hidden", !isAdmin);
}

function getCurrentFilters() {
  return {
    dateFrom: document.getElementById("filterDateFrom").value,
    dateTo: document.getElementById("filterDateTo").value,
    area: document.getElementById("filterArea").value,
    result: document.getElementById("filterResult").value,
    keyword: document.getElementById("filterKeyword").value.trim().toLowerCase()
  };
}

async function applyFilters() {
  const filters = getCurrentFilters();

  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    showToast(t("report.dateRangeInvalid"), "error");
    return;
  }

  await loadReportData(filters);
}

async function resetFilters() {
  document.getElementById("filterDateFrom").value = "";
  document.getElementById("filterDateTo").value = "";
  document.getElementById("filterArea").value = "ALL";
  document.getElementById("filterResult").value = "ALL";
  document.getElementById("filterKeyword").value = "";

  await loadReportData(getCurrentFilters());
}

async function loadReportBranches() {
  const selected = document.getElementById("filterArea")?.value || "ALL";
  const { branches } = await fetchBranches();
  reportBranches = branches;
  reportBranchNames = getActiveBranchNames(branches);

  const filterArea = document.getElementById("filterArea");
  if (filterArea) {
    filterArea.innerHTML = buildReportFilterOptions(branches, selected);
  }
}

async function loadReportData(filters) {
  showPageLoader(true, t("report.loadingData"));

  try {
    const submissionsRef = collection(db, "submissions");
    const constraints = [];

    if (filters.area && filters.area !== "ALL" && filters.area !== ALL_BRANCHES_AREA) {
      constraints.push(where("khuVuc", "==", filters.area));
    }

    if (filters.dateFrom) {
      const fromDate = new Date(`${filters.dateFrom}T00:00:00`);
      constraints.push(where("createdAt", ">=", fromDate));
    }

    if (filters.dateTo) {
      const toDate = new Date(`${filters.dateTo}T23:59:59.999`);
      constraints.push(where("createdAt", "<=", toDate));
    }

    constraints.push(orderBy("createdAt", "desc"));
    constraints.push(limit(DEFAULT_QUERY_LIMIT));

    const q = query(submissionsRef, ...constraints);
    const snapshot = await getDocs(q);

    allSubmissions = snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        ...data
      };
    });

    filteredSubmissions = applyClientSideFilters(allSubmissions, filters);
    currentReportPage = 1;
    selectedSubmissionId = filteredSubmissions.length ? filteredSubmissions[0].submissionId : null;

    renderReportStats(filteredSubmissions);
    renderReportList();

    if (selectedSubmissionId) {
      renderReportDetail(selectedSubmissionId);
    } else {
      renderEmptyDetail(t("report.noFilterResults"));
    }

    updateReportCountText();

    if (snapshot.size >= DEFAULT_QUERY_LIMIT) {
      showToast(`Đang hiển thị tối đa ${DEFAULT_QUERY_LIMIT} phiếu gần nhất theo bộ lọc.`, "info");
    }
  } catch (error) {
    console.error(error);

    if (String(error.message || "").includes("index")) {
      showToast(t("report.indexRequired"), "error");
    } else {
      showToast(t("report.loadFailed"), "error");
    }

    renderEmptyDetail(t("report.loadFailed"));
  } finally {
    showPageLoader(false);
  }
}

function applyClientSideFilters(data, filters) {
  return data.filter((item) => {
    const searchTarget = `${item.hoTen || ""} ${item.taiKhoan || ""} ${item.email || ""}`.toLowerCase();

    const matchKeyword = !filters.keyword || searchTarget.includes(filters.keyword);
    const matchArea = matchesReportAreaFilter(item.khuVuc, filters.area, reportBranchNames);

    let matchResult = true;
    if (filters.result !== "ALL") {
      const answers = Array.isArray(item.answers) ? item.answers : [];
      matchResult = answers.some((answer) => answer.result === filters.result);
    }

    return matchKeyword && matchArea && matchResult;
  });
}

function renderReportStats(data) {
  let totalOk = 0;
  let totalNg = 0;
  let totalNa = 0;

  data.forEach((submission) => {
    const answers = Array.isArray(submission.answers) ? submission.answers : [];
    answers.forEach((answer) => {
      if (answer.result === "OK") totalOk += 1;
      if (answer.result === "NG") totalNg += 1;
      if (answer.result === "N/A") totalNa += 1;
    });
  });

  document.getElementById("statTotalSubmissions").textContent = data.length;
  document.getElementById("statTotalOk").textContent = totalOk;
  document.getElementById("statTotalNg").textContent = totalNg;
  document.getElementById("statTotalNa").textContent = totalNa;
}

function getTotalReportPages() {
  if (!filteredSubmissions.length) return 1;
  return Math.ceil(filteredSubmissions.length / REPORT_PAGE_SIZE);
}

function getPaginatedSubmissions() {
  const start = (currentReportPage - 1) * REPORT_PAGE_SIZE;
  return filteredSubmissions.slice(start, start + REPORT_PAGE_SIZE);
}

function goToReportPage(page) {
  const totalPages = getTotalReportPages();
  const nextPage = Math.min(Math.max(1, page), totalPages);
  if (nextPage === currentReportPage) return;

  currentReportPage = nextPage;
  renderReportList();

  const listContainer = document.getElementById("reportList");
  if (listContainer) {
    listContainer.scrollTop = 0;
  }
}

function renderReportPagination(totalPages) {
  const pagination = document.getElementById("reportPagination");
  const prevBtn = document.getElementById("reportPrevPageBtn");
  const nextBtn = document.getElementById("reportNextPageBtn");
  const pageInfo = document.getElementById("reportPageInfo");

  if (!pagination || !prevBtn || !nextBtn || !pageInfo) return;

  if (totalPages <= 1) {
    pagination.classList.add("hidden");
    return;
  }

  pagination.classList.remove("hidden");
  prevBtn.disabled = currentReportPage <= 1;
  nextBtn.disabled = currentReportPage >= totalPages;
  pageInfo.textContent = t("common.pageOf", { current: currentReportPage, total: totalPages });
}

function renderReportList() {
  const listContainer = document.getElementById("reportList");

  if (!filteredSubmissions.length) {
    renderReportPagination(1);
    listContainer.innerHTML = `
      <div class="empty-card" style="margin: 12px;">
        <h3>${escapeHtml(t("common.noData"))}</h3>
        <p>${escapeHtml(t("report.noFilterResults"))}</p>
      </div>
    `;
    return;
  }

  const totalPages = getTotalReportPages();
  if (currentReportPage > totalPages) {
    currentReportPage = totalPages;
  }

  const pageItems = getPaginatedSubmissions();

  listContainer.innerHTML = pageItems
    .map((item) => {
      const isActive = item.submissionId === selectedSubmissionId;
      const summary = item.summary || {};
      return `
        <div class="submission-card ${isActive ? "active" : ""}" data-submission-id="${escapeHtml(item.submissionId)}">
          <div class="submission-title">${escapeHtml(item.hoTen || "-")} - ${escapeHtml(item.submissionId || "-")}</div>
          <div class="submission-meta">
            <div><strong>${t("report.time")}</strong> ${escapeHtml(item.createdAtText || "-")}</div>
            <div><strong>${t("report.account")}</strong> ${escapeHtml(item.taiKhoan || "-")}</div>
            <div><strong>${t("common.email")}:</strong> ${escapeHtml(item.email || "-")}</div>
            <div><strong>${t("report.area")}</strong> ${escapeHtml(item.khuVuc || "-")}</div>
          </div>
          <div class="badge-row">
            <span class="badge ok">OK: ${summary.okCount || 0}</span>
            <span class="badge ng">NG: ${summary.ngCount || 0}</span>
            <span class="badge na">N/A: ${summary.naCount || 0}</span>
          </div>
        </div>
      `;
    })
    .join("");

  renderReportPagination(totalPages);
}

function renderReportDetail(submissionId) {
  renderReportDetailAsync(submissionId);
}

async function renderReportDetailAsync(submissionId) {
  const detailContainer = document.getElementById("reportDetail");
  const submission = filteredSubmissions.find((item) => item.submissionId === submissionId);

  if (!submission) {
    renderEmptyDetail(t("report.submissionNotFound"));
    return;
  }

  let issueMap = new Map();
  try {
    issueMap = await fetchIssuesForSubmission(submissionId);
  } catch (error) {
    console.warn("Không thể tải trạng thái khắc phục:", error);
  }

  const answersHtml = (submission.answers || [])
    .map((answer, index) => {
      const resultClass = answer.result === "NG" ? "ng" : answer.result === "OK" ? "ok" : "na";
      const images = Array.isArray(answer.images) ? answer.images : [];
      const issueId = buildIssueId(submissionId, answer.questionId);
      const issue = issueMap.get(issueId);
      const remediationHtml =
        answer.result === "NG"
          ? renderRemediationStatusBlock(issue, issueId)
          : "";

      return `
        <div class="detail-answer">
          <div class="detail-answer-question">${index + 1}. ${escapeHtml(answer.question || "-")}</div>
          <div class="badge-row">
            <span class="badge ${resultClass}">${escapeHtml(answer.result || "-")}</span>
            <span class="badge">${escapeHtml(answer.category || "-")}</span>
          </div>

          ${
            answer.note
              ? `<div class="detail-answer-note"><strong>${t("report.errorDescription")}</strong> ${escapeHtml(answer.note)}</div>`
              : ""
          }

          ${remediationHtml}

          ${
            images.length
              ? `
                <div class="detail-image-grid">
                  ${images
                    .map(
                      (img) => `
                        <div class="detail-image-item">
                          <img
                            src="${img.url}"
                            alt="${escapeHtml(t("common.imageEvidence"))}"
                            class="report-detail-image"
                            data-full-src="${img.url}"
                          >
                          <div class="detail-image-caption">
                            <div><strong>${t("checklist.previewFileName")}</strong> ${escapeHtml(img.name || "-")}</div>
                            <div><strong>${t("checklist.previewCompressedSize")}</strong> ${formatBytes(img.size || 0)}</div>
                          </div>
                        </div>
                      `
                    )
                    .join("")}
                </div>
              `
              : ""
          }
        </div>
      `;
    })
    .join("");

  detailContainer.innerHTML = `
    <div class="detail-header">
      <h3>${escapeHtml(submission.submissionId || "-")}</h3>
      <div class="detail-meta">
        <div><strong>${t("report.time")}</strong> ${escapeHtml(submission.createdAtText || "-")}</div>
        <div><strong>${t("common.fullName")}:</strong> ${escapeHtml(submission.hoTen || "-")}</div>
        <div><strong>${t("common.email")}:</strong> ${escapeHtml(submission.email || "-")}</div>
        <div><strong>${t("report.account")}</strong> ${escapeHtml(submission.taiKhoan || "-")}</div>
        <div><strong>${t("report.area")}</strong> ${escapeHtml(submission.khuVuc || "-")}</div>
      </div>
      <div class="badge-row">
        <span class="badge ok">OK: ${submission.summary?.okCount || 0}</span>
        <span class="badge ng">NG: ${submission.summary?.ngCount || 0}</span>
        <span class="badge na">N/A: ${submission.summary?.naCount || 0}</span>
      </div>
    </div>

    ${answersHtml || `<div class="empty-detail">${escapeHtml(t("common.noData"))}</div>`}
  `;
}

async function fetchIssuesForSubmission(submissionId) {
  const q = query(collection(db, "remediationIssues"), where("submissionId", "==", submissionId));
  const snapshot = await getDocs(q);
  const map = new Map();
  snapshot.docs.forEach((docSnap) => {
    map.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
  });
  return map;
}

function renderRemediationStatusBlock(issue, issueId) {
  if (!issue) {
    return `
      <div class="remediation-inline-block">
        <span class="remediation-status-badge remediation-status-open">${escapeHtml(t("report.issueNotCreated"))}</span>
      </div>
    `;
  }

  const statusMeta = getRemediationStatusMeta(issue.status);
  const responsible = issue.responsible
    ? `<div><strong>${t("remediation.table.responsible")}:</strong> ${escapeHtml(issue.responsible)}</div>`
    : "";
  const plan = issue.plan
    ? `<div><strong>${t("remediation.modal.plan")}:</strong> ${escapeHtml(issue.plan)}</div>`
    : "";
  const discoveryText = issue.discoveredAtText || issue.submissionCreatedAtText || "-";
  const elapsedMs = getIssueElapsedMs(issue);
  const carryoverNote = issue.isUnresolvedCarryover
    ? `<div>${escapeHtml(t("report.carryoverNote"))}</div>`
    : "";

  return `
    <div class="remediation-inline-block">
      <div class="remediation-inline-header">
        <span class="remediation-status-badge ${statusMeta.badgeClass}">${escapeHtml(statusMeta.label)}</span>
        <a href="./remediation.html?issue=${encodeURIComponent(issueId)}" class="remediation-link-btn">
          ${t("report.viewRemediation")}
        </a>
      </div>
      <div><strong>${t("remediation.picker.discoveryTime")}:</strong> ${escapeHtml(discoveryText)}</div>
      <div><strong>${escapeHtml(getIssueDurationLabel(issue.status))}:</strong> ${escapeHtml(formatDurationVi(elapsedMs))}</div>
      ${carryoverNote}
      ${responsible}
      ${plan}
    </div>
  `;
}

function renderEmptyDetail(message) {
  document.getElementById("reportDetail").innerHTML = `
    <div class="empty-detail">${escapeHtml(message)}</div>
  `;
}

function updateReportCountText() {
  const totalPages = getTotalReportPages();
  const countText = t("common.resultsCount", { count: filteredSubmissions.length });

  if (totalPages > 1) {
    document.getElementById("reportCountText").textContent = `${countText} · ${t("common.perPage", { count: REPORT_PAGE_SIZE })}`;
    return;
  }

  document.getElementById("reportCountText").textContent = countText;
}

function exportCsv() {
  if (!filteredSubmissions.length) {
    showToast(t("report.noCsvData"), "error");
    return;
  }

  const rows = [
    [
      "MaPhieu",
      "ThoiGian",
      "TaiKhoan",
      "HoTen",
      "Email",
      "KhuVuc",
      "HangMuc",
      "NoiDungKiemTra",
      "KetQua",
      "MoTaLoi",
      "SoLuongAnh",
      "DanhSachAnh"
    ]
  ];

  filteredSubmissions.forEach((submission) => {
    const answers = Array.isArray(submission.answers) ? submission.answers : [];

    answers.forEach((answer) => {
      const images = Array.isArray(answer.images) ? answer.images : [];
      rows.push([
        submission.submissionId || "",
        submission.createdAtText || "",
        submission.taiKhoan || "",
        submission.hoTen || "",
        submission.email || "",
        submission.khuVuc || "",
        answer.category || "",
        answer.question || "",
        answer.result || "",
        answer.note || "",
        images.length,
        images.map((img) => img.url || "").join(" | ")
      ]);
    });
  });

  const csvContent = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `bao-cao-checklist-${getDateForFileName()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast(t("report.csvExported"), "success");
}

async function handleLogout() {
  try {
    await signOut(auth);
    window.location.href = "./index.html";
  } catch (error) {
    console.error(error);
    showToast(t("common.logoutFailed"), "error");
  }
}

function openImageModal(src) {
  const modal = document.getElementById("imageModal");
  const img = document.getElementById("imageModalPreview");

  img.src = src;
  modal.classList.remove("hidden");
}

function closeImageModal() {
  const modal = document.getElementById("imageModal");
  const img = document.getElementById("imageModalPreview");

  img.src = "";
  modal.classList.add("hidden");
}

function showPageLoader(show, text = t("common.loading")) {
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

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "-";
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function csvEscape(value) {
  const safeValue = value == null ? "" : String(value);
  return `"${safeValue.replace(/"/g, '""')}"`;
}

function getDateForFileName() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");

  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes()
  )}${pad(now.getSeconds())}`;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}
