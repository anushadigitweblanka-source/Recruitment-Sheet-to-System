// Turns the HTML of a public CV or portfolio page into plain text lines, the
// same shape the PDF and Word readers produce, so the one field extractor
// reads all three.
//
// This is a text filter, not a browser: nothing is executed, nothing is loaded
// (no scripts, styles, images, frames or other pages) and no network is used.
// Content a page builds with JavaScript is therefore not seen; such a page is
// reported as unreadable instead of being guessed at.

const MAX_LINKS = 100;

// Elements whose content is never CV text.
const DROPPED = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'object',
  'head',
  'nav',
];

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  middot: '·',
  bull: '•',
  copy: '©',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code =
        body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

// True when the bytes look like an HTML page (the bytes decide, not the
// content type the server claims).
export function looksLikeHtml(buffer) {
  const head = buffer
    .subarray(0, 2048)
    .toString('latin1')
    .replace(/^ï»¿/, '')
    .trimStart()
    .toLowerCase();
  return (
    /^(<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<!--)/.test(head) ||
    /<(title|body|h1)[\s>]/.test(head)
  );
}

// The text encoding the page declares (default UTF-8).
export function decodeHtml(buffer) {
  const sniff = buffer.subarray(0, 2048).toString('latin1');
  const label = sniff.match(/<meta[^>]+charset=["']?\s*([a-z0-9_-]+)/i)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(label).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  const value = match ? (match[1] ?? match[2] ?? match[3]) : undefined;
  return value === undefined ? null : decodeEntities(value).trim();
}

// Cloudflare's "email protection" stores an address as hex: the first byte is a
// key and every later byte is a character XOR the key. The address is already
// in the page's HTML, so reading it runs no script and contacts no server.
function decodeProtectedEmail(hex) {
  if (!/^(?:[0-9a-f]{2}){3,}$/i.test(hex)) return null;
  const [key, ...rest] = hex.match(/../g).map((pair) => parseInt(pair, 16));
  return String.fromCharCode(...rest.map((byte) => byte ^ key));
}

// Reads `buffer` as HTML. Returns { text, links, hiddenEmail, person,
// documentLinks }: hiddenEmail is true when the page hides an address behind a
// script that was not run; person is the schema.org Person the page declares (or
// null); documentLinks are links that may lead to a downloadable CV.
export function htmlToText(buffer, { baseUrl = null } = {}) {
  let html = decodeHtml(buffer).replace(/<!--[\s\S]*?-->/g, ' ');
  // Read before scripts and the <head> are dropped: both hold data, not CV text.
  const person = findPerson(html);
  const documentLinks = findDocumentLinks(html, baseUrl);
  for (const name of DROPPED) {
    html = html.replace(new RegExp(`<${name}\\b[\\s\\S]*?<\\/${name}\\s*>`, 'gi'), ' ');
  }

  html = html.replace(
    /<(\w+)\b[^>]*\bdata-cfemail\s*=\s*["']([0-9a-f]+)["'][^>]*>[\s\S]*?<\/\1\s*>/gi,
    (whole, tag, hex) => decodeProtectedEmail(hex) ?? whole,
  );

  const links = [...(person?.sameAs ?? [])];
  // Addresses behind links. A mailto: or tel: whose address is not visible in
  // the link text is written out after it, so the extractor can see it.
  html = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (whole, attrs, inner) => {
    const href = attribute(`<a ${attrs}`, 'href');
    if (!href) return inner;
    if (/^(https?|mailto|tel):/i.test(href) && links.length < MAX_LINKS) links.push(href);
    const visible = decodeEntities(inner.replace(/<[^>]*>/g, ''));
    const direct = href.match(/^(mailto|tel):(.+)$/i);
    if (direct) {
      const target = decodeURIComponent(direct[2].split('?')[0]).trim();
      return visible.includes(target) ? inner : `${inner} ${target} `;
    }
    return inner;
  });

  const text = decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(
        /<\/(p|div|section|article|header|footer|main|aside|ul|ol|li|h[1-6]|tr|table|dl|dt|dd|blockquote|pre|form|fieldset|address)\s*>/gi,
        '\n',
      )
      .replace(
        /<(p|div|section|article|header|footer|main|aside|ul|ol|li|h[1-6]|tr|table|dl|dt|dd|blockquote|pre|form|fieldset|address)\b[^>]*>/gi,
        '\n',
      )
      .replace(/<\/(td|th)\s*>/gi, '  ')
      // Inline formatting does not separate words: "name<span>@</span>site.com".
      .replace(
        /<\/?(?:span|b|i|u|em|strong|small|mark|font|sub|sup|abbr|code|wbr|bdi)\b[^>]*>/gi,
        '',
      )
      .replace(/<[^>]*>/g, ' '),
  );

  const lines = text.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim());
  return {
    text: lines.filter((line, i) => line || lines[i - 1]).join('\n'),
    links,
    hiddenEmail: /\[email\s*protected\]/i.test(text),
    person,
    documentLinks,
  };
}

