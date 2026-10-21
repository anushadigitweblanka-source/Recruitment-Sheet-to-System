// A LinkedIn profile address, checked for shape only. The page never opens it
// or makes a request to LinkedIn: it is just text that HR can keep or change.

const SLUG = /^[A-Za-z0-9%_.-]{2,100}$/;

// True for https://www.linkedin.com/in/<name> (any linkedin.com host, optional
// trailing slash or query). Anything else, including company pages, other sites
// and addresses with a user name or password, is refused.
export function isLinkedinProfileUrl(value) {
  const text = String(value ?? '').trim();
  if (!text || /\s/.test(text)) return false;
  let url;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return false;
  const slug = url.pathname.match(/^\/in\/([^/]+)/i)?.[1];
  return Boolean(slug && SLUG.test(slug));
}
