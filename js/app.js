/**
 * app.js — TemanPR UI wiring.
 *
 * Service selection: if js/firebase-config.js holds a real Firebase
 * project config, the live Firebase AI Logic service is used; otherwise
 * the clearly-labeled local stub (badged STUB everywhere) drives the
 * same UI so every flow can be exercised.
 *
 * State is local-only by design: lesson form, queue, and notebook live
 * in this browser's localStorage. Nothing is sent anywhere except the
 * AI calls themselves, routed per JOB_ROUTES.
 */

import { createAiService, describeError } from "./ai-service.js";
import { createStubService } from "./stub-service.js";
import { isFirebaseConfigured } from "./firebase-config.js";
import {
  JOB_TYPES,
  JOB_ROUTES,
  JOB_LABELS,
  jobUsesPhoto,
} from "./prompts.js";

const LS_QUEUE = "temanpr.queue.v1";
const LS_NOTEBOOK = "temanpr.notebook.v1";

const $ = (id) => document.getElementById(id);

const state = {
  service: null,
  photo: null, // { dataUrl, mimeType }
  queue: loadJson(LS_QUEUE, []),
  notebook: loadJson(LS_NOTEBOOK, []),
  running: new Set(),
};

function loadJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full/blocked — the app keeps working in-memory */
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* ------------------------------ lesson ------------------------------ */

function readLesson() {
  return {
    grade: $("lGrade").value,
    subject: $("lSubject").value,
    topic: $("lTopic").value.trim(),
    language: $("lLanguage").value,
  };
}

function readExtras(jobType) {
  switch (jobType) {
    case JOB_TYPES.EXPLAIN_PHOTO:
      return { note: $("lPhotoNote").value.trim() };
    case JOB_TYPES.EXPLAIN_SIMPLE:
    case JOB_TYPES.ASK_PRIVATE:
      return { text: $("lFreeText").value.trim() };
    case JOB_TYPES.STUDY_PLAN:
      return {
        minutes: Number($("lMinutes").value) || 60,
        subjects: $("lPlanSubjects").value.trim(),
      };
    default:
      return {};
  }
}

/* ------------------------------ photo ------------------------------- */

async function downscalePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.85), mimeType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* --------------------------- connectivity --------------------------- */

function effectiveOnline() {
  return navigator.onLine && !$("simOffline").checked;
}

function renderConnChip() {
  const chip = $("connChip");
  const online = effectiveOnline();
  chip.textContent = online ? "Online" : "Offline";
  chip.dataset.state = online ? "online" : "offline";
}

/* ------------------------------ badges ------------------------------ */

function badgeHtml(source) {
  if (source === "ON_DEVICE") return `<span class="badge badge-device">ON-DEVICE</span>`;
  if (source === "IN_CLOUD") return `<span class="badge badge-cloud">CLOUD</span>`;
  if (source === "QUEUED") return `<span class="badge badge-queued">QUEUED</span>`;
  if (source === "STUB") return `<span class="badge badge-stub">STUB</span>`;
  return `<span class="badge">${escapeHtml(source || "—")}</span>`;
}

/* ---------------------------- renderers ----------------------------- */

function listHtml(items) {
  return `<ul>${(items || []).map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
}

function renderData(jobType, data) {
  switch (jobType) {
    case JOB_TYPES.EXPLAIN_PHOTO:
      return `
        <h4>What it asks</h4><p>${escapeHtml(data.whatItAsks)}</p>
        <h4>Guide it step by step</h4>
        <ol>${(data.steps || []).map((s) => `<li><strong>${escapeHtml(s.title)}.</strong> ${escapeHtml(s.guide)}</li>`).join("")}</ol>
        <h4>Key ideas</h4>${listHtml(data.keyIdeas)}
        <h4>Try together</h4><p>${escapeHtml(data.tryTogether)}</p>
        <h4>Parent tip</h4><p>${escapeHtml(data.parentTip)}</p>`;
    case JOB_TYPES.PRACTICE_QUIZ:
      return (data.questions || [])
        .map(
          (q, i) => `
          <div class="quiz-q">
            <p><strong>${i + 1}.</strong> ${escapeHtml(q.q)}</p>
            <p class="hint">Hint: ${escapeHtml(q.hint)}</p>
            <details><summary>Show answer</summary><p>${escapeHtml(q.answer)}</p></details>
          </div>`
        )
        .join("");
    case JOB_TYPES.EXPLAIN_SIMPLE:
      return `
        <h4>In plain words</h4><p>${escapeHtml(data.simple)}</p>
        <h4>Everyday example</h4><p>${escapeHtml(data.example)}</p>
        <h4>Remember it like this</h4><p>${escapeHtml(data.remember)}</p>
        <h4>Check question</h4><p>${escapeHtml(data.checkQuestion)}</p>`;
    case JOB_TYPES.STUDY_PLAN: {
      const total = (data.blocks || []).reduce((a, b) => a + (Number(b.minutes) || 0), 0);
      return `
        <table class="plan"><tbody>
          ${(data.blocks || []).map((b) => `<tr><td class="mins">${escapeHtml(b.minutes)} min</td><td>${escapeHtml(b.activity)}</td></tr>`).join("")}
        </tbody></table>
        <p class="hint">Total: ${total} minutes</p>
        <h4>For you tonight</h4>${listHtml(data.parentTips)}`;
    }
    case JOB_TYPES.ASK_PRIVATE:
      return `
        <p>${escapeHtml(data.answer)}</p>
        <h4>Small first steps at home</h4>${listHtml(data.firstSteps)}
        <h4>Talking to the teacher</h4><p>${escapeHtml(data.talkToTeacher)}</p>`;
    default:
      return `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  }
}

