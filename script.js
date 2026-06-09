import {
  auth,
  db,
  storage,
  authPersistenceReady,
  initAppCheck,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  deleteUser,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  ref,
  uploadBytes,
  deleteObject
} from "./firebase-config.js";
import { fetchChecklistItems, fetchChecklistCategories, groupChecklistForArea } from "./checklist-service.js";
import {
  FACTORY_AREA,
  ALL_BRANCHES_AREA,
  fetchBranches,
  getActiveBranchNames,
  isValidUserArea,
  buildRegistrationBranchOptions
} from "./areas-service.js";
import { buildIssueId, buildRemediationIssuePayload } from "./remediation-service.js";
import { initI18n, t, onLanguageChange, applyI18n } from "./i18n.js?v=20250620";

const USER_ROLES_CAN_VIEW_REPORT = ["admin", "manager"];
const USER_ROLES_CAN_MANAGE_REMEDIATION = ["admin", "manager"];

function isAdminRole(role) {
  return String(role || "").trim().toLowerCase() === "admin";
}

let currentFirebaseUser = null;
let currentUserProfile = null;
let cachedBranches = [];
let renderedQuestions = [];
let tempImagesByQuestion = {};
let isSubmitting = false;
let isHandlingRegistration = false;
let toastTimer = null;

document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
  initI18n();
  await initAppCheck();
  bindEvents();

  await authPersistenceReady;
  await loadRegistrationBranches();
  observeAuthState();

  onLanguageChange(async () => {
    document.querySelectorAll("[data-original-text]").forEach((el) => {
      delete el.dataset.originalText;
    });
    applyI18n();
    setupRegistrationAreaSelect(cachedBranches);
    if (currentUserProfile && currentFirebaseUser) {
      await showChecklistScreen(currentUserProfile, currentFirebaseUser);
    } else {
      showLoginScreen();
    }
  });
}

function bindEvents() {
  document.getElementById("showLoginTabBtn")?.addEventListener("click", () => showAuthTab("login"));
  document.getElementById("showRegisterTabBtn")?.addEventListener("click", () => showAuthTab("register"));

  document.getElementById("loginForm")?.addEventListener("submit", handleLogin);
  document.getElementById("registerForm")?.addEventListener("submit", handleRegister);
  document.getElementById("registerAreaTypeInput")?.addEventListener("change", handleRegisterAreaTypeChange);
  document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);
  document.getElementById("togglePasswordBtn")?.addEventListener("click", togglePasswordVisibility);
  document.getElementById("checklistForm")?.addEventListener("submit", submitChecklist);

  const questionsContainer = document.getElementById("questionsContainer");
  questionsContainer?.addEventListener("change", handleQuestionContainerChange);
  questionsContainer?.addEventListener("click", handleQuestionContainerClick);

  window.addEventListener("beforeunload", revokeAllPreviewUrls);
}
function showAuthTab(tabName) {
  const loginBtn = document.getElementById("showLoginTabBtn");
  const registerBtn = document.getElementById("showRegisterTabBtn");
  const loginPanel = document.getElementById("loginPanel");
  const registerPanel = document.getElementById("registerPanel");

  const isRegister = tabName === "register";

  loginBtn?.classList.toggle("active", !isRegister);
  registerBtn?.classList.toggle("active", isRegister);

  loginPanel?.classList.toggle("active", !isRegister);
  registerPanel?.classList.toggle("active", isRegister);

  /* Thêm dòng này để chắc chắn panel bị ẩn/hiện đúng */
  loginPanel?.classList.toggle("hidden", isRegister);
  registerPanel?.classList.toggle("hidden", !isRegister);

  if (isRegister) {
    loadRegistrationBranches();
  }
}

