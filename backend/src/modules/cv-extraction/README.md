# CV extraction

Reads a CV from an uploaded file or a pasted link and returns a **draft** for the
Add Candidate form. Nothing here saves a candidate, writes to the database or keeps
the CV: HR checks the filled form and presses Save.

## What a link can point at

The kind of thing at the address is decided from the bytes returned, never from the
address (`linkCv.js`):

| Returned           | How it is read                                                                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF / Word (.docx) | `textExtractor.js`, then `fieldExtractor.js`                                                                                                                                                                         |
| Web page           | 1. its text and its schema.org `Person` data, `mailto:`/`tel:`/profile links (`htmlText.js`)<br>2. a CV document it links to, read as well and preferred where it has more<br>3. only if still not enough, rendering |
| Anything else      | refused with a reason                                                                                                                                                                                                |

## Rendering JavaScript sites (`browserRender.js`, `renderWorker.js`, `renderPage.js`)

Used only as a last resort. The page's scripts run in a **separate child process**
driving the installed Chrome or Edge through `playwright-core` (no browser is
downloaded). The browser cannot reach the network by itself: it has a dead proxy
and no DNS, and every request it makes is answered by `fetchSubresource()` in
`safeFetch.js`, which applies the CV-link rules to each one (HTTPS, standard port,
public host name checked and pinned, no private/loopback/metadata address, no
cookies or credentials, size and time limits). Redirects are re-checked. Images,
media and fonts are not loaded; service workers, downloads, dialogs and pop-ups are
refused. The child receives no application settings or secrets.

It does not get past logins, CAPTCHAs or bot protection; such a page is reported
as blocked.

Settings (environment variables, all optional):

- `CV_RENDER_BROWSER_PATH` - path to Chrome/Edge (found automatically otherwise)
- `CV_RENDER_DISABLED=true` - switch rendering off

Rendering is always off when `VERCEL` is set: serverless functions have no browser.
There, a page that needs JavaScript is reported with a specific message and the
other link types work as usual.
