import {
  db,
  storage,
  collection,
  addDoc,
  serverTimestamp,
  ref,
  uploadBytes,
  getDownloadURL,
  getDocs,
  Timestamp
} from "./firebase-config.js";
import { isChecklistItemVisibleForArea } from "./areas-service.js";
import { buildRemediationIssuePayload } from "./remediation-service.js";

// --- DỮ LIỆU DỰ PHÒNG GỐC CỦA BẠN ---
const FALLBACK_CHECKLIST = [
  { id: "fallback_001", category: "Quản lý an toàn và tình huống khẩn cấp", text: "Người lao động có trang bị đủ dụng cụ bảo hộ lao động (PPE) không?", area: "ALL", order: 1, active: true },
  { id: "fallback_002", category: "Quản lý an toàn và tình huống khẩn cấp", text: "Danh bạ liên lạc trong tình huống khẩn cấp có được hiển thị ở khu vực làm việc không?", area: "ALL", order: 2, active: true },
  { id: "fallback_003", category: "Quản lý an toàn và tình huống khẩn cấp", text: "Có hộp cứu thương và được kiểm tra định kỳ không?", area: "ALL", order: 3, active: true },
  { id: "fallback_004", category: "Quản lý an toàn và tình huống khẩn cấp", text: "Các nút bấm báo động có bị che chắn hay bị vỡ, biến dạng không?", area: "ALL", order: 4, active: true },
  { id: "fallback_005", category: "Quản lý an toàn và tình huống khẩn cấp", text: "Lối thoát hiểm, cửa thoát hiểm có bị che chắn không?", area: "ALL", order: 5, active: true },
  { id: "fallback_006", category: "Môi trường & 5S", text: "Phân loại rác có thực hiện đúng theo quy định không?", area: "ALL", order: 1, active: true },
  { id: "fallback_007", category: "Môi trường & 5S", text: "Khu vực làm việc có rác bẩn hay dầu rơi vãi không?", area: "ALL", order: 2, active: true },
  { id: "fallback_008", category: "Môi trường & 5S", text: "Bóng chiếu sáng có hoạt động bình thường không?", area: "ALL", order: 3, active: true },
  { id: "fallback_009", category: "An toàn Điện và PCCC", text: "Thiết bị chữa cháy có ở đúng vị trí, áp suất vạch xanh không?", area: "ALL", order: 1, active: true },
  { id: "fallback_010", category: "An toàn Điện và PCCC", text: "Các ổ cắm điện có bị mòn, vỡ hay có dấu hiệu cháy không?", area: "ALL", order: 2, active: true },
  { id: "fallback_011", category: "An toàn Điện và PCCC", text: "Thiết bị tiêu thụ điện có được tắt đi sau khi sử dụng không?", area: "ALL", order: 3, active: true },
  { id: "fallback_012", category: "An toàn Điện và PCCC", text: "Có đảm bảo khoảng cách tối thiểu từ vật tư, hàng hóa đến các bảng điện không?", area: "ALL", order: 4, active: true },
  { id: "fallback_013", category: "Thao tác với vật tư hàng hóa", text: "Hàng hóa được vận chuyển và sắp xếp đúng theo hướng dẫn vận hành của kho không?", area: "Chi nhánh", order: 1, active: true },
  { id: "fallback_014", category: "Thao tác với vật tư hàng hóa", text: "Hàng hóa được vận chuyển và sắp xếp đúng theo hướng dẫn/SOP không?", area: "Nhà máy", order: 2, active: true },
  { id: "fallback_015", category: "Thao tác với vật tư hàng hóa", text: "Hàng hóa có chắn lối đi hay cửa thoát hiểm không?", area: "ALL", order: 3, active: true },
  { id: "fallback_016", category: "Thao tác với vật tư hàng hóa", text: "Hàng hóa, vật tư được xếp ngay ngắn và đúng theo layout không?", area: "ALL", order: 4, active: true },
  { id: "fallback_017", category: "An toàn vận hành máy móc thiết bị", text: "Thiết bị, máy móc có được kiểm tra định kỳ không?", area: "ALL", order: 1, active: true },
  { id: "fallback_018", category: "An toàn vận hành máy móc thiết bị", text: "Máy móc, thiết bị có hiện tượng bất thường (rò dầu, âm thanh lạ, mùi khét...) không?", area: "ALL", order: 2, active: true },
  { id: "fallback_019", category: "An toàn vận hành máy móc thiết bị", text: "Hệ thống thông gió có đầy đủ và hoạt động tốt không?", area: "Nhà máy", order: 3, active: true }
];