function observeAuthState() {
  showPageLoader(true, t("common.checkingSession"));

  onAuthStateChanged(auth, async (user) => {
    if (isHandlingRegistration) {
      return;
    }

    try {
      if (!user) {
        currentFirebaseUser = null;
        currentUserProfile = null;
        clearChecklistState();
        showLoginScreen();
        return;
      }

      currentFirebaseUser = user;
      cachedBranches = (await fetchBranches()).branches;
      const profile = await loadCurrentUserProfile(user.uid);
      ensureAuthorizedAccess(profile, cachedBranches);

      currentUserProfile = profile;
      await showChecklistScreen(profile, user);
    } catch (error) {
      console.error(error);
      const message = error.message || t("auth.loadProfileFailed");

      if (shouldSignOutOnAccessError(message)) {
        await safeSignOut();
        showLoginScreen();
      } else if (currentFirebaseUser) {
        showRetryScreen(message);
      } else {
        showLoginScreen();
      }

      showToast(message, "error");
    } finally {
      showPageLoader(false);
    }
  });
}

async function handleLogin(event) {
  event.preventDefault();

  const email = document.getElementById("emailInput").value.trim();
  const password = document.getElementById("passwordInput").value;
  const loginBtn = document.getElementById("loginBtn");

  if (!email || !password) {
    showToast(t("auth.fillEmailPassword"), "error");
    return;
  }

  setButtonLoading(loginBtn, true, t("auth.loggingIn"));

  try {
    await signInWithEmailAndPassword(auth, email, password);
    document.getElementById("passwordInput").value = "";
    showToast(t("auth.loginSuccess"), "success");
  } catch (error) {
    console.error(error);
    showToast(getFirebaseErrorMessage(error), "error");
  } finally {
    setButtonLoading(loginBtn, false);
  }
}

async function handleRegister(event) {
  event.preventDefault();

  const registerBtn = document.getElementById("registerBtn");

  const email = document.getElementById("registerEmailInput").value.trim().toLowerCase();
  const password = document.getElementById("registerPasswordInput").value;
  const confirmPassword = document.getElementById("registerConfirmPasswordInput").value;
  const taiKhoan = document.getElementById("registerTaiKhoanInput").value.trim();
  const hoTen = document.getElementById("registerHoTenInput").value.trim();
  const khuVuc = getRegistrationKhuVuc();

  const validationMessage = validateRegisterForm({
    email,
    password,
    confirmPassword,
    taiKhoan,
    hoTen,
    khuVuc
  }, cachedBranches);

  if (validationMessage) {
    showToast(validationMessage, "error");
    return;
  }

  let createdAuthUser = null;

  setButtonLoading(registerBtn, true, t("auth.registering"));
  showPageLoader(true, t("auth.creatingAccount"));
  isHandlingRegistration = true;

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    createdAuthUser = credential.user;

    await setDoc(doc(db, "users", createdAuthUser.uid), {
      uid: createdAuthUser.uid,
      email,
      taiKhoan,
      hoTen,
      khuVuc,
      role: "user",
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    document.getElementById("registerForm").reset();
    handleRegisterAreaTypeChange();

    await signOut(auth);

    currentFirebaseUser = null;
    currentUserProfile = null;
    showLoginScreen(email);

    showToast(t("auth.registerSuccess"), "success");
  } catch (error) {
    console.error(error);

    // Nếu tạo Auth thành công nhưng lưu Firestore lỗi, xóa user Auth để tránh tài khoản mồ côi
    if (createdAuthUser) {
      try {
        await deleteUser(createdAuthUser);
      } catch (deleteError) {
        console.warn("Không thể xóa user Auth sau khi đăng ký lỗi:", deleteError);
      }
    }

    showToast(getRegisterErrorMessage(error), "error");
  } finally {
    isHandlingRegistration = false;
    setButtonLoading(registerBtn, false);
    showPageLoader(false);
  }
}

function validateRegisterForm({ email, password, confirmPassword, taiKhoan, hoTen, khuVuc }, branches = []) {
  if (!email || !password || !confirmPassword || !taiKhoan || !hoTen || !khuVuc) {
    return t("auth.fillRegisterInfo");
  }

  if (password.length < 6) {
    return t("auth.passwordMin6");
  }

  if (password !== confirmPassword) {
    return t("auth.passwordMismatch");
  }

  if (!isValidUserArea(khuVuc, branches)) {
    return t("auth.invalidArea");
  }

  return "";
}

async function loadRegistrationBranches() {
  try {
    const { branches } = await fetchBranches();
    cachedBranches = branches;
    setupRegistrationAreaSelect(branches);
  } catch (error) {
    console.warn("Không thể tải danh sách chi nhánh:", error);
  }
}

function setupRegistrationAreaSelect(branches = []) {
  const branchSelect = document.getElementById("registerBranchInput");
  if (!branchSelect) return;

  const activeOptions = buildRegistrationBranchOptions(branches);
  branchSelect.innerHTML = `<option value="">${t("auth.placeholder.selectBranch")}</option>${activeOptions}`;
}

function handleRegisterAreaTypeChange() {
  const areaType = document.getElementById("registerAreaTypeInput")?.value || "";
  const branchGroup = document.getElementById("registerBranchGroup");
  const branchSelect = document.getElementById("registerBranchInput");

  const isBranch = areaType === ALL_BRANCHES_AREA;
  branchGroup?.classList.toggle("hidden", !isBranch);

  if (branchSelect) {
    branchSelect.required = isBranch;
    if (!isBranch) {
      branchSelect.value = "";
    }
  }
}

function getRegistrationKhuVuc() {
  const areaType = document.getElementById("registerAreaTypeInput")?.value || "";
  if (areaType === FACTORY_AREA) {
    return FACTORY_AREA;
  }

  if (areaType === ALL_BRANCHES_AREA) {
    return document.getElementById("registerBranchInput")?.value.trim() || "";
  }

  return "";
}

async function handleLogout() {
  try {
    clearChecklistState();
    await signOut(auth);
    showToast(t("auth.loggedOut"), "info");
  } catch (error) {
    console.error(error);
    showToast(t("common.logoutFailed"), "error");
  }
}

function togglePasswordVisibility() {
  const input = document.getElementById("passwordInput");
  const btn = document.getElementById("togglePasswordBtn");

  if (input.type === "password") {
    input.type = "text";
    btn.textContent = t("auth.hidePassword");
  } else {
    input.type = "password";
    btn.textContent = t("auth.showPassword");
  }
}

async function safeSignOut() {
  try {
    await signOut(auth);
  } catch (error) {
    console.warn("safeSignOut lỗi:", error);
  }
}

async function loadCurrentUserProfile(uid) {
  const docRef = doc(db, "users", uid);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    throw new Error(t("auth.profileNotFound"));
  }

  const profile = docSnap.data();

  return {
    uid,
    email: profile.email || "",
    taiKhoan: profile.taiKhoan || "",
    hoTen: profile.hoTen || "",
    khuVuc: profile.khuVuc || "",
    role: profile.role || "user",
    status: profile.status || "pending"
  };
}

