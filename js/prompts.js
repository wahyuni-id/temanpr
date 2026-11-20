/**
 * prompts.js — TemanPR's homework jobs: routing, output schemas, prompts.
 *
 * Every job returns structured JSON. The same schema object is sent to
 * the cloud model as `responseSchema` and to the on-device model as the
 * Prompt API `responseConstraint`, so both engines answer in the same
 * shape and the UI renders them identically.
 *
 * Routing rationale (see ../DESIGN.md §2) — the product's promise is
 * "everything about your child stays on the device; only worksheet
 * photos visit the cloud first, because reading them deserves the
 * biggest model":
 *  - practice + simple explanations (text, frequent) -> PREFER_ON_DEVICE
 *  - worksheet photo reading / the long evening plan -> PREFER_IN_CLOUD
 *  - a parent's private question about their child   -> ONLY_ON_DEVICE
 */

export const JOB_TYPES = {
  EXPLAIN_PHOTO: "explain-photo",
  PRACTICE_QUIZ: "practice-quiz",
  EXPLAIN_SIMPLE: "explain-simple",
  STUDY_PLAN: "study-plan",
  ASK_PRIVATE: "ask-private",
};

/** InferenceMode names from firebase/ai — kept as strings so this file
 *  stays SDK-free and unit-testable in Node; ai-service.js maps them
 *  to the real enum. */
export const JOB_ROUTES = {
  [JOB_TYPES.EXPLAIN_PHOTO]: "PREFER_IN_CLOUD",
  [JOB_TYPES.PRACTICE_QUIZ]: "PREFER_ON_DEVICE",
  [JOB_TYPES.EXPLAIN_SIMPLE]: "PREFER_ON_DEVICE",
  [JOB_TYPES.STUDY_PLAN]: "PREFER_IN_CLOUD",
  [JOB_TYPES.ASK_PRIVATE]: "ONLY_ON_DEVICE",
};

export const JOB_LABELS = {
  [JOB_TYPES.EXPLAIN_PHOTO]: {
    title: "Explain This Worksheet",
    blurb: "Photograph a worksheet page — get guidance you can teach from, not just answers.",
    routeNote: "Cloud first — reading a photo deserves the big model. Falls back to the device when offline.",
  },
  [JOB_TYPES.PRACTICE_QUIZ]: {
    title: "Practice Quiz",
    blurb: "5 practice questions on tonight's topic, with hints and a hidden answer key.",
    routeNote: "Runs on-device first — fast, free, and works with no signal at all.",
  },
  [JOB_TYPES.EXPLAIN_SIMPLE]: {
    title: "Explain It Simply",
    blurb: "Paste a confusing concept — get a plain-words explanation with an everyday example.",
    routeNote: "Runs on-device first — your child's own wording stays on this device.",
  },
  [JOB_TYPES.STUDY_PLAN]: {
    title: "Tonight's Study Plan",
    blurb: "A timed plan for tonight: subjects, minutes, breaks, and what you can do to help.",
    routeNote: "Cloud first — the longest, most detailed output. Falls back to the device offline.",
  },
  [JOB_TYPES.ASK_PRIVATE]: {
    title: "Ask Privately",
    blurb: "A sensitive question about your child. It is answered here, and only here.",
    routeNote: "On-device ONLY — if no device model is available, nothing runs and nothing is uploaded. Ever.",
  },
};

/* ------------------------------- schemas ------------------------------ */

const stepList = {
  type: "array",
  items: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short step title, e.g. 'Find the common denominator'." },
      guide: { type: "string", description: "How the parent explains this step to the child, in warm plain words, max ~60 words." },
    },
    required: ["title", "guide"],
  },
  description: "3-6 teaching steps, in order.",
};

