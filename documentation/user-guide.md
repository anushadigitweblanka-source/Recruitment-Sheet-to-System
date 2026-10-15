# User Guide — Recruitment Sheet to System

A plain-language guide to every page in the application, written for someone using it for the first time. Everything described here exists and works today; where a feature is waiting on a business decision, the guide says so instead of pretending.

**The one idea behind everything:** each candidate moves through a pipeline of stages — Applied → Phone Screened → Interview Scheduled → Interviewed → Selected → Offer Sent → Offer Accepted → Joined — or leaves it as Rejected, On Hold, Not Attended or No Response. Every page either records a step of that journey or shows you where people are on it. The system moves the stage for you when you record a result; you never set a stage by hand.

---

## Login

**What it does:** signs you in with your email address and password. Everything in the application requires signing in first.

**How to use it:** enter your email and password, press Sign in. You stay signed in until you log out or the session expires.

**Important validation:** five wrong passwords in a row pause the account for a short time (it unlocks by itself — no one is locked out permanently). Passwords are at least 12 characters. A deactivated account cannot sign in at all.

**What not to do:** don't share one account between people — the audit log records who did what, and that only means something if each person has their own account.

## Dashboard

**What it does:** shows live counts straight from the database — total candidates, how many are at each pipeline stage, how many employees are working / discontinued / terminated, how many employees are in each lifecycle phase, and the next 10 upcoming direct interviews.

**How to use it:** open it; there is nothing to fill in. Every number is computed when the page loads, so it is always current. A zero means there really are zero — nothing on this page is hardcoded.

**What not to do:** don't treat the stage counts as history — each candidate is counted once, in the stage they are in _now_. For movement over time, use the Reports page.

## Candidate List

**What it does:** all candidates, with search, filters, sorting and paging.

**How to use it:** search by name or Candidate ID; filter by stage, position or source; click a row to open the candidate.

**What not to do:** don't assume a missing candidate means they were deleted — candidates are never deleted. Check the Rejected / On Hold filters.

## Add Candidate

**What it does:** creates a new candidate, who starts at the stage **Applied**.

**How to use it:** fill in the Candidate ID, full name and phone number; choose the applied position and source from the dropdowns (these lists are managed under Administration → Positions & Sources). Email and CV links are optional.

**Important validation:**

