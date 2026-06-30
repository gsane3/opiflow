// SINGLE SOURCE OF TRUTH for the public pricing page (/pricing).
//
// Two annual plans (Base / Premium) + two optional add-ons (AADE invoicing,
// ALUMIL vertical). All prices are EX-VAT (Greek ΦΠΑ 24% added at checkout).
// Edit prices/features HERE — the /pricing page renders entirely from this file.
//
// Strategy note (see OPIFLOW_BUSINESS_BRIEF / financial model): Base is priced
// near-cost as a deliberately low entry point (TAM-suppression moat); the costly
// telephony lives in Premium (covers the per-number carrier floor); AADE is at
// cost (lock-in goodwill); ALUMIL is the vertical value-driver + exclusivity moat.

import { fmtEur } from '@/lib/offer-calculations';

export const VAT_RATE = 0.24;

const eur = (n: number) => fmtEur(n); // Greek-canonical "79 €"

/** A headline plan the customer picks (annual). */
export interface Tier {
  key: 'base' | 'premium';
  name: string;
  tagline: string;
  priceExVat: number;        // € / year, ex-VAT
  perMonthHint: string;      // "≈ 6,58 €/μήνα"
  highlight?: boolean;       // Premium = visually featured
  badge?: string;            // e.g. "Δημοφιλές"
  ctaLabel: string;
  bullets: string[];         // the 4-6 punchiest selling lines for the card
}

/** An optional add-on the customer can attach to either plan. */
export interface AddOn {
  key: 'aade' | 'alumil';
  name: string;
  forWho: string;
  priceLabel: string;        // full price string incl. unit
  accent: 'sky' | 'amber';
  badge?: string;
  tagline: string;
  bullets: string[];
}

export const TIERS: Tier[] = [
  {
    key: 'base',
    name: 'Base',
    tagline: 'Όλη η δουλειά σου σε μία εφαρμογή. Οι κλήσεις γίνονται από το δικό σου κινητό.',
    priceExVat: 79,
    perMonthHint: '≈ 6,58 €/μήνα',
    ctaLabel: 'Ξεκίνα με Base',
    bullets: [
      'Απεριόριστοι πελάτες, έργα & προσφορές',
      'Online αποδοχή προσφοράς από τον πελάτη',
      'AI βοηθός με φωνή & «Πρόταση απάντησης»',
      'Viber / SMS / Email + αυτοματισμοί',
      'Αιτήματα πληρωμής & στατιστικά',
      'iOS · Android · Web — με ομάδα',
    ],
  },
  {
    key: 'premium',
    name: 'Premium',
    tagline: 'Όλα του Base + το επαγγελματικό σου τηλέφωνο με AI. Κάθε κλήση γίνεται πελάτης.',
    priceExVat: 199,
    perMonthHint: '≈ 16,58 €/μήνα',
    highlight: true,
    badge: 'Δημοφιλές',
    ctaLabel: 'Πάρε Premium',
    bullets: [
      'Όλα όσα έχει το Base',
      'Αποκλειστικός αριθμός: προώθηση ή VoIP 210',
      'Κλήσεις μέσα από την εφαρμογή',
      'AI σύνοψη κλήσης με «Επόμενα βήματα»',
      'Αναπάντητες → task · τηλεφωνητής → κείμενο',
      'Όνομα καλούντα · ιστορικό · redial',
    ],
  },
];

export const ADDONS: AddOn[] = [
  {
    key: 'aade',
    name: 'Τιμολόγηση ΑΑΔΕ / myDATA',
    forWho: 'Για όποιον εκδίδει παραστατικά',
    priceLabel: '45 € εφάπαξ + κόστος παραστατικού',
    accent: 'sky',
    tagline: 'Κόψε επίσημο τιμολόγιο με μία φωνητική εντολή — στο κόστος, χωρίς κέρδος για εμάς.',
    bullets: [
      '«Τύπωσε τιμολόγιο 124€ στον Παπαδόπουλο» → επίσημο παραστατικό στο myDATA',
      'Αυτόματη έκδοση μόλις επιβεβαιωθεί η πληρωμή',
      'Σωστό παραστατικό αυτόματα (Τιμολόγιο Β2Β ή Απόδειξη ιδιώτη)',
      'ΜΑΡΚ + QR αποθηκευμένα στην καρτέλα του πελάτη',
    ],
  },
  {
    key: 'alumil',
    name: 'Αλουμίνιο & Ξυλουργική',
    forWho: 'Αλουμινάδες & Μαραγκοί',
    priceLabel: '49 € / έτος',
    accent: 'amber',
    badge: 'Έρχεται',
    tagline: 'Από τη μέτρηση μέχρι το τιμολόγιο, μία ροή. Ώρες δουλειάς γίνονται λεπτά.',
    bullets: [
      'Μέτρα με Bluetooth laser — οι διαστάσεις μπαίνουν μόνες τους (+3D)',
      'Μία κίνηση → προσφορά από την ALUMIL (αποκλειστική συνεργασία)',
      'Βάζεις % κέρδους + εργατικά, η προσφορά φτιάχνεται μόνη της',
      'Ο πελάτης αποδέχεται → έργο → (με ΑΑΔΕ) τιμολόγιο',
    ],
  },
];

