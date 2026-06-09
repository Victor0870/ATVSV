import { t } from "./i18n.js?v=20250620";

export const REMEDIATION_STATUSES = {
  open: { value: "open", label: "Chờ xử lý", badgeClass: "remediation-status-open" },
  in_progress: { value: "in_progress", label: "Đang khắc phục", badgeClass: "remediation-status-progress" },
  done: { value: "done", label: "Hoàn thành", badgeClass: "remediation-status-done" }
};

export const ALLOWED_REMEDIATION_ROLES = ["admin", "manager"];

export function buildIssueId(submissionId, questionId) {
  return `${submissionId}_${questionId}`;
}

export function getRemediationStatusMeta(status) {
  const base = REMEDIATION_STATUSES[status] || REMEDIATION_STATUSES.open;
  return {
    ...base,
    label: t(`remediation.status.${base.value}`)
  };
}

export function buildRemediationIssuePayload(submission, answer) {
  return {
    issueId: buildIssueId(submission.submissionId, answer.questionId),
    submissionId: submission.submissionId,
    questionId: answer.questionId,
    uid: submission.uid,
    email: submission.email || "",
    taiKhoan: submission.taiKhoan || "",
    hoTen: submission.hoTen || "",
    khuVuc: submission.khuVuc || "",
    submissionCreatedAtText: submission.createdAtText || "",
    category: answer.category || "",
    question: answer.question || "",
    note: answer.note || "",
    images: Array.isArray(answer.images) ? answer.images : [],
    plan: "",
    action: "",
    responsible: "",
    status: "open",
    completedAt: null,
    resolutionDurationMs: null,
    discoveredAtText: submission.createdAtText || "",
    linkedFromIssueId: null,
    isUnresolvedCarryover: false,
    updatedBy: ""
  };
}

export function parseIssueDateText(text) {
  if (!text) return null;
  const normalized = String(text).trim().replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function timestampToMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.valueOf();
  if (value.seconds != null) return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  return null;
}

export function getIssueDiscoveredMillis(issue) {
  const fromTimestamp = timestampToMillis(issue.discoveredAt);
  if (fromTimestamp) return fromTimestamp;

  const fromCreatedAt = timestampToMillis(issue.createdAt);
  if (fromCreatedAt) return fromCreatedAt;

  const parsed = parseIssueDateText(issue.discoveredAtText || issue.submissionCreatedAtText);
  return parsed ? parsed.getTime() : null;
}

export function getEffectiveDiscovery(issue, issuesById = new Map()) {
  let current = issue;
  let discoveredAt = issue.discoveredAt || null;
  let discoveredAtText = issue.discoveredAtText || issue.submissionCreatedAtText || "";
  let rootIssueId = issue.id;

  while (current?.linkedFromIssueId) {
    const parent = issuesById.get(current.linkedFromIssueId);
    if (!parent) break;
    current = parent;
    rootIssueId = parent.id;
    discoveredAt = parent.discoveredAt || discoveredAt;
    discoveredAtText = parent.discoveredAtText || parent.submissionCreatedAtText || discoveredAtText;
  }

  return {
    discoveredAt,
    discoveredAtText,
    rootIssueId,
    discoveredMillis: getIssueDiscoveredMillis({
      discoveredAt,
      discoveredAtText,
      submissionCreatedAtText: discoveredAtText
    })
  };
}

export function findRelatedUnresolvedIssues(allIssues, currentIssue) {
  if (!currentIssue) return [];

  return allIssues
    .filter((issue) => {
      if (issue.id === currentIssue.id) return false;
      if (issue.status === "done") return false;
      if (issue.questionId !== currentIssue.questionId) return false;
      return issue.khuVuc === currentIssue.khuVuc;
    })
    .sort((a, b) => {
      const timeA = getIssueDiscoveredMillis(a) || 0;
      const timeB = getIssueDiscoveredMillis(b) || 0;
      return timeB - timeA;
    });
}

export function formatDurationVi(ms) {
  if (ms == null || ms < 0) return "-";

  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);

  if (days > 0) return t("remediation.duration.daysHours", { days, hours });
  if (hours > 0) return t("remediation.duration.hoursMinutes", { hours, minutes });
  if (minutes > 0) return t("remediation.duration.minutes", { minutes });
  return t("remediation.duration.under1Min");
}

export function getIssueDurationLabel(status) {
  return status === "done" ? t("remediation.duration.done") : t("remediation.duration.open");
}

export function getIssueElapsedMs(issue, issuesById = new Map(), nowMs = Date.now()) {
  const discovery = getEffectiveDiscovery(issue, issuesById);
  if (!discovery.discoveredMillis) return null;

  if (issue.status === "done") {
    if (issue.resolutionDurationMs != null) return issue.resolutionDurationMs;
    const completedMs = timestampToMillis(issue.completedAt);
    if (completedMs) return completedMs - discovery.discoveredMillis;
  }

  return nowMs - discovery.discoveredMillis;
}

export function buildStatusFilterOptions(selectedValue = "ALL") {
  const options = [{ value: "ALL", label: t("common.allStatuses") }];

  Object.values(REMEDIATION_STATUSES).forEach((status) => {
    options.push({ value: status.value, label: t(`remediation.status.${status.value}`) });
  });

  return options
    .map((option) => {
      const selected = option.value === selectedValue ? "selected" : "";
      return `<option value="${option.value}" ${selected}>${option.label}</option>`;
    })
    .join("");
}
