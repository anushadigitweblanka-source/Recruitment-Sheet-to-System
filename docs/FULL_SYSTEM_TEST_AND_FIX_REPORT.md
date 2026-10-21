# Full System Test and Fix Report

Recruitment Sheet to System – DigitWebLanka
Audit date: 2026-10-16 · Database inspected: `recruitment_system_dev` (PostgreSQL 18.6) · Nothing committed or pushed.

> **How to read the labels.** WORKING AND VERIFIED = checked by an automated test and/or a live read-only query.
> FIXED AND VERIFIED = a bug found in this audit, fixed, with a regression test.
> IMPLEMENTED BUT NOT VERIFIED = the code exists but this audit could not exercise it (mainly anything that needs a real browser).
> BLOCKED BY CONFIGURATION = needs company-approved settings. REQUIRES APPROVAL = needs a decision before changing. NOT IMPLEMENTED = absent.

## 1. How the audit was done

- **Code and docs read:** repository layout, `package.json` workspaces, the route table (`backend/src/routes/index.js`), all module routers, the frontend navigation and pages, the migrations and the project documentation.
- **Live database:** SELECT-only queries through a read-only session (`SET default_transaction_read_only = on`). No INSERT, UPDATE, DELETE, migration or import was run. No password or secret was printed.
- **No calls to the running app's API.** Every API call, even a read, writes audit and session rows, so API behaviour was verified in the test suite, which runs the real Express app against a throwaway schema with made-up data.
- **Real email, WhatsApp and SMS:** none sent. The only mail adapter is the development one; tests use it or a fake.
- **Browser:** no browser automation was available in this session, so everything that needs a real browser is marked NOT VERIFIED and has manual steps in section 14.

## 2. Inventory checked

| Area                    | Count                                                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend feature modules | 20 (audit, auth, candidates, company-accounts, company-cv, dashboard, employees, historical, interviews, lookups, notifications, offers, phone-screens, pipeline, reports, roles, salary, settings, team-leads, users) |
| API route handlers      | 91 (in 21 router files)                                                                                                                                                                                                |
| Frontend page routes    | 38                                                                                                                                                                                                                     |
| Database tables         | 32, 75 foreign keys, 46 unique/primary-key constraints, 15 migrations applied                                                                                                                                          |
| Automated tests         | 702 backend + 445 frontend = **1,147**                                                                                                                                                                                 |

## 3. Problems found and fixed

| #   | Problem                                                          | Root cause                                                                                                                                                                         | Fix                                                                                                                                                                                                  | Files                                                                                                                | Regression test                                                                                                         |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | WhatsApp/SMS "Missing: interview date and time" with no guidance | A candidate with no saved interview or slot gave only a bare list of what was empty. A later empty phone record could also hide an earlier saved slot.                             | The phone-slot lookup now skips empty records; the preview returns a hint saying an interview must first be scheduled.                                                                               | `mailContext.js`, `messageText.js`, `CandidateMessagePanel.jsx`                                                      | `messageText.test.js`, `candidateMessagePanel.test.jsx`                                                                 |
| 2   | Candidate List Actions column not visible                        | The table had 11 columns and long Remarks made it wider than the page; the table scrolls sideways, so the last column sat off-screen.                                              | Actions column pinned to the right edge; Remarks wraps.                                                                                                                                              | `styles.css`, `DataTable.jsx`, `RecruitmentRecordsList.jsx`, `fields.js`                                             | `recruitmentRecordsList.test.jsx`                                                                                       |
| 3   | View Details / Edit not consistent or permission-aware           | Edit links were shown to everyone and the edit form had no frontend permission check.                                                                                              | View Details labels; Edit only with `candidates.edit`; the form shows a clear "no permission" message. Backend permissions were already enforced and are unchanged.                                  | `RecruitmentRecordsList.jsx`, `CandidateListPage.jsx`, `CandidateDetailsPage.jsx`, `CandidateFormPage.jsx`           | `candidates.test.jsx`, `recruitmentRecords.test.js`                                                                     |
| 4   | Email Send button disabled with no explanation                   | By design it stays off while the server reports something missing (candidate email, interview date/time, Team Lead). The reason was not explained.                                 | Each missing item now shows the step to fix it, with a line beside the button.                                                                                                                       | `CandidateEmailPanel.jsx`                                                                                            | `stage11.test.jsx`                                                                                                      |
| 5   | Development mode looked like a real send                         | The development adapter delivers nothing but the UI said "Mail sent".                                                                                                              | Preview and send responses carry the delivery mode; the UI says "Development mode: no real email was delivered".                                                                                     | `manualMail.js`, `notifications.routes.js`, `CandidateEmailPanel.jsx`                                                | `stage11Notifications.test.js`, `stage11.test.jsx`                                                                      |
| 6   | **Dashboard "Upcoming Interviews" missed waiting candidates**    | It read only recorded direct interviews. A candidate at "Interview Scheduled" whose slot was set at the phone interview was shown on the Interviews page but not on the Dashboard. | The query now also includes that phone slot (once, only while no direct interview exists, only if still in the future).                                                                              | `dashboard.repository.js`                                                                                            | `dashboard.test.js`, `dashboardRecords.test.js`                                                                         |
| 7   | **Mail Status always read "Not available yet"**                  | The Phone Interview and Offer screens had a hard-coded placeholder from before the email log existed.                                                                              | The server now reads the candidate's latest manual mail (interview invitation / joining mail) from `email_log`; screens show Not sent, Sent, Failed or Awaiting approval. It is never typed by hand. | `notifications.repository.js`, `phoneScreens.repository.js`, `offers.repository.js`, phone-interview and offer pages | `stage11Notifications.test.js`, `phoneInterviews.test.jsx`, `offers.test.jsx`, `phoneScreens.test.js`, `offers.test.js` |

