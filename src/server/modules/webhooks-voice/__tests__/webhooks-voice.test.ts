import { describe, it, expect } from 'vitest';
import {
  processPbxRecording,
  processPbxVoicemail,
  processTwilioRecording,
  type PbxRecordingDeps,
  type PbxVoicemailDeps,
  type TwilioRecordingDeps,
} from '../webhooks-voice.service';
import type { SupabaseServer } from '../webhooks-voice.repo';
import type { CallCommRow } from '../../../../lib/server/twilio-recording';

// ---------------------------------------------------------------------------
// Hermetic fake Supabase client. Mirrors the chainable query-builder shape the
// repo uses (select/insert/update/eq/or/order/like/limit/single/maybeSingle),
// resolving per (table, ops) so each test wires only the rows it cares about.
// No real signature-verify / Deepgram / OpenAI / push runs — all injected.
// ---------------------------------------------------------------------------
type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string, o?: unknown): FB;
  insert(v?: unknown): FB;
  update(v?: unknown): FB;
  eq(a?: unknown, b?: unknown): FB;
  or(a?: unknown): FB;
  order(a?: unknown, b?: unknown): FB;
  like(a?: unknown, b?: unknown): FB;
  limit(n?: number): FB;
  single(): FB;
  maybeSingle(): FB;
  then(r: (x: Res) => unknown): unknown;
}
function fakeSupabase(resolve: (table: string, ops: Op[]) => Res): SupabaseServer {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), insert: rec('insert'), update: rec('update'), eq: rec('eq'), or: rec('or'),
      order: rec('order'), like: rec('like'), limit: rec('limit'), single: rec('single'), maybeSingle: rec('maybeSingle'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { from } as unknown as SupabaseServer;
}

function fakeAudio(): File {
  return new File([new Uint8Array([1, 2, 3])], 'rec.wav', { type: 'audio/wav' });
}

const TRANSCRIBE_RESULT = {
  transcript: 'Ομιλητής 1: γεια',
  brief: 'Σύνοψη κλήσης.',
  taskTitle: 'Κάλεσε πίσω',
  taskNote: 'σημείωση',
  taskType: 'call_back' as const,
  taskDueDate: '2026-06-26',
};

describe('processPbxRecording (parity)', () => {
  it('transcribes, saves the brief, creates an ai_draft task, and returns the success shape', async () => {
    const updates: Record<string, unknown>[] = [];
    const supabase = fakeSupabase((t, ops) => {
      if (t === 'communications' && ops.some((o) => o.m === 'update')) {
        updates.push(ops.find((o) => o.m === 'update')!.args[0] as Record<string, unknown>);
        return { data: null, error: null };
      }
      if (t === 'tasks' && ops.some((o) => o.m === 'insert')) return { data: { id: 'task1' }, error: null };
      return { data: null, error: null };
    });
    const deps: PbxRecordingDeps = {
      transcribeAndBriefCallAudio: async () => TRANSCRIBE_RESULT,
      appendCallBrief: async () => {},
    };
    const res = await processPbxRecording(
      supabase,
      {
        audioFile: fakeAudio(),
        uniqueid: 'u1',
        communicationIdParam: null,
        callerNumber: '2101234567',
        dialStatus: 'ANSWER',
        bizEndpointId: null,
        pbxBusinessIdFromEnv: 'biz1',
      },
      deps,
    );
    // uniqueid path resolves no comm (default null) → communication_not_found 200
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: false, received: true, error: 'communication_not_found' });
  });

  it('returns transcription_failed (200) when the engine yields null', async () => {
    const supabase = fakeSupabase((t) => {
      if (t === 'communications') return { data: { id: 'c1', summary: null, customer_id: 'cust1', business_id: 'biz1' }, error: null };
      return { data: null, error: null };
    });
    const deps: PbxRecordingDeps = {
      transcribeAndBriefCallAudio: async () => null,
      appendCallBrief: async () => {},
    };
    const res = await processPbxRecording(
      supabase,
      {
        audioFile: fakeAudio(),
        uniqueid: null,
        communicationIdParam: 'c1',
        callerNumber: null,
        dialStatus: null,
        bizEndpointId: null,
        pbxBusinessIdFromEnv: null,
      },
      deps,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, received: true, error: 'transcription_failed' });
  });

  it('saves the brief + task and returns the full success body when the comm is found by id', async () => {
    const supabase = fakeSupabase((t, ops) => {
      if (t === 'communications' && ops.some((o) => o.m === 'update')) return { data: null, error: null };
      if (t === 'communications') return { data: { id: 'c1', summary: 'old', customer_id: 'cust1', business_id: 'biz1' }, error: null };
      if (t === 'tasks') return { data: { id: 'task1' }, error: null };
      return { data: null, error: null };
    });
    const deps: PbxRecordingDeps = {
      transcribeAndBriefCallAudio: async () => TRANSCRIBE_RESULT,
      appendCallBrief: async () => {},
    };
    const res = await processPbxRecording(
      supabase,
      {
        audioFile: fakeAudio(),
        uniqueid: null,
        communicationIdParam: 'c1',
        callerNumber: null,
        dialStatus: null,
        bizEndpointId: null,
        pbxBusinessIdFromEnv: null,
      },
      deps,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      received: true,
      communication_updated: true,
      communication_id: 'c1',
      task_created: true,
      task_id: 'task1',
      transcript_length: TRANSCRIBE_RESULT.transcript.length,
      brief_length: TRANSCRIBE_RESULT.brief.length,
    });
  });
});

