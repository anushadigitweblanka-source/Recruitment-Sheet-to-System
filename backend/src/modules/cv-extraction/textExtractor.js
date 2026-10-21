// Local text extraction for CV files. Nothing here touches the network, the
// database or the disk: bytes in, text out. No OCR and no external AI service
// is used, so a scanned (image-only) PDF is reported as unreadable instead.
//
// Supported: PDF (unpdf, which wraps Mozilla's PDF.js) and DOCX (mammoth).
// Legacy .doc is not supported: it is a binary format with no maintained
// pure-JavaScript reader, and guessing at its bytes would invent text.

import JSZip from 'jszip';
import mammoth from 'mammoth';
import { getDocumentProxy } from 'unpdf';
import { layoutPageText } from './pdfLayout.js';
import { findPerson, htmlToText, looksLikeHtml, personLines } from './htmlText.js';
import { COMPANY_CV_MAX_BYTES } from '../company-cv/companyCv.service.js';

export const PDF_TYPE = 'application/pdf';
export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const DOC_TYPE = 'application/msword';

export const MAX_BYTES = COMPANY_CV_MAX_BYTES; // same 5 MB limit as the Company CV upload
export const MAX_PDF_PAGES = 10;
export const MAX_TEXT_CHARS = 100_000;
// A DOCX is a zip file, so its unpacked size is checked before it is read.
const MAX_DOCX_ENTRIES = 500;
const MAX_DOCX_UNPACKED_BYTES = 30 * 1024 * 1024;

const fail = (reason, message) => ({ ok: false, reason, message });

// Decides the format from the file's own bytes. The declared content type or
// file name is only a hint and is never trusted on its own.
export function detectFormat(buffer) {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return 'zip';
  }
  // The legacy Word / Office binary signature.
  if (buffer.subarray(0, 4).toString('hex') === 'd0cf11e0') return 'ole';
  return null;
}

// Tidies extracted text without changing its words: unifies line endings,
// removes invisible characters and trailing spaces, and caps blank lines.
export function cleanText(text) {
  return (
    String(text)
      .normalize('NFC')
      .replace(/\r\n?|\u2028|\u2029/g, '\n')
      .replace(/[\u00a0\u2007\u202f]/g, ' ')
      .replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, '')
      // eslint-disable-next-line no-control-regex -- removing control characters is the point
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

async function readPdf(buffer) {
  let pdf;
  try {
    // A copy, because PDF.js takes ownership of the array it is given.
    pdf = await getDocumentProxy(new Uint8Array(buffer), { isEvalSupported: false });
  } catch (error) {
    const encrypted = error?.name === 'PasswordException';
    return encrypted
      ? fail('encrypted', 'The PDF is password protected, so it cannot be read.')
      : fail('unreadable', 'The PDF could not be opened. It may be damaged.');
  }

  try {
    const pageCount = pdf.numPages;
    const warnings = [];
    if (pageCount > MAX_PDF_PAGES) {
      warnings.push(`Only the first ${MAX_PDF_PAGES} of ${pageCount} pages were read.`);
    }
    const pages = [];
    const links = [];
    for (let n = 1; n <= Math.min(pageCount, MAX_PDF_PAGES); n += 1) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      pages.push(layoutPageText(content.items));
      // Clickable links ("LinkedIn" with the address behind it) are not text.
      const annotations = await page.getAnnotations().catch(() => []);
      for (const note of annotations) {
        const url = note.url ?? note.unsafeUrl;
        if (note.subtype === 'Link' && typeof url === 'string' && links.length < MAX_LINKS) {
          links.push(url);
        }
      }
    }
    const raw = pages.join('\n\n');
    return { ok: true, text: raw, pageCount, warnings, links };
  } catch {
    return fail('unreadable', 'The PDF text could not be read. It may be damaged.');
  } finally {
    await pdf.loadingTask?.destroy?.();
  }
}

const MAX_LINKS = 100;

// The addresses behind a Word document's hyperlinks (its external relationships).
async function docxLinks(zip) {
  try {
    const rels = await zip.file('word/_rels/document.xml.rels')?.async('string');
    const links = [];
    for (const tag of (rels ?? '').match(/<Relationship\b[^>]*>/g) ?? []) {
      if (!/\/hyperlink"/.test(tag) || !/TargetMode="External"/.test(tag)) continue;
      const target = tag.match(/Target="([^"]*)"/)?.[1];
      if (target && links.length < MAX_LINKS) links.push(target.replaceAll('&amp;', '&'));
    }
    return links;
  } catch {
    return [];
  }
}

