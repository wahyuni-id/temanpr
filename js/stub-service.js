/**
 * stub-service.js — LOCAL DEMO STUB. Clearly separated on purpose.
 *
 * Implements the exact same interface as ai-service.js
 * ({ kind, probeDevice, generate }) so the whole UI — forms, routing
 * labels, badges, offline queue, notebook — can be exercised before a
 * Firebase project exists. Outputs are deterministic templates built
 * from the lesson fields; they are NOT AI output and are always
 * badged "STUB" in the UI.
 *
 * The moment js/firebase-config.js contains a real project config,
 * app.js selects ai-service.js instead and this file is never called.
 */

import { JOB_TYPES } from "./prompts.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function inBI(lesson) {
  return (lesson?.language || "Bahasa Indonesia").toLowerCase().startsWith("bahasa");
}

function quizFor(lesson) {
  const topic = lesson?.topic || "tonight's topic";
  if (inBI(lesson)) {
    return [1, 2, 3, 4, 5].map((n) => ({
      q: `Soal latihan ${n} tentang ${topic} (contoh dari stub demo — hubungkan Firebase untuk soal asli).`,
      hint: "Ingat kembali contoh yang dijelaskan guru di kelas.",
      answer: "Kunci jawaban contoh dari stub demo.",
    }));
  }
  return [1, 2, 3, 4, 5].map((n) => ({
    q: `Practice question ${n} about ${topic} (demo stub sample — connect Firebase for real questions).`,
    hint: "Think back to the example the teacher used in class.",
    answer: "Sample answer key from the demo stub.",
  }));
}

export function createStubService() {
  return {
    kind: "stub",

    async probeDevice() {
      await sleep(400);
      return { state: "stub", availability: "stub" };
    },

    async generate(jobType, { lesson, extras = {} } = {}) {
      await sleep(650 + Math.random() * 500);
      const l = lesson || {};
      const topic = l.topic || "the topic";
      let data;
      switch (jobType) {
        case JOB_TYPES.EXPLAIN_PHOTO:
          data = {
            whatItAsks: inBI(l)
              ? `Lembar kerja ini meminta anak berlatih tentang ${topic}. (Penjelasan contoh dari stub demo.)`
              : `This worksheet asks the child to practise ${topic}. (Sample explanation from the demo stub.)`,
            steps: [
              { title: "Read it together", guide: "Ask your child to read the first question out loud, slowly." },
              { title: "Find the key idea", guide: `Point at the part of the question that is really about ${topic}.` },
              { title: "Let them try", guide: "Cover the rest of the page. One question at a time is enough." },
            ],
            keyIdeas: [topic, "Show your working, not just the answer"],
            tryTogether: "Can you explain to me, in your own words, what this question wants?",
            parentTip: "Praise the method, not just the right answer — methods repeat, answers don't.",
          };
          break;
        case JOB_TYPES.PRACTICE_QUIZ:
          data = { questions: quizFor(l) };
          break;
        case JOB_TYPES.EXPLAIN_SIMPLE:
          data = {
            simple: inBI(l)
              ? `Penjelasan sederhana tentang "${extras.text || topic}" akan muncul di sini setelah Firebase terhubung. (Stub demo.)`
              : `A simple explanation of "${extras.text || topic}" will appear here once Firebase is connected. (Demo stub.)`,
            example: "Think of it like sharing snacks fairly at home — everyone gets an equal part.",
            remember: "Small steps, said out loud, stick better.",
            checkQuestion: "What would you tell a friend this means?",
          };
          break;
        case JOB_TYPES.STUDY_PLAN:
          data = {
            blocks: [
              { minutes: 5, activity: "Settle in: water, pencils, phone away." },
              { minutes: 20, activity: `Hardest first: ${l.subject || "homework"} — ${topic}.` },
              { minutes: 5, activity: "Break: stand up, look far away, drink." },
              { minutes: 15, activity: "Second subject, lighter questions." },
              { minutes: 5, activity: "Pack the bag for tomorrow together." },
            ],
            parentTips: ["Sit nearby, not over the shoulder.", "End on a win, however small."],
          };
          break;
        case JOB_TYPES.ASK_PRIVATE:
          data = {
            answer:
              "This is a demo stub, so here is a sample of the shape of an answer: many children " +
              "go through a phase like this, and small daily practice at home usually helps more " +
              "than long weekend sessions. (Connect Firebase for a real on-device answer.)",
            firstSteps: ["Ten minutes of practice a day, same time each day.", "Make it a game, not a test."],
            talkToTeacher: "If it continues for more than a term, mention it to the teacher — they see patterns across the class.",
          };
          break;
        default:
          throw new Error(`Stub has no job: ${jobType}`);
      }
      return { data, source: "STUB", mode: "STUB" };
    },
  };
}
