// firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAAyPbgbNVAyPOecFKHWVq5uwDMaKyoM80",
  authDomain: "mind-map3.firebaseapp.com",
  projectId: "mind-map3",
  storageBucket: "mind-map3.firebasestorage.app",
  messagingSenderId: "795917459686",
  appId: "1:795917459686:web:ed4cc63b613e74aa725b27",
  measurementId: "G-TDK7SLFM89"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };
