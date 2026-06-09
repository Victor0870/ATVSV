import {
  auth,
  db,
  authPersistenceReady,
  initAppCheck,
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
import { initI18n, t, onLanguageChange, applyI18n } from "./i18n.js?v=20250620";
import { buildSecureImageAttrs, hydrateSecureImages } from "./security-service.js";

const ISSUE_QUERY_LIMIT = 500;

let currentUserProfile = null;
let currentFirebaseUser = null;
let allIssues = [];
let filteredIssues = [];
let branchNames = [];
let editingIssueId = null;
let editingIssueContext = null;
let toastTimer = null;

document.addEventListener("DOMContentLoaded", initRemediationPage);

function initRemediationPage() {
  initI18n();
  initAppCheck();
  try {
    bindRemediationEvents();
    authPersistenceReady.then(() => observeRemediationAuth());

    onLanguageChange(async () => {
      document.querySelectorAll("[data-original-text]").forEach((el) => {
        delete el.dataset.originalText;
      });
      applyI18n();
      await loadFilterOptions();
      renderIssueStats(filteredIssues);
      renderIssueTable();
      updateIssueCountText();
      if (editingIssueId) {
        openIssueModal(editingIssueId);
      }
    });
  } catch (error) {
    console.error(error);
    showGuestAccessDenied(t("remediation.initFailed"));
    showPageLoader(false);
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
  showPageLoader(true, t("common.checkingAccess"));

  onAuthStateChanged(auth, async (user) => {
    try {
      if (!user) {
        showGuestAccessDenied(t("common.notLoggedIn"));
        return;
      }

      currentFirebaseUser = user;
      const profile = await loadCurrentUserProfile(user.uid);
      currentUserProfile = profile;
      ensureRemediationAccess(profile);
      showRemediationScreen(profile, user);

      await loadFilterOptions();
      await loadIssues();

      const params = new URLSearchParams(window.location.search);
      const issueId = params.get("issue");
      if (issueId) {
        openIssueModal(issueId);
      }
    } catch (error) {
      console.error(error);
      showAccessDenied(
        error.message || t("remediation.noAccessGeneric"),
        currentUserProfile,
        currentFirebaseUser
      );
    } finally {
      showPageLoader(false);
    }
  });
}

async function loadCurrentUserProfile(uid) {
  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) {
    throw new Error(t("remediation.profileNotFound"));
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
    throw new Error(t("remediation.accountNotActive"));
  }

  const role = String(profile.role || "").trim().toLowerCase();
  if (!ALLOWED_REMEDIATION_ROLES.includes(role)) {
    throw new Error(t("remediation.adminOnly"));
  }
}

function showGuestAccessDenied(message) {
  document.getElementById("remediationLayout")?.classList.add("hidden");
  document.getElementById("remediationAccessWrap")?.classList.remove("hidden");
  document.getElementById("remediationGuestMessage").textContent = message;
}

function showAccessDenied(message, profile = null, firebaseUser = null) {
  if (profile && firebaseUser) {
    showAppLayout(profile, firebaseUser);
    document.getElementById("remediationScreen")?.classList.add("hidden");
    document.getElementById("remediationMainAccessDenied")?.classList.remove("hidden");
    document.getElementById("remediationMainAccessMessage").textContent = message;
    return;
  }

  showGuestAccessDenied(message);
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

function showAppLayout(profile, firebaseUser) {
  document.getElementById("remediationAccessWrap")?.classList.add("hidden");
  document.getElementById("remediationLayout")?.classList.remove("hidden");

  document.getElementById("sidebarRemediationUserName").textContent = profile.hoTen || "-";
  document.getElementById("sidebarRemediationUserEmail").textContent =
    firebaseUser?.email || profile.email || "-";
  document.getElementById("remediationUserInitials").textContent = getUserInitials(profile.hoTen);

  const isAdmin = String(profile.role || "").trim().toLowerCase() === "admin";
  document.getElementById("remediationAdminLink")?.classList.toggle("hidden", !isAdmin);
}

function showRemediationScreen(profile, firebaseUser) {
  showAppLayout(profile, firebaseUser);
  document.getElementById("remediationMainAccessDenied")?.classList.add("hidden");
  document.getElementById("remediationScreen")?.classList.remove("hidden");
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
  showPageLoader(true, t("remediation.loadingIssues"));

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
    showTableError("issueTableBody", 6, t("remediation.loadIssuesFailed"));
    showToast(t("remediation.loadIssuesFailed"), "error");
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
    tbody.innerHTML = `<tr><td colspan="6" class="empty-table">${escapeHtml(t("report.noFilterResults"))}</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredIssues
    .map((issue) => {
      const statusMeta = getRemediationStatusMeta(issue.status);
      const elapsedMs = getIssueElapsedMs(issue, getIssuesByIdMap());
      const carryoverBadge = issue.isUnresolvedCarryover
        ? `<span class="issue-carryover-tag">${escapeHtml(t("remediation.modal.unresolved"))}</span>`
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
              ${t("common.edit")}
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
    ? `<div><strong>${t("remediation.modal.clearCarryover")}:</strong> ${escapeHtml(editingIssueContext.linkedFromIssueId || "-")}</div>`
    : "";

  container.innerHTML = `
    <div class="issue-discovery-grid">
      <div><strong>${t("remediation.picker.discoveryTime")}:</strong> ${escapeHtml(editingIssueContext.discoveredAtText || "-")}</div>
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
    showToast(t("remediation.issueNotFound"), "error");
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
                <img ${buildSecureImageAttrs(img, "report-detail-image")} alt="${escapeHtml(t("common.imageEvidence"))}">
              </div>
            `
          )
          .join("")}
      </div>
    `
    : "";

  document.getElementById("issueModalReadonly").innerHTML = `
    <div class="issue-readonly-meta">
      <div><strong>${t("remediation.table.ticketTime")}:</strong> ${escapeHtml(issue.submissionId || "-")}</div>
      <div><strong>${t("report.time")}</strong> ${escapeHtml(issue.submissionCreatedAtText || "-")}</div>
      <div><strong>${t("common.registeredUser")}:</strong> ${escapeHtml(issue.hoTen || "-")} (${escapeHtml(issue.khuVuc || "-")})</div>
      <div><strong>${t("admin.checklist.colCategory")}:</strong> ${escapeHtml(issue.category || "-")}</div>
      <div><strong>${t("admin.checklist.colQuestion")}:</strong> ${escapeHtml(issue.question || "-")}</div>
      ${issue.note ? `<div><strong>${t("report.errorDescription")}</strong> ${escapeHtml(issue.note)}</div>` : ""}
    </div>
    ${imagesHtml}
  `;

  hydrateSecureImages(document.getElementById("issueModalReadonly"));

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
    tbody.innerHTML = `<tr><td colspan="5" class="empty-table">${escapeHtml(t("common.noData"))}</td></tr>`;
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
                ${t("common.select")}
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
    showToast(t("remediation.linkIssueNotFound"), "error");
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
  showToast(t("remediation.carryoverCopied"), "success");
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
  showToast(t("remediation.carryoverCleared"), "info");
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
    showToast(t("remediation.needPlanOrResponsible"), "error");
    return;
  }

  if (status === "done" && !action) {
    showToast(t("remediation.needActionBeforeDone"), "error");
    return;
  }

  try {
    showPageLoader(true, t("remediation.savingUpdate"));

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
    showToast(t("remediation.saveSuccess"), "success");
    await loadIssues();
  } catch (error) {
    console.error(error);
    showToast(t("remediation.saveFailed"), "error");
  } finally {
    showPageLoader(false);
  }
}

function updateIssueCountText() {
  document.getElementById("issueCountText").textContent = t("common.resultsCount", { count: filteredIssues.length });
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
