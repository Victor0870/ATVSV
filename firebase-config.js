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
  getDocs,
  deleteDoc
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
   apiKey: "AIzaSyArUb1e4FUhIvvTUe9c_ul1falHvheeybc",
  authDomain: "e-checksheet-atvsv-c1d45.firebaseapp.com",
  projectId: "e-checksheet-atvsv-c1d45",
  storageBucket: "e-checksheet-atvsv-c1d45.firebasestorage.app",
  messagingSenderId: "958269031699",
  appId: "1:958269031699:web:905782a636a0fed47a46e6"
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
  deleteDoc,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
};