export const FALLBACK_CATEGORIES = [
  { name: "Quản lý an toàn và tình huống khẩn cấp", order: 1 },
  { name: "Môi trường & 5S", order: 2 },
  { name: "An toàn Điện và PCCC", order: 3 },
  { name: "Thao tác với vật tư hàng hóa", order: 4 },
  { name: "An toàn vận hành máy móc thiết bị", order: 5 }
];

// --- CÁC HÀM TIỆN ÍCH HIỂN THỊ VÀ SẮP XẾP CHECKLIST CỦA BẠN ---
export async function fetchChecklistCategories({ throwOnError = false } = {}) {
  try {
    const snap = await getDocs(collection(db, "checklistCategories"));
    const categories = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const orderDiff = (Number(a.order) || 0) - (Number(b.order) || 0);
        if (orderDiff !== 0) return orderDiff;
        return String(a.name || "").localeCompare(String(b.name || ""), "vi");
      });

    if (categories.length > 0) {
      return { categories, source: "firestore" };
    }
  } catch (error) {
    console.warn("Không thể tải danh mục checklist:", error);
    if (throwOnError) throw error;
  }

  return {
    categories: FALLBACK_CATEGORIES.map((item, index) => ({
      id: `fallback_cat_${index + 1}`,
      ...item
    })),
    source: "fallback"
  };
}

export function getCategoryOrderMap(categories = []) {
  const map = new Map();
  categories.forEach((category, index) => {
    map.set(category.name, Number(category.order) || index + 1);
  });
  return map;
}

export function sortChecklistItems(items, categories = []) {
  const categoryOrderMap = getCategoryOrderMap(categories);

  return [...items].sort((a, b) => {
    const categoryA = categoryOrderMap.get(a.category) ?? 9999;
    const categoryB = categoryOrderMap.get(b.category) ?? 9999;
    if (categoryA !== categoryB) return categoryA - categoryB;

    const orderDiff = (Number(a.order) || 0) - (Number(b.order) || 0);
    if (orderDiff !== 0) return orderDiff;

    return String(a.text || "").localeCompare(String(b.text || ""), "vi");
  });
}

export async function fetchChecklistItems({ includeInactive = false, throwOnError = false, categories = [] } = {}) {
  try {
    const snap = await getDocs(collection(db, "checklistItems"));
    let items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (!includeInactive) {
      items = items.filter((item) => item.active !== false);
    }

    items = sortChecklistItems(items, categories);

    if (items.length > 0) {
      return { items, source: "firestore" };
    }
  } catch (error) {
    console.warn("Không thể tải checklist từ Firestore:", error);
    if (throwOnError) throw error;
  }

  const fallback = includeInactive
    ? FALLBACK_CHECKLIST
    : FALLBACK_CHECKLIST.filter((item) => item.active !== false);

  return {
    items: sortChecklistItems(fallback, categories.length ? categories : FALLBACK_CATEGORIES),
    source: "fallback"
  };
}

export function groupChecklistForArea(items, area, categories = [], branchNames = []) {
  const filtered = items.filter((item) => {
    if (item.active === false) return false;
    return isChecklistItemVisibleForArea(item.area, area, branchNames);
  });

  const sortedItems = sortChecklistItems(filtered, categories);
  const categoryOrderMap = getCategoryOrderMap(categories);
  const grouped = new Map();

  sortedItems.forEach((item) => {
    const category = item.category || "Khác";
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category).push({
      id: item.id,
      category,
      text: item.text || "",
      order: Number(item.order) || 0
    });
  });

  const categoryNames = [...grouped.keys()].sort((a, b) => {
    const orderA = categoryOrderMap.get(a) ?? 9999;
    const orderB = categoryOrderMap.get(b) ?? 9999;
    if (orderA !== orderB) return orderA - orderB;
    return a.localeCompare(b, "vi");
  });

  return categoryNames.map((category) => ({
    category,
    questions: grouped.get(category)
  }));
}

export function getItemsInCategory(items, categoryName) {
  return sortChecklistItems(
    items.filter((item) => item.category === categoryName),
    []
  );
}

export function getNextOrderInCategory(items, categoryName) {
  const inCategory = getItemsInCategory(items, categoryName);
  if (!inCategory.length) return 1;
  return Math.max(...inCategory.map((item) => Number(item.order) || 0)) + 1;
}

