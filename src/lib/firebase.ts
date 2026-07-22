import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

/**
 * Configuração do Firebase (app web "Smart Meeting Web").
 * Todos os valores vêm de variáveis NEXT_PUBLIC_* — são públicos por design
 * (identificam o projeto no navegador). A segurança real fica nas Firebase
 * Security Rules + Authentication, nunca em esconder estas chaves.
 */
const firebaseConfig = {
  apiKey:
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??
    "AIzaSyDTJ3ygaIBkk5EX_ye5OVOGJ3jFbXVzsqo",
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
    "smart-meet-d441b.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "smart-meet-d441b",
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    "smart-meet-d441b.firebasestorage.app",
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "600707160164",
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??
    "1:600707160164:web:2bf0d14a6bef083e886771",
  measurementId:
    process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? "G-L1GDFX5ZVM",
};

// Evita reinicializar o app em hot-reload / múltiplos imports.
export const firebaseApp: FirebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);

export const db = getFirestore(firebaseApp);

export const googleProvider = new GoogleAuthProvider();
// Sempre deixa o usuário escolher a conta (evita login silencioso na conta errada).
googleProvider.setCustomParameters({ prompt: "select_account" });
