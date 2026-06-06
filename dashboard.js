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
  getActiveBranchNames,
  FACTORY_AREA
} from "./areas-service.js";
import {
  getRemediationStatusMeta,
  formatDurationVi,
  getIssueElapsedMs,
  getIssueDurationLabel,
  parseIssueDateText,
  timestampToMillis
} from "./remediation-service.js";
import { initI18n, t, onLanguageChange, applyI18n } from "./i18n.js?v=20250611";
import {
  fetchChecklistItems,
  fetchChecklistCategories,
  groupChecklistForArea,
  sortChecklistItems
} from "./checklist-service.js";

const PRIVILEGED_ROLES = ["admin", "manager"];
const QUERY_LIMIT = 500;
const NG_TABLE_LIMIT = 25;
const TOP_DISCOVERERS_LIMIT = 5;
const TOP_NG_QUESTIONS_LIMIT = 5;
const CHART_COLORS = [
  "#ed1c24",
  "#f59e0b",
  "#2563eb",
  "#16a34a",
  "#9333ea",
  "#0891b2",
  "#ea580c",
  "#4f46e5",
  "#be123c",
  "#059669"
];

let currentFirebaseUser = null;
let currentUserProfile = null;
let branchNames = [];
let rawSubmissions = [];
let rawIssues = [];
let cachedChecklistQuestions = [];
let currentPeriod = "week";
let currentAreaFilter = "ALL";
let trendChart = null;
let unresolvedAreaChart = null;
let ngCategoryChart = null;
let topNgQuestionsChart = null;
let toastTimer = null;

document.addEventListener("DOMContentLoaded", initDashboardPage);

function initDashboardPage() {
  initI18n();
  try {
    bindDashboardEvents();
    authPersistenceReady.then(() => observeDashboardAuth());

    onLanguageChange(async () => {
      document.querySelectorAll("[data-original-text]").forEach((el) => {
        delete el.dataset.originalText;
      });
      applyI18n();
      if (currentUserProfile && canViewAllAreas(currentUserProfile)) {
        const { branches } = await fetchBranches();
        const filterArea = document.getElementById("filterDashboardArea");
        if (filterArea) {
          filterArea.innerHTML = buildReportFilterOptions(branches, filterArea.value || "ALL");
        }
      }
      renderDashboardViews();
    });
  } catch (error) {
    console.error(error);
    showGuestAccessDenied(t("dashboard.initFailed"));
    showPageLoader(false);
  }
}

function bindDashboardEvents() {
  document.getElementById("dashboardLogoutBtn")?.addEventListener("click", handleLogout);
  document.getElementById("applyDashboardFilterBtn")?.addEventListener("click", applyDashboardFilter);
  document.getElementById("resetDashboardFilterBtn")?.addEventListener("click", resetDashboardFilter);

  document.querySelectorAll(".dashboard-period-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const period = btn.dataset.period;
      if (!period || period === currentPeriod) return;
      currentPeriod = period;
      updatePeriodButtons();
      renderDashboardViews();
    });
  });

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
  showPageLoader(true, t("common.checkingAccess"));

  onAuthStateChanged(auth, async (user) => {
    try {
      if (!user) {
        showGuestAccessDenied(t("common.notLoggedIn"));
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
      showGuestAccessDenied(error.message || t("dashboard.noAccess"));
    } finally {
      showPageLoader(false);
    }
  });
}

async function loadCurrentUserProfile(uid) {
  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) {
    throw new Error(t("dashboard.profileNotFound"));
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
    throw new Error(t("dashboard.accountNotActive"));
  }
  if (status === "locked") {
    throw new Error(t("dashboard.accountLocked"));
  }
  if (status !== "active") {
    throw new Error(t("dashboard.accountInactive"));
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
      return t("dashboard.scope.area", { area: areaFilter });
    }
    return t("dashboard.scope.all");
  }

  return t("dashboard.scope.userArea", { area: profile?.khuVuc || "-" });
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
  await loadChecklistReference("ALL");
}

async function loadChecklistReference(areaFilter = currentAreaFilter) {
  try {
    const [{ items }, { categories }] = await Promise.all([
      fetchChecklistItems(),
      fetchChecklistCategories()
    ]);

    cachedChecklistQuestions = buildChecklistReferenceQuestions(items, categories, areaFilter);
  } catch (error) {
    console.warn("Không thể tải checklist tham chiếu:", error);
    cachedChecklistQuestions = [];
  }
}

