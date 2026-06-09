import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  addDoc,
  deleteDoc,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  getToken
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";

/**
 * Cấu hình Firebase — apiKey trên client là bình thường với SPA;
 * bảo vệ bằng Security Rules + App Check (bật trong Console).
 */
const firebaseConfig = {
  apiKey: "AIzaSyArUb1e4FUhIvvTUe9c_ul1falHvheeybc",
  authDomain: "e-checksheet-atvsv-c1d45.firebaseapp.com",
  projectId: "e-checksheet-atvsv-c1d45",
  storageBucket: "e-checksheet-atvsv-c1d45.firebasestorage.app",
  messagingSenderId: "958269031699",
  appId: "1:958269031699:web:905782a636a0fed47a46e6"
};

/**
 * Lấy Site Key tại: Firebase Console → App Check → ứng dụng Web → reCAPTCHA v3
 * Để trống = App Check chưa bật (dev). Production: điền key trước khi IT audit.
 */
const APP_CHECK_RECAPTCHA_SITE_KEY = "6Ld50RUtAAAAAC3NDmKim7JXLeqillRscdB-0Rt2";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

const storage = getStorage(app);
const functions = getFunctions(app, "asia-southeast1");

const authPersistenceReady = setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.warn("Không thể thiết lập Firebase auth persistence:", error);
});

let appCheckInitPromise = null;

export function initAppCheck() {
  if (appCheckInitPromise) return appCheckInitPromise;

  appCheckInitPromise = (async () => {
    const isLocalhost =
      location.hostname === "localhost" || location.hostname === "127.0.0.1";

    if (isLocalhost) {
      // eslint-disable-next-line no-undef
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }

    if (!APP_CHECK_RECAPTCHA_SITE_KEY) {
      if (!isLocalhost) {
        console.warn(
          "App Check: chưa cấu hình APP_CHECK_RECAPTCHA_SITE_KEY trong firebase-config.js"
        );
      }
      return;
    }

    try {
      const appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(APP_CHECK_RECAPTCHA_SITE_KEY),
        isTokenAutoRefreshEnabled: true
      });
      await getToken(appCheck, false);
    } catch (error) {
      console.warn("Không thể khởi tạo App Check:", error);
    }
  })();

  return appCheckInitPromise;
}

export function callCompleteRegistration(data) {
  return httpsCallable(functions, "completeRegistration")(data);
}

export function callAdminUpdateUser(data) {
  return httpsCallable(functions, "adminUpdateUser")(data);
}

export {
  app,
  auth,
  db,
  storage,
  functions,
  authPersistenceReady,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  deleteUser,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  addDoc,
  deleteDoc,
  Timestamp,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  httpsCallable
};
