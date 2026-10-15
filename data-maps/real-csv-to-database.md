# Real CSV → Database Mapping (2026-10-15)

**Status: PRELIMINARY — NOT APPROVED FOR IMPORT.** Prepared from a read-only inspection of one real recruitment CSV. Only aggregate facts are recorded here: no candidate name, phone number, remark or other personal value appears in this file. Nothing has been imported, and no schema change is proposed or made.

- **Source file:** `Recruitment_Updates_DigitWebLanka (3)(7.csv`, kept outside the repository (`C:\AnushaDigitWebLanka\Day 03\`). Never copy it into the repo.
- **Version fingerprint:** 74,234 bytes, SHA-256 prefix `1491c7ff37a3d5e6`.
- **Structure:** 1,261 data rows, 404 non-empty records, 857 completely empty rows; 26 columns, 8 named and 18 unnamed; Windows-1252 (not valid UTF-8); CRLF line endings; 6 quoted multi-line cells, so a real CSV parser is required.

Mapping Status values: CONFIRMED, PENDING_MENTOR_CONFIRMATION, NOT IMPORTED.

## Column mapping

| CSV Column   | Meaning                                           | Target Table                                   | Target Column                               | Transformation                                     | Status                                                    | Notes                                                                                                       |
| ------------ | ------------------------------------------------- | ---------------------------------------------- | ------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Name         | Candidate's name                                  | `candidates`                                   | `full_name`                                 | Trim; max 150 chars (none exceed it)               | CONFIRMED                                                 | 1 blank. 4 values contain digits (review).                                                                  |
| Contact #    | Candidate's phone                                 | `candidates`                                   | `phone`                                     | None approved. Value must match `^\+?[0-9]{9,15}$` | CONFIRMED target; value rules PENDING_MENTOR_CONFIRMATION | 1 blank. 397 of 403 are 9 digits (leading `0` apparently lost). Not repaired automatically.                 |
| Date         | Unknown: application, interview or follow-up time | none yet                                       | none yet                                    | Day-first parsing is evidenced but not approved    | PENDING_MENTOR_CONFIRMATION                               | 11 blank. 390 date-time, 3 date-only. `applied_on` does not exist in the schema (needs a migration).        |
| Source       | How the candidate was found                       | `candidates`                                   | `source_id` → `sources.name`                | Lookup against approved list                       | CONFIRMED target; every value PENDING_MENTOR_CONFIRMATION | 8 blank. 40 distinct raw values, many spelling variants. Sources table starts empty.                        |
| Position     | Applied position                                  | `candidates`                                   | `position_id` → `positions.name`            | Lookup against approved list                       | CONFIRMED target; every value PENDING_MENTOR_CONFIRMATION | 2 blank. 24 distinct raw values; "Intern - X" vs "X" and typos.                                             |
| Mode         | Online / Onsite                                   | none                                           | none                                        | n/a                                                | PENDING_MENTOR_CONFIRMATION                               | Looks like interview mode. Only existing `work_mode` is on `offers` (`office` only, temporary). Do not map. |
| Status       | Outcome words                                     | `pipeline_status` (possibly interviews/offers) | `current_stage` (12 seeded stages)          | Word → stage mapping not approved                  | PENDING_MENTOR_CONFIRMATION                               | 23 blank. 6 distinct values. See below.                                                                     |
| Remarks      | Free text                                         | `candidates`                                   | `hr_comment` (candidate) or interview notes | None                                               | PENDING_MENTOR_CONFIRMATION                               | 162 blank. May contain personal or sensitive text. Which target is not approved.                            |
| (18 unnamed) | Unknown                                           | none                                           | none                                        | n/a                                                | NOT IMPORTED                                              | 17 are completely empty; 1 has 10 cells. See "Unnamed columns".                                             |

**Not present in the CSV, so no source:** Candidate ID (`candidate_code`, required and unique), email, address, O/L–A/L results, other education, CV link, company CV link/status, phone-interview fields, interview scores, offers and employees. Nothing is invented for these.

## Date patterns (aggregate)

| Pattern after the date                     | Rows |
| ------------------------------------------ | ---- |
| `dd/mm/yyyy hh:mm`                         | 215  |
| `dd/mm/yyyy hh:mm:ss`                      | 86   |
| `dd/mm/yyyy,hh:mm` (comma, no space)       | 47   |
| `dd/mm/yyyy, hh:mm`                        | 21   |
| `dd/mm/yyyy,hh.mm` (dot as time separator) | 15   |
| `dd/mm/yyyy,h.mm`                          | 3    |
| `dd/mm/yyyy h.mm`                          | 2    |
| `dd/mm/yyyy h:mm`                          | 1    |
| date only                                  | 3    |
| blank                                      | 11   |

- Day and month may be 1 or 2 digits.
- **Day-first evidence:** 235 rows have a first part above 12; **0** rows have a second part above 12. 158 rows are ambiguous on their own. The evidence supports day-first, but it is not an approval.
- **Year anomalies:** 6 rows have a year outside 2025–2026 or a malformed year (3-digit, 5026, 2027).
- **Meaning of the Date column:** unknown. PENDING_MENTOR_CONFIRMATION.

## Status values → system stages (all PENDING_MENTOR_CONFIRMATION)

| Raw Value                 | Rows | Proposed existing mapping | Mapping Status              | Notes                                                              |
| ------------------------- | ---- | ------------------------- | --------------------------- | ------------------------------------------------------------------ |
| Selected                  | 145  | `selected`                | PENDING_MENTOR_CONFIRMATION | Could also imply interview decision `selected`.                    |
| Rejected                  | 89   | `rejected`                | PENDING_MENTOR_CONFIRMATION | Could be phone or direct interview.                                |
| Not Attended              | 70   | `not_attended`            | PENDING_MENTOR_CONFIRMATION |                                                                    |
| On Hold                   | 36   | `on_hold`                 | PENDING_MENTOR_CONFIRMATION |                                                                    |
| Not Accepted by Candidate | 23   | none                      | PENDING_MENTOR_CONFIRMATION | Possibly "Offer Rejected" (mentor decision 12, not a stage today). |
| Rescheduled               | 18   | none                      | PENDING_MENTOR_CONFIRMATION | Not a stage; may be an interview event.                            |
| (blank)                   | 23   | none                      | PENDING_MENTOR_CONFIRMATION | Missing-status handling undecided.                                 |

## Position values (all PENDING_MENTOR_CONFIRMATION)

| Raw Value                     | Rows | Proposed existing mapping                           | Notes                                                 |
| ----------------------------- | ---- | --------------------------------------------------- | ----------------------------------------------------- |
| E Comm Exe                    | 63   | pending approved list                               |                                                       |
| Software Developer            | 56   | pending approved list                               |                                                       |
| Intern - E Comm Exe           | 34   | pending: same position as "E Comm Exe" or separate? | Intern prefix                                         |
| Intern - Software Developer   | 33   | pending: same as "Software Developer" or separate?  |                                                       |
| Inter - Automation Technical  | 29   | pending: typo of "Intern - Automation Technical"?   | Typo                                                  |
| Customer Service Exe          | 28   | pending approved list                               |                                                       |
| Postage                       | 27   | pending approved list                               |                                                       |
| Automation Technical          | 21   | pending approved list                               |                                                       |
| Intern - PH                   | 21   | pending approved list                               | "PH" abbreviation unexpanded                          |
| Digital Marketing             | 18   | pending approved list                               |                                                       |
| Intern - Automation Technical | 16   | pending approved list                               |                                                       |
| Intern - Data Analysis        | 13   | pending: same as "Data Analysis" or separate?       |                                                       |
| Data Analysis                 | 10   | pending approved list                               |                                                       |
| Accountant                    | 7    | pending approved list                               |                                                       |
| B2B Specialist                | 7    | pending approved list                               |                                                       |
| SEO Specialist                | 5    | pending approved list                               |                                                       |
| Graphic Designer              | 4    | pending approved list                               |                                                       |
| Inter - Automation Technician | 2    | pending: typo/variant?                              | Typo                                                  |
| Amazon Vendor                 | 2    | pending approved list                               |                                                       |
| Intern - Managment/HR         | 2    | pending approved list                               | Typo ("Managment")                                    |
| Intern - PPC                  | 2    | pending approved list                               |                                                       |
| Intern - SEO                  | 1    | pending: same as "SEO Specialist" or separate?      |                                                       |
| IOT - Engineer                | 1    | pending approved list                               |                                                       |
| (blank)                       | 2    | none                                                | Missing position: candidates.position_id is nullable. |

## Source values (all PENDING_MENTOR_CONFIRMATION)

Grouped by likely variant. A grouping is a suggestion for the mentor, not a mapping.

| Raw Value(s)                                                        | Rows      | Proposed grouping   | Notes                                                            |
| ------------------------------------------------------------------- | --------- | ------------------- | ---------------------------------------------------------------- |
| LinkedIn                                                            | 64        | LinkedIn            |                                                                  |
| Staff's Refer                                                       | 56        | Staff referral      | Overlaps with Referral; are they different?                      |
| WhatsApp                                                            | 51        | WhatsApp            |                                                                  |
| Xpress Job; Xpress; Express Job                                     | 29; 1; 1  | Xpress Job          | Spelling variants                                                |
| Referrel; Referral; Refferel                                        | 20; 11; 5 | Referral            | Spelling variants                                                |
| UOV                                                                 | 19        | University (UOV)    | Abbreviation unexpanded                                          |
| UWU                                                                 | 18        | University (UWU)    | Abbreviation unexpanded                                          |
| FB                                                                  | 12        | Facebook            |                                                                  |
| ITPro; ITpro                                                        | 12; 12    | ITPro               | Case variants                                                    |
| Ikman                                                               | 9         | Ikman               |                                                                  |
| Job Mail                                                            | 9         | Job Mail            |                                                                  |
| Personal                                                            | 8         | Personal            |                                                                  |
| Google Form                                                         | 8         | Google Form         |                                                                  |
| ESoft                                                               | 7         | ESoft               |                                                                  |
| UOJ                                                                 | 6         | University (UOJ)    | Abbreviation unexpanded                                          |
| Lanka Job; Lanka Jobs; LankaJobs                                    | 6; 5; 3   | Lanka Jobs          | Spelling variants                                                |
| Visited to office                                                   | 2         | Walk-in             |                                                                  |
| EduExp2025                                                          | 2         | Event/exhibition    |                                                                  |
| Vavuniya Campus                                                     | 2         | Campus              |                                                                  |
| Company Website; Website                                            | 2; 1      | Company website     |                                                                  |
| Kachcheri; Kachcheri_(place suffix); Kachcheri_(person-like suffix) | 1; 1; 1   | Kachcheri           | One suffix looks like a person's name; withheld                  |
| Admin Mail; GMail                                                   | 1; 1      | Mail                |                                                                  |
| Manager.lk                                                          | 1         | Manager.lk          |                                                                  |
| UM                                                                  | 1         | University (UM)?    | Abbreviation unexpanded                                          |
| Person-named referrers (3 distinct values)                          | 7         | Individual referrer | Names withheld; policy for personal names in `sources` undecided |
| Single-word name-like value                                         | 1         | Unknown             | Withheld                                                         |
| (blank)                                                             | 8         | none                | `source_id` is nullable                                          |

## Mode values

| Raw Value | Rows | Proposed existing mapping | Mapping Status              | Notes                   |
| --------- | ---- | ------------------------- | --------------------------- | ----------------------- |
| Onsite    | 336  | none                      | PENDING_MENTOR_CONFIRMATION | Probably interview mode |
| Online    | 67   | none                      | PENDING_MENTOR_CONFIRMATION | Probably interview mode |
| (blank)   | 1    | none                      | PENDING_MENTOR_CONFIRMATION |                         |

"Onsite" and "Online" are not in the offer `work_mode` list (`office` only). They must not be written to `offers.work_mode`.

## Unnamed columns

- 18 columns have a blank header. **17 are completely empty.**
- **Column 10** (1-based position) holds 10 non-empty cells. All 10 are text, 4 to 15 characters long, and each sits on a row that also has a Name. None is purely numeric.
- The meaning is unknown, so it is PENDING_MENTOR_CONFIRMATION and NOT IMPORTED. The content is deliberately not copied here.

## Database compatibility

- **Maps cleanly (structurally):** Name → `full_name`; Contact # → `phone` (format rules apply); Source → `source_id`; Position → `position_id`; Remarks → `hr_comment` (target not approved).
- **No target today:** Date (no `applied_on`), Mode, and any per-row interview or phone-screen detail.
- **Required target field missing from the CSV:** `candidates.candidate_code` (NOT NULL, unique, ≤ 30 chars). The CSV has no ID column. The Candidate ID rule (mentor decision 14) is open and IDs are not invented.
- **Lookups needing approval:** `positions` and `sources` start empty; every value in the CSV needs an approved entry.
- **Candidate matching limits:** with no ID and no email, the only match keys are phone, name and position. All three are error-prone (see the validation review).
- **Remaining unnamed information:** Status words carry outcomes that span pipeline, phone screen and interview, with no per-event date.

## Import framework compatibility

- **XLSX supported:** yes (`ExcelJS`, `workbook.xlsx.readFile`).
- **CSV supported:** no.
- **This CSV compatible as-is:** no. It is one flat sheet, not the multi-tab workbook the importer recognises, and its header aliases assume a Candidate ID column that this file lacks.
- **Required change if CSV is wanted:** a CSV reader that handles Windows-1252 and quoted multi-line cells, a header profile for this flat layout, and a Candidate ID strategy. It is not built in this task.
