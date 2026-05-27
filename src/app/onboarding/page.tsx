'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { loadState, saveState } from '@/lib/storage';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { BusinessType, BusinessProfile } from '@/lib/types';
import BusinessTypeSelector from '@/components/onboarding/BusinessTypeSelector';
import BusinessProfileForm, {
  type BusinessProfileData,
} from '@/components/onboarding/BusinessProfileForm';
import LogoUpload from '@/components/onboarding/LogoUpload';
import VatAndTermsForm from '@/components/onboarding/VatAndTermsForm';

interface FormData {
  businessType: BusinessType | null;
  businessName: string;
  ownerName: string;     // localStorage cache only; derived from ownerFirstName + ownerLastName
  phone: string;
  email: string;
  address: string;       // compatibility: mirrors addressLine1 for POST and offer rendering
  city: string;
  vatNumber: string;
  taxOffice: string;
  logoDataUrl: string;
  vatRate: number;
  offerTerms: string;
  // structured profile fields (Slice 023)
  legalName: string;
  tradeName: string;
  ownerFirstName: string;
  ownerLastName: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  region: string;
  website: string;
}

const DEFAULT_OFFER_TERMS =
  'Η παρούσα προσφορά ισχύει για 30 ημέρες από την ημερομηνία έκδοσης. Οι τιμές δεν περιλαμβάνουν αλλαγές εκτός του συμφωνημένου αντικειμένου εργασίας.';

const STEPS = [
  {
    title: 'Τύπος επιχείρησης',
    subtitle: 'Τι είδους επαγγελματίας είσαι;',
  },
  {
    title: 'Στοιχεία επιχείρησης',
    subtitle: 'Αυτά τα στοιχεία θα εμφανίζονται στις προσφορές σου.',
  },
  {
    title: 'Logo επιχείρησης',
    subtitle: 'Προαιρετικό. Μπορείς να το παραλείψεις.',
  },
  {
    title: 'ΦΠΑ & Όροι προσφορών',
    subtitle: 'Προεπιλεγμένες ρυθμίσεις για νέες προσφορές.',
  },
];

// Map plan keys to display names shown in the onboarding header badge.
const PLAN_NAMES: Record<string, string> = {
  starter: 'Starter',
  pro:     'Pro',
  team:    'Team',
};

function buildInitialFormData(): FormData {
  return {
    businessType: null,
    businessName: '',
    ownerName: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    vatNumber: '',
    taxOffice: '',
    logoDataUrl: '',
    vatRate: 24,
    offerTerms: DEFAULT_OFFER_TERMS,
    legalName:      '',
    tradeName:      '',
    ownerFirstName: '',
    ownerLastName:  '',
    addressLine1:   '',
    addressLine2:   '',
    postalCode:     '',
    region:         '',
    website:        '',
  };
}