- **Candidate ID is required and must be unique** (letter case doesn't matter). You type it yourself — the final ID format is still a mentor decision, so the system doesn't generate one.
- **Phone is typed as text.** Spaces, dashes, dots and brackets are cleaned away; a leading 0 is kept.
- **Duplicate warning, not refusal:** if another candidate has the same phone, same email, or same name for the same position, the save stops and shows you the matches. If it genuinely is a different person, confirm and it saves as a separate record. Nothing is ever merged automatically.

**What not to do:** don't invent a Candidate ID scheme of your own — follow whatever format your team already uses in the sheet, until the official format is confirmed. Don't confirm a duplicate warning without reading the matches it shows you.

## Candidate Details

**What it does:** one candidate's full picture — their details, current stage, stage history (every move, with who and when), and links to their phone interview, direct interview and offer.

**How to use it:** open from the Candidate List. Use **Edit Candidate** to correct details, and **CV / Documents** for the two CV link fields (file _upload_ is not built — where files would be stored has not been approved, so the system keeps links only).

**What not to do:** don't try to change the stage here — stages move only when you record results in the Phone Interview, Direct Interview, Offer and Employee pages.

## Phone Interview

**What it does:** records the first screening call: whether the candidate was called, the result, and (when selected) the direct interview date.

**How to use it:** open Phone Interview List, pick the candidate, record the call. The stage moves by itself:

- **Selected + an interview date** → Interview Scheduled
- **Selected, no date yet** → Phone Screened
- **Not Selected** → Rejected (a rejection reason is required)

**Important validation:** the interview date can only be set when the result is Selected. Not Selected without a reason is refused. The **Response** field accepts no values yet — its approved list is a pending mentor decision, and the system refuses guesses rather than inventing options.

**What not to do:** don't try to change a phone result after the candidate has moved further (e.g. already interviewed) — the system refuses to pull them backwards, and that is intentional.

## Direct Interview

**What it does:** records the face-to-face interview: attendance, five scores (Technical, AI, Communication, Confidence, Culture Fit — each 0–10), and the decision.

**How to use it:** the candidate must be at **Interview Scheduled**. Record attendance and scores; the **total out of 50 is calculated by the database** — you cannot type it, so it can never be wrong. Then record the decision:

- **Selected** → stage Selected, **and the offer is created automatically** in the Offer Tracker (see below)
- **Not Selected** → Rejected (reason required)
- **On Hold** → On Hold (reason required, optional follow-up date)

**Important validation:** scores are all five or none — a half-scored interview would look finished when it isn't. Each score is 0–10. A candidate who did not attend cannot be given a decision.

**What not to do:** don't expect to change the decision after an offer exists — once the automatic offer is created, the interview's outcome is locked (the offer is never silently deleted). If that ever needs to change, it is a mentor decision, not a workaround.

## Offer Management

**What it does:** the Offer Tracker — every candidate with an offer, plus every Selected candidate still waiting for one.

**How it fills itself:** when a direct interview is saved as **Selected**, the system creates the offer row automatically, in the same save: the candidate and their applied position, with everything else (offer date, work mode, location, status, joining date, attendance) left empty for you to fill in as things happen. Exactly one offer per candidate — repeated saves, retries and score edits never create a second one.

**How to use it:**

- Fill in the offer as it progresses: **Offer Status = Sent** moves the candidate to Offer Sent; **Accepted** moves them to Offer Accepted.
- Set the **Onboarding Date** (joining date) when agreed.
- On the joining day, record **Attended**. **Attended = Yes creates the employee record automatically**, with the 7-day evaluation already started. Attended can only be recorded once the offer is Accepted and the joining date is set.
- A Selected candidate with no applied position shows as _waiting_: create their offer by hand with **Create Offer** (you must choose the position).

**Important validation:** the offered position must be an approved, in-use position. **Work Mode** currently allows only `office` — the full list is a pending mentor decision. There is **no salary field anywhere** — salary handling is not approved yet and nothing about it exists.

**What not to do:** once the employee record exists, don't try to change the offer's status, joining date or attendance — the employee's lifecycle dates are calculated from them, so they are locked. Other offer fields can still be corrected.

## Employee Lifecycle

**What it does:** tracks each employee through four phases — **Evaluation (7 days) → Probation (3 months) → Junior → Senior** — with a gate decision at the end of each phase. The phase lengths come from Settings, not from code.

**How to use it:**

- Employees are created **only** by the offer's Attended = Yes — there is no "add employee" button, on purpose.
- The phase pages (Evaluation, Probation, Junior Stage, Senior Stage) list who is in each phase. Employee Details shows their phases and exactly which decision is available now.
- **Pass** closes the phase and starts the next one with its dates calculated automatically. **Extend** (probation only) adds up to 1 extra month beyond the original end. **Discontinue** needs a reason and exit date. **Terminate** is separate, needs a reason and date, and is only offered after probation has passed.
- The **junior phase has no calculated end date** — whether its 9 months count from probation end or from joining is a pending mentor decision, so you enter the junior end date yourself when recording the junior Pass.
- The **track** (Intern or Staff) can be set on Edit Employee. A review document link on a decision is optional.
- The Lifecycle Timeline page shows the full phase history; the Discontinued / Exit page lists everyone who left.

**What not to do:** don't look for a way to edit past phases — history is never overwritten; corrections happen as new decisions.

## Notifications

**What it does:** the reminder schedule — what the system plans to send, when, and whether it went.

**What it does _not_ do yet:** reminders are **not created automatically** — who receives which reminder is a pending mentor decision, so automatic creation is off. The sending machinery itself is built and tested: a job runs every 15 minutes and sends whatever is due (send time = deadline minus 24 hours).

**Important:** no real email leaves this application. There is no approved mail provider; sending runs in development mode, where every "send" is recorded in the Email Log but nothing is delivered. The screens say so.

## Email Templates

**What it does:** create and edit the email texts that reminders use.

**How to use it:** write the subject and body; templates can be active or inactive. The same template is never sent twice to the same candidate unless someone explicitly presses Resend.

**What not to do:** don't rely on a fixed list of template types — the final list is a pending mentor decision; today the type is a free label.

## Reports

**What it does:** seven on-screen reports, each queried live: Candidate Status, Funnel, Sources, Positions, Weekly summary, Onboarding, Exit.

**How to use it:** open Reports and switch tabs. Each tab has its own filters (stage, position, source, date ranges). All dates follow the office calendar (Asia/Colombo). The Weekly tab shows a Monday-to-Sunday week — by default the last completed one.

**Known limitation (documented, not a bug):** "Applications this week" counts candidates _added_ that week, because the sheet's true application date needs an approved migration that doesn't exist yet. The **scheduled weekly email is not built** — its recipients are a pending mentor decision; the weekly tab is the on-screen version.

## Excel / CSV / PDF exports

**What it does:** downloads any report as Excel, CSV or PDF.

**How to use it:** set your filters on a report tab, then press the export button for the format you want. The file contains exactly the filtered report — same queries, all rows (up to a 10,000-row safety cap), not just the page on screen. Excel has headers and filter notes; CSV opens correctly in spreadsheets (UTF-8); PDF has page numbers and repeats headers on every page.

**What not to do:** don't edit an export and treat it as the system of record — the database is the record; exports are snapshots with the generation time printed on them.

## Positions & Sources (Administration)

**What it does:** the approved lists behind the Applied Position and Source dropdowns.

**How to use it:** add a position or source to make it selectable; switch one off to retire it. A retired value stays on the records that already use it but cannot be chosen for new ones.

**What not to do:** don't pre-load the real company lists — the current scope is dummy/test data only, by mentor instruction. The approved lists would arrive with the future real-data import, if the mentor extends the scope.

## Users Administration

**What it does:** the accounts that can sign in — list, create, deactivate/reactivate, reset password.

**How to use it:** create a user with name, email, a role from the dropdown and a first password (12+ characters; it is never shown again). Deactivating signs the person out everywhere at once and blocks sign-in; reactivate restores it. Reset password ends their old sessions; the old password stops working immediately.

**Important validation:** emails are unique. Only roles that actually exist in the database can be assigned. You cannot deactivate your own account.

**What not to do:** don't look for a delete button — there isn't one, on purpose. The audit log references users forever, so leaving is deactivation.

## Roles & Permissions

**What it does:** a **read-only** view of the roles in the database, the permissions each one holds (as a matrix), and how many users have each role.

**Why read-only:** the final role list (HR, Team Lead, Intern) and the editable permission structure are a pending mentor decision. Until approved, nothing here can be created, edited or assigned — the page shows exactly what exists, and the backend has no editing routes at all.

## Settings

**What it does:** the editable phase durations: evaluation days (7), probation months (3), maximum probation extension (1 month), junior months (9 — stored, but not yet used to calculate the junior end date; see Employee Lifecycle).

**How to use it:** change a value and save. It takes effect from the next gate decision — past phases are not recalculated. Every change is written to the audit log.

**What not to do:** don't change these casually — they drive real dates on real decisions.

## Audit Log

**What it does:** the append-only record of who changed what and when, across the whole application — candidates, interviews, offers, employees, users, settings, stage changes.

**How to use it:** filter by action, entity, person or date range. Payloads are safe to read: passwords, hashes, tokens and salaries are refused by the audit writer itself, at any depth, before a row is ever written.

**What not to do:** nothing here can be edited or deleted — that is the point.

## Logout

**What it does:** ends your session. After logging out, the back button cannot replay pages with data — every API response is marked not to be cached.

---

_Open mentor decisions referenced above are listed in one place: `handover/mentor-decision-list.md`._
