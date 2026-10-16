import { apiGet } from '../../api/client.js';

// Read-only. A 503 means the historical tables are not enabled in this
// database yet; it is passed on as { unavailable: true } so the page can say so.

function withQuery(path, filters) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters ?? {})) {
    if (value !== '' && value !== null && value !== undefined && value !== false) {
      query.set(name, value);
    }
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

async function call(path) {
  const res = await apiGet(path);
  if (res.status === 503) return { ok: true, status: 200, body: { unavailable: true } };
  return res;
}

export const listHistorical = (filters) => call(withQuery('/historical-interviews', filters));
export const loadSummary = () => call('/historical-interviews/summary');
export const loadOptions = () => call('/historical-interviews/options');

// Recruitment Records: the imported history and the live candidates in one
// read-only list.
export const listRecords = (filters) => call(withQuery('/recruitment-records', filters));
export const loadRecordOptions = () => call('/recruitment-records/options');