function OnboardingPageContent() {
  const router = useRouter();
  const searchParams    = useSearchParams();
  const planKeyParam    = searchParams.get('plan')    ?? '';
  const voucherCodeParam = searchParams.get('voucher') ?? '';
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState<FormData>(buildInitialFormData);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    async function checkSession() {
      try {
        const supabase = createBrowserSupabaseClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          router.replace('/login');
          return;
        }
        setAccessToken(session.access_token);
        try {
          const raw = localStorage.getItem('yorgos_onboarding_prefill');
          const prefill = raw
            ? (JSON.parse(raw) as { ownerName?: string; email?: string })
            : null;
          setFormData((prev) => ({
            ...prev,
            ownerName: prefill?.ownerName?.trim() || prev.ownerName,
            email: prefill?.email?.trim() || session.user.email || prev.email,
          }));
        } catch {
          // non-fatal
        }
      } catch {
        router.replace('/login');
      }
    }
    checkSession();
  }, [router]);

  // Redirect to /package if no plan was passed in URL.
  useEffect(() => {
    if (!planKeyParam) {
      router.replace('/package');
    }
  }, [planKeyParam, router]);

  function updateForm(fields: Partial<FormData>) {
    setFormData((prev) => ({ ...prev, ...fields }));
    setError('');
  }

  function handleNext() {
    if (step === 0 && !formData.businessType) {
      setError('Επέλεξε τύπο επιχείρησης για να συνεχίσεις.');
      return;
    }
    if (step === 1 && !formData.businessName.trim()) {
      setError('Το όνομα επιχείρησης είναι υποχρεωτικό.');
      return;
    }
    if (step === 1 && !formData.ownerFirstName.trim()) {
      setError('Το όνομα υπευθύνου είναι υποχρεωτικό.');
      return;
    }
    setError('');
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      handleComplete();
    }
  }

  function handleBack() {
    setError('');
    setStep((s) => s - 1);
  }

  async function handleComplete() {
    if (submitting) return;
    if (!accessToken) {
      router.replace('/login');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    let res: Response;
    try {
      res = await fetch('/api/businesses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          name:                     formData.businessName.trim(),
          type:                     formData.businessType,
          phone:                    formData.phone.trim()       || null,
          email:                    formData.email.trim()       || null,
          // address: keep old compatibility column in sync with addressLine1.
          address:                  (formData.addressLine1 || formData.address).trim() || null,
          city:                     formData.city.trim()        || null,
          vat_number:               formData.vatNumber.trim()   || null,
          tax_office:               formData.taxOffice.trim()   || null,
          default_vat_rate:         formData.vatRate,
          default_offer_terms:      formData.offerTerms.trim()  || null,
          preferred_contact_method: 'viber',
          packageKey:               planKeyParam,
          ...(voucherCodeParam ? { voucherCode: voucherCodeParam } : {}),
          // structured fields (Slice 023):
          // legal_name defaults to businessName when legalName is left empty.
          legal_name:               (formData.legalName || formData.businessName).trim() || null,
          trade_name:               formData.tradeName.trim()       || null,
          owner_first_name:         formData.ownerFirstName.trim()  || null,
          owner_last_name:          formData.ownerLastName.trim()   || null,
          // address_line1 defaults to address when addressLine1 is left empty.
          address_line1:            (formData.addressLine1 || formData.address).trim() || null,
          address_line2:            formData.addressLine2.trim()    || null,
          postal_code:              formData.postalCode.trim()      || null,
          region:                   formData.region.trim()          || null,
          website:                  formData.website.trim()         || null,
        }),
      });
    } catch {
      setSubmitError('Δεν μπορέσαμε να αποθηκεύσουμε την επιχείρηση. Δοκίμασε ξανά.');
      setSubmitting(false);
      return;
    }
    if (res.status === 400) {
      let apiErr = '';
      try {
        const errBody = await res.json();
        apiErr = typeof errBody.error === 'string' ? errBody.error : '';
      } catch {
        // non-fatal parse failure
      }
      if (apiErr === 'invalid_package') {
        setSubmitError('Δεν βρέθηκε αυτό το πακέτο.');
      } else if (apiErr === 'invalid_voucher') {
        setSubmitError('Ο κωδικός δεν είναι έγκυρος.');
      } else if (apiErr === 'expired_voucher') {
        setSubmitError('Ο κωδικός έχει λήξει.');
      } else if (apiErr === 'invalid_postal_code') {
        setSubmitError('Ο ταχυδρομικός κώδικας πρέπει να είναι ακριβώς 5 ψηφία.');
      } else if (apiErr === 'invalid_website') {
        setSubmitError('Ο ιστότοπος πρέπει να ξεκινά με http:// ή https://.');
      } else {
        setSubmitError('Δεν μπορέσαμε να αποθηκεύσουμε την επιχείρηση. Δοκίμασε ξανά.');
      }
      setSubmitting(false);
      return;
    }
    if (res.status === 201 || res.status === 409) {
      try {
        const state = loadState();
        const now = new Date().toISOString();
        const businessProfile: BusinessProfile = {
          id: crypto.randomUUID(),
          businessName:  formData.businessName.trim(),
          businessType:  formData.businessType!,
          // ownerName is localStorage-only; derive from structured first/last name.
          ownerName:     [formData.ownerFirstName, formData.ownerLastName]
                           .map((s) => s.trim()).filter(Boolean).join(' '),
          phone:         formData.phone.trim(),
          email:         formData.email.trim(),
          address:       (formData.addressLine1 || formData.address).trim(),
          city:          formData.city.trim() || undefined,
          vatNumber:     formData.vatNumber.trim(),
          taxOffice:     formData.taxOffice.trim(),
          logoDataUrl:   formData.logoDataUrl,
          defaultVatRate:        formData.vatRate,
          defaultOfferTerms:     formData.offerTerms.trim(),
          defaultAcceptanceText:
            'Αποδέχομαι τους παραπάνω όρους και επιθυμώ να προχωρήσουμε.',
          preferredContactMethod: 'viber',
          // structured fields (cache only, written after successful DB save):
          legalName:      (formData.legalName || formData.businessName).trim() || undefined,
          tradeName:      formData.tradeName.trim()       || undefined,
          ownerFirstName: formData.ownerFirstName.trim()  || undefined,
          ownerLastName:  formData.ownerLastName.trim()   || undefined,
          addressLine1:   (formData.addressLine1 || formData.address).trim() || undefined,
          addressLine2:   formData.addressLine2.trim()    || undefined,
          postalCode:     formData.postalCode.trim()      || undefined,
          region:         formData.region.trim()          || undefined,
          website:        formData.website.trim()         || undefined,
          createdAt: now,
          updatedAt: now,
        };
        if (state.userProfile) {
          saveState({
            userProfile: { ...state.userProfile, onboardingCompleted: true },
            businessProfile,
            workspace: {
              id: crypto.randomUUID(),
              name: formData.businessName.trim(),
              mode: 'mock_local',
            },
          });
        }
      } catch {
        // localStorage write failure is non-fatal
      }
      try { localStorage.removeItem('yorgos_onboarding_prefill'); } catch { /* non-fatal */ }
      router.push('/number');
      return;
    }
    setSubmitError('Δεν μπορέσαμε να αποθηκεύσουμε την επιχείρηση. Δοκίμασε ξανά.');
    setSubmitting(false);
  }

  // Guard: redirect to /package if plan param is missing.
  // Returning null prevents a flash of the form before router.replace fires.
  if (!planKeyParam) {
    return null;
  }

  const profileFormValue: BusinessProfileData = {
    businessName:   formData.businessName,
    phone:          formData.phone,
    email:          formData.email,
    city:           formData.city,
    vatNumber:      formData.vatNumber,
    taxOffice:      formData.taxOffice,
    legalName:      formData.legalName,
    tradeName:      formData.tradeName,
    ownerFirstName: formData.ownerFirstName,
    ownerLastName:  formData.ownerLastName,
    // Show addressLine1 if set, otherwise fall back to legacy address field.
    addressLine1:   formData.addressLine1 || formData.address,
    addressLine2:   formData.addressLine2,
    postalCode:     formData.postalCode,
    region:         formData.region,
    website:        formData.website,
  };

  const currentStep = STEPS[step];
  const isLastStep = step === STEPS.length - 1;
  const isLogoStep = step === 2;

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-zinc-100 bg-white px-4 py-4">
        <div className="mx-auto max-w-lg">
          <p className="text-sm font-bold text-zinc-900">yorgos.ai</p>
          <div className="mt-3 flex gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                  i <= step ? 'bg-indigo-600' : 'bg-zinc-200'
                }`}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            Βήμα {step + 1} από {STEPS.length}
          </p>
          {planKeyParam && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200">
                {PLAN_NAMES[planKeyParam] ?? planKeyParam}
              </span>
              {voucherCodeParam && (
                <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200">
                  Κωδικός: {voucherCodeParam}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 px-4 py-6">
        <div className="mx-auto max-w-lg">
          <h1 className="text-xl font-semibold text-zinc-900">
            {currentStep.title}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">{currentStep.subtitle}</p>

          <div className="mt-6">
            {step === 0 && (
              <BusinessTypeSelector
                value={formData.businessType}
                onChange={(type) => updateForm({ businessType: type })}
              />
            )}
            {step === 1 && (
              <>
                <BusinessProfileForm
                  value={profileFormValue}
                  onChange={(fields) => {
                    // Keep legacy `address` column in sync so existing offer
                    // rendering (which reads `address`) continues to work.
                    const update: Partial<FormData> = { ...fields };
                    if (fields.addressLine1 !== undefined) {
                      update.address = fields.addressLine1;
                    }
                    updateForm(update);
                  }}
                />
                <p className="mt-3 text-xs text-zinc-400">
                  Το τηλέφωνο εδώ είναι κινητό επικοινωνίας. Ο επαγγελματικός αριθμός σου δίνεται αυτόματα από το yorgos.ai.
                </p>
              </>
            )}
            {step === 2 && (
              <LogoUpload
                value={formData.logoDataUrl}
                onChange={(dataUrl) => updateForm({ logoDataUrl: dataUrl })}
              />
            )}
            {step === 3 && (
              <VatAndTermsForm
                vatRate={formData.vatRate}
                offerTerms={formData.offerTerms}
                onChangeVat={(rate) => updateForm({ vatRate: rate })}
                onChangeTerms={(terms) => updateForm({ offerTerms: terms })}
              />
            )}
          </div>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-zinc-100 bg-white px-4 py-4">
        <div className="mx-auto flex max-w-lg gap-3">
          {step > 0 && (
            <button
              type="button"
              onClick={handleBack}
              className="flex-1 rounded-xl border border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 active:bg-zinc-100"
            >
              Πίσω
            </button>
          )}
          <button
            type="button"
            onClick={handleNext}
            disabled={isLastStep && submitting}
            className={`flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800${isLastStep && submitting ? ' opacity-60 cursor-not-allowed' : ''}`}
          >
            {isLastStep && submitting ? 'Αποθήκευση...' : isLastStep ? 'Ολοκλήρωση' : 'Συνέχεια'}
          </button>
        </div>
        {isLogoStep && (
          <div className="mx-auto mt-2 max-w-lg text-center">
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              className="text-sm text-zinc-400 hover:text-zinc-600"
            >
              Παράλειψη
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-full items-center justify-center">
          <p className="text-sm text-zinc-400">Φόρτωση...</p>
        </div>
      }
    >
      <OnboardingPageContent />
    </Suspense>
  );
}