async function readDocx(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return fail('unreadable', 'The Word file could not be opened. It may be damaged.');
  }

  const entries = Object.values(zip.files);
  if (entries.length > MAX_DOCX_ENTRIES) {
    return fail('unreadable', 'The Word file has an unusual structure and was not read.');
  }
  const unpacked = entries.reduce((sum, entry) => sum + (entry._data?.uncompressedSize ?? 0), 0);
  if (unpacked > MAX_DOCX_UNPACKED_BYTES) {
    return fail('too_large', 'The Word file is too large once unpacked and was not read.');
  }
  if (!zip.file('word/document.xml')) {
    return fail('unsupported_format', 'The file is a zip archive but not a Word (.docx) document.');
  }

  try {
    const { value, messages } = await mammoth.extractRawText({ buffer });
    const warnings = messages.filter((m) => m.type === 'warning').map((m) => m.message);
    // Mammoth separates paragraphs with a blank line; one line per paragraph
    // matches how PDF text arrives.
    return {
      ok: true,
      text: value.replace(/\n\n/g, '\n'),
      pageCount: null,
      warnings: warnings.slice(0, 5),
      links: await docxLinks(zip),
    };
  } catch {
    return fail('unreadable', 'The Word file text could not be read. It may be damaged.');
  }
}

// A web page: the text in its HTML, plus the candidate details it declares as
// structured data (schema.org Person in JSON-LD). Nothing in it is run.
function readHtmlPage(buffer, baseUrl) {
  const { text: raw, links, hiddenEmail, person } = htmlToText(buffer, { baseUrl });
  const body = cleanText(raw);
  const declared = person ? personLines(person) : [];
  const text = [...declared, ...(declared.length > 0 ? [''] : []), body]
    .join('\n')
    .slice(0, MAX_TEXT_CHARS);
  if (declared.length === 0 && body.replace(/\s/g, '').length < 200) {
    return fail(
      'needs_javascript',
      'This web page builds its content with JavaScript, so there is almost no text in its HTML.',
    );
  }
  const warnings = hiddenEmail
    ? [
        'This web page hides its email address with a script that is not run, so the address could not be read. Enter it by hand.',
      ]
    : [];
  return { ok: true, format: 'html', text, pageCount: null, warnings, links };
}

// A web page that was rendered in an isolated browser: its visible text.
function readRenderedPage({ text: raw, links = [], ldjson = [] }) {
  const body = cleanText(String(raw ?? ''));
  // Structured data the page added to itself (schema.org Person), as labelled lines.
  const person = findPerson(
    ldjson.map((json) => `<script type="application/ld+json">${json}</script>`).join('\n'),
  );
  const declared = person ? personLines(person) : [];
  const text = [...declared, ...(declared.length > 0 ? [''] : []), body]
    .join('\n')
    .slice(0, MAX_TEXT_CHARS);
  const direct = links.some((link) => /^(mailto|tel):/i.test(link));
  if (declared.length === 0 && !direct && body.replace(/\s/g, '').length < 60) {
    return fail('empty_page', 'The page opened but contains no readable text.');
  }
  return {
    ok: true,
    format: 'rendered',
    text,
    pageCount: null,
    warnings: [],
    links: [...links, ...(person?.sameAs ?? [])],
  };
}

// Reads the text of a CV. Returns
//   { ok: true, format, text, pageCount, warnings }
// or { ok: false, reason, message } where reason is one of: no_file,
// too_large, unsupported_format, legacy_doc, encrypted, unreadable, no_text.
// `allowHtml` is set only for a fetched link: an uploaded file must be a PDF
// or a Word file.
export async function extractCvText({
  buffer,
  allowHtml = false,
  baseUrl = null,
  rendered = null,
}) {
  if (rendered) return readRenderedPage(rendered);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return fail('no_file', 'No file was provided.');
  }
  if (buffer.length > MAX_BYTES) {
    return fail('too_large', `The file is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
  }

  const detected = detectFormat(buffer);
  if (detected === 'ole') {
    return fail(
      'legacy_doc',
      'Old Word (.doc) files are not supported. Save the CV as .docx or PDF and try again.',
    );
  }
  if (!detected && allowHtml && looksLikeHtml(buffer)) return readHtmlPage(buffer, baseUrl);
  if (!detected) {
    return fail('unsupported_format', 'Only PDF and Word (.docx) CV files are supported.');
  }

  const format = detected === 'pdf' ? 'pdf' : 'docx';
  const result = detected === 'pdf' ? await readPdf(buffer) : await readDocx(buffer);
  if (!result.ok) return result;

  const warnings = [...result.warnings];
  let text = cleanText(result.text);
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    warnings.push(`The text was cut at ${MAX_TEXT_CHARS} characters.`);
  }
  if (text.replace(/\s/g, '').length < 20) {
    return fail(
      'no_text',
      format === 'pdf'
        ? 'The PDF has no readable text. It may be a scanned image, and OCR is not used.'
        : 'The Word file has no readable text.',
    );
  }

  return {
    ok: true,
    format,
    text,
    pageCount: result.pageCount,
    warnings,
    links: result.links ?? [],
  };
}