function ensureAuthorizedAccess(profile, branches = cachedBranches) {
  if (!profile) {
    throw new Error(t("auth.invalidProfile"));
  }

  const role = String(profile.role || "").trim().toLowerCase();
  const isPrivileged = role === "admin" || role === "manager";
  let khuVuc = String(profile.khuVuc || "").trim();

  if (!khuVuc && isPrivileged) {
    khuVuc = FACTORY_AREA;
  }

  profile.khuVuc = khuVuc;

  const status = profile.status === "inactive" ? "pending" : profile.status;

  if (status === "pending") {
    throw new Error(t("auth.pendingApproval"));
  }

  if (status === "locked") {
    throw new Error(t("auth.accountLocked"));
  }

  if (status !== "active") {
    throw new Error(t("auth.notActivated"));
  }

  if (!isValidUserArea(khuVuc, branches)) {
    if (isPrivileged) {
      profile.khuVuc = FACTORY_AREA;
      return;
    }

    throw new Error(t("auth.invalidAccountArea"));
  }
}

function shouldSignOutOnAccessError(message) {
  const normalized = String(message || "").toLowerCase();

  return [
    "chờ quản trị",
    "pending admin approval",
    "pending approval",
    "bị khóa",
    "has been locked",
    "locked",
    "chưa được kích hoạt",
    "not activated",
    "không tìm thấy hồ sơ",
    "profile not found",
    "khu vực của tài khoản không hợp lệ",
    "invalid account area",
    "hồ sơ người dùng không hợp lệ",
    "invalid user profile"
  ].some((phrase) => normalized.includes(phrase));
}

