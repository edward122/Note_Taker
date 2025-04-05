// firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBwhJVoZ2nKnGrl9VJ7D6GXpcUha2IRN08",
  authDomain: "notetaker-f71ae.firebaseapp.com",
  databaseURL: "https://notetaker-f71ae-default-rtdb.firebaseio.com",
  projectId: "notetaker-f71ae",
  storageBucket: "notetaker-f71ae.firebasestorage.app",
  messagingSenderId: "466022334149",
  appId: "1:466022334149:web:bb9e6830f35a4b94b73aac",
  measurementId: "G-ZH0WYZKWKN"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { auth, db, storage };
