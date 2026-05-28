// Firebase SDK bản modular
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
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
 * Lấy trong Firebase Console > Project settings > General > Your apps
 */
const firebaseConfig = {
  apiKey: "AIzaSyAvKmCX-mDsO3oQ8TBWL3GlP_Sc17wxV_U",
  authDomain: "e-checksheet-atvsv.firebaseapp.com",
  projectId: "e-checksheet-atvsv",
  storageBucket: "e-checksheet-atvsv.firebasestorage.app",
  messagingSenderId: "856741565418",
  appId: "1:856741565418:web:9c0e088f3eac4aac715893"
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
  signOut,
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
