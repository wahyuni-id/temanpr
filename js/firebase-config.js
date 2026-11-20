/**
 * firebase-config.js — THE one place Firebase settings live.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  STATUS: WIRED 2026-11-21 — Firebase project temanpr-11c04 under     │
 * │  Wahyuni's Google account (sor3xsor3@gmail.com); AI Logic (Gemini    │
 * │  Developer API) provisioned; App Check (reCAPTCHA Enterprise)        │
 * │  registered + enforced for AI Logic.                                 │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * The Firebase web config is a client identifier, not a private secret —
 * but per the contest rules we still never commit *other* keys here.
 *
 * App Check debug tokens are SECRETS (Google's firebase-ai-logic-basics
 * skill: never hardcode or commit them). A debug token belongs ONLY in
 * `firebase-config.local.js` (gitignored). See
 * `firebase-config.local.example.js`.
 */

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCjD9RPe7P-G1OyCl9ainOyo081AeFMDEE",
  authDomain: "temanpr-11c04.firebaseapp.com",
  projectId: "temanpr-11c04",
  storageBucket: "temanpr-11c04.firebasestorage.app",
  messagingSenderId: "536397972350",
  appId: "1:536397972350:web:db03338ca6b262ef15692f",
};

export const APP_SETTINGS = {
  /**
   * Cloud-hosted model, used via inCloudParams for every hybrid model
   * instance. Current per Firebase's hybrid configuration docs (default
   * cloud fallback from JS SDK v13). Re-verify at integration time
   * against https://firebase.google.com/docs/ai-logic/models — never
   * use Gemini 1.x/2.x names (deprecated). Follow-up option: source
   * this from Firebase Remote Config (parameter `cloud_model`) so the
   * model can be switched without a redeploy.
   */
  cloudModel: "gemini-3.5-flash-lite",

  /**
   * App Check for the hosted site (Plan A): reCAPTCHA Enterprise site
   * key. Site keys are public and safe to commit. Leave null to use the
   * debug-token flow instead (local development / Plan B).
   */
  recaptchaSiteKey: "6LfNZiouAAAAAG2xajIDNMSwwhIwN1Oi_DVVSIT0",

  /**
   * App Check debug token (Plan B). DO NOT put a real token here.
   * Put it in firebase-config.local.js (gitignored) — see the example
   * file. null = auto-generate on localhost (token prints to console,
   * then register it under Firebase Console → App Check → Manage
   * debug tokens).
   */
  appCheckDebugToken: null,
};

/** True once a real Firebase project config has been pasted in. */
export function isFirebaseConfigured(cfg = FIREBASE_CONFIG) {
  return (
    typeof cfg.apiKey === "string" &&
    cfg.apiKey.length > 0 &&
    cfg.apiKey !== "REPLACE_ME" &&
    typeof cfg.projectId === "string" &&
    cfg.projectId !== "REPLACE_ME"
  );
}
