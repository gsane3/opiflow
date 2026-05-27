'use client';

export interface BusinessProfileData {
  businessName: string;
  ownerName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  vatNumber: string;
  taxOffice: string;
}

interface Props {
  value: BusinessProfileData;
  onChange: (fields: Partial<BusinessProfileData>) => void;
}

interface FieldConfig {
  key: keyof BusinessProfileData;
  label: string;
  placeholder: string;
  type?: string;
  optional?: boolean;
  maxLength?: number;
  helperText?: string;
}

const fields: Array<FieldConfig> = [
  {
    key: 'businessName',
    label: 'Όνομα επιχείρησης',
    placeholder: 'π.χ. Τεχνική Παπαδόπουλος',
  },
  {
    key: 'ownerName',
    label: 'Ονοματεπώνυμο',
    placeholder: 'π.χ. Γιώργος Παπαδόπουλος',
  },
  {
    key: 'phone',
    label: 'Τηλέφωνο',
    placeholder: 'π.χ. 694 000 0000',
    type: 'tel',
  },
  {
    key: 'email',
    label: 'Email',
    placeholder: 'π.χ. info@business.gr',
    type: 'email',
  },
  {
    key: 'address',
    label: 'Διεύθυνση',
    placeholder: 'π.χ. Αθήνα, Αττική',
  },
  {
    key: 'city',
    label: 'Πόλη',
    placeholder: 'π.χ. Αθήνα',
    optional: true,
    maxLength: 100,
    helperText: 'Θα χρησιμοποιηθεί αργότερα για επιλογή αριθμού πόλης.',
  },
  {
    key: 'vatNumber',
    label: 'ΑΦΜ',
    placeholder: 'π.χ. 123456789',
    optional: true,
  },
  {
    key: 'taxOffice',
    label: 'ΔΟΥ',
    placeholder: 'π.χ. Α΄ Αθηνών',
    optional: true,
  },
];

export default function BusinessProfileForm({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {fields.map((field) => (
        <div key={field.key}>
          <label className="mb-1 block text-sm font-medium text-zinc-700">
            {field.label}
            {field.optional && (
              <span className="ml-1 text-xs font-normal text-zinc-400">
                (προαιρετικό)
              </span>
            )}
          </label>
          <input
            type={field.type ?? 'text'}
            value={value[field.key]}
            onChange={(e) => onChange({ [field.key]: e.target.value })}
            placeholder={field.placeholder}
            maxLength={field.maxLength}
            className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          {field.helperText && (
            <p className="mt-1 text-xs text-zinc-400">{field.helperText}</p>
          )}
        </div>
      ))}
    </div>
  );
}
