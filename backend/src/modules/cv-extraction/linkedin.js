// Finds the candidate's own LinkedIn profile address in a CV.
//
// Everything here is local text handling. The address is only ever READ and
// checked for shape: nothing is fetched from LinkedIn and no profile is opened.
//
// What counts: a personal profile, https://www.linkedin.com/in/<name>, written
// in the text (with or without https:// and www.) or hidden behind a clickable
// word such as "LinkedIn" (a PDF link or a Word hyperlink, passed in as
// `links`). What does not: a company, school, job or post page, an address on
// any other site (including look-alikes such as linkedin.com.example.test), a
// template placeholder (/in/your-name), and anything below a References heading
// (a referee's profile is not the candidate's).

const PROFILE_IN_TEXT = /(?:https?:\/\/)?(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/in\/[^\s<>"'\])]+/gi;
const COMPANY_IN_TEXT =
  /(?:https?:\/\/)?(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/(?:company|school|showcase|jobs|posts|feed|pulse|groups)\/[^\s<>"'\])]+/i;
const PLACEHOLDER_SLUG =
  /^(?:your[-._]?(?:name|profile|username|id|link)|user[-._]?name|(?:first|firstname)[-._]?(?:last|lastname)|name[-._]?surname|profile[-._]?name)$/i;
const SLUG = /^[A-Za-z0-9%_.-]{2,100}$/;

// The canonical profile address (https://www.linkedin.com/in/<name>) for what
// the CV wrote, or null when it is not a personal LinkedIn profile.
export function canonicalLinkedinProfile(raw) {
  let text = String(raw ?? '')
    .trim()
    .replace(/[.,;:!?)\]]+$/, '');
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;

  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;

  const slug = url.pathname.match(/^\/in\/([^/]+)/i)?.[1];
  if (!slug || !SLUG.test(slug)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    return null;
  }
  // After decoding, a profile name is letters, digits, dots, dashes and underscores.
  if (!/^[\p{L}\p{N}_.-]+$/u.test(decoded) || PLACEHOLDER_SLUG.test(decoded)) return null;
  return `https://www.linkedin.com/in/${slug}`;
}

const found = (value) => ({ status: 'extracted', value, note: null });

// Reads the CV's text lines and any clickable links. Returns the same shape as
// the other fields: { status: 'extracted' | 'uncertain' | 'unavailable', value, note }.
export function findLinkedin(lines, links = []) {
  const end = lines.findIndex((line) => /^\s*(?:references?|referees?)\s*:?\s*$/i.test(line));
  const body = end === -1 ? lines : lines.slice(0, end);

  const profiles = [];
  const add = (raw) => {
    const profile = canonicalLinkedinProfile(raw);
    if (profile && !profiles.some((p) => p.toLowerCase() === profile.toLowerCase())) {
      profiles.push(profile);
    }
  };
  for (const link of links) add(link);
  for (const line of body) for (const match of line.matchAll(PROFILE_IN_TEXT)) add(match[0]);

  if (profiles.length === 1) return found(profiles[0]);
  if (profiles.length > 1) {
    return {
      status: 'uncertain',
      value: null,
      note: 'More than one LinkedIn profile was found. Enter the right one.',
      alternatives: profiles,
    };
  }

  const company =
    body.some((line) => COMPANY_IN_TEXT.test(line)) || links.some((l) => COMPANY_IN_TEXT.test(l));
  return {
    status: 'unavailable',
    value: null,
    note: company
      ? 'Only a company LinkedIn page was found, which is not the candidate’s own profile.'
      : 'No LinkedIn profile link was found in the CV.',
  };
}