function showRetryScreen(message) {
  document.getElementById("authShell")?.classList.remove("hidden");
  document.getElementById("loginScreen")?.classList.remove("hidden");
  document.getElementById("checklistScreen")?.classList.add("hidden");
  showAuthTab("login");

  const subtitle = document.querySelector("#loginScreen .auth-subtitle");
  if (subtitle) {
    subtitle.textContent = message || t("auth.loadDataFailed");
  }
}

function showLoginScreen(prefillEmail = "") {
  document.getElementById("authShell")?.classList.remove("hidden");
  document.getElementById("loginScreen")?.classList.remove("hidden");
  document.getElementById("checklistScreen")?.classList.add("hidden");

  const subtitle = document.querySelector("#loginScreen .auth-subtitle");
  if (subtitle) {
    subtitle.textContent = t("common.company");
  }

  document.getElementById("loginForm")?.reset();

  const passwordInput = document.getElementById("passwordInput");
  const togglePasswordBtn = document.getElementById("togglePasswordBtn");
  const emailInput = document.getElementById("emailInput");

  if (passwordInput) {
    passwordInput.type = "password";
  }

  if (togglePasswordBtn) {
    togglePasswordBtn.textContent = t("auth.showPassword");
  }

  if (emailInput && prefillEmail) {
    emailInput.value = prefillEmail;
  }

  showAuthTab("login");
}
async function showChecklistScreen(profile, firebaseUser) {
  document.getElementById("authShell")?.classList.add("hidden");
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("checklistScreen").classList.remove("hidden");

  document.getElementById("displayHoTen").textContent = profile.hoTen || "-";
  document.getElementById("displayEmail").textContent = firebaseUser.email || profile.email || "-";
  document.getElementById("displayTaiKhoan").textContent = profile.taiKhoan || "-";
  document.getElementById("displayKhuVuc").textContent = profile.khuVuc || "-";

  updateAppSidebar(profile, firebaseUser);

  await renderQuestions(profile.khuVuc);
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

function updateAppSidebar(profile, firebaseUser) {
  const reportLink = document.getElementById("reportLink");
  const remediationLink = document.getElementById("remediationLink");
  const adminLink = document.getElementById("adminLink");
  const manageNavLabel = document.getElementById("appManageNavLabel");
  const role = String(profile.role || "").trim().toLowerCase();
  const canManageReports = USER_ROLES_CAN_VIEW_REPORT.includes(role);
  const isAdmin = isAdminRole(profile.role);

  reportLink?.classList.toggle("hidden", !canManageReports);
  remediationLink?.classList.toggle("hidden", !canManageReports);
  adminLink?.classList.toggle("hidden", !isAdmin);
  manageNavLabel?.classList.toggle("hidden", !canManageReports && !isAdmin);

  document.getElementById("sidebarUserName").textContent = profile.hoTen || "-";
  document.getElementById("sidebarUserEmail").textContent = firebaseUser.email || profile.email || "-";
  document.getElementById("appUserInitials").textContent = getUserInitials(profile.hoTen);
}

async function renderQuestions(area) {
  const container = document.getElementById("questionsContainer");
  if (!container) return;

  showPageLoader(true, t("checklist.loading"));

  try {
    const [{ items, source }, { categories }, { branches }] = await Promise.all([
      fetchChecklistItems(),
      fetchChecklistCategories(),
      fetchBranches()
    ]);
    cachedBranches = branches;
    const branchNames = getActiveBranchNames(branches);
    const groups = groupChecklistForArea(items, area, categories, branchNames);

    if (!groups.length) {
      container.innerHTML = `<div class="empty-card">${escapeHtml(t("checklist.noQuestions"))}</div>`;
      showToast(t("checklist.noQuestionsFound"), "error");
      return;
    }

    if (source === "fallback") {
      showToast(t("checklist.fallbackWarning"), "info");
    }

    clearChecklistState();
    renderedQuestions = [];

    let html = "";
    let questionIndex = 0;

    groups.forEach((group) => {
      html += `
        <section class="category-card">
          <div class="category-header">${escapeHtml(group.category)}</div>
          <div class="question-list">
      `;

      group.questions.forEach((question) => {
        questionIndex += 1;
        const questionId = question.id || `q${questionIndex}`;

        renderedQuestions.push({
          id: questionId,
          category: group.category,
          question: question.text
        });

        html += `
          <article class="question-item" id="item_${questionId}">
            <div class="question-text">${questionIndex}. ${escapeHtml(question.text)}</div>

            <div class="options-row">
              <label class="option-chip ok">
                <input type="radio" name="answer_${questionId}" value="OK" data-question-id="${questionId}">
                <span>${t("checklist.answer.ok")}</span>
              </label>

              <label class="option-chip ng">
                <input type="radio" name="answer_${questionId}" value="NG" data-question-id="${questionId}">
                <span>${t("checklist.answer.ng")}</span>
              </label>

              <label class="option-chip na">
                <input type="radio" name="answer_${questionId}" value="N/A" data-question-id="${questionId}">
                <span>${t("checklist.answer.na")}</span>
              </label>
            </div>

            <div class="extra-fields hidden" id="extra_${questionId}">
              <div class="form-group">
                <label for="note_${questionId}">${t("checklist.errorNote")}</label>
                <textarea id="note_${questionId}" placeholder="${escapeHtml(t("checklist.errorNotePlaceholder"))}"></textarea>
                <div class="helper-text">${t("checklist.ngNoteRequired")}</div>
              </div>

              <div class="image-upload-box">
                <label>${t("checklist.evidenceImages")}</label>
                <div class="image-upload-actions">
                  <input
                    type="file"
                    class="image-input"
                    id="imageInput_${questionId}"
                    data-question-id="${questionId}"
                    accept="image/*"
                    capture="environment"
                    multiple
                  >
                  <div class="helper-text">
                    ${t("checklist.imageResizeDetail")}
                  </div>
                </div>
                <div id="preview_${questionId}" class="image-preview-grid"></div>
              </div>
            </div>

            <div class="error-text hidden" id="error_${questionId}"></div>
          </article>
        `;
      });

      html += `
          </div>
        </section>
      `;
    });

    container.innerHTML = html;
  } catch (error) {
    console.error(error);
    container.innerHTML = `<div class="empty-card">${escapeHtml(t("checklist.loadFailed"))}</div>`;
    showToast(error.message || t("checklist.loadFailed"), "error");
  } finally {
    showPageLoader(false);
  }
}

function handleQuestionContainerChange(event) {
  const target = event.target;

  if (target.matches('input[type="radio"]')) {
    handleAnswerChange(target);
    return;
  }

  if (target.matches(".image-input")) {
    handleImageSelection(target);
  }
}

function handleQuestionContainerClick(event) {
  const removeBtn = event.target.closest(".preview-remove-btn");
  if (removeBtn) {
    const questionId = removeBtn.dataset.questionId;
    const imageIndex = Number(removeBtn.dataset.imageIndex);
    removeSelectedImage(questionId, imageIndex);
  }
}

function handleAnswerChange(radioInput) {
  const questionId = radioInput.dataset.questionId;
  const selectedValue = radioInput.value;

  const extraFields = document.getElementById(`extra_${questionId}`);
  const errorBox = document.getElementById(`error_${questionId}`);
  const questionItem = document.getElementById(`item_${questionId}`);

  questionItem.classList.remove("invalid");
  errorBox.textContent = "";
  errorBox.classList.add("hidden");

  if (selectedValue === "NG") {
    extraFields.classList.remove("hidden");
  } else {
    extraFields.classList.add("hidden");
    clearQuestionSupplementalData(questionId);
  }
}

async function handleImageSelection(inputElement) {
  const questionId = inputElement.dataset.questionId;
  const selectedFiles = Array.from(inputElement.files || []);
  inputElement.value = "";

  if (!selectedFiles.length) return;

  if (!tempImagesByQuestion[questionId]) {
    tempImagesByQuestion[questionId] = [];
  }

  const currentImages = tempImagesByQuestion[questionId];
  const remainingSlots = 2 - currentImages.length;

  if (remainingSlots <= 0) {
    showToast(t("checklist.max2Images"), "error");
    return;
  }

  const filesToProcess = selectedFiles.slice(0, remainingSlots);

  if (selectedFiles.length > remainingSlots) {
    showToast(t("checklist.onlyMoreImages", { count: remainingSlots }), "info");
  }

  try {
    showPageLoader(true, t("checklist.processingImages"));
    for (const file of filesToProcess) {
      const resized = await resizeImageFile(file);
      tempImagesByQuestion[questionId].push(resized);
    }
    previewSelectedImages(questionId);
    showToast(t("checklist.imageAdded"), "success");
  } catch (error) {
    console.error(error);
    showToast(error.message || t("checklist.imageProcessFailed"), "error");
  } finally {
    showPageLoader(false);
  }
}

function previewSelectedImages(questionId) {
  const previewContainer = document.getElementById(`preview_${questionId}`);
  if (!previewContainer) return;

  const images = tempImagesByQuestion[questionId] || [];

  if (!images.length) {
    previewContainer.innerHTML = "";
    return;
  }

  previewContainer.innerHTML = images
    .map((image, index) => {
      return `
        <div class="image-preview-card">
          <img src="${image.previewUrl}" alt="${escapeHtml(t("common.imageEvidence"))} ${index + 1}">
          <div class="image-preview-meta">
            <div><strong>${t("checklist.previewFileName")}</strong> ${escapeHtml(image.name)}</div>
            <div><strong>${t("checklist.previewOriginalSize")}</strong> ${formatBytes(image.originalSize)}</div>
            <div><strong>${t("checklist.previewCompressedSize")}</strong> ${formatBytes(image.resizedSize)}</div>
            <div><strong>${t("checklist.previewDimensions")}</strong> ${image.width} x ${image.height}px</div>
          </div>
          <button
            type="button"
            class="preview-remove-btn"
            data-question-id="${questionId}"
            data-image-index="${index}"
          >
            ${t("checklist.removeImage")}
          </button>
        </div>
      `;
    })
    .join("");
}

function removeSelectedImage(questionId, imageIndex) {
  if (!tempImagesByQuestion[questionId]) return;

  const removed = tempImagesByQuestion[questionId][imageIndex];
  revokePreviewUrl(removed);

  tempImagesByQuestion[questionId].splice(imageIndex, 1);
  previewSelectedImages(questionId);
}

function clearQuestionSupplementalData(questionId) {
  revokeQuestionPreviewUrls(questionId);

  const noteField = document.getElementById(`note_${questionId}`);
  const previewContainer = document.getElementById(`preview_${questionId}`);
  const errorBox = document.getElementById(`error_${questionId}`);
  const questionItem = document.getElementById(`item_${questionId}`);
  const imageInput = document.getElementById(`imageInput_${questionId}`);

  if (noteField) noteField.value = "";
  if (previewContainer) previewContainer.innerHTML = "";
  if (errorBox) {
    errorBox.textContent = "";
    errorBox.classList.add("hidden");
  }
  if (questionItem) {
    questionItem.classList.remove("invalid");
  }
  if (imageInput) {
    imageInput.value = "";
  }

  tempImagesByQuestion[questionId] = [];
}

function clearChecklistState() {
  revokeAllPreviewUrls();
  renderedQuestions = [];
  tempImagesByQuestion = {};
  isSubmitting = false;
}

function revokePreviewUrl(imageItem) {
  if (imageItem && imageItem.previewUrl && imageItem.previewUrl.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(imageItem.previewUrl);
    } catch (error) {
      console.warn("Không thể giải phóng preview URL:", error);
    }
  }
}

