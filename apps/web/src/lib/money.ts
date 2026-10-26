/** INR decimal input to exact integer paise. No floating point conversion. */
export function parseINR(value: string, allowZero = true): number {
  const text = value.trim();
  if (!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(text)) throw new Error("Enter an INR amount with up to two decimal places, without commas or symbols.");
  const [whole, fraction = ""] = text.split(".");
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise) || paise > 1_000_000_000 || (!allowZero && paise === 0)) throw new Error(allowZero ? "Use an amount from ₹0 to ₹1,00,00,000." : "Use an amount greater than ₹0 and at most ₹1,00,00,000.");
  return paise;
}
export function amountInput(paise: number | null | undefined): string { if (paise == null) return ""; return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`; }
export function money(paise: number | null | undefined): string {
  if (paise == null) return "Not set";
  const negative = paise < 0; const value = Math.abs(paise);
  const whole = Math.floor(value / 100).toLocaleString("en-IN"); const fraction = value % 100;
  return `${negative ? "−" : ""}₹${whole}${fraction ? `.${String(fraction).padStart(2, "0")}` : ""}`;
}