function buildChecklistReferenceQuestions(items, categories, areaFilter) {
  const activeItems = items.filter((item) => item.active !== false);

  if (areaFilter && areaFilter !== "ALL") {
    return flattenChecklistGroups(groupChecklistForArea(activeItems, areaFilter, categories, branchNames));
  }

  if (!canViewAllAreas()) {
    const userArea = currentUserProfile?.khuVuc;
    if (!userArea) return [];
    return flattenChecklistGroups(groupChecklistForArea(activeItems, userArea, categories, branchNames));
  }

  return sortChecklistItems(activeItems, categories).map((item) => ({
    id: item.id,
    category: item.category || "",
    text: item.text || ""
  }));
}

function flattenChecklistGroups(groups) {
  const questions = [];
  groups.forEach((group) => {
    group.questions.forEach((question) => {
      questions.push({
        id: question.id,
        category: group.category,
        text: question.text || ""
      });
    });
  });
  return questions;
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
  showPageLoader(true, t("dashboard.loadingStats"));

  try {
    currentAreaFilter = areaFilter;
    await loadChecklistReference(areaFilter);
    const submissions = await loadScopedSubmissions(areaFilter);
    const issues = await loadScopedIssues(areaFilter, submissions);

    rawSubmissions = submissions;
    rawIssues = issues;

    document.getElementById("dashboardScopeText").textContent = getDashboardScopeLabel(
      currentUserProfile,
      areaFilter
    );

    renderDashboardViews();
  } catch (error) {
    console.error(error);
    showToast(t("dashboard.loadFailed"), "error");
    renderEmptyNgTable(t("dashboard.loadDataRetry"));
    renderTopDiscoverersTable([]);
    renderNgByCategoryChart([]);
    renderTopNgQuestionsChart([]);
  } finally {
    showPageLoader(false);
  }
}

function renderDashboardViews() {
  const submissions = filterByPeriod(rawSubmissions, currentPeriod, getSubmissionDate);
  const issues = filterByPeriod(rawIssues, currentPeriod, getIssueDate);

  updatePeriodHint();
  renderSubmissionStats(submissions);
  renderIssueStats(issues);
  renderTrendChart(submissions);
  renderUnresolvedAreaChart(issues);
  renderTopDiscoverersTable(submissions);
  renderNgByCategoryChart(submissions);
  renderTopNgQuestionsChart(submissions);
  renderNgTable(issues);
}

function updatePeriodButtons() {
  document.querySelectorAll(".dashboard-period-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.period === currentPeriod);
  });
}

function updatePeriodHint() {
  const hint = getPeriodHint(currentPeriod);
  document.getElementById("dashboardPeriodHint").textContent = hint;
  document.getElementById("topDiscoverersPeriodLabel").textContent = getPeriodShortLabel(currentPeriod);
  document.getElementById("trendChartTitle").textContent = t("dashboard.chart.ngTrendWithPeriod", { period: hint });
}

function getPeriodShortLabel(period) {
  if (period === "month") return t("dashboard.period.month");
  if (period === "year") return t("dashboard.period.year");
  return t("dashboard.period.week");
}

function getPeriodHint(period) {
  if (period === "month") return t("dashboard.period.hint.month");
  if (period === "year") return t("dashboard.period.hint.year");
  return t("dashboard.period.hint.week");
}

function getSubmissionDate(submission) {
  const ms = timestampToMillis(submission.createdAt);
  if (ms) return new Date(ms);
  return parseIssueDateText(submission.createdAtText);
}

function getIssueDate(issue) {
  const ms =
    timestampToMillis(issue.discoveredAt) ||
    timestampToMillis(issue.createdAt) ||
    timestampToMillis(issue.updatedAt);
  if (ms) return new Date(ms);
  return parseIssueDateText(issue.discoveredAtText || issue.submissionCreatedAtText);
}

function filterByPeriod(items, period, getDateFn) {
  const now = new Date();

  return items.filter((item) => {
    const date = getDateFn(item);
    if (!date) return false;

    if (period === "week") {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      weekAgo.setHours(0, 0, 0, 0);
      return date >= weekAgo;
    }

    if (period === "month") {
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    }

    if (period === "year") {
      return date.getFullYear() === now.getFullYear();
    }

    return true;
  });
}

