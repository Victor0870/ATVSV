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
  fetchBranches,
  buildReportFilterOptions,
  getActiveBranchNames
} from "./areas-service.js";
import {
  getRemediationStatusMeta,
  formatDurationVi,
  getIssueElapsedMs,
  getIssueDurationLabel
} from "./remediation-service.js";

const PRIVILEGED_ROLES = ["admin", "manager"];
const QUERY_LIMIT = 500;
const NG_TABLE_LIMIT = 25;

let currentFirebaseUser = null;
let currentUserProfile = null;
let branchNames = [];
let allSubmissions = [];
let allIssues = [];
let trendChart = null;
let toastTimer = null;

document.addEventListener("DOMContentLoaded", initDashboardPage);

function initDashboardPage() {
  try {
    bindDashboardEvents();
    authPersistenceReady.then(() => observeDashboardAuth());
  } catch (error) {
    console.error(error);
    showGuestAccessDenied("Không thể khởi tạo dashboard. Vui lòng tải lại trang.");
    showPageLoader(false);
  }
}

function bindDashboardEvents() {
  document.getElementById("dashboardLogoutBtn")?.addEventListener("click", handleLogout);
  document.getElementById("applyDashboardFilterBtn")?.addEventListener("click", applyDashboardFilter);
  document.getElementById("resetDashboardFilterBtn")?.addEventListener("click", resetDashboardFilter);
  document.getElementById("closeImageModalBtn")?.addEventListener("click", closeImageModal);
  document.getElementById("imageModalBackdrop")?.addEventListener("click", closeImageModal);
  document.getElementById("ngTableBody")?.addEventListener("click", (event) => {
    const image = event.target.closest(".dashboard-ng-image");
    if (image) {
      openImageModal(image.dataset.fullSrc);
      return;
    }

    const link = event.target.closest(".dashboard-issue-link");
    if (link && canManageIssues()) {
      window.location.href = link.href;
    }
  });
}

