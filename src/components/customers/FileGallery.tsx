'use client';

// Full-screen, mobile-first photo/video lightbox for customer files.
//
// Files live in private Supabase storage, so the gallery never receives URLs
// directly: the caller passes a `resolveUrl(file)` callback that returns a
// short-lived *signed* URL on demand (caller wraps the existing
// /files/signed-url endpoint). We resolve lazily for the active file and for
// thumbnails, caching results keyed by `sessionId:fileIndex` so revisiting a
// file (or scrubbing the thumbnail strip) does not re-hit the network.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Spinner, cn } from '@/components/ui';

export interface GalleryFile {
  sessionId: string;
  fileIndex: number;
  name: string;
  kind?: 'image' | 'video' | 'file';
  mimeType?: string;
}

export interface FileGalleryProps {
  /** Controls visibility. When false the component renders `null`. */
  open: boolean;
  /** Called when the user dismisses (X, Escape, or overlay backdrop). */
  onClose: () => void;
  /** Files flattened across sessions, in display order. */
  files: GalleryFile[];
  /** Index to open on first show. Clamped into range. Defaults to 0. */
  initialIndex?: number;
  /**
   * Resolves a file to a short-lived signed URL. Returns `null` on failure;
   * the gallery then shows a retry affordance.
   */
  resolveUrl: (file: GalleryFile) => Promise<string | null>;
}

/** Stable cache key for a file across sessions. */
function keyOf(file: GalleryFile): string {
  return `${file.sessionId}:${file.fileIndex}`;
}