function revokeQuestionPreviewUrls(questionId) {
  const images = tempImagesByQuestion[questionId] || [];
  images.forEach(revokePreviewUrl);
}

function revokeAllPreviewUrls() {
  Object.keys(tempImagesByQuestion).forEach((questionId) => {
    revokeQuestionPreviewUrls(questionId);
  });
}

async function resizeImageFile(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error(t("checklist.fileNotImage", { name: file.name }));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error(t("checklist.fileReadFailed", { name: file.name })));

    reader.onload = () => {
      const img = new Image();

      img.onerror = () => reject(new Error(t("checklist.fileProcessFailed", { name: file.name })));

      img.onload = () => {
        const maxWidth = 1280;
        const maxHeight = 1280;

        let { width, height } = img;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error(t("checklist.canvasNotSupported")));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error(t("checklist.compressFailed", { name: file.name })));
              return;
            }

            const safeName = file.name.replace(/\.[^/.]+$/, "");
            const finalName = `${safeName}.jpg`;
            const compressedFile = new File([blob], finalName, { type: "image/jpeg" });
            const previewUrl = URL.createObjectURL(blob);

            resolve({
              originalFile: file,
              file: compressedFile,
              name: finalName,
              originalSize: file.size,
              resizedSize: compressedFile.size,
              width,
              height,
              previewUrl
            });
          },
          "image/jpeg",
          0.78
        );
      };

      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

