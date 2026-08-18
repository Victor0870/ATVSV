import {
  auth,
  authPersistenceReady,
  initAppCheck,
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword
} from "./firebase-config.js";
import { initI18n, t, onLanguageChange, applyI18n } from "./i18n.js?v=20260818b";

let toastTimer = null;
let currentFirebaseUser = null;

document.addEventListener("DOMContentLoaded", initChangePasswordPage);

async function initChangePasswordPage() {
  initI18n();
  await initAppCheck();

  document.getElementById("changePasswordForm")?.addEventListener("submit", handleChangePassword);

  onLanguageChange(() => {
    applyI18n();
    renderSignedInEmail();
  });

  await authPersistenceReady;
  observeAuth();
}

function observeAuth() {
  showPageLoader(true, t("common.checkingSession"));

  onAuthStateChanged(auth, (user) => {
    currentFirebaseUser = user || null;

    if (!user) {
      showGuestAccessDenied();
      showPageLoader(false);
      return;
    }

    showChangePasswordScreen();
    showPageLoader(false);
  });
}

function showGuestAccessDenied() {
  document.getElementById("changePasswordScreen")?.classList.add("hidden");
  document.getElementById("changePasswordGuestWrap")?.classList.remove("hidden");
}

function showChangePasswordScreen() {
  document.getElementById("changePasswordGuestWrap")?.classList.add("hidden");
  document.getElementById("changePasswordScreen")?.classList.remove("hidden");
  renderSignedInEmail();
}

function renderSignedInEmail() {
  const emailEl = document.getElementById("changePasswordEmail");
  if (!emailEl) return;
  emailEl.textContent = currentFirebaseUser?.email || "";
}

async function handleChangePassword(event) {
  event.preventDefault();

  const currentPassword = document.getElementById("currentPasswordInput")?.value || "";
  const newPassword = document.getElementById("newPasswordInput")?.value || "";
  const confirmPassword = document.getElementById("confirmNewPasswordInput")?.value || "";
  const submitBtn = document.getElementById("changePasswordBtn");

  if (!currentPassword || !newPassword || !confirmPassword) {
    showToast(t("changePassword.fillAll"), "error");
    return;
  }

  if (newPassword.length < 6) {
    showToast(t("auth.passwordMin6"), "error");
    return;
  }

  if (newPassword !== confirmPassword) {
    showToast(t("auth.passwordMismatch"), "error");
    return;
  }

  if (newPassword === currentPassword) {
    showToast(t("changePassword.sameAsOld"), "error");
    return;
  }

  if (!currentFirebaseUser?.email) {
    showToast(t("common.notLoggedIn"), "error");
    return;
  }

  setButtonLoading(submitBtn, true, t("changePassword.saving"));

  try {
    const credential = EmailAuthProvider.credential(currentFirebaseUser.email, currentPassword);
    await reauthenticateWithCredential(currentFirebaseUser, credential);
    await updatePassword(currentFirebaseUser, newPassword);

    document.getElementById("changePasswordForm")?.reset();
    showToast(t("changePassword.success"), "success");
    setTimeout(() => {
      window.location.href = "./index.html";
    }, 1200);
  } catch (error) {
    console.error(error);
    showToast(getChangePasswordErrorMessage(error), "error");
    setButtonLoading(submitBtn, false);
  }
}

function getChangePasswordErrorMessage(error) {
  const code = error?.code || "";

  switch (code) {
    case "auth/wrong-password":
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return t("changePassword.wrongCurrent");
    case "auth/weak-password":
      return t("auth.error.weakPassword");
    case "auth/requires-recent-login":
      return t("changePassword.wrongCurrent");
    case "auth/too-many-requests":
      return t("auth.error.tooManyRequests");
    case "auth/network-request-failed":
      return t("auth.error.network");
    default:
      return error?.message || t("auth.error.unknown");
  }
}

function showPageLoader(show, text = t("common.loading")) {
  const loader = document.getElementById("pageLoader");
  const loaderText = document.getElementById("pageLoaderText");
  if (loaderText && text) loaderText.textContent = text;
  loader?.classList.toggle("hidden", !show);
}

function setButtonLoading(button, isLoading, loadingText = t("common.loading")) {
  if (!button) return;
  if (!button.dataset.originalText) {
    button.dataset.originalText = button.textContent;
  }
  button.disabled = isLoading;
  button.textContent = isLoading ? loadingText : button.dataset.originalText;
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
