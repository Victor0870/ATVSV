import { storage, ref, getDownloadURL } from "./firebase-config.js";

const imageUrlCache = new Map();

/**
 * Resolve storage path from image record (path preferred, legacy url supported).
 */
export function getImageStoragePath(image) {
  if (!image) return null;

  if (image.path && typeof image.path === "string") {
    return image.path.trim();
  }

  if (image.url && typeof image.url === "string") {
    return extractStoragePathFromUrl(image.url);
  }

  return null;
}

export function extractStoragePathFromUrl(url) {
  try {
    const match = String(url).match(/\/o\/([^?]+)/);
    if (!match) return null;
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/**
 * Load image URL at view time (Storage rules enforce auth).
 */
export async function resolveSecureImageUrl(image) {
  const storagePath = getImageStoragePath(image);
  if (!storagePath) return null;

  if (imageUrlCache.has(storagePath)) {
    return imageUrlCache.get(storagePath);
  }

  const imageRef = ref(storage, storagePath);
  const url = await getDownloadURL(imageRef);
  imageUrlCache.set(storagePath, url);
  return url;
}

export function buildSecureImageAttrs(image, extraClasses = "") {
  const classNames = ["secure-storage-image", extraClasses].filter(Boolean).join(" ");
  const storagePath = getImageStoragePath(image);
  if (storagePath) {
    return `class="${classNames}" data-storage-path="${escapeAttr(storagePath)}" src=""`;
  }

  if (image?.url) {
    return `class="${classNames} legacy-image-url" src="${escapeAttr(image.url)}" data-full-src="${escapeAttr(image.url)}"`;
  }

  return `class="${classNames}" src=""`;
}

/**
 * After rendering HTML with img[data-storage-path], call this to load images via SDK.
 */
export async function hydrateSecureImages(root = document) {
  const images = root.querySelectorAll("img[data-storage-path]:not([data-hydrated])");
  if (!images.length) return;

  await Promise.all(
    Array.from(images).map(async (img) => {
      const storagePath = img.dataset.storagePath;
      if (!storagePath) return;

      img.dataset.hydrated = "1";

      try {
        const url = await resolveSecureImageUrl({ path: storagePath });
        if (!url) return;
        img.src = url;
        img.dataset.fullSrc = url;
        img.removeAttribute("data-error");
      } catch (error) {
        console.warn("Không thể tải ảnh minh chứng:", storagePath, error);
        img.alt = "Ảnh không khả dụng";
        img.dataset.error = "1";
        img.classList.add("secure-image-error");
      }
    })
  );
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
