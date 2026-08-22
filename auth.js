/* ==========================================================================
   AUTH.JS
   Wraps Firebase Authentication (email/password) and Firestore so the rest
   of the app can stay simple. Exposes a single global: window.CV_AUTH.

   If firebase-config.js still has placeholder values, or the Firebase SDK
   fails to load (e.g. no internet, or opened via file:// where some
   browsers block third-party scripts), the app falls back to "guest mode":
   everything works exactly as before, using localStorage only.
   ========================================================================== */

window.CV_AUTH = (function () {
  let ready = false;
  let cloudEnabled = false;
  let auth = null;
  let db = null;
  let currentUser = null;
  const readyCallbacks = [];

  function isConfigured() {
    return typeof firebaseConfig !== "undefined" &&
      firebaseConfig.apiKey &&
      !firebaseConfig.apiKey.startsWith("REPLACE_WITH");
  }

  function init() {
    if (!isConfigured() || typeof firebase === "undefined") {
      // Guest-mode only: no Firebase config or SDK present.
      ready = true;
      cloudEnabled = false;
      readyCallbacks.forEach((cb) => cb(null));
      return;
    }
    try {
      firebase.initializeApp(firebaseConfig);
      auth = firebase.auth();
      db = firebase.firestore();
      cloudEnabled = true;

      auth.onAuthStateChanged((user) => {
        currentUser = user;
        ready = true;
        readyCallbacks.forEach((cb) => cb(user));
        document.dispatchEvent(new CustomEvent("cv-auth-changed", { detail: { user } }));
      });
    } catch (e) {
      console.warn("Firebase init failed, falling back to guest mode:", e);
      ready = true;
      cloudEnabled = false;
      readyCallbacks.forEach((cb) => cb(null));
    }
  }

  function onReady(cb) {
    if (ready) cb(currentUser);
    else readyCallbacks.push(cb);
  }

  function isCloudEnabled() {
    return cloudEnabled;
  }

  function getUser() {
    return currentUser;
  }

  async function signUp(email, password) {
    if (!cloudEnabled) throw new Error("Cloud sync isn't configured yet. See SETUP.md.");
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    return cred.user;
  }

  async function signIn(email, password) {
    if (!cloudEnabled) throw new Error("Cloud sync isn't configured yet. See SETUP.md.");
    const cred = await auth.signInWithEmailAndPassword(email, password);
    return cred.user;
  }

  async function signOutUser() {
    if (!cloudEnabled) return;
    await auth.signOut();
  }

  async function resetPassword(email) {
    if (!cloudEnabled) throw new Error("Cloud sync isn't configured yet. See SETUP.md.");
    await auth.sendPasswordResetEmail(email);
  }

  async function loadCloudData() {
    if (!cloudEnabled || !currentUser) return null;
    const docSnap = await db.collection("users").doc(currentUser.uid).get();
    return docSnap.exists ? docSnap.data() : null;
  }

  // Writes immediately (no debounce) so a quick refresh right after a
  // change — e.g. toggling "watched" and then reloading the page a moment
  // later — can never lose that write to a cancelled timer.
  function saveCloudData(data) {
    if (!cloudEnabled || !currentUser) return;
    db.collection("users").doc(currentUser.uid).set({
      ...data,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch((e) => console.warn("Cloud save failed:", e));
  }

  // Real-time sync: keeps every open device's copy up to date automatically
  // whenever any device (including this one) writes a change, without
  // needing a manual refresh.
  let unsubscribeSnapshot = null;
  function subscribeToUserDoc(uid, callback) {
    if (!cloudEnabled) return;
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    unsubscribeSnapshot = db.collection("users").doc(uid).onSnapshot(
      (docSnap) => callback(docSnap.exists ? docSnap.data() : null),
      (err) => console.warn("Cloud sync listener error:", err)
    );
  }
  function unsubscribeUserDoc() {
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }
  }

  init();

  return {
    onReady,
    isCloudEnabled,
    getUser,
    signUp,
    signIn,
    signOut: signOutUser,
    resetPassword,
    loadCloudData,
    saveCloudData,
    subscribeToUserDoc,
    unsubscribeUserDoc
  };
})();