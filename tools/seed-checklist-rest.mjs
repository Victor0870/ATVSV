/**
 * Seed checklist qua Firestore REST API + Firebase CLI credentials
 * Chạy: npm run seed:checklist
 */

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { DEFAULT_CHECKLIST_ITEMS } from "./checklist-default-data.mjs";

const PROJECT_ID = "e-checksheet-atvsv-c1d45";

function loadFirebaseCliToken() {
  const paths = [
    join(homedir(), ".config", "configstore", "firebase-tools.json"),
    join(homedir(), "AppData", "Roaming", "configstore", "firebase-tools.json")
  ];

  for (const configPath of paths) {
    if (!existsSync(configPath)) continue;

    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const tokens = config?.tokens;
    const accessToken = tokens?.access_token;
    const refreshToken = tokens?.refresh_token;

    if (accessToken) {
      return { accessToken, refreshToken, expiresAt: tokens?.expires_at };
    }
  }

  return null;
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    client_secret: "j9PHV0F2z/PFAE6HTLwa6gGfo"
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!res.ok) {
    throw new Error(`Không thể refresh token: ${res.status}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function getAccessToken() {
  const creds = loadFirebaseCliToken();
  if (!creds) {
    throw new Error("Chưa tìm thấy Firebase CLI token. Chạy: firebase login");
  }

  const now = Date.now();
  if (creds.expiresAt && creds.expiresAt > now + 60000) {
    return creds.accessToken;
  }

  if (!creds.refreshToken) {
    return creds.accessToken;
  }

  return refreshAccessToken(creds.refreshToken);
}

async function firestoreRequest(method, path, body) {
  const token = await getAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore ${method} failed (${res.status}): ${text}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

async function collectionHasDocuments() {
  const data = await firestoreRequest("GET", "checklistItems?pageSize=1");
  return Array.isArray(data.documents) && data.documents.length > 0;
}

function toFirestoreValue(value) {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  if (typeof value === "boolean") return { booleanValue: value };
  if (value && value._seconds !== undefined) {
    return { timestampValue: new Date(value._seconds * 1000).toISOString() };
  }
  return { stringValue: String(value) };
}

function buildDocumentFields(item) {
  const now = new Date().toISOString();
  return {
    category: toFirestoreValue(item.category),
    text: toFirestoreValue(item.text),
    area: toFirestoreValue(item.area),
    order: toFirestoreValue(item.order),
    active: toFirestoreValue(true),
    seeded: toFirestoreValue(true),
    createdAt: toFirestoreValue({ _seconds: Math.floor(Date.now() / 1000) }),
    updatedAt: toFirestoreValue({ _seconds: Math.floor(Date.now() / 1000) })
  };
}

async function seedChecklist() {
  console.log(`Project: ${PROJECT_ID}`);

  const hasData = await collectionHasDocuments();
  if (hasData) {
    console.log("Collection checklistItems đã có dữ liệu — bỏ qua seed.");
    return;
  }

  for (const item of DEFAULT_CHECKLIST_ITEMS) {
    await firestoreRequest("PATCH", `checklistItems/${item.id}`, {
      fields: buildDocumentFields(item)
    });
    console.log(`  + ${item.id}: ${item.text.slice(0, 50)}...`);
  }

  console.log(`\nĐã seed ${DEFAULT_CHECKLIST_ITEMS.length} câu hỏi checklist.`);
}

seedChecklist().catch((error) => {
  console.error("Seed thất bại:", error.message);
  process.exit(1);
});
