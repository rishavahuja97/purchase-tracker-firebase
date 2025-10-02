

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';


// Import the functions you need from the SDKs you need
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAvnLZV1wtyqwftylSndZ5UnFlvytFXDBU",
  authDomain: "purchase-tracker-app-b7e4f.firebaseapp.com",
  projectId: "purchase-tracker-app-b7e4f",
  storageBucket: "purchase-tracker-app-b7e4f.firebasestorage.app",
  messagingSenderId: "714915319159",
  appId: "1:714915319159:web:45682e0bc5d6ca05936572"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