function observeDashboardAuth() {
  showPageLoader(true, "Đang kiểm tra quyền truy cập...");

  onAuthStateChanged(auth, async (user) => {
    try {
      if (!user) {
        showGuestAccessDenied("Bạn chưa đăng nhập. Vui lòng đăng nhập trước.");
        return;
      }

      currentFirebaseUser = user;
      const profile = await loadCurrentUserProfile(user.uid);
      ensureDashboardAccess(profile);
      currentUserProfile = profile;

      showDashboardScreen(profile, user);
      await loadDashboardFilters(profile);
      await loadDashboardData(getDashboardAreaFilter());
    } catch (error) {
      console.error(error);
      showGuestAccessDenied(error.message || "Bạn không thể truy cập dashboard.");
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
    taiKhoan: data.taiKhoan || "",
    hoTen: data.hoTen || "",
    khuVuc: data.khuVuc || "",
    role: data.role || "user",
    status: data.status || "inactive"
  };
}

function ensureDashboardAccess(profile) {
  const status = String(profile.status || "").trim().toLowerCase();
  if (status === "pending" || status === "inactive") {
    throw new Error("Tài khoản chưa được kích hoạt.");
  }
  if (status === "locked") {
    throw new Error("Tài khoản đã bị khóa.");
  }
  if (status !== "active") {
    throw new Error("Tài khoản không ở trạng thái hoạt động.");
  }
}

function canViewAllAreas(profile = currentUserProfile) {
  const role = String(profile?.role || "").trim().toLowerCase();
  return PRIVILEGED_ROLES.includes(role);
}

function canManageIssues(profile = currentUserProfile) {
  return canViewAllAreas(profile);
}

function getDashboardScopeLabel(profile = currentUserProfile, areaFilter = "ALL") {
  if (canViewAllAreas(profile)) {
    if (areaFilter && areaFilter !== "ALL") {
      return `Phạm vi: ${areaFilter}`;
    }
    return "Phạm vi: Toàn hệ thống (Admin/Manager)";
  }

  return `Phạm vi: Khu vực ${profile?.khuVuc || "-"}`;
}

function getDashboardAreaFilter() {
  if (!canViewAllAreas()) {
    return currentUserProfile?.khuVuc || "ALL";
  }

  return document.getElementById("filterDashboardArea")?.value || "ALL";
}

function showGuestAccessDenied(message) {
  document.getElementById("dashboardLayout")?.classList.add("hidden");
  document.getElementById("dashboardGuestWrap")?.classList.remove("hidden");
  document.getElementById("dashboardGuestMessage").textContent = message;
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

function showDashboardScreen(profile, firebaseUser) {
  document.getElementById("dashboardGuestWrap")?.classList.add("hidden");
  document.getElementById("dashboardLayout")?.classList.remove("hidden");

  document.getElementById("sidebarDashboardUserName").textContent = profile.hoTen || "-";
  document.getElementById("sidebarDashboardUserEmail").textContent =
    firebaseUser?.email || profile.email || "-";
  document.getElementById("dashboardUserInitials").textContent = getUserInitials(profile.hoTen);

  const canManage = canViewAllAreas(profile);
  const isAdmin = String(profile.role || "").trim().toLowerCase() === "admin";

  document.getElementById("dashboardManageNavLabel")?.classList.toggle("hidden", !canManage);
  document.getElementById("dashboardReportLink")?.classList.toggle("hidden", !canManage);
  document.getElementById("dashboardRemediationLink")?.classList.toggle("hidden", !canManage);
  document.getElementById("dashboardAdminLink")?.classList.toggle("hidden", !isAdmin);
  document.getElementById("dashboardFilterCard")?.classList.toggle("hidden", !canManage);
}

async function loadDashboardFilters(profile) {
  const { branches } = await fetchBranches();
  branchNames = getActiveBranchNames(branches);

  const filterArea = document.getElementById("filterDashboardArea");
  if (filterArea && canViewAllAreas(profile)) {
    filterArea.innerHTML = buildReportFilterOptions(branches, "ALL");
  }

  document.getElementById("dashboardScopeText").textContent = getDashboardScopeLabel(profile, "ALL");
}

async function applyDashboardFilter() {
  await loadDashboardData(getDashboardAreaFilter());
}

async function resetDashboardFilter() {
  const filterArea = document.getElementById("filterDashboardArea");
  if (filterArea) {
    filterArea.value = "ALL";
  }
  await loadDashboardData("ALL");
}

async function loadDashboardData(areaFilter) {
  showPageLoader(true, "Đang tải dữ liệu thống kê...");

  try {
    const submissions = await loadScopedSubmissions(areaFilter);
    const issues = await loadScopedIssues(areaFilter, submissions);

    allSubmissions = submissions;
    allIssues = issues;

    document.getElementById("dashboardScopeText").textContent = getDashboardScopeLabel(
      currentUserProfile,
      areaFilter
    );

    renderSubmissionStats(allSubmissions);
    renderIssueStats(allIssues);
    renderTrendChart(allSubmissions);
    renderNgTable(allIssues);
  } catch (error) {
    console.error(error);
    showToast("Không thể tải dữ liệu dashboard.", "error");
    renderEmptyNgTable("Không thể tải dữ liệu. Vui lòng thử lại.");
  } finally {
    showPageLoader(false);
  }
}

async function loadScopedSubmissions(areaFilter) {
  const submissionsRef = collection(db, "submissions");
  const constraints = [];

  if (!canViewAllAreas()) {
    constraints.push(where("khuVuc", "==", currentUserProfile.khuVuc));
  } else if (areaFilter && areaFilter !== "ALL") {
    constraints.push(where("khuVuc", "==", areaFilter));
  }

  constraints.push(orderBy("createdAt", "desc"));
  constraints.push(limit(QUERY_LIMIT));

  const snapshot = await getDocs(query(submissionsRef, ...constraints));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

async function loadScopedIssues(areaFilter, submissions = []) {
  const issuesRef = collection(db, "remediationIssues");
  const constraints = [];

  if (!canViewAllAreas()) {
    constraints.push(where("khuVuc", "==", currentUserProfile.khuVuc));
  } else if (areaFilter && areaFilter !== "ALL") {
    constraints.push(where("khuVuc", "==", areaFilter));
  }

  constraints.push(orderBy("updatedAt", "desc"));
  constraints.push(limit(QUERY_LIMIT));

  try {
    const snapshot = await getDocs(query(issuesRef, ...constraints));
    return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  } catch (error) {
    console.warn("Không thể tải remediationIssues:", error);
    return buildFallbackIssuesFromSubmissions(allSubmissions);
  }
}

function buildFallbackIssuesFromSubmissions(submissions) {
  const items = [];

  submissions.forEach((submission) => {
    (submission.answers || []).forEach((answer) => {
      if (answer.result !== "NG") return;

      items.push({
        id: `${submission.submissionId}_${answer.questionId}`,
        submissionId: submission.submissionId,
        questionId: answer.questionId,
        khuVuc: submission.khuVuc,
        hoTen: submission.hoTen,
        question: answer.question,
        note: answer.note,
        submissionCreatedAtText: submission.createdAtText,
        status: "open",
        images: answer.images || []
      });
    });
  });

  return items;
}

function renderSubmissionStats(submissions) {
  let totalOk = 0;
  let totalNg = 0;
  let totalNa = 0;

  submissions.forEach((submission) => {
    (submission.answers || []).forEach((answer) => {
      if (answer.result === "OK") totalOk += 1;
      if (answer.result === "NG") totalNg += 1;
      if (answer.result === "N/A") totalNa += 1;
    });
  });

  document.getElementById("statTotalSubmissions").textContent = submissions.length;
  document.getElementById("statTotalOk").textContent = totalOk;
  document.getElementById("statTotalNg").textContent = totalNg;
  document.getElementById("statTotalNa").textContent = totalNa;
}

function renderIssueStats(issues) {
  let openCount = 0;
  let progressCount = 0;
  let doneCount = 0;
  let totalResolutionMs = 0;
  let doneWithDuration = 0;

  issues.forEach((issue) => {
    if (issue.status === "open") openCount += 1;
    if (issue.status === "in_progress") progressCount += 1;
    if (issue.status === "done") {
      doneCount += 1;
      if (issue.resolutionDurationMs != null) {
        totalResolutionMs += issue.resolutionDurationMs;
        doneWithDuration += 1;
      }
    }
  });

  document.getElementById("statIssueOpen").textContent = openCount;
  document.getElementById("statIssueProgress").textContent = progressCount;
  document.getElementById("statIssueDone").textContent = doneCount;

  const avgEl = document.getElementById("statAvgResolution");
  if (!doneWithDuration) {
    avgEl.textContent = "-";
    return;
  }

  avgEl.textContent = formatDurationVi(Math.round(totalResolutionMs / doneWithDuration));
}

function renderTrendChart(submissions) {
  const map = new Map();

  submissions.forEach((submission) => {
    const date = String(submission.createdAtText || "").split(" ")[0];
    if (!date) return;
    map.set(date, (map.get(date) || 0) + 1);
  });

  const sortedDates = [...map.keys()].sort();
  const labels = sortedDates.slice(-7);
  const data = labels.map((label) => map.get(label) || 0);

  const canvas = document.getElementById("trendChart");
  if (!canvas) return;

  if (trendChart) {
    trendChart.destroy();
  }

  trendChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Số phiếu",
          data,
          borderColor: "#ed1c24",
          backgroundColor: "rgba(237, 28, 36, 0.12)",
          tension: 0.35,
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0 }
        }
      }
    }
  });
}

