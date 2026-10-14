# Module 4 – Offer Management (backend)

**Implemented:** listing, creating, viewing and changing offers, the joining (onboarding) date and attendance, and the stage changes they cause.

| Route                   | Permission        | Purpose                                              |
| ----------------------- | ----------------- | ---------------------------------------------------- |
| `GET /api/offers`       | `candidates.view` | Candidates who have an offer, or are waiting for one |
| `GET /api/offers/:id`   | `candidates.view` | One offer with its candidate                         |
| `POST /api/offers`      | `offers.manage`   | Create the offer for a selected candidate            |
| `PATCH /api/offers/:id` | `offers.manage`   | Change it; only the fields sent are changed          |

List filters: `search` (name or Candidate ID), `offerStatus` (`sent`, `accepted`, or `pending` for no status yet), `onboardingFrom` / `onboardingTo` (dates), `waiting=true` (selected candidates with no offer yet, used by the Create Offer form), `page`, `pageSize` (at most 100).

Files: `offers.routes.js` (HTTP), `offers.service.js` (rules and stage changes), `offers.validation.js` (field checks), `offers.repository.js` (SQL).

Screens (`frontend/src/modules/offers/`): Offer List, Create Offer, Offer Details and Edit Offer, all connected to these routes.

Table: `offers` (migration 005). Stage changes go through `../pipeline/pipeline.js`, which writes `pipeline_status`, `stage_history` and the audit log together, in the same transaction as the offer.

## Rules

- An offer can be created only for a candidate at **Selected**, the stage a direct interview result of Selected puts them in. Rejected, On Hold, Not Attended and every other stage are refused by the backend.
- One offer per candidate for now; a second is refused with a pointer to the first.
- **Position** is required and must be an approved position that is in use. It defaults to the position the candidate applied for. A position switched off later stays valid on an offer that already has it.
- **Offer Date** and **Onboarding Date** (the joining date) are optional real dates.
- **Location** is optional text, at most 200 characters.
- **Offer Status** is `sent`, `accepted` or empty (not sent yet).
- **Attended** is Yes, No or empty. It can be recorded only once the Offer Status is Accepted and the Onboarding Date is set.
- **Work Mode** has no approved list of values, so no value is accepted yet. The column exists for when the list is approved.
- **Email Status** is not stored. It is to be read from the email log (Module 6), which does not exist yet, so the screens show "Not available yet".

The database repeats the status list and the attendance rule as constraints, so they hold even if the application is bypassed.

## Stage changes

| Offer                  | Candidate's stage          |
| ---------------------- | -------------------------- |
| Created, no status yet | Selected (no change)       |
| Offer Status: Sent     | Offer Sent                 |
| Offer Status: Accepted | Offer Accepted             |
| Attended: Yes          | Joined                     |
| Attended: No           | Offer Accepted (no change) |
| Status cleared again   | Selected                   |

- A stage only changes when the outcome changes. Editing the date, location or position alone changes nothing.
- Every change adds a `stage_history` row with who and when. Earlier rows are never altered.
- A candidate moved elsewhere by something other than the offer is not moved again by it: the change is refused and nothing is saved.

Audit actions: `OFFER_CREATE`, `OFFER_UPDATE` (changed fields only) and `PIPELINE_STAGE_CHANGE` (with `source: "offer"`).

## Effect on Module 3

Once an offer exists for a candidate, the direct interview's result can no longer be changed (`interviews.service.js`). Its other fields, such as remarks, can still be edited. An offer that has not been sent leaves the candidate at Selected, so comparing stages alone would not catch this.

## Salary

**Salary functionality pending mentor approval and authorization design.** There is no salary column, table, field, query or endpoint. The guide lists `salary_lkr` in `offers` in one place and requires a separate `offer_salary` table readable only by the Main user in another; that choice is open (decisions 1 and 2 in `docs/mentor-approval-required.md`). A salary sent by the browser is ignored, and the audit log refuses any field named salary.

## Not part of this module

- Attended = Yes moves the candidate to Joined and nothing more. **No employee or 7-day evaluation is created here.** The guide says Attended = Yes creates both; that belongs to Module 5 – Employee Lifecycle.
- No mail is sent and no email status is recorded; that belongs to Module 6.

## MENTOR CONFIRMATION REQUIRED

None of the items below has been approved. Each describes what the application does today, as a working choice, and what needs an answer.

1. **Automatic offer creation.**
   - The guide's acceptance checklist says "Selecting 'Selected' in the interview creates an offer row automatically".
   - Today no offer row is created automatically. A selected candidate appears in the Offer List as waiting, and HR creates the offer from there.
   - To confirm: which behaviour is approved.
2. **Offer Status values.**
   - The guide never lists them. Allowed today: **Sent** and **Accepted** only, because the guide's stage list has Offer Sent and Offer Accepted. An offer not sent yet has no status; "Pending" is not in the guide and is not used.
   - To confirm: whether further statuses are needed.
3. **Offer Rejected.**
   - The guide's import rules map "Not Accepted by Candidate" to "Offer Rejected", but Offer Rejected is not in the stage list (decision 3 in `docs/mentor-approval-required.md`), and "Rejected" there means rejected by the company.
   - Not implemented: no rejected status is accepted, so a declined offer cannot be recorded yet.
   - To confirm: whether Offer Rejected is a valid status and stage.
4. **Attended = Yes → Joined.**
   - Today Attended = Yes moves the candidate to Joined. This is inferred from the stage list and from "Attended = Yes creates the employee"; the guide does not name the stage directly.
   - To confirm: this stage change.
5. **Attended = No.**
   - The guide gives it no stage. Today it is recorded and the candidate's stage does not change (stays at Offer Accepted).
   - To confirm: what should happen.
6. **Work Mode values.**
   - No approved list (decision 6), so the field is shown but disabled and nothing can be saved in it.
   - To confirm: the list of values.
7. **One offer or several per candidate.**
   - The table allows several (no unique rule on `candidate_id`), so a history of offers stays possible. The application allows one: a second is refused with a pointer to the first.
   - To confirm: whether a candidate can receive more than one offer, for example after declining.
8. **Salary storage.**
   - The guide lists `salary_lkr` in `offers` in its table list, and requires a separate `offer_salary` table in its access-control section. Unresolved (decision 1). Nothing is stored.
9. **Salary viewing permissions.**
   - Whether only the Main User may view and edit salary, and whether every view is logged. Unresolved (decision 2). The `salary.view` and `salary.edit` permissions exist from migration 001 but nothing uses them.
