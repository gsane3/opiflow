export function isLikelyMobile(phone: string): boolean {
  const clean = phone.replace(/[\s\-\(\)\.\+]/g, '');
  // Greek mobile: 69XXXXXXXX, 069XXXXXXXX, 3069XXXXXXXX, 003069XXXXXXXX
  return /^(0030|30|0)?69\d{7,8}$/.test(clean);
}

export function getSmsPhone(customer: {
  phone?: string;
  mobilePhone?: string;
}): string | null {
  if (customer.mobilePhone?.trim()) return customer.mobilePhone.trim();
  if (customer.phone?.trim() && isLikelyMobile(customer.phone)) return customer.phone.trim();
  return null;
}