## 4. Template type mismatch

`Interview_Invitation` (the label) versus `interview_invitation` (the stored code): the database check requires lowercase codes, the code looks up the lowercase code, and the live table contains one active `interview_invitation` template (one-click). **It resolves correctly** (WORKING AND VERIFIED). The original error happened because the table was empty then. Duplicate templates are impossible (unique constraint on type).

## 5. Live database snapshot (SELECT only)

| Item                         | Count                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| Registered candidates        | 8 (applied 3, interview scheduled 3, joined 2)                                                      |
| Historical interview records | 404 (one completed batch); 145 with status Selected                                                 |
| Employees                    | 2 (both active, both in Evaluation)                                                                 |
| Direct interviews            | 2 · Phone interviews 5 · Offers 2                                                                   |
| Email templates              | 1 · Email log rows 0 · Pending notifications 0                                                      |
| Team Leads mapped            | 0                                                                                                   |
| Users                        | 5 (4 Main User, 2 of them active; 1 leftover viewer test account)                                   |
| Audit log rows               | 598 (was 594 at the start; the four extra rows are from the app being browsed, not from this audit) |

Integrity checks all returned 0 problems: duplicate Candidate IDs, candidates without a pipeline row, more than one employee per candidate, employees whose candidate is not Joined, Joined candidates without an employee, repeated phone screens or offers per candidate, passwords not hashed with argon2. The dashboard repository functions, run read-only, matched the direct counts. The 145 Selected historical records are **not** counted as employees, offers or notifications.

## 6. Real data preserved

Confirmed. The counts above are unchanged by this audit. Candidates 2002, 2003, 2005 and 2006, all 404 historical records, both employees and every offer were only read. Tests ran in throwaway schemas.

## 7. End-to-end workflow (fictional data, isolated schema)

New test `backend/tests/endToEndWorkflow.test.js` (11 checks, all pass): registration → list → duplicate Candidate ID refused → message hint when no interview → phone interview with slot → message and email preview use the saved slot → development send logged once, repeat refused → direct interview scored 40/50, Selected → exactly one offer → accepted with joining date → joining text → attended twice creates exactly one employee → Evaluation → Probation → Junior → exit → dashboard counts match the database → report and CSV/XLSX/PDF exports → audit log → role restrictions (view-only user refused audit log, email send and salary; signed-out refused).

## 8. Feature status

| Feature                                                                             | Status                              | Notes                                                                                                 |
| ----------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Add / save candidate, ID uniqueness, validation                                     | WORKING AND VERIFIED                |                                                                                                       |
| Candidate List search, filters, pagination                                          | WORKING AND VERIFIED                | API and component tests                                                                               |
| View Details / Edit / Cancel                                                        | FIXED AND VERIFIED                  | permission-aware                                                                                      |
| Unified list (404 historical + candidates)                                          | WORKING AND VERIFIED                | read-only history; no separate page                                                                   |
| Actions column visible                                                              | FIXED AND VERIFIED (code and tests) | real-browser look: NOT VERIFIED                                                                       |
| CV upload and retrieval                                                             | IMPLEMENTED BUT NOT VERIFIED        | links tested; file upload to a company store waits on approval                                        |
| Phone screening                                                                     | WORKING AND VERIFIED                |                                                                                                       |
| Mail Status                                                                         | FIXED AND VERIFIED                  | shows "Sent" for a development send too, see section 10                                               |
| Direct interviews, scores out of 50, decisions                                      | WORKING AND VERIFIED                |                                                                                                       |
| Message previews read saved interview data                                          | FIXED AND VERIFIED                  |                                                                                                       |
| Offers, acceptance, joining, employee creation, duplicate prevention                | WORKING AND VERIFIED                | Selected ≠ Accepted ≠ Joined preserved                                                                |
| Historical Selected never becomes an employee                                       | WORKING AND VERIFIED                |                                                                                                       |
| Six employee lifecycle pages and transitions                                        | WORKING AND VERIFIED                | date rules tested against the guide example                                                           |
| Email templates (create, edit, activate, placeholders, duplicates)                  | WORKING AND VERIFIED                | wording is placeholder, not company-approved                                                          |
| Email preview                                                                       | WORKING AND VERIFIED                |                                                                                                       |
| Email send, development mode                                                        | FIXED AND VERIFIED                  |                                                                                                       |
| Real email delivery                                                                 | BLOCKED BY CONFIGURATION            | see section 9                                                                                         |
| WhatsApp / SMS text                                                                 | WORKING AND VERIFIED                | copy only; no provider exists                                                                         |
| Dashboard cards                                                                     | FIXED AND VERIFIED                  | all from PostgreSQL                                                                                   |
| Reports, filters, CSV / XLSX / PDF                                                  | WORKING AND VERIFIED                |                                                                                                       |
| Weekly report range (previous Monday to Sunday)                                     | WORKING AND VERIFIED                |                                                                                                       |
| Monday 08:00 Asia/Colombo schedule                                                  | IMPLEMENTED BUT NOT VERIFIED live   | logic tested; runs from a 15-minute job once the server is up; sends only via the development adapter |
| Login, logout, sessions, hashing, audit log                                         | WORKING AND VERIFIED                |                                                                                                       |
| Roles and permissions editing                                                       | REQUIRES APPROVAL                   | mentor-blocked                                                                                        |
| Salary restrictions                                                                 | WORKING AND VERIFIED                | `salary.*` held only by Main User                                                                     |
| Notifications and duplicate prevention                                              | WORKING AND VERIFIED                |                                                                                                       |
| Layout on desktop, tablet, mobile; console errors; loading states in a real browser | IMPLEMENTED BUT NOT VERIFIED        |                                                                                                       |

