# Current execution update (2026-09-19)

User stopped Kimi/multi-agent dispatch. Codex direct implementation only. Local pilot verified; public cloud not deployed. See handoffs/A/2026-09-19-collection-final.md. The worker policy below describes historical execution, not authorization to dispatch again.

# Collection pilot / 2026-09-19

User authorized Codex-controlled Kimi workers and requested data collection/cloud workflow. User confirmed no cloud account: deliver localhost end-to-end persistent collection plus deployable artifacts and deployment plan. No purchase or actual cloud deployment. Preserve current UI and preview.html/preview-immersive.html. This is a single-trial synthetic engineering pilot, not approved participant recruitment or frozen multi-trial/jsPsych study.

TypeScript remains mandatory. Node 24 built-in node:sqlite + HTTP avoids new runtime dependencies. One server process and persistent disk. Build server with Vite SSR (controller owns config). Serve built frontend from same origin; /collect.html is the new collection entry. Existing demos remain memory-only. No external AI call; scripted ChatService stays. Synthetic data only; no names/phone/age assumptions.

## Frozen HTTP interface

JSON /api errors: {error:{code,message}}, non-2xx. No secrets in responses/logs. Same-origin, HttpOnly SameSite=Strict session cookie, Secure iff configured HTTPS; random bearer token hashed in DB, not session ID alone. POST requests application/json; enforce Origin when supplied, reject cross-origin. No permissive CORS. Payload bounded, no stacks, admin export authenticated separately.

- GET /api/health -> {ok:true, storage:'sqlite', simulation:true}
- POST /api/session body {credential: EntryCredential, entry: EntryAcknowledgement} -> Snapshot; validates entry code and versions. Existing authenticated cookie resumes existing session, without clearing prior events. No session is created before consent and start.
- GET /api/session -> Snapshot or 401. Snapshot = {session:Session, events:EventEnvelope[], entry:EntryAcknowledgement, completed:boolean}. This response MUST NOT include future result/advice.
- GET /api/trial -> PublicTrial, fixed trial_id preview-trial-1; prior consent required.
- GET /api/advice -> RevealedAdviceBlock, source gating identical to local demo, no advice on human.
- GET /api/feedback -> TrialFeedback, only after final prediction persisted.
- POST /api/events body {events:EventEnvelope[]} -> SaveReceipt, durable transactional idempotence/conflict/sequence/identity/version checks. Reject foreign session IDs. Ack only committed events. Reuse existing single-trial validation via adapter replay if practical; allow seeded Session in local demo as server-only option. On replay call loadAdvice before advice_revealed and getFeedback before feedback_presented. Never weaken validation to accept replay.
- POST /api/audit body {records: AuditRecord[]} -> {acknowledged_ids:string[],persisted_at:string,receipt_id:string}; AuditRecord = {id:string,type:string,at_ms:number,data:unknown}. Bound size; idempotent same-ID same-body, reject conflict. No recursive network calls.
- POST /api/finish body {} -> SaveReceipt completed only when mandatory core records are persisted. Frontend must flush pending audit before requesting finish.
- GET /api/export -> own authenticated session {simulation:true,persistence_scope:'remote',session,events,entry,presentation_audit,feedback:null|TrialFeedback}; feedback null until final prediction. No tokens. AuditRecord IDs preserved.
- GET /api/admin/export -> {simulation:true,sessions: above[]}, admin Bearer env token required; optional ?format=csv yields one summary row per session with safe CSV escaping, correct/missing fields distinct.
- POST /api/logout body {} -> {ok:true}, clears cookie only, never deletes records.

SQLite sessions store immutable session + entry, hashed token; events unique(session,event_id) and unique(session,sequence). Persist adviceLoaded/feedbackLoaded or reconstruct consistent phase gating. Server restart preserves identities, events, results and completion. Do not use memory map as durable authority. Server frontend static must deny traversal/dotfiles, source maps, database/admin secrets, and serve only intended dist files. Deny unknown API paths; no public arbitrary database queries.

## Server exports / configuration

server/app.ts exports createCollectionServer(options): {server:http.Server,close:()=>Promise<void>}; options {databasePath:string,entryCode:string,adminToken:string,staticDir?:string,secureCookies?:boolean}. server/main.ts uses HOST(default127.0.0.1), PORT(default5200), DATA_PATH, ENTRY_CODE, ADMIN_TOKEN, STATIC_DIR(defaultdist), SECURE_COOKIES. Refuse missing entry/admin secrets; no baked-in default credentials. Tests supply synthetic secrets. NODE_ENV=production requires secure cookies. Server build dist-server/main.js, Node24.

## Frontend boundaries

HTTP adapter implements existing ExperimentAdapter; credentials include user-entered entry code, user-selected participation mode, observed device type. Additional helpers snapshot(), export(), saveAudit(), logout() belong to remote adapter. Fetch credentials same-origin, timeouts and bounded retry; unknown responses schema-validated. Never say saved/complete without server receipts.

ImmersiveRun can accept optional entry credential and restore confirmed raw events. Initialize optional existing snapshot; restore records map and sequence, independent/final/source/advice/stage. Partial prediction+missing confidence must retry same original choice, not overwrite. Restored final-submitted goes ready, restored feedback-presented finishes pending completion safely. Completed session shows result and export. Record feedback-presented only after actual render. Audit records must have stable IDs; queue persists in sessionStorage before sending; remove only acknowledged IDs. No client future outcome bundle dependency in collect entry.

New bootstrap-collection.ts wires entry, code/participation mode form, HTTP adapter, controller and existing machine/chat UI. Reuse styles. Consent copy must explicitly describe server storage and restart recovery for this collection pilot, no old memory-only promises; extend entry materials injection without changing default preview behavior. Existing begin/end UI accepts options/callbacks for collection labels, remote export and new session logout. Browser reload resumes locked answers from server and retries pending events/audit with same IDs. Resume should not pretend chat partial text is unread; reuse saved audit where possible or clearly distinguish re-presentation. No individual payment/personal profile fields until research decision.

## Worker execution policy

Workers receive file-only MCP tools with canonical-root and allowlist checks, no native Shell/network/subagent tools. Only Kimi model transport uses network. This is tool-level containment, not OS sandbox. Controller verifier runs candidate code locally; controller audits critical routes and auth. At most three workers, no recursive agents. Logs stay in ignored artifacts/swarm, task/results are JSON. Tokens/cost unavailable -> null, never estimates labelled measured.