function getChartAreaLabels(areaFilter = currentAreaFilter) {
  if (areaFilter && areaFilter !== "ALL") {
    return [areaFilter];
  }

  if (!canViewAllAreas()) {
    return [currentUserProfile?.khuVuc || "Khác"];
  }

  return [FACTORY_AREA, ...branchNames];
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
    return buildFallbackIssuesFromSubmissions(submissions);
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
  const { labels, data } = buildTrendSeries(submissions, currentPeriod);
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
          label: t("dashboard.chart.ngCount"),
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

function buildTrendSeries(submissions, period) {
  const map = new Map();
  const now = new Date();

  submissions.forEach((submission) => {
    const date = getSubmissionDate(submission);
    if (!date) return;

    let ngCount = 0;
    (submission.answers || []).forEach((answer) => {
      if (answer.result === "NG") ngCount += 1;
    });
    if (!ngCount) return;

    let key = "";
    if (period === "year") {
      key = `T${date.getMonth() + 1}`;
    } else {
      key = formatDayKey(date);
    }

    map.set(key, (map.get(key) || 0) + ngCount);
  });

  if (period === "year") {
    const labels = Array.from({ length: 12 }, (_, index) => `T${index + 1}`);
    const data = labels.map((label) => map.get(label) || 0);
    return { labels, data };
  }

  if (period === "month") {
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const labels = [];
    const data = [];

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day);
      labels.push(String(day).padStart(2, "0"));
      data.push(map.get(formatDayKey(date)) || 0);
    }

    return { labels, data };
  }

  const labels = [];
  const data = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - offset);
    labels.push(formatDayLabel(date));
    data.push(map.get(formatDayKey(date)) || 0);
  }

  return { labels, data };
}

function formatDayKey(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDayLabel(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

function renderUnresolvedAreaChart(issues) {
  const labels = getChartAreaLabels();
  const unresolved = issues.filter((issue) => issue.status !== "done");
  const counts = new Map(labels.map((label) => [label, 0]));

  unresolved.forEach((issue) => {
    const area = issue.khuVuc || "Khác";
    if (!counts.has(area)) {
      counts.set(area, 0);
    }
    counts.set(area, (counts.get(area) || 0) + 1);
  });

  const data = labels.map((label) => counts.get(label) || 0);
  const canvas = document.getElementById("unresolvedAreaChart");
  if (!canvas) return;

  if (unresolvedAreaChart) {
    unresolvedAreaChart.destroy();
  }

  unresolvedAreaChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: t("dashboard.chart.unresolvedCount"),
          data,
          backgroundColor: "rgba(237, 28, 36, 0.78)",
          borderColor: "#ed1c24",
          borderWidth: 1,
          borderRadius: 8
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
        },
        x: {
          ticks: {
            maxRotation: 45,
            minRotation: 0
          }
        }
      }
    }
  });
}

function renderTopDiscoverersTable(submissions) {
  const tbody = document.getElementById("topDiscoverersBody");
  if (!tbody) return;

  const counts = new Map();

  submissions.forEach((submission) => {
    let ngCount = 0;
    (submission.answers || []).forEach((answer) => {
      if (answer.result === "NG") ngCount += 1;
    });

    if (!ngCount) return;

    const key = submission.uid || submission.taiKhoan || submission.hoTen || "unknown";
    const existing = counts.get(key) || { name: submission.hoTen || "", count: 0 };
    existing.count += ngCount;
    if (submission.hoTen) {
      existing.name = submission.hoTen;
    }
    counts.set(key, existing);
  });

  const topList = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_DISCOVERERS_LIMIT);

  tbody.innerHTML = Array.from({ length: TOP_DISCOVERERS_LIMIT }, (_, index) => {
    const item = topList[index];
    const rank = index + 1;
    const name = item?.name ? escapeHtml(item.name) : "";
    const count = item?.count != null ? item.count : "";

    return `
      <tr>
        <td>${rank}</td>
        <td>${name}</td>
        <td>${count}</td>
      </tr>
    `;
  }).join("");
}

function destroyChartInstance(chartInstance) {
  if (chartInstance) {
    chartInstance.destroy();
  }
  return null;
}