function renderNgTable(issues) {
  const tbody = document.getElementById("ngTableBody");
  const openIssues = issues
    .filter((issue) => issue.status !== "done")
    .sort((a, b) => {
      const timeA = String(a.submissionCreatedAtText || a.discoveredAtText || "");
      const timeB = String(b.submissionCreatedAtText || b.discoveredAtText || "");
      return timeB.localeCompare(timeA);
    })
    .slice(0, NG_TABLE_LIMIT);

  document.getElementById("ngTableCount").textContent = `${openIssues.length} kết quả`;

  if (!openIssues.length) {
    renderEmptyNgTable("Không có lỗi NG đang mở trong phạm vi này.");
    return;
  }

  tbody.innerHTML = openIssues
    .map((issue) => {
      const statusMeta = getRemediationStatusMeta(issue.status);
      const elapsedMs = getIssueElapsedMs(issue);
      const durationLabel = getIssueDurationLabel(issue.status);
      const images = Array.isArray(issue.images) ? issue.images : [];
      const firstImage = images[0];
      const issueLink = canManageIssues()
        ? `<a href="./remediation.html?issue=${encodeURIComponent(issue.id)}" class="dashboard-issue-link remediation-link-btn">Xem khắc phục</a>`
        : `<span class="issue-subtext">Liên hệ quản lý khu vực</span>`;

      return `
        <tr>
          <td>
            <div><strong>${escapeHtml(issue.submissionId || "-")}</strong></div>
            <div class="issue-subtext">${escapeHtml(issue.submissionCreatedAtText || issue.discoveredAtText || "-")}</div>
            <div class="issue-subtext">${escapeHtml(issue.hoTen || "-")}</div>
          </td>
          <td>${escapeHtml(issue.khuVuc || "-")}</td>
          <td>
            <div>${escapeHtml(issue.question || "-")}</div>
            ${issue.note ? `<div class="issue-subtext">${escapeHtml(issue.note)}</div>` : ""}
            ${
              firstImage
                ? `<img src="${firstImage.url}" alt="Ảnh NG" class="dashboard-ng-image" data-full-src="${firstImage.url}">`
                : ""
            }
          </td>
          <td>
            <span class="remediation-status-badge ${statusMeta.badgeClass}">${escapeHtml(statusMeta.label)}</span>
            <div class="issue-subtext">${escapeHtml(durationLabel)}: ${escapeHtml(formatDurationVi(elapsedMs))}</div>
          </td>
          <td>${issueLink}</td>
        </tr>
      `;
    })
    .join("");
}

function renderEmptyNgTable(message) {
  document.getElementById("ngTableBody").innerHTML = `
    <tr>
      <td colspan="5" class="empty-table">${escapeHtml(message)}</td>
    </tr>
  `;
  document.getElementById("ngTableCount").textContent = "0 kết quả";
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
