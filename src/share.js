export const MAX_SHARE_CHARS = 2000;

// Turns an Android share ({ text, webUrl, meta: { title } }) into compose-box text, or '' to ignore it.
// Chrome sends the page title as the subject and the link as the text.
export function shareText({ text, webUrl, meta } = {}) {
  const subject = meta?.title?.trim() ?? '';
  const body = (text?.trim() || webUrl?.trim()) ?? '';
  let out = (subject && !body.includes(subject) ? [subject, body] : [body]).filter(Boolean).join('\n');
  if (out.length > MAX_SHARE_CHARS) {
    out = out.slice(0, MAX_SHARE_CHARS);
    if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1); // don't split an emoji
    out = out.trimEnd();
  }
  return out;
}
