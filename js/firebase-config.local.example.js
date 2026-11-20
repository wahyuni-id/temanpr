/**
 * firebase-config.local.example.js — copy this file to
 * `firebase-config.local.js` (gitignored) for local-only overrides.
 *
 * Use it for an App Check debug token during local development:
 *   1. Run the app on localhost once with no token — the SDK prints an
 *      "AppCheck debug token" UUID to the browser console.
 *   2. Register that UUID in Firebase Console → Security → App Check →
 *      Apps → (your web app) → Manage debug tokens.
 *   3. Paste it below. NEVER commit the real file or the token.
 *
 * Any field set here overrides APP_SETTINGS in firebase-config.js.
 */

export const LOCAL_OVERRIDES = {
  // appCheckDebugToken: "00000000-0000-0000-0000-000000000000",
};
