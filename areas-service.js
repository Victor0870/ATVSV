import { db, collection, getDocs } from "./firebase-config.js";
import { t } from "./i18n.js?v=20250620";

export const FACTORY_AREA = "Nhà máy";
export const ALL_BRANCHES_AREA = "Chi nhánh";

export const FALLBACK_BRANCHES = [
  { name: "Hà Nội", order: 1 },
  { name: "Hà Tĩnh", order: 2 },
  { name: "Đà Nẵng", order: 3 },
  { name: "Hồ Chí Minh", order: 4 },
  { name: "Cần Thơ", order: 5 }
];

export async function fetchBranches({ includeInactive = false, throwOnError = false } = {}) {
  try {
    const snap = await getDocs(collection(db, "branches"));
    let branches = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));

    if (!includeInactive) {
      branches = branches.filter((branch) => branch.active !== false);
    }

    branches.sort((a, b) => {
      const orderDiff = (Number(a.order) || 0) - (Number(b.order) || 0);
      if (orderDiff !== 0) return orderDiff;
      return String(a.name || "").localeCompare(String(b.name || ""), "vi");
    });

    if (branches.length > 0) {
      return { branches, source: "firestore" };
    }
  } catch (error) {
    console.warn("Không thể tải danh sách chi nhánh:", error);
    if (throwOnError) throw error;
  }

  return {
    branches: FALLBACK_BRANCHES.map((branch, index) => ({
      id: `fallback_branch_${index + 1}`,
      ...branch,
      active: true
    })),
    source: "fallback"
  };
}

export function getActiveBranchNames(branches = []) {
  return branches.filter((branch) => branch.active !== false).map((branch) => branch.name);
}

export function isValidUserArea(khuVuc, branches = []) {
  const area = String(khuVuc || "").trim();
  if (!area) return false;
  if (area === FACTORY_AREA) return true;
  if (area === ALL_BRANCHES_AREA) return true;
  return branches.some((branch) => branch.active !== false && branch.name === area);
}

export function isBranchUserArea(khuVuc, branches = []) {
  const area = String(khuVuc || "").trim();
  if (area === ALL_BRANCHES_AREA) return true;
  return getActiveBranchNames(branches).includes(area);
}

export function isChecklistItemVisibleForArea(itemArea, userArea, branchNames = []) {
  const normalizedItemArea = itemArea || "ALL";
  const normalizedUserArea = String(userArea || "").trim();

  if (normalizedItemArea === "ALL") return true;
  if (normalizedItemArea === normalizedUserArea) return true;

  if (normalizedItemArea === ALL_BRANCHES_AREA) {
    if (normalizedUserArea === ALL_BRANCHES_AREA) return true;
    return branchNames.includes(normalizedUserArea);
  }

  return false;
}

export function matchesReportAreaFilter(submissionArea, filterArea, branchNames = []) {
  const area = String(submissionArea || "").trim();
  if (!filterArea || filterArea === "ALL") return true;
  if (filterArea === area) return true;

  if (filterArea === ALL_BRANCHES_AREA) {
    return area === ALL_BRANCHES_AREA || branchNames.includes(area);
  }

  return false;
}

export function buildChecklistAreaOptions(branches = [], selectedValue = "ALL") {
  const options = [
    { value: "ALL", label: t("common.allAreas") },
    { value: FACTORY_AREA, label: t("filter.areaType.factory") },
    { value: ALL_BRANCHES_AREA, label: t("filter.allBranchesGroup") }
  ];

  getActiveBranchNames(branches).forEach((branchName) => {
    options.push({ value: branchName, label: branchName });
  });

  return options
    .map((option) => {
      const selected = option.value === selectedValue ? "selected" : "";
      return `<option value="${escapeAttr(option.value)}" ${selected}>${escapeHtml(option.label)}</option>`;
    })
    .join("");
}

export function buildReportFilterOptions(branches = [], selectedValue = "ALL") {
  const options = [
    { value: "ALL", label: t("common.allAreas") },
    { value: FACTORY_AREA, label: t("filter.areaType.factory") },
    { value: ALL_BRANCHES_AREA, label: t("filter.allBranchesGroup") }
  ];

  getActiveBranchNames(branches).forEach((branchName) => {
    options.push({ value: branchName, label: branchName });
  });

  return options
    .map((option) => {
      const selected = option.value === selectedValue ? "selected" : "";
      return `<option value="${escapeAttr(option.value)}" ${selected}>${escapeHtml(option.label)}</option>`;
    })
    .join("");
}

export function buildRegistrationBranchOptions(branches = []) {
  return getActiveBranchNames(branches)
    .map((branchName) => `<option value="${escapeAttr(branchName)}">${escapeHtml(branchName)}</option>`)
    .join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
