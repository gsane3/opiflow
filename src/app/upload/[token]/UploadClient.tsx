'use client';

import { useState, useRef } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'video/mp4',
  'video/quicktime',
];

const MAX_FILES = 10;
const MAX_FILE_SIZE_BYTES = 52_428_800;
const UPLOAD_BUCKET = 'customer-uploads';

interface Props {
  valid: boolean;
  reason: 'expired' | 'completed' | 'invalid' | null;
  rawToken: string;
}

type Phase = 'idle' | 'uploading' | 'done' | 'error';

export default function UploadClient({ valid, reason, rawToken }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [comment, setComment] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progressText, setProgressText] = useState('');
  const [errorText, setErrorText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!valid) {
    const isCompleted = reason === 'completed';
    const isExpired = reason === 'expired' || isCompleted;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-12">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
          <div className="mb-4 text-center text-3xl">{isExpired ? '⏰' : '🔒'}</div>
          <h1 className="mb-2 text-center text-base font-semibold text-zinc-900">
            {isExpired
              ? 'Ο σύνδεσμος έχει ολοκληρωθεί ή έχει λήξει.'
              : 'Ο σύνδεσμος δεν είναι διαθέσιμος.'}
          </h1>
          <p className="text-center text-sm text-zinc-500">
            {isExpired
              ? 'Ο σύνδεσμος έχει ήδη χρησιμοποιηθεί ή δεν είναι πλέον ενεργός.'
              : 'Ο σύνδεσμος δεν αναγνωρίζεται ή έχει ανακληθεί. Επικοινωνήστε με την επιχείρηση για νέο σύνδεσμο.'}
          </p>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-12">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
          <div className="mb-4 text-center text-3xl">&#x2705;</div>
          <h1 className="mb-2 text-center text-base font-semibold text-zinc-900">
            {'Τα αρχεία ανέβηκαν με επιτυχία.'}
          </h1>
          <p className="text-center text-sm text-zinc-500">
            {'Ο επαγγελματίας θα τα δει στην καρτέλα σας.'}
          </p>
        </div>
      </div>
    );
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    setErrorText('');

    const typed = selected.filter(f => ALLOWED_MIME_TYPES.includes(f.type));
    if (typed.length < selected.length) {
      setErrorText('Κάποια αρχεία αποκλείστηκαν (μη αποδεκτός τύπος).');
    }

    const sized = typed.filter(f => f.size <= MAX_FILE_SIZE_BYTES);
    if (sized.length < typed.length) {
      setErrorText('Κάποια αρχεία ξεπερνούν το μέγιστο επιτρεπτό μέγεθος (50MB).');
    }

    const capped = sized.slice(0, MAX_FILES);
    if (capped.length < sized.length) {
      setErrorText(`Μπορείτε να ανεβάσετε έως ${MAX_FILES} αρχεία.`);
    }

    setFiles(capped);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (files.length === 0) {
      setErrorText('Επιλέξτε τουλάχιστον ένα αρχείο.');
      return;
    }

    setPhase('uploading');
    setErrorText('');

    let supabase: ReturnType<typeof createBrowserSupabaseClient>;
    try {
      supabase = createBrowserSupabaseClient();
    } catch {
      setPhase('error');
      setErrorText('Δεν ήταν δυνατή η σύνδεση. Δοκιμάστε ξανά.');
      return;
    }

    const uploadedFiles: Array<{
      uploadPath: string;
      name: string;
      sizeBytes: number;
      mimeType: string;
    }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgressText(`Ανεβαίνει ${i + 1} από ${files.length}...`);

      let signedData: { uploadUrl: string; uploadPath: string; token: string };
      try {
        const res = await fetch(`/api/upload/${encodeURIComponent(rawToken)}/signed-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, mimeType: file.type, sizeBytes: file.size }),
        });
        const json = (await res.json()) as {
          ok: boolean;
          uploadUrl?: string;
          uploadPath?: string;
          token?: string;
          error?: string;
        };
        if (!json.ok || !json.uploadUrl || !json.uploadPath || !json.token) {
          setPhase('error');
          setErrorText('Δεν ήταν δυνατή η προετοιμασία ανεβάσματος. Δοκιμάστε ξανά.');
          return;
        }
        signedData = { uploadUrl: json.uploadUrl, uploadPath: json.uploadPath, token: json.token };
      } catch {
        setPhase('error');
        setErrorText('Δεν ήταν δυνατή η σύνδεση. Δοκιμάστε ξανά.');
        return;
      }

      const { error: uploadError } = await supabase.storage
        .from(UPLOAD_BUCKET)
        .uploadToSignedUrl(signedData.uploadPath, signedData.token, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        setPhase('error');
        setErrorText('Δεν ήταν δυνατό το ανέβασμα του αρχείου. Δοκιμάστε ξανά.');
        return;
      }

      uploadedFiles.push({
        uploadPath: signedData.uploadPath,
        name: file.name,
        sizeBytes: file.size,
        mimeType: file.type,
      });
    }

    setProgressText('Ολοκλήρωση...');

    try {
      const res = await fetch(`/api/upload/${encodeURIComponent(rawToken)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: uploadedFiles,
          customerComment: comment.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        setPhase('error');
        setErrorText('Δεν ήταν δυνατή η ολοκλήρωση. Δοκιμάστε ξανά.');
        return;
      }
    } catch {
      setPhase('error');
      setErrorText('Δεν ήταν δυνατή η σύνδεση. Δοκιμάστε ξανά.');
      return;
    }

    setPhase('done');
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
        <div className="mb-4 text-center text-3xl">&#x1F4F7;</div>
        <h1 className="mb-1 text-center text-base font-semibold text-zinc-900">
          {'Ανέβασμα φωτογραφιών / βίντεο'}
        </h1>
        <p className="mb-5 text-center text-sm text-zinc-500">
          {'Ανεβάστε φωτογραφίες ή βίντεο από τη συσκευή και τον χώρο.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              ref={fileInputRef}
              id="file-input"
              type="file"
              multiple
              accept={ALLOWED_MIME_TYPES.join(',')}
              onChange={handleFileChange}
              disabled={phase === 'uploading'}
              className="hidden"
            />
            <label
              htmlFor="file-input"
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-200 px-4 py-6 text-center transition hover:border-zinc-400 hover:bg-zinc-50 active:bg-zinc-100"
            >
              <span className="text-2xl">&#x1F4C1;</span>
              <span className="text-sm font-medium text-zinc-700">
                {files.length > 0
                  ? `${files.length} αρχεί${files.length === 1 ? 'ο' : 'α'} επιλεγμέν${files.length === 1 ? 'ο' : 'α'}`
                  : 'Επιλογή αρχείων'}
              </span>
              <span className="text-xs text-zinc-400">
                {`Έως ${MAX_FILES} αρχεία, max 50MB το καθένα`}
              </span>
            </label>
          </div>

          {files.length > 0 ? (
            <ul className="space-y-1">
              {files.map((f, idx) => (
                <li
                  key={idx}
                  className="flex items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-600"
                >
                  <span className="flex-1 truncate">{f.name}</span>
                  <span className="shrink-0 text-zinc-400">
                    {(f.size / 1024 / 1024).toFixed(1)}MB
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              {'Σχόλιο για τον επαγγελματία'}
            </label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              disabled={phase === 'uploading'}
              placeholder={'Προαιρετικό σχόλιο...'}
              className="min-h-20 w-full resize-none rounded-2xl border border-zinc-200 px-4 py-3 text-sm outline-none focus:border-zinc-400"
            />
          </div>

          {errorText ? (
            <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">
              <p>{errorText}</p>
              {phase === 'error' ? (
                <button
                  type="button"
                  onClick={() => { setPhase('idle'); setErrorText(''); }}
                  className="mt-1 underline"
                >
                  {'Δοκιμάστε ξανά'}
                </button>
              ) : null}
            </div>
          ) : null}

          {phase === 'uploading' ? (
            <p className="rounded-xl bg-indigo-50 px-3 py-2 text-xs text-indigo-600">
              {progressText}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={phase === 'uploading' || phase === 'error' || files.length === 0}
            className="w-full rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {phase === 'uploading'
              ? 'Ανεβαίνουν...'
              : 'Ανέβασμα αρχείων'}
          </button>
        </form>
      </div>
    </div>
  );
}
