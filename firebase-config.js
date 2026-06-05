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
  getFirestore,
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
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

/**
 * Điền cấu hình Firebase của bạn tại đây
 */
const firebaseConfig = {
  apiKey: "DIEN_API_KEY_TAI_DAY",
  authDomain: "DIEN_AUTH_DOMAIN_TAI_DAY",
  projectId: "DIEN_PROJECT_ID_TAI_DAY",
  storageBucket: "DIEN_STORAGE_BUCKET_TAI_DAY",
  messagingSenderId: "DIEN_MESSAGING_SENDER_ID_TAI_DAY",
  appId: "DIEN_APP_ID_TAI_DAY"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export {
  app,
  auth,
  db,
  storage,
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
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
};