function validateChecklist() {
  if (!currentFirebaseUser || !currentUserProfile || currentUserProfile.status !== "active") {
    showToast(t("checklist.invalidSession"), "error");
    return false;
  }

  for (const item of renderedQuestions) {
    const selected = document.querySelector(`input[name="answer_${item.id}"]:checked`);
    const noteField = document.getElementById(`note_${item.id}`);
    const errorBox = document.getElementById(`error_${item.id}`);
    const questionItem = document.getElementById(`item_${item.id}`);

    questionItem.classList.remove("invalid");
    errorBox.classList.add("hidden");
    errorBox.textContent = "";

    if (!selected) {
      questionItem.classList.add("invalid");
      errorBox.textContent = t("checklist.selectAnswer");
      errorBox.classList.remove("hidden");
      questionItem.scrollIntoView({ behavior: "smooth", block: "center" });
      showToast(t("checklist.selectAllAnswers"), "error");
      return false;
    }

    if (selected.value === "NG" && !noteField.value.trim()) {
      questionItem.classList.add("invalid");
      errorBox.textContent = t("checklist.ngNoteRequiredInline");
      errorBox.classList.remove("hidden");
      noteField.focus();
      questionItem.scrollIntoView({ behavior: "smooth", block: "center" });
      showToast(t("checklist.enterNgNote"), "error");
      return false;
    }

    const questionImages = tempImagesByQuestion[item.id] || [];
    if (questionImages.length > 2) {
      questionItem.classList.add("invalid");
      errorBox.textContent = t("checklist.max2ImagesError");
      errorBox.classList.remove("hidden");
      questionItem.scrollIntoView({ behavior: "smooth", block: "center" });
      showToast(t("checklist.tooManyImages"), "error");
      return false;
    }
  }

  return true;
}

