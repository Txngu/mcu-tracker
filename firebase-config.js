/* ==========================================================================
   FIREBASE-CONFIG.JS
   Paste YOUR OWN Firebase project's config object below. You get this from:
   Firebase Console → Project Settings → General → "Your apps" → Web app.

   These values are NOT secret — they identify your project publicly, the
   same way a website URL does. Your data is protected by the Firestore
   Security Rules you set in the console (see SETUP.md), not by hiding
   this file. It is safe to commit this file to a public GitHub repo.

   Until you replace the placeholders below, the app will run fine in
   "guest mode" (localStorage only, no cross-device sync) and simply won't
   offer the Sign In / Sign Up option.
   ========================================================================== */

const firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_PROJECT.firebaseapp.com",
  projectId: "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket: "REPLACE_WITH_YOUR_PROJECT.appspot.com",
  messagingSenderId: "REPLACE_WITH_YOUR_SENDER_ID",
  appId: "REPLACE_WITH_YOUR_APP_ID"
};