/** A boolean = ✓/—; a string = a short note shown in the cell. */
export type Cell = boolean | string;
export interface CompRow { label: string; base: Cell; premium: Cell }
export interface CompGroup { title: string; rows: CompRow[] }

/** The full feature comparison matrix (Base vs Premium). */
export const COMPARISON: CompGroup[] = [
  {
    title: 'Πελάτες & Έργα',
    rows: [
      { label: 'Απεριόριστοι πελάτες & επαφές (import / export)', base: true, premium: true },
      { label: 'Καρτέλα πελάτη με πλήρες ιστορικό (timeline)', base: true, premium: true },
      { label: '«Τι χρειάζεται τώρα» — έξυπνες προτεινόμενες ενέργειες', base: true, premium: true },
      { label: 'Φάκελοι έργων + PDF', base: true, premium: true },
    ],
  },
  {
    title: 'Προσφορές, Ραντεβού & Πληρωμές',
    rows: [
      { label: 'Προσφορές πολλαπλών γραμμών (ΦΠΑ/ποσότητες) + PDF', base: true, premium: true },
      { label: 'Online αποδοχή/απόρριψη προσφοράς από τον πελάτη', base: true, premium: true },
      { label: 'Ραντεβού με ημερολόγιο (.ics) & επιβεβαίωση πελάτη', base: true, premium: true },
      { label: 'Εργασίες + αυτόματο follow-up στο «κερδισμένος»', base: true, premium: true },
      { label: 'Αιτήματα πληρωμής (IBAN) & επιβεβαίωση κατάθεσης', base: true, premium: true },
    ],
  },
  {
    title: 'AI & Επικοινωνία',
    rows: [
      { label: 'AI βοηθός με φωνή & κείμενο (ραντεβού, προσφορές, έργα)', base: true, premium: true },
      { label: '«Πρόταση απάντησης» με AI στο chat', base: true, premium: true },
      { label: 'Viber / SMS / Email + έτοιμα μηνύματα', base: true, premium: true },
      { label: 'Προγραμματισμένα μηνύματα + αυτόματη απάντηση εκτός ωραρίου', base: true, premium: true },
      { label: 'Links «Ζήτα στοιχεία / φωτογραφίες»', base: true, premium: true },
    ],
  },
  {
    title: 'Πλατφόρμα',
    rows: [
      { label: 'iOS · Android · Web', base: true, premium: true },
      { label: 'Πολλοί χρήστες / ομάδα', base: true, premium: true },
      { label: 'Στατιστικά + καθολική αναζήτηση', base: true, premium: true },
      { label: 'Ασφάλεια & πλήρης συμμόρφωση GDPR', base: true, premium: true },
    ],
  },
  {
    title: 'Τηλεφωνία με AI',
    rows: [
      { label: 'Κλήσεις', base: 'Από το κινητό σου', premium: 'Αριθμός Opiflow' },
      { label: 'Αποκλειστικός αριθμός (προώθηση ή VoIP 210…)', base: false, premium: true },
      { label: 'Κλήσεις μέσα από την εφαρμογή', base: false, premium: true },
      { label: 'AI σύνοψη κλήσης με «Επόμενα βήματα»', base: false, premium: true },
      { label: 'Όνομα καλούντα · ιστορικό κλήσεων · redial', base: false, premium: true },
      { label: 'Αναπάντητες → task · τηλεφωνητής → κείμενο', base: false, premium: true },
    ],
  },
];

/** Labels for prices, derived once. */
export function exVatLabel(n: number): string {
  return `${eur(n)}`;
}
export function incVatLabel(n: number): string {
  return eur(Math.round(n * (1 + VAT_RATE) * 100) / 100);
}
