'use client';

import { useState, useEffect, useRef } from 'react';
import {
  isCustomerFileStorageSupported,
  addCustomerFile,
  listCustomerFiles,
  deleteCustomerFile,
  type CustomerFileRecord,
} from '@/lib/customer-files';
import CustomerMediaGallery from './CustomerMediaGallery';

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return `${Math.round(bytes / 1024)} KB`;
  return `${mb.toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('el-GR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const KIND_LABELS: Record<CustomerFileRecord['kind'], string> = {
  image: 'Φωτογραφία',
  video: 'Βίντεο',
  other: 'Αρχείο',
};

interface FileRow {
  record: CustomerFileRecord;
  objectUrl: string;
}

interface Props {
  customerId: string;
}

export default function CustomerFilesSection({ customerId }: Props) {
  const supported = isCustomerFileStorageSupported();
  const [rows, setRows] = useState<FileRow[]>([]);
  const [fileError, setFileError] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Track all active object URLs so they can be revoked on cleanup.
  const urlsRef = useRef<string[]>([]);

  function revokeAll() {
    for (const url of urlsRef.current) {
      URL.revokeObjectURL(url);
    }
    urlsRef.current = [];
  }

  async function refreshFiles(cancelled?: { current: boolean }) {
    if (!supported) return;
    try {
      const records = await listCustomerFiles(customerId);
      if (cancelled?.current) return;
      revokeAll();
      const mapped: FileRow[] = records
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((r) => {
          const url = URL.createObjectURL(r.blob);
          urlsRef.current.push(url);
          return { record: r, objectUrl: url };
        });
      setRows(mapped);
    } catch {
      if (!cancelled?.current) setRows([]);
    }
  }

  useEffect(() => {
    if (!supported) return;
    const cancelled = { current: false };
    refreshFiles(cancelled);
    return () => {
      cancelled.current = true;
      revokeAll();
    };
    // customerId is stable for the lifetime of this component instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, supported]);

  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (selected.length === 0) return;

    setFileError('');
    const oversized = selected.find((f) => f.size > MAX_FILE_BYTES);
    if (oversized) {
      setFileError('Το αρχείο είναι πολύ μεγάλο για το τοπικό MVP.');
      return;
    }

    setIsAdding(true);
    try {
      for (const file of selected) {
        await addCustomerFile(customerId, file);
      }
      await refreshFiles();
    } catch {
      setFileError('Σφάλμα κατά την αποθήκευση του αρχείου.');
    } finally {
      setIsAdding(false);
    }
  }

  async function handleDelete(id: string, objectUrl: string) {
    const idx = rows.findIndex((r) => r.record.id === id);
    try {
      await deleteCustomerFile(id);
      URL.revokeObjectURL(objectUrl);
      urlsRef.current = urlsRef.current.filter((u) => u !== objectUrl);
      const nextRows = rows.filter((r) => r.record.id !== id);
      setRows(nextRows);
      // Adjust gallery selection safely when deleting while gallery is open.
      if (selectedIndex !== null) {
        if (nextRows.length === 0) {
          setSelectedIndex(null);
        } else if (idx === selectedIndex) {
          // Deleted the current item — clamp to last available
          setSelectedIndex(Math.min(selectedIndex, nextRows.length - 1));
        } else if (idx < selectedIndex) {
          // Deleted an item before current — shift index back by one
          setSelectedIndex(selectedIndex - 1);
        }
        // idx > selectedIndex: no change needed
      }
    } catch {
      // Ignore delete errors silently
    }
  }

  if (!supported) {
    return (
      <p className="mt-2 text-sm text-zinc-400">
        Η τοπική αποθήκευση αρχείων δεν υποστηρίζεται σε αυτόν τον browser.
      </p>
    );
  }

  return (
    <div id="customer-files" className="mt-3">
      {/* Gallery modal */}
      {selectedIndex !== null && rows.length > 0 && (
        <CustomerMediaGallery
          files={rows}
          currentIndex={selectedIndex}
          onClose={() => setSelectedIndex(null)}
          onChangeIndex={setSelectedIndex}
        />
      )}

      {/* File rows */}
      {rows.length > 0 && (
        <ul className="mb-3 space-y-2">
          {rows.map(({ record, objectUrl }, idx) => (
            <li
              key={record.id}
              className="flex cursor-pointer items-center gap-3 rounded-xl bg-zinc-50 p-2 ring-1 ring-zinc-100 transition hover:bg-zinc-100"
              onClick={() => setSelectedIndex(idx)}
            >
              {/* Thumbnail / icon */}
              {record.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={objectUrl}
                  alt={record.fileName}
                  className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-zinc-200"
                />
              ) : record.kind === 'video' ? (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-indigo-50 ring-1 ring-indigo-100">
                  <svg
                    className="h-6 w-6 text-indigo-400"
                    fill="none"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
                    />
                  </svg>
                </div>
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-100 ring-1 ring-zinc-200">
                  <svg
                    className="h-6 w-6 text-zinc-400"
                    fill="none"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                    />
                  </svg>
                </div>
              )}

              {/* File info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-800">{record.fileName}</p>
                <p className="text-xs text-zinc-400">
                  {KIND_LABELS[record.kind]} · {formatBytes(record.sizeBytes)} · {formatDate(record.createdAt)}
                </p>
              </div>

              {/* Actions */}
              <div className="flex shrink-0 flex-col items-end gap-1">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setSelectedIndex(idx); }}
                  className="text-xs text-indigo-600 hover:text-indigo-700"
                >
                  Άνοιγμα
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void handleDelete(record.id, objectUrl); }}
                  className="text-xs text-zinc-400 transition hover:text-red-500"
                >
                  Διαγραφή
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={handleFilesSelected}
      />

      {/* Upload trigger button */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={isAdding}
        className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg
          className="h-4 w-4 text-zinc-400"
          fill="none"
          strokeWidth={1.5}
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
          />
        </svg>
        {isAdding ? 'Αποθήκευση...' : 'Προσθήκη φωτογραφίας ή βίντεο'}
      </button>

      {fileError && (
        <p className="mt-1.5 text-xs text-red-600">{fileError}</p>
      )}

      {/* Local-only notices */}
      <div className="mt-3 space-y-0.5">
        <p className="text-xs text-zinc-400">
          Τα αρχεία αποθηκεύονται μόνο σε αυτή τη συσκευή. Δεν ανεβαίνουν σε cloud στο MVP.
        </p>
        <p className="text-xs text-zinc-300">
          Cloud συγχρονισμός: Σύντομα
        </p>
      </div>
    </div>
  );
}
