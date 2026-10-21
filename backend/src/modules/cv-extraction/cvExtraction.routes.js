import express, { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { findLikelyDuplicates } from '../candidates/candidates.repository.js';
import { normalizeName, phoneMatchKey } from '../candidates/candidates.validation.js';
import { extractCv } from './extractCv.js';
import { readCvLink } from './linkCv.js';
import { renderCvPage } from './renderPage.js';
import { FetchRefused, fetchCvDocument } from './safeFetch.js';
import { DOCX_TYPE, MAX_BYTES, PDF_TYPE } from './textExtractor.js';

// Reading a CV is a preview. These routes never create or change a candidate,
// never store the file, and write nothing: they return the details found plus
// any existing candidates who look like the same person. HR checks the filled
// form and saves it through the existing POST /api/candidates (validation,
// duplicate warning, generated Candidate ID, history and audit).
//
//   POST /api/candidates/extract-cv/file   the PDF/DOCX bytes as the body
//   POST /api/candidates/extract-cv/link   { url } - fetched safely, then read

const MAX_PARALLEL_LINK_FETCHES = 4;
const MAX_PARALLEL_RENDERS = 2;

const FETCH_STATUS = {
  invalid_link: 422,
  not_https: 422,
  credentials_in_link: 422,
  bad_port: 422,
  not_public: 422,
  redirect: 422,
  needs_login: 422,
  not_a_document: 422,
  too_large: 413,
  timeout: 504,
  unreachable: 502,
};

// Existing candidates who look like the extracted person, by the same rules
// the save uses (phone's last nine digits, email, name for the same position).
// Every phone and email the CV offered is checked, not only the first.
async function findExistingMatches(pool, fields) {
  const values = (name) => {
    const field = fields[name];
    if (!field) return [];
    return [...new Set([field.value, ...(field.alternatives ?? [])].filter(Boolean))];
  };
  const phones = values('phone').map(phoneMatchKey).filter(Boolean);
  const emails = values('email').map((e) => e.toLowerCase());
  const nameKey = fields.fullName?.value ? normalizeName(fields.fullName.value) : null;

  const attempts = [];
  for (const phoneKey of phones.length ? phones : [null]) {
    for (const email of emails.length ? emails : [null]) {
      if (phoneKey || email) {
        attempts.push({ phoneKey, email, nameKey, positionId: null, excludeId: null });
      }
    }
  }
  const found = new Map();
  for (const attempt of attempts) {
    for (const match of await findLikelyDuplicates(pool, attempt)) found.set(match.id, match);
  }
  return [...found.values()].sort((a, b) => a.id - b.id);
}

export function cvExtractionRouter({
  pool,
  fetchDocument = fetchCvDocument,
  renderPage = renderCvPage,
}) {
  const router = Router();
  const canEdit = requirePermission('candidates.edit');
  let activeFetches = 0;
  let activeRenders = 0;

  // Opening a page in the isolated browser is heavy, so only a few run at once.
  async function limitedRender(url) {
    if (activeRenders >= MAX_PARALLEL_RENDERS) {
      const busy = new Error('Too many pages are being opened right now. Try again in a moment.');
      busy.reason = 'busy';
      throw busy;
    }
    activeRenders += 1;
    try {
      return await renderPage(url);
    } finally {
      activeRenders -= 1;
    }
  }

  async function respondWith(res, extraction, { cvUrl = null } = {}) {
    if (extraction.status === 'failed') {
      return res.status(422).json({
        error: 'extraction_failed',
        reason: extraction.reason,
        message: extraction.message,
      });
    }
    const duplicates = await findExistingMatches(pool, extraction.fields);
    res.json({ extraction, duplicates, cvUrl });
  }

  router.post(
    '/extract-cv/file',
    canEdit,
    express.raw({ type: [PDF_TYPE, DOCX_TYPE], limit: MAX_BYTES }),
    async (req, res) => {
      const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim();
      if (contentType !== PDF_TYPE && contentType !== DOCX_TYPE) {
        return res.status(415).json({
          error: 'unsupported_type',
          message: 'Upload a PDF or Word (.docx) CV.',
        });
      }
      await respondWith(res, await extractCv({ buffer: req.body }));
    },
  );

  router.post('/extract-cv/link', canEdit, async (req, res) => {
    if (activeFetches >= MAX_PARALLEL_LINK_FETCHES) {
      return res.status(429).json({
        error: 'busy',
        message: 'Too many CV links are being read right now. Try again in a moment.',
      });
    }
    const url = req.body?.url;
    activeFetches += 1;
    let extraction;
    try {
      extraction = await readCvLink({ url, fetchDocument, renderPage: limitedRender });
    } catch (err) {
      if (!(err instanceof FetchRefused)) throw err;
      return res.status(FETCH_STATUS[err.reason] ?? 422).json({
        error: 'link_refused',
        reason: err.reason,
        message: err.message,
      });
    } finally {
      activeFetches -= 1;
    }
    await respondWith(res, extraction, { cvUrl: url.trim() });
  });

  return router;
}