// ---------------------------------------------------------------- structured data

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const asArray = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);
const asText = (value) => (typeof value === 'string' ? value.trim() : '');

function addressText(address) {
  if (typeof address === 'string') return address.trim();
  if (!address || typeof address !== 'object') return '';
  return [
    address.streetAddress,
    address.addressLocality,
    address.addressRegion,
    address.postalCode,
    typeof address.addressCountry === 'object'
      ? address.addressCountry?.name
      : address.addressCountry,
  ]
    .map(asText)
    .filter(Boolean)
    .join(', ');
}

function isPerson(node) {
  return node && typeof node === 'object' && asArray(node['@type']).includes('Person');
}

// Every object in a JSON-LD document, however deeply it is nested.
function* walk(node, depth = 0) {
  if (depth > 6 || !node || typeof node !== 'object') return;
  yield node;
  for (const value of Array.isArray(node) ? node : Object.values(node))
    yield* walk(value, depth + 1);
}

// The candidate's own details as the page declares them in schema.org JSON-LD
// (<script type="application/ld+json">, which is data, not run). Nothing is
// taken from anywhere else, and a Person without contact details is only a name.
// Returns null, or { name, email, phones, address, sameAs }.
export function findPerson(html) {
  let best = null;
  for (const block of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  )) {
    let data;
    try {
      data = JSON.parse(block[1]);
    } catch {
      continue;
    }
    for (const node of walk(data)) {
      if (!isPerson(node)) continue;
      const email = asText(node.email).replace(/^mailto:/i, '');
      const person = {
        name: asText(node.name),
        email: EMAIL_SHAPE.test(email) ? email : '',
        phones: asArray(node.telephone)
          .map(asText)
          .filter((p) => p && p.length <= 30),
        address: addressText(node.address),
        sameAs: asArray(node.sameAs)
          .map(asText)
          .filter((u) => /^https:\/\//i.test(u)),
      };
      const weight = (p) =>
        (p.email ? 4 : 0) + (p.phones.length ? 4 : 0) + (p.address ? 1 : 0) + (p.name ? 1 : 0);
      if (!best || weight(person) > weight(best)) best = person;
    }
  }
  return best && (best.name || best.email || best.phones.length) ? best : null;
}

// The person's details written as the labelled lines the field extractor reads.
export function personLines(person) {
  return [
    person.name && `Name: ${person.name}`,
    person.email && `Email: ${person.email}`,
    ...person.phones.map((phone) => `Phone: ${phone}`),
    person.address && `Address: ${person.address}`,
  ].filter(Boolean);
}

// ---------------------------------------------------------------- linked documents

const CV_WORDS = /\b(?:cv|c\.v\.|resume|résumé|curriculum(?:\s+vitae)?)\b/i;
const NOT_A_CV = /privacy|terms|cookie|policy|brochure|catalog|invoice|certificate/i;

// Links on a page that may lead to the candidate's own CV document: files
// ending in .pdf/.docx, or links worded "CV" / "Resume". Whether one really is
// a document is decided later from its bytes, never from the address.
// Returns up to `limit` absolute https addresses, best first.
export function findDocumentLinks(html, baseUrl, limit = 3) {
  if (!baseUrl) return [];
  const found = new Map();
  const consider = (rawHref, label, bonus) => {
    const href = decodeEntities(rawHref ?? '').trim();
    if (!href || href.startsWith('#') || /^(?:mailto|tel|javascript|data):/i.test(href)) return;
    let url;
    try {
      url = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (url.protocol !== 'https:') return;
    url.hash = '';
    const file = /\.(?:pdf|docx)$/i.test(url.pathname);
    const worded = CV_WORDS.test(label) || CV_WORDS.test(decodeURIComponent(url.pathname));
    if (!file && !worded) return;
    if (NOT_A_CV.test(url.pathname) || NOT_A_CV.test(label)) return;
    const score = (file ? 2 : 0) + (worded ? 3 : 0) + bonus;
    const key = url.toString();
    if (url.toString() === new URL(baseUrl).toString()) return;
    if ((found.get(key) ?? -1) < score) found.set(key, score);
  };
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const tag = `<a ${match[1]}`;
    const label = [
      decodeEntities(match[2].replace(/<[^>]*>/g, ' ')),
      attribute(tag, 'aria-label'),
      attribute(tag, 'title'),
      attribute(tag, 'download'),
    ]
      .filter(Boolean)
      .join(' ');
    consider(attribute(tag, 'href'), label, attribute(tag, 'download') !== null ? 1 : 0);
  }
  // <link rel="preload" as="document" href="CV.pdf">, <link rel="alternate" ...>
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    consider(attribute(match[0], 'href'), attribute(match[0], 'title') ?? '', 0);
  }
  return [...found.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([url]) => url);
}
