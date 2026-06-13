/** Masks an email for display (e.g. pu•••@g•••.com). */
export function redactEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•••";

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const domainName = dot >= 0 ? domain.slice(0, dot) : domain;
  const tld = dot >= 0 ? domain.slice(dot) : "";

  const mask = (value: string, keepStart: number): string => {
    if (value.length <= keepStart) return `${value[0] ?? ""}•••`;
    return `${value.slice(0, keepStart)}•••`;
  };

  return `${mask(local, 2)}@${mask(domainName, 1)}${tld}`;
}
