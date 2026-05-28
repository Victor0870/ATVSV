import {
  auth,
  db,
  storage,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "./firebase-config.js";

const AREAS = {
  PRODUCTION: "Sản xuất / Thử nghiệm / Phòng Lab",
  WAREHOUSE: "Kho vận / Chi nhánh"
};

const USER_ROLES_CAN_VIEW_REPORT = ["admin", "manager"];

let currentFirebaseUser = null;
let currentUserProfile = null;
let renderedQuestions = [];
let tempImagesByQuestion = {};
let isSubmitting = false;
let toastTimer = null;

document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
  bindEvents();

  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (error) {
    console.warn("Không thể thiết lập persistence:", error);
  }

  observeAuthState();
}

function bindEvents() {
  document.getElementById("loginForm").addEventListener("submit", handleLogin);
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);
  document.getElementById("togglePasswordBtn").addEventListener("click", togglePasswordVisibility);
  document.getElementById("checklistForm").addEventListener("submit", submitChecklist);

  const questionsContainer = document.getElementById("questionsContainer");
  questionsContainer.addEventListener("change", handleQuestionContainerChange);
  questionsContainer.addEventListener("click", handleQuestionContainerClick);
}

function observeAuthState() {
  showPageLoader(true, "Đang kiểm tra phiên đăng nhập...");

  onAuthStateChanged(auth, async (user) => {
    try {
      if (!user) {
        currentFirebaseUser = null;
        currentUserProfile = null;
        clearChecklistState();
        showLoginScreen();
        return;
      }

      currentFirebaseUser = user;
      const profile = await loadCurrentUserProfile(user.uid);
      ensureAuthorizedAccess(profile);

      currentUserProfile = profile;
      showChecklistScreen(profile, user);
    } catch (error) {
      console.error(error);
      await safeSignOut();
      showLoginScreen();
      showToast(error.message || "Không thể tải hồ sơ người dùng", "error");
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
    showToast("Vui lòng nhập đầy đủ email và mật khẩu", "error");
    return;
  }

  setButtonLoading(loginBtn, true, "Đang đăng nhập...");

  try {
    await signInWithEmailAndPassword(auth, email, password);
    document.getElementById("passwordInput").value = "";
    showToast("Đăng nhập thành công", "success");
  } catch (error) {
    console.error(error);
    showToast(getFirebaseErrorMessage(error), "error");
  } finally {
    setButtonLoading(loginBtn, false);
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    clearChecklistState();
    showToast("Đã đăng xuất", "info");
  } catch (error) {
    console.error(error);
    showToast("Không thể đăng xuất. Vui lòng thử lại.", "error");
  }
}

function togglePasswordVisibility() {
  const input = document.getElementById("passwordInput");
  const btn = document.getElementById("togglePasswordBtn");

  if (input.type === "password") {
    input.type = "text";
    btn.textContent = "Ẩn";
  } else {
    input.type = "password";
    btn.textContent = "Hiện";
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
    throw new Error("Không tìm thấy hồ sơ người dùng trong Firestore");
  }

  const profile = docSnap.data();

  return {
    uid,
    email: profile.email || "",
    taiKhoan: profile.taiKhoan || "",
    hoTen: profile.hoTen || "",
    khuVuc: profile.khuVuc || "",
    role: profile.role || "user",
    status: profile.status || "inactive"
  };
}

function ensureAuthorizedAccess(profile) {
  if (!profile) {
    throw new Error("Hồ sơ người dùng không hợp lệ");
  }

  if (profile.status !== "active") {
    throw new Error("Tài khoản của bạn đang ở trạng thái không hoạt động");
  }

  if (![AREAS.PRODUCTION, AREAS.WAREHOUSE].includes(profile.khuVuc)) {
    throw new Error("Khu vực của tài khoản không hợp lệ");
  }
}

function showLoginScreen() {
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("checklistScreen").classList.add("hidden");
  document.getElementById("loginForm").reset();
  document.getElementById("passwordInput").type = "password";
  document.getElementById("togglePasswordBtn").textContent = "Hiện";
}

function showChecklistScreen(profile, firebaseUser) {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("checklistScreen").classList.remove("hidden");

  document.getElementById("displayHoTen").textContent = profile.hoTen || "-";
  document.getElementById("displayEmail").textContent = firebaseUser.email || profile.email || "-";
  document.getElementById("displayTaiKhoan").textContent = profile.taiKhoan || "-";
  document.getElementById("displayKhuVuc").textContent = profile.khuVuc || "-";

  const reportLink = document.getElementById("reportLink");
  if (USER_ROLES_CAN_VIEW_REPORT.includes(profile.role)) {
    reportLink.classList.remove("hidden");
  } else {
    reportLink.classList.add("hidden");
  }

  renderQuestions(profile.khuVuc);
}

function buildQuestionConfig() {
  return [
    {
      category: "Quản lý an toàn và tình huống khẩn cấp",
      questions: [
        { text: "Người lao động có trang bị đủ dụng cụ bảo hộ lao động (PPE) không?", areas: "ALL" },
        { text: "Danh bạ liên lạc trong tình huống khẩn cấp có được hiển thị ở khu vực làm việc không?", areas: "ALL" },
        { text: "Có hộp cứu thương và được kiểm tra định kỳ không?", areas: "ALL" },
        { text: "Các nút bấm báo động có bị che chắn hay bị vỡ, biến dạng không?", areas: "ALL" },
        { text: "Lối thoát hiểm, cửa thoát hiểm có bị che chắn không?", areas: "ALL" }
      ]
    },
    {
      category: "Môi trường & 5S",
      questions: [
        { text: "Phân loại rác có thực hiện đúng theo quy định không?", areas: "ALL" },
        { text: "Khu vực làm việc có rác bẩn hay dầu rơi vãi không?", areas: "ALL" },
        { text: "Bóng chiếu sáng có hoạt động bình thường không?", areas: "ALL" }
      ]
    },
    {
      category: "An toàn Điện và PCCC",
      questions: [
        { text: "Thiết bị chữa cháy có ở đúng vị trí, áp suất vạch xanh không?", areas: "ALL" },
        { text: "Các ổ cắm điện có bị mòn, vỡ hay có dấu hiệu cháy không?", areas: "ALL" },
        { text: "Thiết bị tiêu thụ điện có được tắt đi sau khi sử dụng không?", areas: "ALL" },
        { text: "Có đảm bảo khoảng cách tối thiểu từ vật tư, hàng hóa đến các bảng điện không?", areas: "ALL" }
      ]
    },
    {
      category: "Thao tác với vật tư hàng hóa",
      questions: [
        {
          byArea: {
            [AREAS.WAREHOUSE]: "Hàng hóa được vận chuyển và sắp xếp đúng theo hướng dẫn vận hành của kho không?",
            [AREAS.PRODUCTION]: "Hàng hóa được vận chuyển và sắp xếp đúng theo hướng dẫn/SOP không?"
          }
        },
        { text: "Hàng hóa có chắn lối đi hay cửa thoát hiểm không?", areas: "ALL" },
        { text: "Hàng hóa, vật tư được xếp ngay ngắn và đúng theo layout không?", areas: "ALL" }
      ]
    },
    {
      category: "An toàn vận hành máy móc thiết bị",
      questions: [
        { text: "Thiết bị, máy móc có được kiểm tra định kỳ không?", areas: "ALL" },
        { text: "Máy móc, thiết bị có hiện tượng bất thường (rò dầu, âm thanh lạ, mùi khét...) không?", areas: "ALL" },
        { text: "Hệ thống thông gió có đầy đủ và hoạt động tốt không?", areas: [AREAS.PRODUCTION] }
      ]
    }
  ];
}

function getQuestionsByArea(area) {
  const source = buildQuestionConfig();
  const output = [];

  source.forEach((group) => {
    const questions = [];

    group.questions.forEach((item) => {
      if (item.byArea) {
        if (item.byArea[area]) {
          questions.push({
            category: group.category,
            text: item.byArea[area]
          });
        }
      } else if (item.areas === "ALL" || (Array.isArray(item.areas) && item.areas.includes(area))) {
        questions.push({
          category: group.category,
          text: item.text
        });
      }
    });

    if (questions.length > 0) {
      output.push({
        category: group.category,
        questions
      });
    }
  });

  return output;
}

function renderQuestions(area) {
  const container = document.getElementById("questionsContainer");
  const groups = getQuestionsByArea(area);

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
      const questionId = `q${questionIndex}`;

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
              <span>OK</span>
            </label>

            <label class="option-chip ng">
              <input type="radio" name="answer_${questionId}" value="NG" data-question-id="${questionId}">
              <span>NG</span>
            </label>

            <label class="option-chip na">
              <input type="radio" name="answer_${questionId}" value="N/A" data-question-id="${questionId}">
              <span>N/A</span>
            </label>
          </div>

          <div class="extra-fields hidden" id="extra_${questionId}">
            <div class="form-group">
              <label for="note_${questionId}">Mô tả lỗi phát hiện</label>
              <textarea id="note_${questionId}" placeholder="Mô tả lỗi phát hiện..."></textarea>
              <div class="helper-text">Bắt buộc nhập mô tả khi chọn NG.</div>
            </div>

            <div class="image-upload-box">
              <label>Ảnh minh chứng lỗi (tối đa 2 ảnh)</label>
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
                  Ảnh sẽ được tự động resize tối đa 1280px và nén JPEG trước khi upload.
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
    showToast("Mỗi câu lỗi chỉ được tối đa 2 ảnh", "error");
    return;
  }

  const filesToProcess = selectedFiles.slice(0, remainingSlots);

  if (selectedFiles.length > remainingSlots) {
    showToast(`Chỉ nhận thêm ${remainingSlots} ảnh cho câu này`, "info");
  }

  try {
    showPageLoader(true, "Đang xử lý ảnh...");
    for (const file of filesToProcess) {
      const resized = await resizeImageFile(file);
      tempImagesByQuestion[questionId].push(resized);
    }
    previewSelectedImages(questionId);
    showToast("Đã thêm ảnh minh chứng", "success");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Không thể xử lý ảnh", "error");
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
          <img src="${image.previewUrl}" alt="Ảnh minh chứng ${index + 1}">
          <div class="image-preview-meta">
            <div><strong>Tên file:</strong> ${escapeHtml(image.name)}</div>
            <div><strong>Kích thước gốc:</strong> ${formatBytes(image.originalSize)}</div>
            <div><strong>Sau nén:</strong> ${formatBytes(image.resizedSize)}</div>
            <div><strong>Kích thước ảnh:</strong> ${image.width} x ${image.height}px</div>
          </div>
          <button
            type="button"
            class="preview-remove-btn"
            data-question-id="${questionId}"
            data-image-index="${index}"
          >
            Xóa ảnh này
          </button>
        </div>
      `;
    })
    .join("");
}

function removeSelectedImage(questionId, imageIndex) {
  if (!tempImagesByQuestion[questionId]) return;

  tempImagesByQuestion[questionId].splice(imageIndex, 1);
  previewSelectedImages(questionId);
}

function clearQuestionSupplementalData(questionId) {
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
  renderedQuestions = [];
  tempImagesByQuestion = {};
  isSubmitting = false;
}

async function resizeImageFile(file) {
  if (!file.type.startsWith("image/")) {
    throw new Error(`File "${file.name}" không phải là ảnh hợp lệ`);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error(`Không thể đọc file "${file.name}"`));

    reader.onload = () => {
      const img = new Image();

      img.onerror = () => reject(new Error(`Không thể xử lý ảnh "${file.name}"`));

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
          reject(new Error("Trình duyệt không hỗ trợ xử lý canvas"));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          async (blob) => {
            if (!blob) {
              reject(new Error(`Không thể nén ảnh "${file.name}"`));
              return;
            }

            const safeName = file.name.replace(/\.[^/.]+$/, "");
            const finalName = `${safeName}.jpg`;
            const compressedFile = new File([blob], finalName, { type: "image/jpeg" });

            try {
              const previewUrl = await blobToDataURL(blob);
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
            } catch (error) {
              reject(error);
            }
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

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Không thể tạo preview ảnh"));
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function validateChecklist() {
  if (!currentFirebaseUser || !currentUserProfile || currentUserProfile.status !== "active") {
    showToast("Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.", "error");
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
      errorBox.textContent = "Vui lòng chọn kết quả cho câu này.";
      errorBox.classList.remove("hidden");
      questionItem.scrollIntoView({ behavior: "smooth", block: "center" });
      showToast("Vui lòng chọn kết quả cho tất cả câu hỏi", "error");
      return false;
    }

    if (selected.value === "NG" && !noteField.value.trim()) {
      questionItem.classList.add("invalid");
      errorBox.textContent = "Câu chọn NG bắt buộc phải nhập mô tả lỗi.";
      errorBox.classList.remove("hidden");
      noteField.focus();
      questionItem.scrollIntoView({ behavior: "smooth", block: "center" });
      showToast("Vui lòng nhập mô tả lỗi cho câu đã chọn NG", "error");
      return false;
    }

    const questionImages = tempImagesByQuestion[item.id] || [];
    if (questionImages.length > 2) {
      questionItem.classList.add("invalid");
      errorBox.textContent = "Tối đa 2 ảnh cho mỗi câu lỗi.";
      errorBox.classList.remove("hidden");
      questionItem.scrollIntoView({ behavior: "smooth", block: "center" });
      showToast("Có câu đang vượt quá số lượng ảnh cho phép", "error");
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

    const downloadURL = await getDownloadURL(storageRef);

    uploadedImages.push({
      url: downloadURL,
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
  setButtonLoading(submitBtn, true, "Đang gửi...");
  showPageLoader(true, "Đang upload ảnh và lưu dữ liệu...");

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

    showToast("Gửi báo cáo thành công", "success");
    resetChecklistForm();
  } catch (error) {
    console.error(error);

    // Nếu ghi Firestore lỗi sau khi đã upload ảnh, thử xóa ảnh rác
    if (uploadedStoragePaths.length) {
      await Promise.allSettled(
        uploadedStoragePaths.map((path) => {
          const fileRef = ref(storage, path);
          return deleteObject(fileRef);
        })
      );
    }

    showToast(error.message || "Không thể gửi báo cáo. Vui lòng thử lại.", "error");
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

function showPageLoader(show, text = "Đang xử lý...") {
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

function setButtonLoading(button, isLoading, loadingText = "Đang xử lý...") {
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
      return "Email không đúng định dạng.";
    case "auth/user-disabled":
      return "Tài khoản này đã bị vô hiệu hóa.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Sai email hoặc mật khẩu.";
    case "auth/too-many-requests":
      return "Bạn thử đăng nhập quá nhiều lần. Vui lòng thử lại sau.";
    case "auth/network-request-failed":
      return "Lỗi kết nối mạng. Vui lòng kiểm tra Internet.";
    default:
      return error?.message || "Đã xảy ra lỗi không xác định.";
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
