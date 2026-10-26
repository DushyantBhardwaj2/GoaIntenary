/** Only application routes may be a post-authentication destination. */
export function safeReturnPath(value: string | null): string {
  if (["/trips", "/explore", "/join"].includes(value ?? "") || /^\/trips\/[a-z0-9-]+$/i.test(value ?? "")) return value!;
  return "/trips";
}
