'use client';

// Shared Opiflow prototype icon set + brand logo — ported verbatim from the
// prototype icons.jsx so every faithfully-ported screen uses the EXACT same
// line-icons. Usage: <OpfIcon name="home" size={22} color="var(--brand)" stroke={1.9} />

const P: Record<string, string> = {
  home: 'M3 10.8 12 4l9 6.8M5.5 9.4V20h13V9.4M9.5 20v-5.5h5V20',
  users: 'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M9.5 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM20 19v-1.4a3.5 3.5 0 0 0-2.6-3.4M15.5 4.8a3.2 3.2 0 0 1 0 6.2',
  phone: 'M6.6 4.2c.4-.3.9-.2 1.2.2l1.6 2.3c.2.4.2.8-.1 1.1L9.2 9.1c-.2.3-.2.6 0 .9a11 11 0 0 0 4.8 4.8c.3.2.6.1.9 0l1.3-1.1c.3-.3.7-.3 1.1-.1l2.3 1.6c.4.3.5.8.2 1.2l-1 1.4c-.5.7-1.4 1-2.2.8A15.5 15.5 0 0 1 4.3 8c-.2-.8.1-1.7.8-2.2z',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z M19.4 13.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z',
  bell: 'M18 8.5a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 20.5a2 2 0 0 1-3.4 0',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20.5 20.5 16 16',
  chart: 'M5 21V11M12 21V4M19 21v-6',
  sparkles: 'M12 4.5l1.6 4.3 4.3 1.6-4.3 1.6L12 16.3l-1.6-4.3-4.3-1.6 4.3-1.6zM18.5 4v3M20 5.5h-3M6 16v2.5M7.2 17.2H4.8',
  check: 'M5 12.5l4.5 4.5L19 7',
  calendar: 'M5 7.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM8 3.5v4M16 3.5v4M5 10.5h14',
  file: 'M7 4.5h6l4 4V18a1.5 1.5 0 0 1-1.5 1.5h-8.5A1.5 1.5 0 0 1 5.5 18V6A1.5 1.5 0 0 1 7 4.5ZM13 4.5V8.5h4M8.5 13h7M8.5 16h5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3 2',
  message: 'M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H9l-4 3.5V16H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z',
  chevronR: 'M9 5l7 7-7 7',
  chevronL: 'M15 5l-7 7 7 7',
  chevronD: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  cloudDown: 'M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17.4 9.2 3.5 3.5 0 0 1 17 18M12 11v6M9.5 14.5 12 17l2.5-2.5',
  send: 'M21 4 3 11l6 2.5L12 20l3-7z M9 13.5 15 8',
  link: 'M9.5 14.5 14.5 9.5M10 7l1.5-1.5a3.5 3.5 0 0 1 5 5L15 12M14 17l-1.5 1.5a3.5 3.5 0 0 1-5-5L9 12',
  image: 'M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2zM9 11a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 9 11ZM19 15l-4-4-8 6.5',
  clipboard: 'M9 4.5h6a1 1 0 0 1 1 1v1H8v-1a1 1 0 0 1 1-1ZM8 6.5H6.5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 6.5 19.5h11A1.5 1.5 0 0 0 19 18V8a1.5 1.5 0 0 0-1.5-1.5H16',
  mic: 'M12 14.5a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5.5a3 3 0 0 0 3 3ZM6.5 11.5a5.5 5.5 0 0 0 11 0M12 17.5V21',
  map: 'M9.5 5 4.5 7v12l5-2 5 2 5-2V5l-5 2zM9.5 5v12M14.5 7v12',
  edit: 'M16.5 4.5 19.5 7.5 9 18l-3.5 1 1-3.5zM14.5 6.5 17.5 9.5',
  trash: 'M5 7h14M9 7V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5V7M6.5 7l.8 11a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L18.5 7',
  x: 'M6 6l12 12M18 6 6 18',
  backspace: 'M9 5.5h9A1.5 1.5 0 0 1 19.5 7v10A1.5 1.5 0 0 1 18 18.5H9L3.5 12zM13 9.5l4 5M17 9.5l-4 5',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1ZM12 14.5v2.5',
  mail: 'M4.5 7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2zM5 7.5l7 5 7-5',
  eye: 'M3 12s3.5-6.5 9-6.5S21 12 21 12s-3.5 6.5-9 6.5S3 12 3 12ZM12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z',
  eyeOff: 'M10 5.7A8 8 0 0 1 12 5.5c5.5 0 9 6.5 9 6.5a16 16 0 0 1-2.6 3.3M6.5 7.5A16 16 0 0 0 3 12s3.5 6.5 9 6.5a8 8 0 0 0 3.3-.7M4 4l16 16M9.9 9.9a2.6 2.6 0 0 0 3.6 3.7',
  arrowR: 'M5 12h14M13 6l6 6-6 6',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  folder: 'M4 7.5A1.5 1.5 0 0 1 5.5 6h3.8a1.5 1.5 0 0 1 1.1.5l1 1.1a1.5 1.5 0 0 0 1.1.5h5.5A1.5 1.5 0 0 1 19.5 9.6V17a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 17z',
  folderPlus: 'M4 7.5A1.5 1.5 0 0 1 5.5 6h3.8a1.5 1.5 0 0 1 1.1.5l1 1.1a1.5 1.5 0 0 0 1.1.5h5.5A1.5 1.5 0 0 1 19.5 9.6V17a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 17zM12 11v4M10 13h4',
  share: 'M12 14.5V4M8.5 7.5 12 4l3.5 3.5M5.5 12v6A1.5 1.5 0 0 0 7 19.5h10a1.5 1.5 0 0 0 1.5-1.5v-6',
  euro: 'M16.5 7.2A5 5 0 0 0 8 11h7M8 13h6.5A5 5 0 0 1 6 16M5 11h2M5 13h2',
  callOut: 'M14 4.2c.4-.3.9-.2 1.1.2l1.5 2.1c.2.3.2.7-.1 1l-1 1c-.2.2-.2.5 0 .8a10 10 0 0 0 4.3 4.3c.3.2.6.1.8 0l1-1c.3-.3.7-.3 1-.1l2.1 1.5M18.5 5.5 22 2M22 2h-4M22 2v4',
  pin: 'M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10ZM12 13a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
};

export function OpfIcon({ name, size = 24, color = 'currentColor', stroke = 1.9, fill = false }: { name: string; size?: number; color?: string; stroke?: number; fill?: boolean }) {
  const d = P[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" fill={fill ? color : 'none'} />
    </svg>
  );
}

/** Brand mark — the "O" logo glyph, ported from the prototype. */
export function OpfLogo({ size = 40, radius = 12 }: { size?: number; radius?: number }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: radius,
        background: 'linear-gradient(150deg,#3a9ad8 0%,#2A86C5 48%,#1c6fb0 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 6px 16px rgba(42,134,197,0.35), inset 0 1px 1px rgba(255,255,255,0.5)',
        flexShrink: 0, position: 'relative', overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 80% at 25% 15%, rgba(255,255,255,0.4), transparent 55%)' }} />
      <div style={{ width: size * 0.42, height: size * 0.42, borderRadius: '50%', border: `${Math.max(2.5, size * 0.085)}px solid #fff`, boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }} />
    </div>
  );
}
