import { db, collection, getDocs } from "./firebase-config.js";

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

export function groupChecklistForArea(items, area, categories = []) {
  const filtered = items.filter((item) => {
    if (item.active === false) return false;
    const itemArea = item.area || "ALL";
    return itemArea === "ALL" || itemArea === area;
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
