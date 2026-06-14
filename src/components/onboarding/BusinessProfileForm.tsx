'use client';

export interface BusinessProfileData {
  businessName: string;
  phone: string;
  email: string;
  city: string;
  vatNumber: string;
  taxOffice: string;
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

interface Props {
  value: BusinessProfileData;
  onChange: (fields: Partial<BusinessProfileData>) => void;
}

const inputCls =
  'w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-white/10 dark:bg-[#0f1923] dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:ring-indigo-500/20';
const labelCls = 'mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300';
const sectionTitleCls = 'mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-200';

function Field({
  label,
  optional,
  helperText,
  children,
}: {
  label: string;
  optional?: boolean;
  helperText?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={labelCls}>
        {label}
        {optional && (
          <span className="ml-1 text-xs font-normal text-zinc-400 dark:text-zinc-500">(προαιρετικό)</span>
        )}
      </label>
      {children}
      {helperText && (
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{helperText}</p>
      )}
    </div>
  );
}

export default function BusinessProfileForm({ value, onChange }: Props) {
  function set<K extends keyof BusinessProfileData>(key: K, val: BusinessProfileData[K]) {
    onChange({ [key]: val } as Partial<BusinessProfileData>);
  }

  return (
    <div className="flex flex-col gap-6">

      {/* 1. Ταυτότητα επιχείρησης */}
      <section>
        <h3 className={sectionTitleCls}>Ταυτότητα επιχείρησης</h3>
        <div className="flex flex-col gap-4">
          <Field label="Επωνυμία εμφάνισης">
            <input
              type="text"
              className={inputCls}
              value={value.businessName}
              onChange={(e) => set('businessName', e.target.value)}
              placeholder="π.χ. Τεχνική Παπαδόπουλος"
            />
          </Field>
          <Field label="Νομική επωνυμία" optional>
            <input
              type="text"
              className={inputCls}
              value={value.legalName}
              onChange={(e) => set('legalName', e.target.value)}
              placeholder="π.χ. ΤΕΧΝΙΚΗ ΠΑΠΑΔΟΠΟΥΛΟΣ ΙΚΕ"
            />
          </Field>
          <Field label="Εμπορικό όνομα" optional>
            <input
              type="text"
              className={inputCls}
              value={value.tradeName}
              onChange={(e) => set('tradeName', e.target.value)}
              placeholder="π.χ. Τεχνική Παπαδόπουλος"
            />
          </Field>
        </div>
      </section>

      {/* 2. Υπεύθυνος */}
      <section>
        <h3 className={sectionTitleCls}>Υπεύθυνος</h3>
        <div className="flex flex-col gap-4">
          <Field label="Όνομα υπευθύνου">
            <input
              type="text"
              className={inputCls}
              value={value.ownerFirstName}
              onChange={(e) => set('ownerFirstName', e.target.value)}
              placeholder="π.χ. Γιώργος"
            />
          </Field>
          <Field label="Επώνυμο υπευθύνου" optional>
            <input
              type="text"
              className={inputCls}
              value={value.ownerLastName}
              onChange={(e) => set('ownerLastName', e.target.value)}
              placeholder="π.χ. Παπαδόπουλος"
            />
          </Field>
        </div>
      </section>

      {/* 3. Επικοινωνία */}
      <section>
        <h3 className={sectionTitleCls}>Επικοινωνία</h3>
        <div className="flex flex-col gap-4">
          <Field label="Τηλέφωνο">
            <input
              type="tel"
              className={inputCls}
              value={value.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="π.χ. 694 000 0000"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              className={inputCls}
              value={value.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="π.χ. info@business.gr"
            />
          </Field>
          <Field label="Ιστότοπος" optional>
            <input
              type="url"
              className={inputCls}
              value={value.website}
              onChange={(e) => set('website', e.target.value)}
              placeholder="https://business.gr"
            />
          </Field>
        </div>
      </section>

      {/* 4. Διεύθυνση */}
      <section>
        <h3 className={sectionTitleCls}>Διεύθυνση</h3>
        <div className="flex flex-col gap-4">
          <Field label="Οδός και αριθμός">
            <input
              type="text"
              className={inputCls}
              value={value.addressLine1}
              onChange={(e) => set('addressLine1', e.target.value)}
              placeholder="π.χ. Λεωφ. Βικέλα 30"
            />
          </Field>
          <Field label="Συμπλήρωμα διεύθυνσης" optional>
            <input
              type="text"
              className={inputCls}
              value={value.addressLine2}
              onChange={(e) => set('addressLine2', e.target.value)}
              placeholder="π.χ. Όροφος 2"
            />
          </Field>
          <Field label="ΤΚ" optional>
            <input
              type="text"
              className={inputCls}
              value={value.postalCode}
              onChange={(e) => set('postalCode', e.target.value)}
              placeholder="π.χ. 54249"
              maxLength={5}
            />
          </Field>
          <Field
            label="Πόλη"
            optional
            helperText="Θα χρησιμοποιηθεί αργότερα για επιλογή αριθμού πόλης."
          >
            <input
              type="text"
              className={inputCls}
              value={value.city}
              onChange={(e) => set('city', e.target.value)}
              placeholder="π.χ. Θεσσαλονίκη"
              maxLength={100}
            />
          </Field>
          <Field label="Περιοχή / Νομός" optional>
            <input
              type="text"
              className={inputCls}
              value={value.region}
              onChange={(e) => set('region', e.target.value)}
              placeholder="π.χ. Κεντρική Μακεδονία"
            />
          </Field>
        </div>
      </section>

      {/* 5. Φορολογικά */}
      <section>
        <h3 className={sectionTitleCls}>Φορολογικά</h3>
        <div className="flex flex-col gap-4">
          <Field label="ΑΦΜ" optional>
            <input
              type="text"
              className={inputCls}
              value={value.vatNumber}
              onChange={(e) => set('vatNumber', e.target.value)}
              placeholder="π.χ. 123456789"
            />
          </Field>
          <Field label="ΔΟΥ" optional>
            <input
              type="text"
              className={inputCls}
              value={value.taxOffice}
              onChange={(e) => set('taxOffice', e.target.value)}
              placeholder="π.χ. Α΄ Αθηνών"
            />
          </Field>
        </div>
      </section>

    </div>
  );
}
