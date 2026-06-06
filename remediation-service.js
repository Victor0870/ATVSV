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
  return REMEDIATION_STATUSES[status] || REMEDIATION_STATUSES.open;
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
    updatedBy: ""
  };
}

export function buildStatusFilterOptions(selectedValue = "ALL") {
  const options = [{ value: "ALL", label: "Tất cả trạng thái" }];

  Object.values(REMEDIATION_STATUSES).forEach((status) => {
    options.push({ value: status.value, label: status.label });
  });

  return options
    .map((option) => {
      const selected = option.value === selectedValue ? "selected" : "";
      return `<option value="${option.value}" ${selected}>${option.label}</option>`;
    })
    .join("");
}
