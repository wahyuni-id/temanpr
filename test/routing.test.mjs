/**
 * routing.test.mjs — local checks for TemanPR's routing logic.
 *
 * Run:  node test/routing.test.mjs
 *
 * These tests cover everything that can be verified WITHOUT a live
 * Firebase project or a real Gemini Nano device:
 *  - every job has a valid InferenceMode route, a schema, and a label
 *  - the privacy invariant: ask-private is ONLY_ON_DEVICE, and it is
 *    the ONLY job with that mode
 *  - prompt building includes the lesson context and the user's text,
 *    and throws on unknown jobs
 *  - the demo stub honours the ai-service interface and returns data
 *    matching each job's schema-required keys, badged STUB
 *
 * They do NOT prove cloud or on-device inference — that needs the live
 * Firebase project (SETUP.md §5). Headless Chromium in CI ships a fake
 * Prompt API stub, so no local test may claim the device path works.
 */

import assert from "node:assert/strict";

import {
  JOB_TYPES,
  JOB_ROUTES,
  JOB_LABELS,
  JOB_SCHEMAS,
  buildPrompt,
  jobUsesPhoto,
} from "../js/prompts.js";
import { createStubService } from "../js/stub-service.js";
import { isFirebaseConfigured, FIREBASE_CONFIG } from "../js/firebase-config.js";

const VALID_MODES = new Set([
  "PREFER_ON_DEVICE",
  "ONLY_ON_DEVICE",
  "PREFER_IN_CLOUD",
  "ONLY_IN_CLOUD",
]);

const jobs = Object.values(JOB_TYPES);
let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok — ${name}`);
}

console.log("TemanPR routing checks");

check("there are exactly 5 jobs", () => {
  assert.equal(jobs.length, 5);
});

check("every job has a valid route, schema, and label", () => {
  for (const job of jobs) {
    assert.ok(VALID_MODES.has(JOB_ROUTES[job]), `${job}: route ${JOB_ROUTES[job]}`);
    assert.equal(JOB_SCHEMAS[job]?.type, "object", `${job}: schema`);
    assert.ok(JOB_SCHEMAS[job].required?.length > 0, `${job}: schema.required`);
    assert.ok(JOB_LABELS[job]?.title && JOB_LABELS[job]?.routeNote, `${job}: label`);
  }
});

check("privacy invariant: ask-private is the only ONLY_ON_DEVICE job", () => {
  assert.equal(JOB_ROUTES[JOB_TYPES.ASK_PRIVATE], "ONLY_ON_DEVICE");
  const onlyDevice = jobs.filter((j) => JOB_ROUTES[j] === "ONLY_ON_DEVICE");
  assert.deepEqual(onlyDevice, [JOB_TYPES.ASK_PRIVATE]);
});

check("routing shape: 2 device-preferred, 2 cloud-preferred, 1 device-only", () => {
  const count = (m) => jobs.filter((j) => JOB_ROUTES[j] === m).length;
  assert.equal(count("PREFER_ON_DEVICE"), 2);
  assert.equal(count("PREFER_IN_CLOUD"), 2);
  assert.equal(count("ONLY_ON_DEVICE"), 1);
});

check("only the worksheet job uses a photo", () => {
  for (const job of jobs) {
    assert.equal(jobUsesPhoto(job), job === JOB_TYPES.EXPLAIN_PHOTO, job);
  }
});

const lesson = {
  grade: "Kelas 4 SD",
  subject: "Matematika",
  topic: "Pecahan senilai",
  language: "Bahasa Indonesia",
};

check("prompts carry the lesson context", () => {
  const p = buildPrompt(JOB_TYPES.PRACTICE_QUIZ, lesson);
  assert.match(p, /Kelas 4 SD/);
  assert.match(p, /Pecahan senilai/);
  assert.match(p, /Bahasa Indonesia/);
});

check("private prompt carries the parent's text and a no-diagnosis guardrail", () => {
  const p = buildPrompt(JOB_TYPES.ASK_PRIVATE, lesson, { text: "Anak saya masih tertukar b dan d" });
  assert.match(p, /tertukar b dan d/);
  assert.match(p, /Never diagnose/);
});

check("photo prompt tells the model to teach, not hand over answers", () => {
  const p = buildPrompt(JOB_TYPES.EXPLAIN_PHOTO, lesson, { note: "stuck on number 3" });
  assert.match(p, /teach the method/i);
  assert.match(p, /stuck on number 3/);
});

check("unknown job throws", () => {
  assert.throws(() => buildPrompt("nope", lesson), /Unknown job type/);
});

check("shipped config is placeholders (app must boot in stub mode)", () => {
  assert.equal(isFirebaseConfigured(), false);
  assert.equal(FIREBASE_CONFIG.apiKey, "REPLACE_ME");
});

const stub = createStubService();
{
  const res = await stub.probeDevice();
  assert.equal(res.state, "stub");
  passed += 1;
  console.log("  ok — stub probe reports the stub state");
}

for (const job of jobs) {
  const extras =
    job === JOB_TYPES.EXPLAIN_SIMPLE || job === JOB_TYPES.ASK_PRIVATE
      ? { text: "contoh teks" }
      : job === JOB_TYPES.STUDY_PLAN
        ? { minutes: 60, subjects: "Matematika" }
        : job === JOB_TYPES.EXPLAIN_PHOTO
          ? { note: "" }
          : {};
  const { data, source } = await stub.generate(job, { lesson, extras });
  check(`stub output for ${job} matches schema-required keys, badged STUB`, () => {
    assert.equal(source, "STUB");
    for (const key of JOB_SCHEMAS[job].required) {
      assert.ok(key in data, `${job}: missing ${key}`);
    }
  });
}

console.log(`\nAll ${passed} checks passed.`);