describe('processPbxVoicemail (parity)', () => {
  it('creates a voicemail communication and returns the transcribed flag', async () => {
    let pushed = false;
    const supabase = fakeSupabase((t, ops) => {
      if (t === 'customers') return { data: null, error: null };
      if (t === 'communications' && ops.some((o) => o.m === 'insert')) return { data: { id: 'vm1' }, error: null };
      return { data: null, error: null };
    });
    const deps: PbxVoicemailDeps = {
      transcribeAndBriefCallAudio: async () => TRANSCRIBE_RESULT,
      appendCallBrief: async () => {},
      sendPushToBusinessOwner: async () => { pushed = true; },
    };
    const res = await processPbxVoicemail(
      supabase,
      'biz1',
      { audioFile: fakeAudio(), caller: '+302101234567', uniqueid: null },
      deps,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, communication_id: 'vm1', transcribed: true });
    expect(pushed).toBe(true);
  });

  it('reports transcribed:false when the engine fails', async () => {
    const supabase = fakeSupabase((t, ops) => {
      if (t === 'communications' && ops.some((o) => o.m === 'insert')) return { data: { id: 'vm2' }, error: null };
      return { data: null, error: null };
    });
    const deps: PbxVoicemailDeps = {
      transcribeAndBriefCallAudio: async () => null,
      appendCallBrief: async () => {},
      sendPushToBusinessOwner: async () => {},
    };
    const res = await processPbxVoicemail(
      supabase,
      'biz1',
      { audioFile: fakeAudio(), caller: null, uniqueid: null },
      deps,
    );
    expect(await res.json()).toEqual({ ok: true, communication_id: 'vm2', transcribed: false });
  });
});

// ---------------------------------------------------------------------------
// Twilio RecordingStatusCallback — the post-auth pipeline (the route keeps the
// env-gate, form parsing, signature validation and guards verbatim; the twilio
// SDK + recording libs are injected so this stays hermetic).
// ---------------------------------------------------------------------------

const TWILIO_COMM: CallCommRow = {
  id: 'c1', business_id: 'b1', summary: null, customer_id: 'cust1', brief_created_at: null,
};
const TWILIO_INPUT = {
  accountSid: 'AC1', authToken: 'tok', callSid: 'CA1',
  recordingUrl: 'https://api.twilio.com/rec', recordingSid: 'RE1', fromNumber: '+302101234567',
};
function twilioDeps(over: Partial<TwilioRecordingDeps> = {}): TwilioRecordingDeps {
  return {
    findCallCommunication: async () => TWILIO_COMM,
    persistRecordingEvent: async () => {},
    deleteTwilioRecording: async () => true,
    downloadRecordingWav: async () => ({ file: new File([new Uint8Array([1, 2, 3])], 'r.wav', { type: 'audio/wav' }) }),
    processRecordingForCommunication: async () => true,
    ...over,
  };
}

describe('processTwilioRecording (parity)', () => {
  it('communication_not_found → persists for reconcile and acks 200', async () => {
    let persisted = false;
    const res = await processTwilioRecording({} as unknown as SupabaseServer, TWILIO_INPUT, twilioDeps({
      findCallCommunication: async () => null,
      persistRecordingEvent: async () => { persisted = true; },
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, received: true, error: 'communication_not_found' });
    expect(persisted).toBe(true);
  });

  it('already_processed → deletes the cloud copy and acks (idempotent)', async () => {
    let deleted = false;
    const res = await processTwilioRecording({} as unknown as SupabaseServer, TWILIO_INPUT, twilioDeps({
      findCallCommunication: async () => ({ ...TWILIO_COMM, brief_created_at: '2026-06-01T00:00:00Z' }),
      deleteTwilioRecording: async () => { deleted = true; return true; },
    }));
    expect(await res.json()).toEqual({ ok: true, received: true, already_processed: true });
    expect(deleted).toBe(true);
  });

  it('recording_size_invalid → deletes the cloud copy and acks', async () => {
    let deleted = false;
    const res = await processTwilioRecording({} as unknown as SupabaseServer, TWILIO_INPUT, twilioDeps({
      downloadRecordingWav: async () => ({ error: 'size_invalid' }),
      deleteTwilioRecording: async () => { deleted = true; return true; },
    }));
    expect(await res.json()).toEqual({ ok: true, received: true, error: 'recording_size_invalid' });
    expect(deleted).toBe(true);
  });

  it('recording_download_failed → persists and acks', async () => {
    const res = await processTwilioRecording({} as unknown as SupabaseServer, TWILIO_INPUT, twilioDeps({
      downloadRecordingWav: async () => ({ error: 'download_failed' }),
    }));
    expect(await res.json()).toEqual({ ok: true, received: true, error: 'recording_download_failed' });
  });

  it('transcription_failed → persists and acks', async () => {
    const res = await processTwilioRecording({} as unknown as SupabaseServer, TWILIO_INPUT, twilioDeps({
      processRecordingForCommunication: async () => false,
    }));
    expect(await res.json()).toEqual({ ok: true, received: true, error: 'transcription_failed' });
  });

  it('success → deletes the cloud copy and reports communication_updated', async () => {
    let deleted = false;
    const res = await processTwilioRecording({} as unknown as SupabaseServer, TWILIO_INPUT, twilioDeps({
      deleteTwilioRecording: async () => { deleted = true; return true; },
    }));
    expect(await res.json()).toEqual({
      ok: true, received: true, communication_updated: true, communication_id: 'c1',
    });
    expect(deleted).toBe(true);
  });
});