/** Plain-text rendering for copy/export. */
function toText(jobType, data) {
  const lines = [];
  const walk = (v, indent = "") => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, indent));
    else if (v && typeof v === "object") Object.values(v).forEach((x) => walk(x, indent));
    else if (typeof v === "string" && v.trim()) lines.push(v);
    else if (typeof v === "number") lines.push(String(v));
  };
  walk(data);
  return lines.join("\n");
}

/* --------------------------- result cards --------------------------- */

function resultCard({ jobType, source, data, error, lessonLine, ts }) {
  const el = document.createElement("article");
  el.className = "result-card";
  const label = JOB_LABELS[jobType];
  el.innerHTML = `
    <header>
      <strong>${escapeHtml(label.title)}</strong>
      ${badgeHtml(source)}
      <span class="ts">${new Date(ts).toLocaleTimeString()}</span>
    </header>
    ${lessonLine ? `<p class="lesson-line">${escapeHtml(lessonLine)}</p>` : ""}
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : `<div class="result-body">${renderData(jobType, data)}</div>`}
    ${!error ? `<div class="card-actions"><button type="button" class="ghost-btn copy-btn">Copy</button></div>` : ""}`;
  const copyBtn = el.querySelector(".copy-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(toText(jobType, data));
        copyBtn.textContent = "Copied ✓";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
      } catch {
        copyBtn.textContent = "Copy failed";
      }
    });
  }
  return el;
}

function prependResult(card) {
  $("resultsEmpty")?.remove();
  $("results").prepend(card);
}

function lessonLine(lesson) {
  return [lesson.grade, lesson.subject, lesson.topic].filter(Boolean).join(" · ");
}

/* ------------------------------- queue ------------------------------ */

