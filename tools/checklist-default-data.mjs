/**
 * Danh sách checklist mặc định — đồng bộ với buildQuestionConfig() trong script.js
 * Chạy: npm run seed:checklist
 */

export const DEFAULT_CHECKLIST_ITEMS = [
  // Quản lý an toàn và tình huống khẩn cấp
  { id: "check_001", category: "Quản lý an toàn và tình huống khẩn cấp", text: "Người lao động có trang bị đủ dụng cụ bảo hộ lao động (PPE) không?", area: "ALL", order: 1 },
  { id: "check_002", category: "Quản lý an toàn và tình huống khẩn cấp", text: "Danh bạ liên lạc trong tình huống khẩn cấp có được hiển thị ở khu vực làm việc không?", area: "ALL", order: 2 },
  { id: "check_003", category: "Quản lý an toàn và tình huống khẩn cấp", text: "Có hộp cứu thương và được kiểm tra định kỳ không?", area: "ALL", order: 3 },
  { id: "check_004", category: "Quản lý an toàn và tình huống khẩn cấp", text: "Các nút bấm báo động có bị che chắn hay bị vỡ, biến dạng không?", area: "ALL", order: 4 },
  { id: "check_005", category: "Quản lý an toàn và tình huống khẩn cấp", text: "Lối thoát hiểm, cửa thoát hiểm có bị che chắn không?", area: "ALL", order: 5 },

  // Môi trường & 5S
  { id: "check_006", category: "Môi trường & 5S", text: "Phân loại rác có thực hiện đúng theo quy định không?", area: "ALL", order: 6 },
  { id: "check_007", category: "Môi trường & 5S", text: "Khu vực làm việc có rác bẩn hay dầu rơi vãi không?", area: "ALL", order: 7 },
  { id: "check_008", category: "Môi trường & 5S", text: "Bóng chiếu sáng có hoạt động bình thường không?", area: "ALL", order: 8 },

  // An toàn Điện và PCCC
  { id: "check_009", category: "An toàn Điện và PCCC", text: "Thiết bị chữa cháy có ở đúng vị trí, áp suất vạch xanh không?", area: "ALL", order: 9 },
  { id: "check_010", category: "An toàn Điện và PCCC", text: "Các ổ cắm điện có bị mòn, vỡ hay có dấu hiệu cháy không?", area: "ALL", order: 10 },
  { id: "check_011", category: "An toàn Điện và PCCC", text: "Thiết bị tiêu thụ điện có được tắt đi sau khi sử dụng không?", area: "ALL", order: 11 },
  { id: "check_012", category: "An toàn Điện và PCCC", text: "Có đảm bảo khoảng cách tối thiểu từ vật tư, hàng hóa đến các bảng điện không?", area: "ALL", order: 12 },

  // Thao tác với vật tư hàng hóa
  { id: "check_013", category: "Thao tác với vật tư hàng hóa", text: "Hàng hóa được vận chuyển và sắp xếp đúng theo hướng dẫn vận hành của kho không?", area: "Chi nhánh", order: 13 },
  { id: "check_014", category: "Thao tác với vật tư hàng hóa", text: "Hàng hóa được vận chuyển và sắp xếp đúng theo hướng dẫn/SOP không?", area: "Nhà máy", order: 14 },
  { id: "check_015", category: "Thao tác với vật tư hàng hóa", text: "Hàng hóa có chắn lối đi hay cửa thoát hiểm không?", area: "ALL", order: 15 },
  { id: "check_016", category: "Thao tác với vật tư hàng hóa", text: "Hàng hóa, vật tư được xếp ngay ngắn và đúng theo layout không?", area: "ALL", order: 16 },

  // An toàn vận hành máy móc thiết bị
  { id: "check_017", category: "An toàn vận hành máy móc thiết bị", text: "Thiết bị, máy móc có được kiểm tra định kỳ không?", area: "ALL", order: 17 },
  { id: "check_018", category: "An toàn vận hành máy móc thiết bị", text: "Máy móc, thiết bị có hiện tượng bất thường (rò dầu, âm thanh lạ, mùi khét...) không?", area: "ALL", order: 18 },
  { id: "check_019", category: "An toàn vận hành máy móc thiết bị", text: "Hệ thống thông gió có đầy đủ và hoạt động tốt không?", area: "Nhà máy", order: 19 }
];
