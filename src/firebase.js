import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyBx6Fivm9tdBV2ppbQlS9w3gCaqvmBsnH4",
  authDomain: "bingo-multiplayer-7777.firebaseapp.com",
  projectId: "bingo-multiplayer-7777",
  storageBucket: "bingo-multiplayer-7777.firebasestorage.app",
  messagingSenderId: "600605315871",
  appId: "1:600605315871:web:5361492d02dac0a565d62a"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export default app;
