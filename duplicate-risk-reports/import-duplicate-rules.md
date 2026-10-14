# Import Duplicate Rules (2026-10-14)

**Confidential folder — no real candidate details may be written here without explicit approval.** This file documents rules only; it contains no data.

These are the duplicate rules the system already implements (verified in migration 002 and `backend/src/modules/candidates/`), and how the future import must apply them. Core principle: **warning / review only — no automatic merge, no automatic deletion, no overwrite of an existing candidate.** Every suspected duplicate → REVIEW REQUIRED.

## 1. Hard rule (the database refuses)

| Rule                                      | Where enforced                   | Import behaviour                                                                                                                                                                        |
| ----------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate ID (`candidate_code`) is UNIQUE | unique constraint, migration 002 | A workbook row whose Candidate ID already exists in the system is NOT imported and NOT merged. Issue `duplicate_candidate_id` → review queue. The existing record is never overwritten. |

## 2. Soft rules (likely-duplicate warning, HR decides)

Implemented today in `candidates.service.js` / `candidates.repository.js` (`findLikelyDuplicates`) for manual entry; the import applies the same matches:

| Match            | How it is compared (as implemented)                                                                           | Import behaviour                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Normalized phone | last 9 digits of the digits-only phone (`phoneMatchKey`) — survives a lost leading zero and +94 vs 0 prefixes | issue `duplicate_candidate` → review queue |
| Normalized email | exact match on the stored email                                                                               | issue `duplicate_candidate` → review queue |
| Name + position  | full name lowercased with whitespace collapsed (`normalizeName`), AND the same `position_id`                  | issue `duplicate_candidate` → review queue |

In the application a likely duplicate is a warning the user can confirm past (`confirmDuplicate`), and confirming is written to the audit log (`savedDespiteLikelyDuplicates`). The import must NOT use that confirm path automatically — a human reviews each flagged row.

## 3. Repeated CV link (guide requirement)

The guide records that the same CV link is reused across candidates in the workbook. `cv_url` is deliberately NOT unique. The import flags each reused link with issue `duplicate_cv_link` → review queue (warning only; the rows still may both be legitimate).

## 4. What is never done

- No automatic merge of two candidate rows.
- No automatic deletion of any row.
- No overwrite of an existing candidate's fields by an imported row.
- No silent attachment of a Tab 2 / Tab 7 row to a candidate when the phone/name match is ambiguous (several candidates match) — that row goes to review.

## 5. Open questions (do not resolve without the mentor)

- Which match counts as "the same person" (phone, email, or both), and whether a returning applicant gets a new candidate row (proposal section 6.2, marked M).
- Whether family members sharing one phone are expected in the data (affects how phone matches are reviewed, not the rule itself).

## 6. Reports that will live in this folder

One file per future duplicate-scan or import dry run, named `YYYY-MM-DD-<scope>.md`, listing per suspected pair: the fields that matched, the confidence, the decision (merge / keep both / reject), who decided, and when. **Do not commit real candidate details in those reports unless explicitly approved; prefer candidate codes over names, and consider git-ignoring real reports.**