function renderQueue() {
  const panel = $("queuePanel");
  const list = $("queueList");
  panel.hidden = state.queue.length === 0;
  list.innerHTML = "";
  state.queue.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escapeHtml(JOB_LABELS[item.jobType].title)} — waiting for a connection</span>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost-btn danger";
    btn.textContent = "Cancel";
    btn.addEventListener("click", () => {
      state.queue = state.queue.filter((q) => q.id !== item.id);
      saveJson(LS_QUEUE, state.queue);
      renderQueue();
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
}

async function flushQueue() {
  if (!effectiveOnline() || state.queue.length === 0) return;
  const items = [...state.queue];
  state.queue = [];
  saveJson(LS_QUEUE, state.queue);
  renderQueue();
  for (const item of items) {
    await runJob(item.jobType, item.payload, { fromQueue: true });
  }
}

/* ------------------------------ notebook ---------------------------- */

function renderNotebook() {
  const box = $("notebook");
  box.innerHTML = "";
  if (state.notebook.length === 0) {
    box.innerHTML = `<p class="empty">Saved results will live here — in this browser only, never on a server.</p>`;
    return;
  }
  [...state.notebook].reverse().forEach((entry) => {
    box.appendChild(
      resultCard({
        jobType: entry.jobType,
        source: entry.source,
        data: entry.data,
        lessonLine: entry.lessonLine,
        ts: entry.ts,
      })
    );
  });
}

/* ------------------------------ run jobs ---------------------------- */

function validate(jobType, extras) {
  if (jobType === JOB_TYPES.EXPLAIN_PHOTO && !state.photo) {
    return "Add a worksheet photo first (left panel) — this job reads the photo.";
  }
  if (
    (jobType === JOB_TYPES.EXPLAIN_SIMPLE || jobType === JOB_TYPES.ASK_PRIVATE) &&
    !extras.text
  ) {
    return "Write the concept or question in the “Explain / ask” box first (left panel).";
  }
  return null;
}

async function runJob(jobType, payload, { fromQueue = false } = {}) {
  if (state.running.has(jobType) && !fromQueue) return;
  const route = JOB_ROUTES[jobType];

  // Cloud-preferring jobs wait politely when there is no connection.
  if (!fromQueue && route === "PREFER_IN_CLOUD" && !effectiveOnline()) {
    const item = { id: `${Date.now()}-${jobType}`, jobType, payload };
    state.queue.push(item);
    saveJson(LS_QUEUE, state.queue);
    renderQueue();
    prependResult(
      resultCard({
        jobType,
        source: "QUEUED",
        data: null,
        error: "No connection right now — this job is queued and will run by itself when you are back online.",
        lessonLine: lessonLine(payload.lesson),
        ts: Date.now(),
      })
    );
    return;
  }

  state.running.add(jobType);
  const btn = document.querySelector(`[data-run="${jobType}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Working…";
  }
  try {
    const { data, source } = await state.service.generate(jobType, payload);
    const entry = {
      jobType,
      source,
      data,
      lessonLine: lessonLine(payload.lesson),
      ts: Date.now(),
    };
    prependResult(resultCard(entry));
    state.notebook.push(entry);
    saveJson(LS_NOTEBOOK, state.notebook);
    renderNotebook();
  } catch (err) {
    prependResult(
      resultCard({
        jobType,
        source: "—",
        data: null,
        error: describeError(jobType, err),
        lessonLine: lessonLine(payload.lesson),
        ts: Date.now(),
      })
    );
  } finally {
    state.running.delete(jobType);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Run";
    }
  }
}

function onRunClicked(jobType) {
  const lesson = readLesson();
  const extras = readExtras(jobType);
  const problem = validate(jobType, extras);
  if (problem) {
    prependResult(
      resultCard({
        jobType,
        source: "—",
        data: null,
        error: problem,
        lessonLine: lessonLine(lesson),
        ts: Date.now(),
      })
    );
    return;
  }
  const payload = { lesson, extras };
  if (jobUsesPhoto(jobType) && state.photo) payload.image = state.photo;
  runJob(jobType, payload);
}

/* ------------------------------ job cards --------------------------- */

function renderJobCards() {
  const box = $("jobCards");
  box.innerHTML = "";
  Object.values(JOB_TYPES).forEach((jobType) => {
    const label = JOB_LABELS[jobType];
    const card = document.createElement("div");
    card.className = "job-card";
    card.innerHTML = `
      <div>
        <h3>${escapeHtml(label.title)}</h3>
        <p>${escapeHtml(label.blurb)}</p>
        <p class="route-note">${escapeHtml(label.routeNote)}</p>
      </div>
      <button type="button" class="run-btn" data-run="${jobType}">Run</button>`;
    card.querySelector("button").addEventListener("click", () => onRunClicked(jobType));
    box.appendChild(card);
  });
}

/* ------------------------------ device AI --------------------------- */

async function enableDevice() {
  const chip = $("deviceChip");
  const btn = $("enableDeviceBtn");
  btn.disabled = true;
  chip.textContent = "Device AI: checking…";
  try {
    const res = await state.service.probeDevice((v) => {
      if (typeof v === "number") {
        chip.textContent = `Device AI: downloading ${Math.round(v * 100)}%`;
      }
    });
    if (res.state === "ready") chip.textContent = "Device AI: ready";
    else if (res.state === "stub") chip.textContent = "Device AI: demo stub";
    else chip.textContent = "Device AI: unavailable — cloud will be used";
  } finally {
    btn.disabled = false;
  }
}

/* -------------------------------- init ------------------------------ */

async function init() {
  renderJobCards();
  renderQueue();
  renderNotebook();
  renderConnChip();

  const live = isFirebaseConfigured() ? await createAiService() : null;
  state.service = live || createStubService();

  const chip = $("serviceChip");
  if (state.service.kind === "firebase") {
    chip.textContent = "Firebase AI Logic: live";
    $("stubBanner").hidden = true;
  } else {
    chip.textContent = "Demo stub (no Firebase config)";
    $("stubBanner").hidden = false;
  }

  $("enableDeviceBtn").addEventListener("click", enableDevice);
  $("simOffline").addEventListener("change", () => {
    renderConnChip();
    flushQueue();
  });
  window.addEventListener("online", () => {
    renderConnChip();
    flushQueue();
  });
  window.addEventListener("offline", renderConnChip);

  $("lPhoto").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    state.photo = await downscalePhoto(file);
    const preview = $("photoPreview");
    preview.src = state.photo.dataUrl;
    preview.hidden = false;
  });

  $("exportBtn").addEventListener("click", () => {
    const text = state.notebook
      .map(
        (e) =>
          `=== ${JOB_LABELS[e.jobType].title} [${e.source}] ${new Date(e.ts).toLocaleString()} ===\n${e.lessonLine}\n\n${toText(e.jobType, e.data)}`
      )
      .join("\n\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = "temanpr-notebook.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("clearBtn").addEventListener("click", () => {
    state.notebook = [];
    saveJson(LS_NOTEBOOK, state.notebook);
    renderNotebook();
  });

  // Jobs queued in a previous session run when we are back online.
  flushQueue();
}

init();
