// Guide session is stored in sessionStorage only — never touches localStorage or CRM state.
const SESSION_KEY = 'yorgos_ai_demo_guide_session';

export type DemoGuideStep =
  | 'seed'
  | 'dashboard'
  | 'review'
  | 'customer'
  | 'tasks'
  | 'appointments'
  | 'offer'
  | 'response'
  | 'followup'
  | 'feedback'
  | 'done';

export interface DemoGuideSession {
  active: boolean;
  currentStep: DemoGuideStep;
  completedSteps: DemoGuideStep[];
  startedAt: string;
  completedAt?: string;
}

// ── Step order and hrefs ──────────────────────────────────────────────────────

const STEP_ORDER: DemoGuideStep[] = [
  'seed', 'dashboard', 'review', 'customer', 'tasks', 'appointments', 'offer', 'response', 'followup',
];

const STEP_HREFS: Record<DemoGuideStep, string> = {
  seed:      '/demo',
  dashboard: '/dashboard?demoStep=dashboard&guide=1',
  review:    '/ai-review?demoStep=review&guide=1',
  customer:     '/customers/demo-karagiannis?demoStep=customer&guide=1',
  tasks:        '/tasks?demoStep=tasks&guide=1',
  appointments: '/appointments?demoStep=appointments&guide=1',
  offer:        '/offers/demo-offer-1?demoStep=offer&guide=1',
  response:  '/offer-response/demo-offer-1?demoStep=response&guide=1',
  followup:  '/offers/demo-offer-1?demoStep=followup&guide=1',
  feedback:  '/demo/pilot-feedback?demoStep=feedback&guide=1',
  done:      '/demo',
};

// ── Safe sessionStorage access ────────────────────────────────────────────────

function getSS(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

// ── Public helpers ────────────────────────────────────────────────────────────

export function loadDemoGuideSession(): DemoGuideSession | null {
  const ss = getSS();
  if (!ss) return null;
  try {
    const raw = ss.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as DemoGuideSession) : null;
  } catch {
    return null;
  }
}

export function saveDemoGuideSession(session: DemoGuideSession): void {
  const ss = getSS();
  if (!ss) return;
  try {
    ss.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // silently ignore quota errors
  }
}

export function startDemoGuide(): void {
  // 'seed' is auto-completed at /demo — guide starts directly at dashboard.
  saveDemoGuideSession({
    active: true,
    currentStep: 'dashboard',
    completedSteps: ['seed'],
    startedAt: new Date().toISOString(),
  });
}

export function completeDemoGuideStep(step: DemoGuideStep): void {
  const session = loadDemoGuideSession();
  if (!session) return;
  const completedSteps = session.completedSteps.includes(step)
    ? session.completedSteps
    : ([...session.completedSteps, step] as DemoGuideStep[]);
  saveDemoGuideSession({ ...session, completedSteps });
}

export function setCurrentDemoGuideStep(step: DemoGuideStep): void {
  const session = loadDemoGuideSession();
  if (!session) return;
  saveDemoGuideSession({ ...session, currentStep: step });
}

export function exitDemoGuide(): void {
  const ss = getSS();
  if (!ss) return;
  try {
    ss.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export function finishDemoGuide(): void {
  const session = loadDemoGuideSession();
  if (!session) return;
  saveDemoGuideSession({
    ...session,
    active: false,
    currentStep: 'done',
    completedAt: new Date().toISOString(),
  });
}

export function isDemoGuideActive(): boolean {
  const session = loadDemoGuideSession();
  return !!(session?.active);
}

export function isDemoGuideDone(): boolean {
  const session = loadDemoGuideSession();
  return session?.currentStep === 'done' && !session?.active;
}

export function isStepCompleted(step: DemoGuideStep): boolean {
  return loadDemoGuideSession()?.completedSteps.includes(step) ?? false;
}

export function getNextDemoGuideStep(step: DemoGuideStep): DemoGuideStep {
  const idx = STEP_ORDER.indexOf(step);
  if (idx === -1 || idx >= STEP_ORDER.length - 1) return 'done';
  return STEP_ORDER[idx + 1];
}

export function getGuideStepHref(step: DemoGuideStep): string {
  return STEP_HREFS[step] ?? '/demo';
}

export function getCurrentGuideHref(): string {
  const session = loadDemoGuideSession();
  if (!session?.active) return '/demo';
  return getGuideStepHref(session.currentStep);
}

// Pathnames (no query) that satisfy each guide step — used by GlobalGuideGuard.
const STEP_PATHNAMES: Partial<Record<DemoGuideStep, string>> = {
  seed:      '/demo',
  dashboard: '/dashboard',
  review:    '/ai-review',
  customer:     '/customers/demo-karagiannis',
  tasks:        '/tasks',
  appointments: '/appointments',
  offer:        '/offers/demo-offer-1',
  response:  '/offer-response/demo-offer-1',
  followup:  '/offers/demo-offer-1',
  feedback:  '/demo/pilot-feedback',
  done:      '/demo',
};

export function getStepPathname(step: DemoGuideStep): string {
  return STEP_PATHNAMES[step] ?? '/demo';
}

export const STEP_DISPLAY_TITLES: Partial<Record<DemoGuideStep, string>> = {
  dashboard: 'Dashboard',
  review:    'AI Review',
  customer:     'Καρτέλα πελάτη',
  tasks:        'Tasks',
  appointments: 'Ραντεβού',
  offer:        'Προσφορά',
  response:  'Απάντηση πελάτη',
  followup:  'Follow-up task',
  feedback:  'Feedback',
};