function collectChecklistData() {
  const answers = renderedQuestions.map((item) => {
    const selected = document.querySelector(`input[name="answer_${item.id}"]:checked`);
    const noteField = document.getElementById(`note_${item.id}`);
    const images = tempImagesByQuestion[item.id] || [];

    return {
      questionId: item.id,
      category: item.category,
      question: item.question,
      result: selected ? selected.value : "",
      note: selected && selected.value === "NG" ? noteField.value.trim() : "",
      imagesTemp: selected && selected.value === "NG" ? images : []
    };
  });

  const summary = answers.reduce(
    (acc, item) => {
      if (item.result === "OK") acc.okCount += 1;
      if (item.result === "NG") acc.ngCount += 1;
      if (item.result === "N/A") acc.naCount += 1;
      return acc;
    },
    {
      totalQuestions: answers.length,
      okCount: 0,
      ngCount: 0,
      naCount: 0
    }
  );

  return { answers, summary };
}

function generateSubmissionId() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");

  const timestamp =
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    "-" +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());

  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `PHIEU-${timestamp}-${randomPart}`;
}

function getCurrentDateTimeText() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");

  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(
    now.getMinutes()
  )}:${pad(now.getSeconds())}`;
}

async function uploadQuestionImages(uid, submissionId, answer) {
  const uploadedImages = [];

  for (let index = 0; index < answer.imagesTemp.length; index += 1) {
    const image = answer.imagesTemp[index];
    const timestamp = Date.now();
    const filePath = `checksheet-images/${uid}/${submissionId}/${answer.questionId}_${timestamp}_${index + 1}.jpg`;

    const storageRef = ref(storage, filePath);

    await uploadBytes(storageRef, image.file, {
      contentType: "image/jpeg"
    });

    uploadedImages.push({
      path: filePath,
      name: image.name,
      size: image.resizedSize
    });
  }

  return uploadedImages;
}

async function submitChecklist(event) {
  event.preventDefault();

  if (isSubmitting) return;
  if (!validateChecklist()) return;

  const submitBtn = document.getElementById("submitBtn");
  isSubmitting = true;
  setButtonLoading(submitBtn, true, t("checklist.submitting"));
  showPageLoader(true, t("checklist.uploadingSaving"));

  const uploadedStoragePaths = [];

  try {
    const submissionId = generateSubmissionId();
    const { answers, summary } = collectChecklistData();

    const finalAnswers = [];

    for (const answer of answers) {
      let uploadedImages = [];

      if (answer.result === "NG" && answer.imagesTemp.length > 0) {
        uploadedImages = await uploadQuestionImages(currentFirebaseUser.uid, submissionId, answer);
        uploadedImages.forEach((img) => uploadedStoragePaths.push(img.path));
      }

      finalAnswers.push({
        questionId: answer.questionId,
        category: answer.category,
        question: answer.question,
        result: answer.result,
        note: answer.note,
        images: uploadedImages
      });
    }

    const submissionDoc = {
      submissionId,
      uid: currentFirebaseUser.uid,
      email: currentFirebaseUser.email || currentUserProfile.email || "",
      taiKhoan: currentUserProfile.taiKhoan,
      hoTen: currentUserProfile.hoTen,
      khuVuc: currentUserProfile.khuVuc,
      createdAt: serverTimestamp(),
      createdAtText: getCurrentDateTimeText(),
      summary,
      answers: finalAnswers
    };

    await setDoc(doc(db, "submissions", submissionId), submissionDoc);

    const ngAnswers = finalAnswers.filter((answer) => answer.result === "NG");
    if (ngAnswers.length) {
      await Promise.all(
        ngAnswers.map((answer) => {
          const issueId = buildIssueId(submissionId, answer.questionId);
          return setDoc(doc(db, "remediationIssues", issueId), {
            ...buildRemediationIssuePayload(submissionDoc, answer),
            discoveredAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        })
      );
    }

    showToast(t("checklist.submitSuccess"), "success");
    resetChecklistForm();
  } catch (error) {
    console.error(error);

    if (uploadedStoragePaths.length) {
      await Promise.allSettled(
        uploadedStoragePaths.map((path) => {
          const fileRef = ref(storage, path);
          return deleteObject(fileRef);
        })
      );
    }

    showToast(error.message || t("checklist.submitFailed"), "error");
  } finally {
    isSubmitting = false;
    setButtonLoading(submitBtn, false);
    showPageLoader(false);
  }
}

function resetChecklistForm() {
  if (!currentUserProfile) return;
  renderQuestions(currentUserProfile.khuVuc);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showPageLoader(show, text = t("common.loading")) {
  const loader = document.getElementById("pageLoader");
  const loaderText = document.getElementById("pageLoaderText");

  if (!loader) return;

  if (loaderText) {
    loaderText.textContent = text;
  }

  if (show) {
    loader.classList.remove("hidden");
  } else {
    loader.classList.add("hidden");
  }
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

function getFirebaseErrorMessage(error) {
  const code = error?.code || "";

  switch (code) {
    case "auth/invalid-email":
      return t("auth.error.invalidEmail");
    case "auth/user-disabled":
      return t("auth.error.userDisabled");
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return t("auth.error.wrongPassword");
    case "auth/too-many-requests":
      return t("auth.error.tooManyRequests");
    case "auth/network-request-failed":
      return t("auth.error.network");
    default:
      return error?.message || t("auth.error.unknown");
  }
}

function getRegisterErrorMessage(error) {
  const code = error?.code || "";

  switch (code) {
    case "auth/email-already-in-use":
      return t("auth.error.emailExists");
    case "auth/invalid-email":
      return t("auth.error.invalidEmail");
    case "auth/weak-password":
      return t("auth.error.weakPassword");
    case "permission-denied":
    case "functions/permission-denied":
      return t("auth.error.permissionDenied");
    case "auth/network-request-failed":
    case "functions/unavailable":
    case "functions/not-found":
    case "functions/internal":
      return code.startsWith("functions/") ? t("security.functionNotDeployed") : t("auth.error.network");
    default:
      return error?.message || t("auth.error.registerFailed");
  }
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "-";
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);

  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}
