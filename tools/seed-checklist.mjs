import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { DEFAULT_CHECKLIST_ITEMS } from "./checklist-default-data.mjs";

const PROJECT_ID = "e-checksheet-atvsv-c1d45";
const __dirname = dirname(fileURLToPath(import.meta.url));

function initFirebaseAdmin() {
  const serviceAccountPath = join(__dirname, "service-account.json");

  if (existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));
    initializeApp({
      credential: cert(serviceAccount),
      projectId: PROJECT_ID
    });
    return "service-account.json";
  }

  initializeApp({
    credential: applicationDefault(),
    projectId: PROJECT_ID
  });
  return "application-default-credentials";
}

async function seedChecklist() {
  const authMode = initFirebaseAdmin();
  const db = getFirestore();

  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Auth: ${authMode}`);

  const existing = await db.collection("checklistItems").limit(1).get();

  if (!existing.empty) {
    console.log("Collection checklistItems đã có dữ liệu — bỏ qua seed để tránh ghi đè.");
    console.log("Nếu muốn seed lại, xóa collection checklistItems trên Firebase Console trước.");
    process.exit(0);
  }

  const batch = db.batch();
  const now = FieldValue.serverTimestamp();

  DEFAULT_CHECKLIST_ITEMS.forEach((item) => {
    const ref = db.collection("checklistItems").doc(item.id);
    batch.set(ref, {
      category: item.category,
      text: item.text,
      area: item.area,
      order: item.order,
      active: true,
      seeded: true,
      createdAt: now,
      updatedAt: now
    });
  });

  await batch.commit();

  console.log(`Đã seed ${DEFAULT_CHECKLIST_ITEMS.length} câu hỏi checklist lên Firestore.`);
}

seedChecklist().catch((error) => {
  console.error("Seed thất bại:", error.message);
  console.error("");
  console.error("Cách khắc phục:");
  console.error("1. Firebase Console → Project Settings → Service accounts → Generate new private key");
  console.error("2. Lưu file vào tools/service-account.json (file này đã được gitignore)");
  console.error("3. Chạy lại: npm run seed:checklist");
  process.exit(1);
});
