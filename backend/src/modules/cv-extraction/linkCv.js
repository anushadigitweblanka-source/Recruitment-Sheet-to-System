// Reads a CV from a link, whatever the link points at. The kind of thing at the
// address is decided from the bytes that come back, never from the address:
//
//   PDF or Word file        -> read directly.
//   Web page                -> 1. its own text and structured data (schema.org
//                                 Person), mailto/tel/LinkedIn links;
//                              2. a CV document the page links to (a PDF or Word
//                                 file), read as well and preferred where it has
//                                 more;
//                              3. only if neither gives enough, the page is opened
//                                 in the isolated browser (renderPage) and its
//                                 visible text is read.
//
// Everything is fetched through the safe fetcher; nothing here keeps or logs
// the content.

import { extractCv, failure } from './extractCv.js';
import { FetchRefused } from './safeFetch.js';
import { decodeHtml, findDocumentLinks, looksLikeHtml } from './htmlText.js';
import { detectFormat } from './textExtractor.js';

const MAX_DOCUMENT_TRIES = 2;
// A page whose own text is this short, with nothing else found, is worth rendering.
const THIN_PAGE_CHARS = 400;
const MIN_FIELDS_FOR_STATIC = 3;

const usable = (extraction) => Boolean(extraction) && extraction.status !== 'failed';

const RENDER_UNAVAILABLE =
  'This page builds its content with JavaScript, and pages like that cannot be read on this server (it has no isolated browser for them). Use a link to a PDF or Word CV, or the site’s own CV download link.';

// Combines two readings of the same CV. `primary` wins wherever it found a value;
// `secondary` fills what it did not find.
export function mergeExtractions(primary, secondary) {
  if (!usable(primary)) return secondary;
  if (!usable(secondary)) return primary;
  const fields = { ...secondary.fields, ...primary.fields };
  for (const name of Object.keys(secondary.fields)) {
    if (
      primary.fields[name]?.status !== 'extracted' &&
      secondary.fields[name]?.status === 'extracted'
    ) {
      fields[name] = secondary.fields[name];
    }
  }
  const formDraft = { ...secondary.formDraft, ...primary.formDraft };
  const review = { extracted: [], uncertain: [], unavailable: [] };
  for (const [name, field] of Object.entries(fields)) review[field.status]?.push(name);
  const base = [
    'fullName',
    'phone',
    'email',
    'address',
    'olMaths',
    'alResult',
    'alStream',
    'otherEducation',
  ];
  return {
    ...primary,
    fields,
    formDraft,
    review,
    status: base.every((name) => fields[name]?.status === 'extracted') ? 'extracted' : 'partial',
    hints: {
      appliedPosition: primary.hints?.appliedPosition ?? secondary.hints?.appliedPosition ?? null,
      targetPosition: primary.hints?.targetPosition ?? secondary.hints?.targetPosition ?? null,
      source: primary.hints?.source ?? secondary.hints?.source ?? null,
    },
    warnings: [...new Set([...primary.warnings, ...secondary.warnings])],
  };
}

// Tries the CV documents a page links to; returns the first that reads, or null.
async function readLinkedDocument(links, { fetchDocument, extract }) {
  for (const link of links.slice(0, MAX_DOCUMENT_TRIES)) {
    let document;
    try {
      document = await fetchDocument(link);
    } catch (error) {
      if (error instanceof FetchRefused) continue;
      throw error;
    }
    if (!detectFormat(document.buffer)) continue; // another web page, not a document
    const extraction = await extract({ buffer: document.buffer });
    if (usable(extraction)) {
      extraction.source = { ...extraction.source, linkedDocument: true };
      return extraction;
    }
  }
  return null;
}

// Links from the rendered page, as the anchor HTML findDocumentLinks reads.
const anchorHtml = (anchors) =>
  anchors
    .map(
      (a) =>
        `<a href="${String(a.href).replaceAll('"', '%22')}">${String(a.text).replaceAll('<', ' ')}</a>`,
    )
    .join('\n');

// Returns an extraction result (possibly { status: 'failed' }). Throws FetchRefused
// when the link itself is refused (private address, redirect, login and so on).
export async function readCvLink({ url, fetchDocument, renderPage = null, extract = extractCv }) {
  const { buffer } = await fetchDocument(url);

  if (detectFormat(buffer) || !looksLikeHtml(buffer)) return extract({ buffer });

  const page = await extract({ buffer, allowHtml: true, baseUrl: url });
  const linked = await readLinkedDocument(findDocumentLinks(decodeHtml(buffer), url), {
    fetchDocument,
    extract,
  });
  let best = mergeExtractions(linked, page);

  const staticIsEnough =
    usable(best) &&
    (linked !== null ||
      (best.source.characters >= THIN_PAGE_CHARS &&
        Object.keys(best.formDraft).length >= MIN_FIELDS_FOR_STATIC) ||
      Object.keys(best.formDraft).length >= MIN_FIELDS_FOR_STATIC + 2);
  if (staticIsEnough) return best;

  const pageNeedsScripts = !usable(page) && page.reason === 'needs_javascript';
  const thin = usable(page);
  if (!pageNeedsScripts && !thin) return best; // failed for another reason: report it

  if (!renderPage)
    return pageNeedsScripts ? failure('render_unavailable', RENDER_UNAVAILABLE) : best;

  let rendered;
  try {
    rendered = await renderPage(url);
  } catch (error) {
    if (usable(best)) return best; // the static reading stands
    if (
      error?.reason === 'no_browser' ||
      error?.reason === 'no_playwright' ||
      error?.reason === 'launch_failed'
    ) {
      return failure('render_unavailable', RENDER_UNAVAILABLE);
    }
    return failure(
      error?.reason ?? 'render_failed',
      error?.message ?? 'The page could not be rendered.',
    );
  }

  const fromRender = await extract({ rendered });
  const renderedLinked = await readLinkedDocument(
    findDocumentLinks(anchorHtml(rendered.anchors ?? []), url),
    { fetchDocument, extract },
  );
  const merged = mergeExtractions(mergeExtractions(renderedLinked, fromRender), best);
  return usable(merged) ? merged : fromRender;
}
