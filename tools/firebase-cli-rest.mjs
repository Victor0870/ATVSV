/**
 * Firestore REST helpers dùng token từ Firebase CLI (firebase login).
 */

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const PROJECT_ID = "e-checksheet-atvsv-c1d45";

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

export async function getAccessToken() {
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

export async function firestoreRequest(method, path, body) {
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

export function fromFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return Number(value.doubleValue);
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.nullValue !== undefined) return null;

  if (value.mapValue) {
    const obj = {};
    const fields = value.mapValue.fields || {};
    Object.entries(fields).forEach(([key, nested]) => {
      obj[key] = fromFirestoreValue(nested);
    });
    return obj;
  }

  if (value.arrayValue) {
    return (value.arrayValue.values || []).map((item) => fromFirestoreValue(item));
  }

  return null;
}

export function parseFirestoreDocument(doc) {
  const name = doc?.name || "";
  const id = name.split("/").pop() || "";
  const result = { id };

  const fields = doc?.fields || {};
  Object.entries(fields).forEach(([key, value]) => {
    result[key] = fromFirestoreValue(value);
  });

  return result;
}

export function toFirestoreValue(value) {
  if (value == null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === "boolean") return { booleanValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };

  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => toFirestoreValue(item))
      }
    };
  }

  if (typeof value === "object") {
    const fields = {};
    Object.entries(value).forEach(([key, nested]) => {
      fields[key] = toFirestoreValue(nested);
    });
    return { mapValue: { fields } };
  }

  return { stringValue: String(value) };
}

export function toFirestoreFields(obj) {
  const fields = {};
  Object.entries(obj).forEach(([key, value]) => {
    fields[key] = toFirestoreValue(value);
  });
  return fields;
}

export async function listCollectionDocuments(collectionId, pageSize = 300) {
  const items = [];
  let pageToken = "";

  do {
    const query = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) query.set("pageToken", pageToken);

    const data = await firestoreRequest("GET", `${collectionId}?${query.toString()}`);
    const docs = Array.isArray(data?.documents) ? data.documents : [];
    docs.forEach((doc) => items.push(parseFirestoreDocument(doc)));
    pageToken = data?.nextPageToken || "";
  } while (pageToken);

  return items;
}