export const JOB_SCHEMAS = {
  [JOB_TYPES.EXPLAIN_PHOTO]: {
    type: "object",
    properties: {
      whatItAsks: { type: "string", description: "One or two sentences: what this worksheet page asks the child to do." },
      steps: stepList,
      keyIdeas: { type: "array", items: { type: "string" }, description: "2-4 key ideas the child needs for this page." },
      tryTogether: { type: "string", description: "One question the parent can ask the child to check understanding." },
      parentTip: { type: "string", description: "One practical tip for helping without doing the work for the child." },
    },
    required: ["whatItAsks", "steps", "keyIdeas", "tryTogether", "parentTip"],
  },
  [JOB_TYPES.PRACTICE_QUIZ]: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            q: { type: "string", description: "The practice question, right for the class level." },
            hint: { type: "string", description: "A hint that nudges without giving the answer." },
            answer: { type: "string", description: "The correct answer, with a one-line why." },
          },
          required: ["q", "hint", "answer"],
        },
        description: "Exactly 5 questions, growing slightly harder.",
      },
    },
    required: ["questions"],
  },
  [JOB_TYPES.EXPLAIN_SIMPLE]: {
    type: "object",
    properties: {
      simple: { type: "string", description: "The explanation in plain words a child of this class level understands, max ~120 words." },
      example: { type: "string", description: "One everyday example from Indonesian home life that makes the idea concrete." },
      remember: { type: "string", description: "One short sentence or trick to remember it by." },
      checkQuestion: { type: "string", description: "One question the parent can ask to check the child got it." },
    },
    required: ["simple", "example", "remember", "checkQuestion"],
  },
  [JOB_TYPES.STUDY_PLAN]: {
    type: "object",
    properties: {
      blocks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            minutes: { type: "integer", description: "How long this block lasts, in minutes." },
            activity: { type: "string", description: "What to do in this block, concretely." },
          },
          required: ["minutes", "activity"],
        },
        description: "The evening's blocks in order, including short breaks. Total minutes must not exceed the time available.",
      },
      parentTips: { type: "array", items: { type: "string" }, description: "2-3 short tips for the parent tonight." },
    },
    required: ["blocks", "parentTips"],
  },
  [JOB_TYPES.ASK_PRIVATE]: {
    type: "object",
    properties: {
      answer: { type: "string", description: "A warm, honest, practical answer, max ~180 words. Supportive, never alarmist." },
      firstSteps: { type: "array", items: { type: "string" }, description: "2-4 small things the parent can try at home this week." },
      talkToTeacher: { type: "string", description: "When and why to raise this with the child's teacher, in one or two sentences." },
    },
    required: ["answer", "firstSteps", "talkToTeacher"],
  },
};

/* --------------------------- prompt builders -------------------------- */

function lessonBrief(lesson) {
  const lines = [
    `Child's class level: ${lesson.grade || "Kelas 4 SD"}`,
    lesson.subject ? `Subject: ${lesson.subject}` : null,
    lesson.topic ? `Tonight's topic: ${lesson.topic}` : null,
    `Write your answer in: ${lesson.language || "Bahasa Indonesia"}`,
  ];
  return lines.filter(Boolean).join("\n");
}

const ROLE =
  "You are TemanPR, a warm and patient homework companion for Indonesian parents " +
  "helping their child with schoolwork (PR). Your job is to help the PARENT teach: " +
  "explain steps and ideas, and let the child do the work — never just hand over a " +
  "finished assignment. Use language and examples right for the child's class level " +
  "and for everyday Indonesian home life. Never invent curriculum facts you are " +
  "unsure of; if a worksheet detail is unclear, say what part is unclear instead of " +
  "guessing. Return ONLY a JSON object matching the requested schema — no markdown, " +
  "no commentary.";

const PRIVATE_ROLE =
  "You are TemanPR, a warm and sensible companion for Indonesian parents. A parent is " +
  "asking a private question about their own child. Be supportive and practical: " +
  "normalise what is common for the child's age, suggest small things to try at home, " +
  "and say plainly when something is worth raising with the teacher. Never diagnose " +
  "any medical, psychological, or learning condition, and never use alarming words. " +
  "Return ONLY a JSON object matching the requested schema — no markdown, no commentary.";

export function buildPrompt(jobType, lesson, extras = {}) {
  const brief = lessonBrief(lesson || {});
  switch (jobType) {
    case JOB_TYPES.EXPLAIN_PHOTO:
      return (
        `${ROLE}\n\n${brief}\n\nTask: look at the attached photo of a worksheet page. ` +
        `Explain what it asks and give the parent steps to guide the child through it. ` +
        `Do NOT simply list final answers; teach the method.` +
        (extras.note ? `\n\nParent's note: ${extras.note}` : "")
      );
    case JOB_TYPES.PRACTICE_QUIZ:
      return (
        `${ROLE}\n\n${brief}\n\nTask: create a practice quiz of exactly 5 questions on ` +
        `tonight's topic for this class level. Each question needs a hint that nudges ` +
        `without giving the answer, plus the correct answer with a one-line why.`
      );
    case JOB_TYPES.EXPLAIN_SIMPLE:
      return (
        `${ROLE}\n\n${brief}\n\nTask: explain the following concept or question in plain ` +
        `words for this child, with one everyday example and one check question.\n\n"""${extras.text || ""}"""`
      );
    case JOB_TYPES.STUDY_PLAN:
      return (
        `${ROLE}\n\n${brief}\n\nTask: build a study plan for tonight. The family has ` +
        `${extras.minutes || 60} minutes. Subjects to cover: ${extras.subjects || lesson?.subject || "tonight's homework"}. ` +
        `Include short breaks, start with the hardest subject, and end with something light.`
      );
    case JOB_TYPES.ASK_PRIVATE:
      return (
        `${PRIVATE_ROLE}\n\nChild's class level: ${lesson?.grade || "Kelas 4 SD"}\n` +
        `Write your answer in: ${lesson?.language || "Bahasa Indonesia"}\n\n` +
        `Parent's private question:\n"""${extras.text || ""}"""`
      );
    default:
      throw new Error(`Unknown job type: ${jobType}`);
  }
}

/** Jobs that attach the worksheet photo when one is provided. */
export function jobUsesPhoto(jobType) {
  return jobType === JOB_TYPES.EXPLAIN_PHOTO;
}
