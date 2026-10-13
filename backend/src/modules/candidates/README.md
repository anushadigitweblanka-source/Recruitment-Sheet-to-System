# Module 1 – Candidate Management (backend)

**Implemented:** listing, searching, adding, viewing and editing candidates.

| Route                     | Permission        | Purpose                                    |
| ------------------------- | ----------------- | ------------------------------------------ |
| `GET /api/candidates`     | `candidates.view` | List with search, filters, sorting, paging |
| `POST /api/candidates`    | `candidates.edit` | Add a candidate                            |
| `GET /api/candidates/:id` | `candidates.view` | One candidate                              |
| `PUT /api/candidates/:id` | `candidates.edit` | Change a candidate                         |

Files: `candidates.routes.js` (HTTP), `candidates.service.js` (rules, duplicate check, audit), `candidates.validation.js` (field checks), `candidates.repository.js` (SQL).

Tables: `candidates`, `pipeline_status`, `stage_history`, with the lookup lists `positions`, `sources` and `pipeline_stages` (served by `../lookups/`).

## Rules

- **Candidate ID** is required and unique, whatever its letter case. Its format is not fixed and it is typed by the user, because the format has not been confirmed.
- **Phone** is text. Spaces, dashes, dots and brackets are removed; a leading 0 is kept. A phone sent as a number is refused.
- **Phone and email are not unique.** A likely duplicate is a warning, never a refusal and never a merge.
- **Duplicate warning:** raised when another candidate has the same phone (compared on the last nine digits), the same email, or the same name for the same position. The save answers `409` with the matches and stores nothing. Sending the same request again with `confirmDuplicate: true` saves it as a separate record.
- When editing, the duplicate check runs only if the phone, email, name or position changed.
- Every new candidate starts at the stage **Applied**, with one `stage_history` row.
- `CANDIDATE_CREATE` and `CANDIDATE_UPDATE` are written to the audit log. An update records only the fields that changed.

## Not built yet

- Changing a candidate's stage (comes with the phone and direct interview modules).
- Uploading files. Where uploaded files are stored has not been approved, so only the two CV link fields exist.

## Waiting on

- The Candidate ID format and how new IDs are generated.
- Whether Applied Position should be required once the approved positions are entered.
- Which matches should count as a duplicate.
