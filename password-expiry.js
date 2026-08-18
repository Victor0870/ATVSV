import { t, onLanguageChange } from "./i18n.js?v=20260818";

export const PASSWORD_CYCLE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let accountCreatedAt = null;
let languageBound = false;
let refreshTimer = null;

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveAccountCreatedAt(profile, firebaseUser) {
  return (
    toDate(profile?.createdAt) ||
    toDate(firebaseUser?.metadata?.creationTime) ||
    null
  );
}

export function getPasswordExpiryState(createdAt = accountCreatedAt, now = Date.now()) {
  const created = toDate(createdAt);
  if (!created) {
    return { remainingDays: null, usedDays: 0, percent: 0 };
  }

  const elapsedDays = Math.floor(Math.max(0, now - created.getTime()) / MS_PER_DAY);
  const usedDays = elapsedDays % PASSWORD_CYCLE_DAYS;
  const remainingDays = PASSWORD_CYCLE_DAYS - usedDays;
  const percent = Math.round((remainingDays / PASSWORD_CYCLE_DAYS) * 100);

  return { remainingDays, usedDays, percent };
}

function renderPasswordExpiryWidgets() {
  const state = getPasswordExpiryState();
  const remainText =
    state.remainingDays == null
      ? t("passwordExpiry.unknown")
      : t("passwordExpiry.remainDays", { n: state.remainingDays });

  document.querySelectorAll("[data-password-expiry]").forEach((root) => {
    const remainEl = root.querySelector("[data-password-expiry-remain]");
    const fillEl = root.querySelector("[data-password-expiry-fill]");
    if (remainEl) remainEl.textContent = remainText;
    if (fillEl) fillEl.style.width = `${state.percent}%`;
    root.classList.toggle(
      "is-warning",
      state.remainingDays != null && state.remainingDays <= 7
    );
  });
}

export function bindPasswordExpiry(profile, firebaseUser) {
  accountCreatedAt = resolveAccountCreatedAt(profile, firebaseUser);

  if (!languageBound) {
    languageBound = true;
    onLanguageChange(() => renderPasswordExpiryWidgets());
  }

  if (!refreshTimer) {
    refreshTimer = window.setInterval(renderPasswordExpiryWidgets, 60 * 60 * 1000);
  }

  renderPasswordExpiryWidgets();
}