/** Derive the display kind, falling back to mimeType, then to a generic file. */
function kindOf(file: GalleryFile): 'image' | 'video' | 'file' {
  if (file.kind) return file.kind;
  const mt = file.mimeType ?? '';
  if (mt.startsWith('image/')) return 'image';
  if (mt.startsWith('video/')) return 'video';
  return 'file';
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export default function FileGallery({
  open,
  onClose,
  files,
  initialIndex = 0,
  resolveUrl,
}: FileGalleryProps) {
  const count = files.length;

  const [index, setIndex] = useState(() => clamp(initialIndex, 0, Math.max(0, count - 1)));
  // Resolved signed URLs, keyed by `sessionId:fileIndex`.
  const [urls, setUrls] = useState<Record<string, string>>({});
  // Keys currently in flight, so we don't fire duplicate resolves.
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  // Keys that failed to resolve (null URL or thrown), so we can offer retry.
  const [errored, setErrored] = useState<Record<string, boolean>>({});

  // Latest resolveUrl without retriggering effects when the caller passes a
  // fresh closure each render.
  const resolveRef = useRef(resolveUrl);
  useEffect(() => {
    resolveRef.current = resolveUrl;
  }, [resolveUrl]);

  // When (re)opened, jump to the requested initial index.
  useEffect(() => {
    if (open) setIndex(clamp(initialIndex, 0, Math.max(0, count - 1)));
  }, [open, initialIndex, count]);

  // Keep the active index valid if the file list shrinks.
  useEffect(() => {
    setIndex((i) => clamp(i, 0, Math.max(0, count - 1)));
  }, [count]);

  const active = count > 0 ? files[clamp(index, 0, count - 1)] : undefined;

  // Resolve a single file's signed URL (idempotent; skips cached/in-flight).
  const resolve = useCallback(
    (file: GalleryFile) => {
      const key = keyOf(file);
      setUrls((prevUrls) => {
        if (prevUrls[key]) return prevUrls;
        setLoading((l) => {
          if (l[key]) return l;
          // Fire the async resolve outside of the state updater.
          queueMicrotask(async () => {
            try {
              const url = await resolveRef.current(file);
              if (url) {
                setUrls((u) => ({ ...u, [key]: url }));
                setErrored((e) => (e[key] ? { ...e, [key]: false } : e));
              } else {
                setErrored((e) => ({ ...e, [key]: true }));
              }
            } catch {
              setErrored((e) => ({ ...e, [key]: true }));
            } finally {
              setLoading((l2) => ({ ...l2, [key]: false }));
            }
          });
          return { ...l, [key]: true };
        });
        return prevUrls;
      });
    },
    [],
  );

  // Lazily resolve the active file whenever it changes (and on open).
  useEffect(() => {
    if (!open || !active) return;
    const key = keyOf(active);
    if (urls[key] || loading[key] || errored[key]) return;
    resolve(active);
  }, [open, active, urls, loading, errored, resolve]);

  const goPrev = useCallback(() => setIndex((i) => clamp(i - 1, 0, Math.max(0, count - 1))), [count]);
  const goNext = useCallback(() => setIndex((i) => clamp(i + 1, 0, Math.max(0, count - 1))), [count]);

  // Keyboard: Escape closes, arrows navigate. Lock body scroll while open.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    }
    document.addEventListener('keydown', onKeyDown);

    const hasDocument = typeof document !== 'undefined';
    const prevOverflow = hasDocument ? document.body.style.overflow : '';
    if (hasDocument) document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (hasDocument) document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, goPrev, goNext]);

  // Keep the active thumbnail in view as the user navigates.
  const stripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const strip = stripRef.current;
    if (!strip) return;
    const el = strip.querySelector<HTMLElement>(`[data-thumb-index="${index}"]`);
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [index, open]);

  const atStart = index <= 0;
  const atEnd = index >= count - 1;

  if (!open || count === 0 || !active) return null;

  const activeKey = keyOf(active);
  const activeUrl = urls[activeKey];
  const activeKind = kindOf(active);
  const isActiveLoading = !!loading[activeKey] && !activeUrl;
  const isActiveError = !!errored[activeKey] && !activeUrl;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/90 animate-[fadeIn_0.2s_ease-out]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Προβολή αρχείων"
    >
      {/* Top bar: name + position + close */}
      <div
        className="flex items-center gap-3 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={active.name}>
            {active.name}
          </p>
          <p className="text-xs text-white/60">
            {index + 1}/{count}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Κλείσιμο"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition hover:bg-white/10 active:bg-white/20"
        >
          <svg className="h-6 w-6" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Stage */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Prev tap zone / arrow */}
        <button
          type="button"
          onClick={goPrev}
          disabled={atStart}
          aria-label="Προηγούμενο"
          className={cn(
            'absolute left-0 top-0 bottom-0 z-10 flex w-[22%] max-w-[120px] items-center justify-start pl-2',
            'text-white transition disabled:pointer-events-none disabled:opacity-0',
          )}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
            <svg className="h-6 w-6" fill="none" strokeWidth={2.2} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19 8 12l7-7" />
            </svg>
          </span>
        </button>

        {/* Next tap zone / arrow */}
        <button
          type="button"
          onClick={goNext}
          disabled={atEnd}
          aria-label="Επόμενο"
          className={cn(
            'absolute right-0 top-0 bottom-0 z-10 flex w-[22%] max-w-[120px] items-center justify-end pr-2',
            'text-white transition disabled:pointer-events-none disabled:opacity-0',
          )}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
            <svg className="h-6 w-6" fill="none" strokeWidth={2.2} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
            </svg>
          </span>
        </button>

        {/* Content */}
        <div className="flex h-full w-full items-center justify-center px-[18%] py-2">
          {isActiveLoading ? (
            <div className="flex flex-col items-center gap-2 text-white/80">
              <Spinner size="lg" />
              <span className="text-sm">Φόρτωση…</span>
            </div>
          ) : isActiveError ? (
            <div className="flex flex-col items-center gap-3 text-center text-white">
              <p className="text-sm text-white/80">Δεν ήταν δυνατή η φόρτωση του αρχείου.</p>
              <button
                type="button"
                onClick={() => {
                  setErrored((e) => ({ ...e, [activeKey]: false }));
                  resolve(active);
                }}
                className="flex h-11 items-center justify-center rounded-xl bg-white/10 px-5 text-sm font-semibold text-white transition hover:bg-white/20 active:bg-white/30"
              >
                Δοκιμή ξανά
              </button>
            </div>
          ) : activeUrl ? (
            activeKind === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={activeKey}
                src={activeUrl}
                alt={active.name}
                className="max-h-full max-w-full object-contain select-none"
                draggable={false}
              />
            ) : activeKind === 'video' ? (
              <video
                key={activeKey}
                src={activeUrl}
                controls
                playsInline
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-4 text-center text-white">
                <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10">
                  <svg className="h-8 w-8" fill="none" strokeWidth={1.8} stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                    />
                  </svg>
                </span>
                <p className="max-w-xs truncate text-sm text-white/80">{active.name}</p>
                <a
                  href={activeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-12 items-center justify-center rounded-xl bg-indigo-600 px-5 text-base font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800"
                >
                  Άνοιγμα αρχείου
                </a>
              </div>
            )
          ) : null}
        </div>
      </div>

      {/* Thumbnail strip */}
      {count > 1 && (
        <div
          ref={stripRef}
          className="flex shrink-0 gap-2 overflow-x-auto px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
          onClick={(e) => e.stopPropagation()}
        >
          {files.map((file, i) => (
            <Thumb
              key={keyOf(file)}
              file={file}
              index={i}
              active={i === index}
              url={urls[keyOf(file)]}
              onSelect={() => setIndex(i)}
              onNeedUrl={() => resolve(file)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ThumbProps {
  file: GalleryFile;
  index: number;
  active: boolean;
  url?: string;
  onSelect: () => void;
  onNeedUrl: () => void;
}

/**
 * One thumbnail in the bottom strip. Images resolve a tiny <img> lazily once
 * visible (or once tapped); videos/other files show a generic glyph and never
 * fetch a URL just for the thumbnail (keeps the strip lightweight).
 */
function Thumb({ file, index, active, url, onSelect, onNeedUrl }: ThumbProps) {
  const kind = kindOf(file);
  const ref = useRef<HTMLButtonElement | null>(null);

  // Lazily resolve image thumbnails only when scrolled into view.
  useEffect(() => {
    if (kind !== 'image' || url) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      // No IO support (or SSR): resolve eagerly as a fallback.
      onNeedUrl();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          onNeedUrl();
          io.disconnect();
        }
      },
      { root: el.parentElement, rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, url]);

  return (
    <button
      ref={ref}
      type="button"
      data-thumb-index={index}
      onClick={onSelect}
      aria-label={`${file.name} (${index + 1})`}
      aria-current={active || undefined}
      className={cn(
        'relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white/10 ring-2 transition',
        active ? 'ring-indigo-500' : 'ring-transparent hover:ring-white/40',
      )}
    >
      {kind === 'image' && url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-white/70">
          {kind === 'video' ? (
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          ) : kind === 'image' ? (
            // Image not yet resolved — neutral placeholder glyph.
            <svg className="h-5 w-5" fill="none" strokeWidth={1.8} stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M6 6h.008v.008H6V6Z"
              />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" strokeWidth={1.8} stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
              />
            </svg>
          )}
        </span>
      )}
    </button>
  );
}
