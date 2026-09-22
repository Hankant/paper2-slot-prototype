// @vitest-environment node
/**
 * HTTP integration tests for the durable SQLite collection backend
 * (.agents/architecture.md frozen interface).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONTRACT_VERSION, CLIENT_VERSION, type EventEnvelope } from '@contracts';
import { createCollectionServer } from '../../server/app.js';

const ENTRY_CODE = 'TEST-ENTRY-0001';
const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';
const CONSENT_VERSION = 'collect-consent-2026-09-22-v2';
const INSTRUCTIONS_VERSION = 'collect-instructions-2026-09-22-v2';
const TRIAL_ID = 'preview-trial-1';
const ADVICE_ID = 'preview-advice-1';

const tempDir = mkdtempSync(path.join(tmpdir(), 'collect-server-'));

interface ApiResponse {
  status: number;
  json: unknown;
  setCookies: string[];
}

class Client {
  cookie = '';
  constructor(private getBaseUrl: () => string) {}
  async request(
    method: string,
    pathname: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<ApiResponse> {
    const response = await fetch(`${this.getBaseUrl()}${pathname}`, {
      method,
      headers: {
        // Force a fresh socket per request: the restart tests close and rebind
        // the server, and undici's keep-alive pool would otherwise reuse the
        // dead socket and fail with ECONNRESET.
        connection: 'close',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookies =
      typeof (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie ===
      'function'
        ? (response.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
        : [];
    for (const raw of setCookies) {
      const pair = raw.split(';')[0] ?? '';
      if (pair.includes(`${'collect_session'}=`)) this.cookie = pair;
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: response.status, json, setCookies };
  }
}

let baseUrl = '';
let closeServer: () => Promise<void> = () => Promise.resolve();

async function startServer(databasePath: string): Promise<void> {
  const { server, close } = createCollectionServer({
    databasePath,
    entryCode: ENTRY_CODE,
    adminToken: ADMIN_TOKEN,
    secureCookies: false,
  });
  closeServer = close;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await closeServer();
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function credential(entryCode: string) {
  return {
    entry_code: entryCode,
    observed_participation_mode: 'remote',
    observed_device_class: 'desktop',
    client_versions: {
      protocol_version: 'unreleased',
      contract_version: CONTRACT_VERSION,
      material_version: '0.3.0',
      client_version: CLIENT_VERSION,
    },
  };
}

function entryAck() {
  const now = new Date().toISOString();
  return {
    consent_version: CONSENT_VERSION,
    instructions_version: INSTRUCTIONS_VERSION,
    accepted_at: now,
    started_at: now,
  };
}

interface SessionInfo {
  session_id: string;
  participant_id: string;
}

let eventCounter = 0;
function makeEvent(
  session: SessionInfo,
  type: EventEnvelope['event_type'],
  payload: unknown,
  overrides: Record<string, unknown> = {},
): EventEnvelope {
  const trialLevel = ![
    'consent_recorded',
    'practice_completed',
    'profile_submitted',
    'session_completion_requested',
  ].includes(type);
  return {
    schema_version: '0.3.0',
    contract_version: CONTRACT_VERSION,
    protocol_version: 'unreleased',
    material_version: '0.3.0',
    client_version: CLIENT_VERSION,
    session_id: session.session_id,
    participant_id: session.participant_id,
    event_id: randomUUID(),
    sequence_no: eventCounter,
    ...(trialLevel ? { trial_id: TRIAL_ID } : {}),
    phase:
      type === 'consent_recorded' ? 'consent' : type === 'practice_completed' ? 'practice' : 'main',
    event_type: type,
    client_timestamp: new Date().toISOString(),
    elapsed_ms: eventCounter * 250,
    payload,
    ...overrides,
  } as EventEnvelope;
}

async function saveEvent(client: Client, event: EventEnvelope) {
  const response = await client.request('POST', '/api/events', { events: [event] });
  expect(response.status).toBe(200);
  return response.json as {
    acknowledged_event_ids: string[];
    rejected_events: { event_id: string; reason_code: string; reason_message: string }[];
    persistence_scope: string;
    persisted_at: string | null;
    receipt_id: string | null;
    session_status: string;
    current_phase: string;
  };
}

function errCode(response: ApiResponse): string {
  return (response.json as { error: { code: string } }).error.code;
}

describe('collection server', () => {
  it('rejects unknown consent, strips entry secrets and rejects conflicting audit batches', async () => {
    await startServer(path.join(tempDir, 'validation.sqlite'));
    const client = new Client(() => baseUrl);
    const bad = await client.request('POST', '/api/session', {
      credential: credential(ENTRY_CODE),
      entry: { ...entryAck(), consent_version: 'arbitrary' },
    });
    expect(bad.status).toBe(400);
    expect((await client.request('GET', '/api/session')).status).toBe(401);
    const opened = await client.request('POST', '/api/session', {
      credential: credential(ENTRY_CODE),
      entry: { ...entryAck(), entry_code: ENTRY_CODE, extra: 'private' },
    });
    expect(opened.status).toBe(200);
    expect(JSON.stringify(opened.json)).not.toContain(ENTRY_CODE);
    expect(JSON.stringify(opened.json)).not.toContain('private');
    const record = { id: 'same', type: 'opened', at_ms: 1, data: null };
    const conflict = await client.request('POST', '/api/audit', {
      records: [record, { ...record, data: 'different' }],
    });
    expect(conflict.status).toBe(409);
    const data = (await client.request('GET', '/api/export')).json as {
      presentation_audit: unknown[];
    };
    expect(data.presentation_audit).toEqual([]);
    const textPost = await client.request(
      'POST',
      '/api/logout',
      {},
      { 'content-type': 'text/plain' },
    );
    expect(textPost.status).toBe(415);
  });

  it('preserves advice loading across restart before presentation, without auto-loading on write', async () => {
    const dbPath = path.join(tempDir, 'loaded.sqlite');
    await startServer(dbPath);
    const client = new Client(() => baseUrl);
    const opened = await client.request('POST', '/api/session', {
      credential: credential(ENTRY_CODE),
      entry: entryAck(),
    });
    const session = (opened.json as { session: SessionInfo }).session;
    eventCounter = 0;
    await saveEvent(client, makeEvent(session, 'consent_recorded', { version: CONSENT_VERSION }));
    eventCounter = 1;
    await saveEvent(
      client,
      makeEvent(session, 'prediction_submitted', { machine_id: 'A', display_position: 'left' }),
    );
    eventCounter = 2;
    await saveEvent(client, makeEvent(session, 'confidence_submitted', { confidence_percent: 70 }));
    eventCounter = 3;
    await saveEvent(client, makeEvent(session, 'source_selected', { source: 'ai' }));
    eventCounter = 4;
    const presented = makeEvent(session, 'advice_revealed', {
      advice_id: ADVICE_ID,
      revealed_at_phase: 'main',
    });
    const denied = await saveEvent(client, presented);
    expect(denied.acknowledged_event_ids).toEqual([]);
    expect((await client.request('GET', '/api/advice')).status).toBe(200);
    await closeServer();
    await startServer(dbPath);
    const accepted = await saveEvent(client, presented);
    expect(accepted.acknowledged_event_ids).toEqual([presented.event_id]);
  });
  it('runs the full self branch durably and withholds outcomes before final', async () => {
    await startServer(path.join(tempDir, 'self.sqlite'));
    const client = new Client(() => baseUrl);

    const health = await client.request('GET', '/api/health');
    expect(health.json).toEqual({ ok: true, storage: 'sqlite', simulation: true });

    // Wrong entry code is rejected and creates no session.
    const wrong = await client.request('POST', '/api/session', {
      credential: credential('WRONG-CODE'),
      entry: entryAck(),
    });
    expect(wrong.status).toBe(401);
    expect(errCode(wrong)).toBe('INVALID_ENTRY_CODE');
    const anonymous = await client.request('GET', '/api/session');
    expect(anonymous.status).toBe(401);

    // Correct code creates the session and sets a hardened cookie.
    const opened = await client.request('POST', '/api/session', {
      credential: credential(ENTRY_CODE),
      entry: entryAck(),
    });
    expect(opened.status).toBe(200);
    const snapshot = opened.json as {
      session: SessionInfo & { metadata: { participation_mode: string; device_class: string } };
      events: unknown[];
      entry: { consent_version: string };
      completed: boolean;
    };
    expect(snapshot.events).toEqual([]);
    expect(snapshot.completed).toBe(false);
    expect(snapshot.entry.consent_version).toBe(CONSENT_VERSION);
    expect(snapshot.session.metadata.participation_mode).toBe('remote');
    expect(snapshot.session.metadata.device_class).toBe('desktop');
    const cookieHeader = opened.setCookies[0] ?? '';
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('SameSite=Strict');
    expect(cookieHeader).not.toContain('Secure');

    // Trial requires prior consent event.
    const earlyTrial = await client.request('GET', '/api/trial');
    expect(earlyTrial.status).toBe(409);

    const session = snapshot.session;
    eventCounter = 0;
    const consent = makeEvent(session, 'consent_recorded', { version: CONSENT_VERSION });
    const consentReceipt = await saveEvent(client, consent);
    expect(consentReceipt.acknowledged_event_ids).toEqual([consent.event_id]);
    expect(consentReceipt.rejected_events).toEqual([]);
    expect(consentReceipt.persistence_scope).toBe('remote');
    expect(consentReceipt.receipt_id).toBeTruthy();
    expect(consentReceipt.persisted_at).toBeTruthy();
    expect(consentReceipt.current_phase).toBe('main');

    const trial = await client.request('GET', '/api/trial');
    expect(trial.status).toBe(200);
    const trialBody = trial.json as { trial_id: string; advice?: { revealed: boolean } };
    expect(trialBody.trial_id).toBe(TRIAL_ID);
    expect(trialBody.advice?.revealed).toBe(false);

    eventCounter = 1;
    await saveEvent(
      client,
      makeEvent(session, 'prediction_submitted', { machine_id: 'A', display_position: 'left' }),
    );
    eventCounter = 2;
    await saveEvent(client, makeEvent(session, 'confidence_submitted', { confidence_percent: 70 }));
    eventCounter = 3;
    await saveEvent(client, makeEvent(session, 'source_selected', { source: 'human' }));

    const advice = await client.request('GET', '/api/advice');
    expect(advice.status).toBe(409);

    // Outcome is server-scored and withheld before the final prediction.
    const premature = await client.request('GET', '/api/feedback');
    expect(premature.status).toBe(409);

    eventCounter = 4;
    await saveEvent(
      client,
      makeEvent(session, 'final_prediction_submitted', {
        machine_id: 'A',
        display_position: 'left',
        changed_after_advice: false,
      }),
    );

    const feedback = await client.request('GET', '/api/feedback');
    expect(feedback.status).toBe(200);
    const feedbackBody = feedback.json as {
      actual_winner_machine_id: string;
      final_correct: boolean;
      points_awarded: number;
    };
    expect(feedbackBody.actual_winner_machine_id).toBe('C');

    // Finish requires the completion request event first.
    const earlyFinish = await client.request('POST', '/api/finish', {});
    expect(earlyFinish.status).toBe(409);

    eventCounter = 5;
    await saveEvent(client, makeEvent(session, 'feedback_presented', { presented_at_ms: 900 }));
    eventCounter = 6;
    await saveEvent(
      client,
      makeEvent(session, 'session_completion_requested', { ack_required_event_count: 6 }),
    );

    const finish = await client.request('POST', '/api/finish', {});
    expect(finish.status).toBe(200);
    const finishReceipt = finish.json as {
      session_status: string;
      current_phase: string;
      persistence_scope: string;
    };
    expect(finishReceipt.session_status).toBe('completed');
    expect(finishReceipt.current_phase).toBe('completed');
    expect(finishReceipt.persistence_scope).toBe('remote');

    const exported = await client.request('GET', '/api/export');
    expect(exported.status).toBe(200);
    const exportBody = exported.json as {
      simulation: boolean;
      persistence_scope: string;
      completed: boolean;
      events: unknown[];
      entry: { consent_version: string };
      presentation_audit: unknown[];
      feedback: { actual_winner_machine_id: string } | null;
      token_hash?: string;
    };
    expect(exportBody.simulation).toBe(true);
    expect(exportBody.persistence_scope).toBe('remote');
    expect(exportBody.completed).toBe(true);
    expect(exportBody.events).toHaveLength(7);
    expect(exportBody.feedback?.actual_winner_machine_id).toBe('C');
    expect(exportBody.token_hash).toBeUndefined();
    expect(JSON.stringify(exportBody)).not.toContain(ADMIN_TOKEN);

    // Snapshot must not carry future outcomes either.
    const resumed = await client.request('GET', '/api/session');
    expect(resumed.status).toBe(200);
    expect((resumed.json as { completed: boolean }).completed).toBe(true);

    // Exact retry: same event resent is acknowledged without duplication.
    const retry = await saveEvent(client, consent);
    expect(retry.acknowledged_event_ids).toEqual([consent.event_id]);
    const afterRetry = await client.request('GET', '/api/export');
    expect((afterRetry.json as { events: unknown[] }).events).toHaveLength(7);

    // Conflicting replay of the same event id is rejected and not persisted.
    const conflicted = await saveEvent(
      client,
      makeEvent(
        session,
        'consent_recorded',
        { version: 'other-version' },
        { event_id: consent.event_id },
      ),
    );
    expect(conflicted.acknowledged_event_ids).toEqual([]);
    expect(conflicted.rejected_events[0]?.reason_code).toBe('EVENT_CONFLICT');
    const afterConflict = await client.request('GET', '/api/export');
    expect((afterConflict.json as { events: unknown[] }).events).toHaveLength(7);

    // Foreign session identity is rejected outright.
    const foreign = await client.request('POST', '/api/events', {
      events: [
        {
          ...(consent as Record<string, unknown>),
          event_id: randomUUID(),
          session_id: randomUUID(),
        },
      ],
    });
    expect(foreign.status).toBe(400);
    expect(errCode(foreign)).toBe('INVALID_EVENT');

    // Cross-origin POST is rejected.
    const crossOrigin = await client.request(
      'POST',
      '/api/events',
      { events: [] },
      { origin: 'http://evil.example' },
    );
    expect(crossOrigin.status).toBe(403);
  });

  it('runs the AI branch with cookie isolation, audit idempotence, admin export and logout', async () => {
    await startServer(path.join(tempDir, 'ai.sqlite'));
    const clientA = new Client(() => baseUrl);

    const opened = await clientA.request('POST', '/api/session', {
      credential: credential(ENTRY_CODE),
      entry: entryAck(),
    });
    expect(opened.status).toBe(200);
    const session = (opened.json as { session: SessionInfo }).session;

    eventCounter = 0;
    await saveEvent(clientA, makeEvent(session, 'consent_recorded', { version: CONSENT_VERSION }));
    eventCounter = 1;
    await saveEvent(
      clientA,
      makeEvent(session, 'prediction_submitted', { machine_id: 'A', display_position: 'left' }),
    );
    eventCounter = 2;
    await saveEvent(
      clientA,
      makeEvent(session, 'confidence_submitted', { confidence_percent: 80 }),
    );
    eventCounter = 3;
    await saveEvent(clientA, makeEvent(session, 'source_selected', { source: 'ai' }));
    const advice = await clientA.request('GET', '/api/advice');
    expect(advice.status).toBe(200);
    eventCounter = 4;
    await saveEvent(
      clientA,
      makeEvent(session, 'advice_revealed', { advice_id: ADVICE_ID, revealed_at_phase: 'main' }),
    );
    eventCounter = 5;
    await saveEvent(
      clientA,
      makeEvent(session, 'final_prediction_submitted', {
        machine_id: 'B',
        display_position: 'center',
        changed_after_advice: true,
      }),
    );
    const feedback = await clientA.request('GET', '/api/feedback');
    expect(feedback.status).toBe(200);
    const feedbackBody = feedback.json as { final_correct: boolean; points_awarded: number };
    expect(feedbackBody.final_correct).toBe(false);
    expect(feedbackBody.points_awarded).toBe(0);

    // Audit persistence with stable ids and idempotent retry.
    const auditRecord = {
      id: 'audit-1',
      type: 'visibility_changed',
      at_ms: 42,
      data: { element_id: 'x', visible: true },
    };
    const audit = await clientA.request('POST', '/api/audit', { records: [auditRecord] });
    expect(audit.status).toBe(200);
    expect((audit.json as { acknowledged_ids: string[] }).acknowledged_ids).toEqual(['audit-1']);
    const auditRetry = await clientA.request('POST', '/api/audit', { records: [auditRecord] });
    expect(auditRetry.status).toBe(200);
    const auditConflict = await clientA.request('POST', '/api/audit', {
      records: [{ ...auditRecord, data: { element_id: 'y', visible: false } }],
    });
    expect(auditConflict.status).toBe(409);
    expect(errCode(auditConflict)).toBe('EVENT_CONFLICT');

    eventCounter = 6;
    await saveEvent(clientA, makeEvent(session, 'feedback_presented', { presented_at_ms: 1000 }));
    eventCounter = 7;
    await saveEvent(
      clientA,
      makeEvent(session, 'session_completion_requested', { ack_required_event_count: 7 }),
    );
    const finish = await clientA.request('POST', '/api/finish', {});
    expect(finish.status).toBe(200);

    // Cookie isolation: a second participant sees nothing without/with their own cookie.
    const clientB = new Client(() => baseUrl);
    const anonymous = await clientB.request('GET', '/api/session');
    expect(anonymous.status).toBe(401);
    const openedB = await clientB.request('POST', '/api/session', {
      credential: credential(ENTRY_CODE),
      entry: entryAck(),
    });
    expect(openedB.status).toBe(200);
    const sessionB = (openedB.json as { session: SessionInfo }).session;
    expect(sessionB.session_id).not.toBe(session.session_id);
    expect(sessionB.participant_id).not.toBe(session.participant_id);
    const exportB = (await clientB.request('GET', '/api/export')).json as {
      session: SessionInfo;
      events: unknown[];
      feedback: unknown;
    };
    expect(exportB.session.session_id).toBe(sessionB.session_id);
    expect(exportB.events).toEqual([]);
    expect(exportB.feedback).toBeNull();

    // Admin export requires the Bearer token and never leaks it.
    const noToken = await clientB.request('GET', '/api/admin/export');
    expect(noToken.status).toBe(401);
    const wrongToken = await clientB.request('GET', '/api/admin/export', undefined, {
      authorization: 'Bearer wrong-token',
    });
    expect(wrongToken.status).toBe(401);
    const admin = await clientB.request('GET', '/api/admin/export', undefined, {
      authorization: `Bearer ${ADMIN_TOKEN}`,
    });
    expect(admin.status).toBe(200);
    const adminBody = admin.json as {
      simulation: boolean;
      sessions: {
        session: SessionInfo;
        events: unknown[];
        presentation_audit: { id: string }[];
        feedback: unknown;
        token_hash?: string;
      }[];
    };
    expect(adminBody.simulation).toBe(true);
    expect(adminBody.sessions).toHaveLength(2);
    const shapeA = adminBody.sessions.find((s) => s.session.session_id === session.session_id);
    expect(shapeA?.events).toHaveLength(8);
    expect(shapeA?.presentation_audit.map((r) => r.id)).toEqual(['audit-1']);
    expect(JSON.stringify(adminBody)).not.toContain(ADMIN_TOKEN);
    expect(JSON.stringify(adminBody)).not.toContain('token_hash');

    // CSV summary: one row per session; missing fields stay empty, booleans explicit.
    const csv = await clientB.request('GET', '/api/admin/export?format=csv', undefined, {
      authorization: `Bearer ${ADMIN_TOKEN}`,
    });
    expect(csv.status).toBe(200);
    const csvText = csv.json as string;
    expect(csvText).toContain('session_id,participant_id');
    expect(csvText).toContain(session.session_id);
    expect(csvText).toContain(sessionB.session_id);
    const rowA = csvText.split('\r\n').find((line) => line.includes(session.session_id)) ?? '';
    expect(rowA).toContain('false'); // final_correct for machine B
    const rowB = csvText.split('\r\n').find((line) => line.includes(sessionB.session_id)) ?? '';
    const rowBCells = rowB.split(',');
    const csvHeader = csvText.split('\r\n')[0]?.split(',') ?? [];
    expect(rowBCells[csvHeader.indexOf('actual_winner_machine_id')]).toBe('');

    // Logout clears the cookie but never deletes records.
    const logout = await clientA.request('POST', '/api/logout', {});
    expect(logout.status).toBe(200);
    expect((logout.json as { ok: boolean }).ok).toBe(true);
    const afterLogout = await clientA.request('GET', '/api/session');
    expect(afterLogout.status).toBe(401);
    const adminAfterLogout = await clientB.request('GET', '/api/admin/export', undefined, {
      authorization: `Bearer ${ADMIN_TOKEN}`,
    });
    expect(
      (adminAfterLogout.json as { sessions: { session: SessionInfo }[] }).sessions,
    ).toHaveLength(2);
  });

  it('persists across restarts and preserves advice/feedback gating', async () => {
    const dbPath = path.join(tempDir, 'restart.sqlite');
    await startServer(dbPath);
    const client = new Client(() => baseUrl);

    const opened = await client.request('POST', '/api/session', {
      credential: credential(ENTRY_CODE),
      entry: entryAck(),
    });
    const session = (opened.json as { session: SessionInfo }).session;

    eventCounter = 0;
    await saveEvent(client, makeEvent(session, 'consent_recorded', { version: CONSENT_VERSION }));
    eventCounter = 1;
    await saveEvent(
      client,
      makeEvent(session, 'prediction_submitted', { machine_id: 'A', display_position: 'left' }),
    );

    // Restart the whole server process state (same database file).
    await closeServer();
    await startServer(dbPath);

    const resumed = await client.request('GET', '/api/session');
    expect(resumed.status).toBe(200);
    const snapshot = resumed.json as { events: unknown[]; completed: boolean };
    expect(snapshot.events).toHaveLength(2);
    expect(snapshot.completed).toBe(false);

    // Gating is reconstructed, not weakened: advice still needs source choice.
    const earlyAdvice = await client.request('GET', '/api/advice');
    expect(earlyAdvice.status).toBe(409);
    const trial = await client.request('GET', '/api/trial');
    expect(trial.status).toBe(200);

    eventCounter = 2;
    await saveEvent(client, makeEvent(session, 'confidence_submitted', { confidence_percent: 60 }));
    eventCounter = 3;
    await saveEvent(client, makeEvent(session, 'source_selected', { source: 'ai' }));
    const advice = await client.request('GET', '/api/advice');
    expect(advice.status).toBe(200);
    eventCounter = 4;
    await saveEvent(
      client,
      makeEvent(session, 'advice_revealed', { advice_id: ADVICE_ID, revealed_at_phase: 'main' }),
    );
    eventCounter = 5;
    await saveEvent(
      client,
      makeEvent(session, 'final_prediction_submitted', {
        machine_id: 'B',
        display_position: 'center',
        changed_after_advice: true,
      }),
    );
    const feedback = await client.request('GET', '/api/feedback');
    expect(feedback.status).toBe(200);
    eventCounter = 6;
    await saveEvent(client, makeEvent(session, 'feedback_presented', { presented_at_ms: 700 }));
    eventCounter = 7;
    await saveEvent(
      client,
      makeEvent(session, 'session_completion_requested', { ack_required_event_count: 7 }),
    );
    const finish = await client.request('POST', '/api/finish', {});
    expect(finish.status).toBe(200);
    expect((finish.json as { session_status: string }).session_status).toBe('completed');

    // A second restart still sees the completed durable record.
    await closeServer();
    await startServer(dbPath);
    const exported = await client.request('GET', '/api/export');
    expect(exported.status).toBe(200);
    const exportBody = exported.json as {
      completed: boolean;
      events: unknown[];
      feedback: { actual_winner_machine_id: string } | null;
    };
    expect(exportBody.completed).toBe(true);
    expect(exportBody.events).toHaveLength(8);
    expect(exportBody.feedback?.actual_winner_machine_id).toBe('C');
  });
});