function truncateChartLabel(text, maxLength = 56) {
  const value = String(text || "").trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function renderNgByCategoryChart(submissions) {
  const canvas = document.getElementById("ngCategoryChart");
  const emptyEl = document.getElementById("ngCategoryChartEmpty");
  if (!canvas) return;

  const categoryCounts = new Map();

  submissions.forEach((submission) => {
    (submission.answers || []).forEach((answer) => {
      if (answer.result !== "NG") return;
      const category = String(answer.category || "").trim() || "—";
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    });
  });

  const labels = [...categoryCounts.keys()];
  const data = labels.map((label) => categoryCounts.get(label));
  const total = data.reduce((sum, value) => sum + value, 0);

  if (!total) {
    ngCategoryChart = destroyChartInstance(ngCategoryChart);
    canvas.classList.add("hidden");
    if (emptyEl) {
      emptyEl.textContent = t("common.noData");
      emptyEl.classList.remove("hidden");
    }
    return;
  }

  canvas.classList.remove("hidden");
  emptyEl?.classList.add("hidden");
  ngCategoryChart = destroyChartInstance(ngCategoryChart);

  ngCategoryChart = new Chart(canvas, {
    type: "pie",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: labels.map((_, index) => CHART_COLORS[index % CHART_COLORS.length]),
          borderColor: "#fff",
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 12,
            font: { size: 11 }
          }
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const value = Number(context.raw) || 0;
              const percent = total ? ((value / total) * 100).toFixed(1) : "0";
              return `${context.label}: ${value} (${percent}%)`;
            }
          }
        }
      }
    }
  });
}

function buildTopNgQuestionRows(submissions) {
  const questionCounts = new Map();

  submissions.forEach((submission) => {
    (submission.answers || []).forEach((answer) => {
      if (answer.result !== "NG") return;

      const key = answer.questionId || answer.question || "unknown";
      const existing = questionCounts.get(key) || {
        key,
        question: answer.question || "",
        count: 0
      };

      existing.count += 1;
      if (answer.question) {
        existing.question = answer.question;
      }

      questionCounts.set(key, existing);
    });
  });

  let ranked = [...questionCounts.values()].sort((a, b) => b.count - a.count);

  if (ranked.length < TOP_NG_QUESTIONS_LIMIT && cachedChecklistQuestions.length) {
    const usedKeys = new Set(ranked.map((item) => item.key));

    cachedChecklistQuestions.forEach((referenceQuestion) => {
      if (ranked.length >= TOP_NG_QUESTIONS_LIMIT) return;

      const key = referenceQuestion.id || referenceQuestion.text;
      if (usedKeys.has(key)) return;

      ranked.push({
        key,
        question: referenceQuestion.text || "",
        count: 0
      });
      usedKeys.add(key);
    });
  }

  return ranked.slice(0, TOP_NG_QUESTIONS_LIMIT).sort((a, b) => b.count - a.count);
}

function renderTopNgQuestionsChart(submissions) {
  const canvas = document.getElementById("topNgQuestionsChart");
  const emptyEl = document.getElementById("topNgQuestionsChartEmpty");
  if (!canvas) return;

  const ranked = buildTopNgQuestionRows(submissions);

  if (!ranked.length) {
    topNgQuestionsChart = destroyChartInstance(topNgQuestionsChart);
    canvas.classList.add("hidden");
    if (emptyEl) {
      emptyEl.textContent = t("common.noData");
      emptyEl.classList.remove("hidden");
    }
    return;
  }

  canvas.classList.remove("hidden");
  emptyEl?.classList.add("hidden");
  topNgQuestionsChart = destroyChartInstance(topNgQuestionsChart);

  const labels = ranked.map((item) => truncateChartLabel(item.question));
  const data = ranked.map((item) => item.count);

  topNgQuestionsChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: t("dashboard.chart.ngCount"),
          data,
          backgroundColor: "rgba(237, 28, 36, 0.78)",
          borderColor: "#ed1c24",
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const index = items[0]?.dataIndex;
              return ranked[index]?.question || items[0]?.label || "";
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { precision: 0 }
        },
        y: {
          ticks: {
            autoSkip: false,
            font: { size: 11 }
          }
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

  document.getElementById("ngTableCount").textContent = t("common.resultsCount", { count: openIssues.length });

  if (!openIssues.length) {
    renderEmptyNgTable(t("common.noData"));
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
        ? `<a href="./remediation.html?issue=${encodeURIComponent(issue.id)}" class="dashboard-issue-link remediation-link-btn">${t("remediation.viewRemediation")}</a>`
        : `<span class="issue-subtext">${t("dashboard.contactManager")}</span>`;

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
                ? `<img src="${firstImage.url}" alt="${escapeHtml(t("common.imageEvidence"))}" class="dashboard-ng-image" data-full-src="${firstImage.url}">`
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
  document.getElementById("ngTableCount").textContent = t("common.resultsCount", { count: 0 });
}

async function handleLogout() {
  try {
    await signOut(auth);
    window.location.href = "./index.html";
  } catch (error) {
    console.error(error);
    showToast(t("remediation.logoutFailed"), "error");
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

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}