## 9. Email delivery readiness: NO

Delivery is development only (`mailService.js` delivers nothing). To go live the company must approve a provider and supply, through environment settings (never in code): provider type, host and port or API endpoint, credentials, the sender address, and the wording of each template. Real sending must also be explicitly authorized.

## 10. Items needing approval

1. **A `simulated` email-log status.** The log only allows queued / sent / failed, so a development send is stored as `sent`. That needs a migration to fix honestly, which was not created.
2. **HR cannot manage offers or employees.** The HR role holds no `offers.manage` or `employees.manage`; only Main User and Intern hold them. Not changed; confirm whether this is intended.
3. **Team Leads.** No Team Lead is mapped to any position, so the Team Lead summary mail is blocked until the company's mapping is entered.
4. **Roles & Permissions editing** and the weekly email provider remain mentor-blocked.
5. Entering joining dates needs an Offer; confirm entering only the Onboarding Date is allowed while salary entry is restricted.

## 11. Security and configuration findings (not software bugs)

- A leftover test role and user (`test_accept_viewer`) exist in the live database; remove through the admin page when appropriate.
- All API answers send `Cache-Control: no-store`, every route after sign-in requires authentication, and passwords are stored as argon2 hashes.
- Only 2 of 4 Main User accounts are active; no HR, Team Lead or Intern users exist in the live database yet.

## 12. Performance and UI

- Lists page on the server (20–100 rows); search is debounced.
- The wide Recruitment Records table scrolls sideways with the Actions column pinned.
- Browser performance, responsive layout and console errors could not be measured here: NOT VERIFIED.

## 13. Test results

| Command                    | Result                               |
| -------------------------- | ------------------------------------ |
| `npm.cmd test`             | 702 backend + 445 frontend, all pass |
| `npm.cmd run build`        | passes                               |
| `npm.cmd run lint`         | clean                                |
| `npm.cmd run format:check` | clean                                |

## 14. Manual verification steps (browser)

1. Hard refresh http://127.0.0.1:5173 (`Ctrl+Shift+R`) and sign in as Main User.
2. **Candidate List:** the last column is Actions, pinned on the right; registered rows show View Details and Edit, imported rows show View Details only; narrow the window and confirm Actions stays visible.
3. **Phone Interviews and Offers:** Mail Status / Email Status reads Not sent for candidates with no logged mail.
4. **Dashboard:** a candidate at Interview Scheduled whose phone-interview slot is still in the future appears in Upcoming Interviews. The current slots of 2005, 2009 and 2010 have already passed, so the list may legitimately be empty today.
5. **Candidate with no interview:** Preview in WhatsApp/SMS shows the "No interview has been scheduled" hint; Send in email shows the reason.
6. Do not click Send or Save on real candidates 2002, 2003, 2005 or 2006.

## 15. Final verdict

The application code is in good shape: every automated check passes, the live database is intact and consistent, and seven confirmed gaps were fixed with regression tests. It is **not** fully ready for production: real email delivery is BLOCKED BY CONFIGURATION, several decisions need approval (section 10), and everything that needs a real browser is NOT VERIFIED.

## Beginner summary

Your system works from candidate registration through to employee exit, and your real data is untouched. This audit fixed seven things: clearer messages when an interview date is missing, a visible Actions column, Edit shown only to people allowed to edit, an honest "development mode" for emails, a Dashboard that now includes candidates whose interview was booked at the phone call, and a Mail Status that comes from the email log. Real emails cannot be sent until the company approves an email service. Open the app in a browser using the steps above to confirm how it looks.
