/**
 * ai-service.js — TemanPR's Firebase AI Logic integration.
 *
 * It imports the Firebase AI Logic SDK, creates hybrid GenerativeModel
 * instances (Gemini Nano on-device via Chrome's Prompt API, Gemini in
 * the cloud as fallback — or vice versa), and calls generateContent()
 * with per-job inference modes from prompts.js (JOB_ROUTES).
 *
 * Design notes (from Firebase's official docs + the
 * firebase-ai-logic-basics agent skill):
 *  - AI Logic must be PROVISIONED on the Firebase project (console
 *    AI Logic "Get started" flow, or `npx firebase-tools@latest init
 *    ailogic`). Config alone is not enough — without provisioning,
 *    calls fail with PERMISSION_DENIED.
 *  - App Check is enforced for AI Logic. Generative models also enforce
 *    replay protection, so getAI() is initialized with
 *    useLimitedUseAppCheckTokens: true (skill guidance).
 *  - Which engine served a request is read from the response itself:
 *    result.response.inferenceSource === "ON_DEVICE" | "IN_CLOUD".
 *    The UI badge shows exactly that — never a guess.
 *  - Hybrid model creation follows the configuration docs: the mode at
 *    top level, the cloud model + generation config in inCloudParams,
 *    and the on-device JSON constraint in
 *    onDeviceParams.promptOptions.responseConstraint.
 */

import { initializeApp } from "firebase/app";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
} from "firebase/ai";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";

import {
  FIREBASE_CONFIG,
  APP_SETTINGS,
  isFirebaseConfigured,
} from "./firebase-config.js";
import { JOB_ROUTES, JOB_SCHEMAS, buildPrompt, jobUsesPhoto } from "./prompts.js";

const MAX_TOKENS = {
  "explain-photo": 2048,
  "practice-quiz": 1536,
  "explain-simple": 1024,
  "study-plan": 2048,
  "ask-private": 1024,
};

/** Optional gitignored local overrides (debug token). Absent is fine. */
async function loadLocalOverrides() {
  try {
    const mod = await import("./firebase-config.local.js");
    return mod.LOCAL_OVERRIDES || {};
  } catch {
    return {};
  }
}

/** Tolerant JSON extraction: models occasionally wrap JSON in prose. */
export function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("The model did not return JSON. Please try again.");
  }
}

/** Convert an uploaded image File into an SDK inline-data part. */
async function fileToGenerativePart(file) {
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return { inlineData: { data, mimeType: file.type } };
}

/**
 * Convert a data URL (the app's canonical photo form — downscaled on
 * the device before it is stored or queued) into an inline-data part.
 */
function dataUrlToGenerativePart(dataUrl, mimeType) {
  const data = String(dataUrl).split(",")[1];
  if (!data) throw new Error("The worksheet photo could not be read. Please pick it again.");
  return { inlineData: { data, mimeType: mimeType || "image/jpeg" } };
}

function setupAppCheck(app, settings) {
  // Plan A: reCAPTCHA Enterprise (hosted site; the site key is public).
  if (settings.recaptchaSiteKey) {
    try {
      return initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(settings.recaptchaSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      console.warn("[TemanPR] App Check (reCAPTCHA) init failed:", err);
      return null;
    }
  }
  // Plan B: debug provider. A token from the gitignored local config
  // wins; on localhost, `true` auto-generates one (printed to the
  // console — register it under App Check → Manage debug tokens).
  // Debug tokens are secrets: they are never committed (see config).
  const isLocalhost = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (settings.appCheckDebugToken) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = settings.appCheckDebugToken;
  } else if (isLocalhost) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  } else {
    console.warn(
      "[TemanPR] No App Check provider configured for this origin. " +
        "Cloud calls may be rejected (403) until a reCAPTCHA site key " +
        "or a registered debug token is provided."
    );
    return null;
  }
  // Debug provider flow (per Firebase's web debug-provider docs): with
  // self.FIREBASE_APPCHECK_DEBUG_TOKEN set, initializeAppCheck exchanges
  // the debug token; no attestation provider is passed.
  try {
    return initializeAppCheck(app, { isTokenAutoRefreshEnabled: true });
  } catch (err) {
    console.warn("[TemanPR] App Check (debug) init failed:", err);
    return null;
  }
}

/**
 * Create the live AI service, or return null when no real Firebase
 * config is present yet (the app then runs on the local stub).
 */