// --- TÍNH NĂNG MỚI: TỰ ĐỘNG NÉN ẢNH GIẢM DUNG LƯỢNG TRÊN TRÌNH DUYỆT ---
/**
 * Hàm nén ảnh và giảm độ phân giải trực tiếp trên trình duyệt
 */
export function compressImage(file, maxWidth = 1200, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith("image/")) {
      return resolve(file); // Trả về file gốc nếu không phải định dạng ảnh
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("Nén ảnh thất bại."));
            }
          },
          "image/jpeg",
          quality
        );
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

/**
 * Xử lý nén và tải từng ảnh bằng chứng lên Firebase Storage
 */
async function uploadEvidenceImage(file, submissionId, questionId, index, uid) {
  if (!file) return null;
  
  // Tự động nén ảnh tại client trước khi thực hiện upload (vượt qua Rules giới hạn 2MB)
  const compressedBlob = await compressImage(file, 1200, 0.75);
  
  const timestamp = Date.now();
  const fileExtension = file.name ? file.name.split('.').pop() : 'jpg';
  
  const storagePath = `submissions/${uid}/${submissionId}/${questionId}_${index}_${timestamp}.${fileExtension}`;
  const storageRef = ref(storage, storagePath);
  
  const uploadResult = await uploadBytes(storageRef, compressedBlob);
  const downloadUrl = await getDownloadURL(uploadResult.ref);
  
  return {
    path: uploadResult.metadata.fullPath,
    url: downloadUrl
  };
}

// --- LUỒNG NỘP PHIẾU CHECKLIST CHÍNH CỦA BẠN ---
export async function submitChecklist({
  userProfile,
  branch,
  answers,
  createdAtText
}) {
  if (!userProfile || !branch || !answers || !answers.length) {
    throw new Error("Dữ liệu nộp checklist không hợp lệ hoặc bị thiếu.");
  }

  const randStr = Math.random().toString(36).substring(2, 7).toUpperCase();
  const dateSegment = createdAtText.split(" ")[0].replace(/-/g, "");
  const submissionId = `SUB_${dateSegment}_${randStr}`;

  const normalAnswers = [];
  const ngAnswers = [];

  for (const ans of answers) {
    const isNG = ans.value === "NG";
    const uploadedImages = [];
    
    if (Array.isArray(ans.imageFiles) && ans.imageFiles.length > 0) {
      for (let i = 0; i < ans.imageFiles.length; i++) {
        const file = ans.imageFiles[i];
        if (file) {
          const imgMeta = await uploadEvidenceImage(file, submissionId, ans.questionId, i, userProfile.uid);
          if (imgMeta) {
            uploadedImages.push(imgMeta);
          }
        }
      }
    }

    const finalAnswerData = {
      questionId: ans.questionId,
      category: ans.category || "",
      question: ans.question || "",
      value: ans.value || "",
      note: ans.note || "",
      images: uploadedImages
    };

    if (isNG) {
      ngAnswers.push(finalAnswerData);
    } else {
      normalAnswers.push(finalAnswerData);
    }
  }

  const submissionPayload = {
    submissionId,
    uid: userProfile.uid,
    email: userProfile.email || "",
    taiKhoan: userProfile.taiKhoan || userProfile.email || "",
    hoTen: userProfile.hoTen || "",
    khuVuc: branch,
    createdAtText,
    createdAt: serverTimestamp(),
    answers: [...normalAnswers, ...ngAnswers],
    totalQuestions: answers.length,
    ngCount: ngAnswers.length
  };

  await addDoc(collection(db, "submissions"), submissionPayload);

  if (ngAnswers.length > 0) {
    const remediationRef = collection(db, "remediationIssues");
    
    for (const ngAns of ngAnswers) {
      const issuePayload = buildRemediationIssuePayload(submissionPayload, ngAns);
      
      issuePayload.createdAt = serverTimestamp();
      issuePayload.updatedAt = serverTimestamp();
      
      const parsedDate = parseTextToDate(createdAtText);
      if (parsedDate) {
        issuePayload.discoveredAt = Timestamp.fromDate(parsedDate);
      } else {
        issuePayload.discoveredAt = serverTimestamp();
      }

      await addDoc(remediationRef, issuePayload);
    }
  }

  return submissionId;
}

function parseTextToDate(text) {
  if (!text) return null;
  const normalized = String(text).trim().replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}
