# TemanPR — homework help that keeps your child's work on your device

**TemanPR** is a privacy-first homework companion for Indonesian parents, built with
**Firebase AI Logic hybrid inference**: Gemini Nano on-device (Chrome Prompt API) and
Gemini in the cloud, routed per job — because *everything about your child should stay
on the family device; only worksheet photos visit the cloud first, where the biggest
model reads them best.*

Set the class level, subject, and tonight's topic once, then run one-tap jobs. Every
result carries a **served-by badge** read from the response's real `inferenceSource` —
the app never guesses which engine ran.

## The five jobs and how they route

| Job | Inference mode | Why |
|---|---|---|
| Explain This Worksheet (photo) | `PREFER_IN_CLOUD` | Reading a photographed page deserves the big multimodal model; falls back to the device offline (JPEG/PNG is supported on-device). |
| Practice Quiz | `PREFER_ON_DEVICE` | Short structured text — Nano's home turf. Free, fast, works with no signal. |
| Explain It Simply | `PREFER_ON_DEVICE` | Single-turn text; the child's own wording stays on the device. |
| Tonight's Study Plan | `PREFER_IN_CLOUD` | The longest, most detailed output; cloud quality wins, device fallback offline. |
| Ask Privately | `ONLY_ON_DEVICE` | A parent's question about their child **never leaves the device**. No device model → nothing runs, nothing is uploaded. |

Cloud-preferring jobs created while offline are queued locally and run automatically
on reconnect. All state (queue, saved results) lives in the browser's localStorage —
there is no TemanPR server and no account.

## How Firebase AI Logic is used

- `js/ai-service.js` initializes the Firebase AI Logic JS SDK (pinned **13.4.0** via
  CDN import map, no build step) with the **Gemini Developer API** backend and
  `useLimitedUseAppCheckTokens: true` (App Check replay protection).
- Each job gets a hybrid `GenerativeModel` with its `InferenceMode`, the cloud model
  **`gemini-3.5-flash-lite`** in `inCloudParams`, and a JSON schema sent to the cloud
  as `responseSchema` and to the device as `responseConstraint`
  (`js/prompts.js` — one schema, both engines, identical rendering).
- The badge is `response.inferenceSource` (`ON_DEVICE` / `IN_CLOUD`) — ground truth
  from the SDK.
- **App Check**: reCAPTCHA Enterprise provider on the hosted site; a debug-token flow
  for local development (tokens live only in a gitignored local file — never committed).

## Run it

No build step. Serve the folder statically and open it:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Without a Firebase config, the app runs on a **clearly labeled demo stub** (banner +
`STUB` badges) so every flow — queue, notebook, badges — can be exercised.

### Go live with your own Firebase project

1. Create a Firebase project, then **AI Logic → Get started** and choose the
   **Gemini Developer API** (this provisions the service; config alone is not enough —
   without it, calls fail with `PERMISSION_DENIED`). CLI alternative:
   `npx -y firebase-tools@latest init ailogic`.
2. Register a **Web app** and paste its config into `js/firebase-config.js`
   (that file is the only place config lives).
3. **App Check**: create a reCAPTCHA Enterprise key, register the web app under
   Security → App Check, and paste the site key into `APP_SETTINGS.recaptchaSiteKey`
   in the same file. For localhost only, you may instead use the debug-token flow —
   see `js/firebase-config.local.example.js`.
4. Deploy anywhere static, e.g. Firebase Hosting: `npx -y firebase-tools@latest deploy --only hosting`.

### Try the on-device path (judges)

Open the hosted app in **Chrome Desktop ≥ 139**, click **Enable on-device AI**, and
allow the Gemini Nano download. Then run **Practice Quiz** or **Ask Privately** and
watch the badge read **ON-DEVICE**. Turn off your connection and run Practice Quiz
again — it still works; run Tonight's Study Plan and watch it queue instead.

## Tests

```bash
node test/routing.test.mjs
```

Verifies the routing table (including the privacy invariant: Ask Privately is the
only `ONLY_ON_DEVICE` job), schemas, prompt building, and stub output shapes.
Cloud/on-device inference itself can only be proven against the live project.

## License

MIT — see `LICENSE`.