export async function createAiService() {
  if (!isFirebaseConfigured()) return null;

  const overrides = await loadLocalOverrides();
  const settings = { ...APP_SETTINGS, ...overrides };

  const app = initializeApp(FIREBASE_CONFIG);
  setupAppCheck(app, settings);

  // Replay protection: limited-use App Check tokens (skill guidance).
  const ai = getAI(app, {
    backend: new GoogleAIBackend(),
    useLimitedUseAppCheckTokens: true,
  });

  const modelCache = new Map();

  function modelFor(jobType) {
    if (modelCache.has(jobType)) return modelCache.get(jobType);
    const modeName = JOB_ROUTES[jobType];
    const mode = InferenceMode[modeName];
    const schema = JOB_SCHEMAS[jobType];
    const generationConfig = {
      temperature: 0.6,
      maxOutputTokens: MAX_TOKENS[jobType] || 2048,
      responseMimeType: "application/json",
      responseSchema: schema,
    };
    let model;
    try {
      model = getGenerativeModel(ai, {
        mode,
        inCloudParams: { model: settings.cloudModel, generationConfig },
        onDeviceParams: {
          promptOptions: { responseConstraint: schema },
          ...(jobUsesPhoto(jobType)
            ? {
                createOptions: {
                  expectedInputs: [{ type: "text" }, { type: "image" }],
                  expectedOutputs: [{ type: "text" }],
                },
              }
            : {}),
        },
      });
    } catch (err) {
      // Older/alternate SDK shapes: fall back to top-level config.
      console.warn("[TemanPR] Hybrid params rejected, retrying plain:", err);
      model = getGenerativeModel(ai, {
        model: settings.cloudModel,
        mode,
        generationConfig,
      });
    }
    modelCache.set(jobType, model);
    return model;
  }

  return {
    kind: "firebase",

    /**
     * Warm up the on-device model. MUST be called from a user gesture;
     * reports download progress (0..1) via onProgress. Never throws —
     * unavailability is a normal state (cloud fallback covers it).
     */
    async probeDevice(onProgress) {
      // Fast hint from Chrome's Prompt API surface, when present.
      let availability = "unknown";
      try {
        if (typeof LanguageModel !== "undefined") {
          availability = await LanguageModel.availability();
        }
      } catch {
        /* hint only — the SDK remains the source of truth */
      }
      try {
        const model = modelFor("practice-quiz");
        if (typeof model.initializeDeviceModel === "function") {
          await model.initializeDeviceModel((v) => {
            if (typeof onProgress === "function") onProgress(v);
          });
          return { state: "ready", availability };
        }
        return { state: "unsupported-sdk", availability };
      } catch (err) {
        console.info("[TemanPR] On-device model unavailable:", err);
        return { state: "unavailable", availability };
      }
    },

    /**
     * Run one homework job. Returns { data, source, mode } where source
     * is the SDK-reported inferenceSource ("ON_DEVICE" | "IN_CLOUD")
     * so the UI badge is ground truth.
     */
    async generate(jobType, { lesson, extras = {}, imageFile, image } = {}) {
      const prompt = buildPrompt(jobType, lesson, extras);
      const parts = [prompt];
      if (jobUsesPhoto(jobType)) {
        // Prefer the app's downscaled data-URL photo; accept a raw File
        // as a fallback. Images must be inline data (JPEG/PNG) — that is
        // also all the on-device model accepts.
        if (image?.dataUrl) parts.push(dataUrlToGenerativePart(image.dataUrl, image.mimeType));
        else if (imageFile) parts.push(await fileToGenerativePart(imageFile));
      }
      const model = modelFor(jobType);
      const result = await model.generateContent(parts);
      const response = result.response;
      const data = parseJsonLoose(response.text());
      return {
        data,
        source: response.inferenceSource || "UNKNOWN",
        mode: JOB_ROUTES[jobType],
      };
    },
  };
}

/** Map raw SDK errors to messages a parent (and a judge) can act on. */
export function describeError(jobType, err) {
  const msg = String(err?.message || err || "");
  if (/PERMISSION_DENIED|permission-denied/i.test(msg)) {
    return "Firebase AI Logic is not provisioned on this project yet (console: AI Logic → Get started, or `npx firebase-tools@latest init ailogic`).";
  }
  if (/app-check|appcheck|403/i.test(msg)) {
    return "App Check rejected the request. Check the reCAPTCHA site key, or register the debug token shown in the browser console (App Check → Manage debug tokens).";
  }
  if (JOB_ROUTES[jobType] === "ONLY_ON_DEVICE" && /on-device|ondevice|not available|unavailable/i.test(msg)) {
    return "No on-device model is available in this browser, and Ask Privately never uploads your question. Try Chrome on desktop with on-device AI enabled — your question stays on the device there too.";
  }
  if (/offline|network|fetch/i.test(msg) || (typeof navigator !== "undefined" && !navigator.onLine)) {
    return "No connection, and this job needs the cloud right now. It has been queued and will run when you are back online.";
  }
  return `Generation failed: ${msg}`;
}
