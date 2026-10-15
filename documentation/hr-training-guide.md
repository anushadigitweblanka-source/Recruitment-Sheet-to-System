# HR Training Guide — hands-on demo flows

Walk through these flows on the development system with **made-up people only** (use names like "Demo Person", phones like 0770000123, emails ending in `@example.test`). Never use a real applicant for practice. Full page-by-page detail is in `documentation/user-guide.md`.

---

## Flow 1 — the happy path: from application to Senior

This is the whole system in one story. One fictional candidate goes from applying to becoming a senior employee.

**1. Add the candidate.** Candidate Management → Add Candidate. Give them a Candidate ID (e.g. `DEMO-0001`), name, phone, and choose a position and source. Save. Open Candidate Details: they are at **Applied**, and the stage history already has its first row.

**2. Phone interview.** Phone Interview → pick the candidate. Record Called = Yes, Result = **Selected**, and set the direct interview date and time. Save. The stage is now **Interview Scheduled** — you didn't set it; the result did.

**3. Direct interview.** Direct Interview → New Interview Evaluation → pick the candidate. Attendance = Attended. Enter the five scores (0–10 each) — watch the **total out of 50 calculate itself**. Decision = **Selected**. Save.

**4. The offer created itself.** Open Offer Management. The candidate is already there **with an offer** — you did not create it. It carries their applied position; everything else is empty, waiting for real events. The stage is **Selected**.

**5. Offer Sent.** Open the offer → Edit. Set Offer Status = **Sent** (add the offer date if you have one). Save. Stage: **Offer Sent**.

**6. Offer Accepted.** Edit again: Offer Status = **Accepted**, and set the **Onboarding Date** (pick a date a few days ahead for the demo). Save. Stage: **Offer Accepted**.

**7. Joining day — Attended.** Edit the offer: **Attended = Yes**. Save. Two things happen at once: stage becomes **Joined**, and an **employee record is created automatically** with the 7-day evaluation already running (check Employee Lifecycle → Evaluation — they're listed, with the end date calculated from the joining date).

> From here the offer's status, joining date and attendance are locked — the lifecycle dates depend on them.

**8. Evaluation → Pass.** Employee Details → the decision panel offers Pass or Discontinue. Choose **Pass**. The evaluation row closes, and **Probation** starts the next day, ending 3 months later — dates computed for you.

**9. Probation → Pass.** Same page, when probation ends: **Pass** (or Extend, by up to 1 month total, if more time is needed). **Junior** starts the next day.

**10. Junior → Pass → Senior.** When probation passes, the junior phase gets its **end date automatically** (9 months from its start, the day before the same date 9 months on). On the day, record **Pass**; you do not type a date. **Senior** starts the next day and has no end date. (Only an older junior phase with no stored end date still asks you to type it.)

Open the **Lifecycle Timeline**: the whole journey is there, every phase with its dates and decisions, nothing overwritten.

---

## Flow 2 — rejected candidate

1. Add a second fictional candidate.
2. Phone Interview → Result = **Not Selected**. The save refuses until you give a **rejection reason** — try saving without one to see the message. With the reason, the stage becomes **Rejected**.
3. Alternative: take a candidate through to the direct interview and record decision **Not Selected** there — same rule, same result.
4. See them under Candidate List filtered by Rejected, and counted in the Dashboard's Rejected figure and the reports' outcome buckets.

## Flow 3 — on hold

1. Take a fictional candidate to the direct interview (phone Selected + date, interview attended + scores).
2. Decision = **On Hold**. A **hold reason is required**; the follow-up date is optional — set one.
3. Stage becomes **On Hold**. Editing the interview later to **Selected** releases them forward (and creates their offer automatically).

## Flow 4 — discontinued and terminated

1. Reuse the Flow 1 employee or make a fresh one (quickest: repeat Flow 1 steps 1–7).
2. **Discontinue:** on Employee Details, choose **Discontinue** at any gate — it needs a **reason and an exit date**. The employee's status becomes Discontinued; they keep the phase they left from and appear on the **Discontinued / Exit** page.
3. **Terminate:** terminate is a separate action for employees **past probation** (junior or senior) — also reason + date. Status becomes Terminated.
4. Both show up in the **Exit report** with type, date and reason.

## Flow 5 — reports and exports demo

1. After the flows above you have real movement to look at. Open **Reports**.
2. **Candidate Status:** filter by the demo position — see each demo candidate and their current stage.
3. **Funnel:** see "there now" versus "entered during period" per stage.
4. **Sources / Positions:** your demo source with its outcome buckets (joined, rejected, on hold, in progress).
5. **Weekly:** this week's applications and stage movements.
6. **Onboarding / Exit:** the demo employee's joining, and the discontinued/terminated one.
7. On any tab press **Excel**, **CSV** and **PDF** — open each file and check it matches the filtered screen, including the generated time and filter notes.

## Flow 6 — notifications demo

1. Open **Notifications**: this is the reminder schedule. Note the banner — the system is in **development mail mode**: nothing is ever actually delivered, every attempt is only recorded in the **Email Log**.
2. Reminders are created automatically when a phase, interview or joining date is saved (set the HR and manager addresses under **Settings** first; with none set the reminder shows as **Failed — Blocked, missing …**, which is the safe, visible behaviour).
3. Open **Email Templates**: create a template for one of the guide's mail types (subject + body), save, edit it, switch it inactive and back. Notice that each type only offers the send modes the guide allows.
   - Open a candidate at _Interview Scheduled_ → **Send an email** → _Direct interview invitation_ → **Preview** → edit one copy → **Send**. Try sending again: it is refused until you press **Resend**.
   - Prepare the _Joining / onboarding mail_ as HR: it is not sent. Sign in as the Main User, open **Email Log** and approve it (or reject it with a reason).
   - On the offer's details page the Main User can record the salary; sign in as HR and confirm it is not shown.
   - **Administration → Team Leads**: map a demo position to a demo Team Lead.
   - **Administration → Company Accounts**: after marking a demo employee Attended, mark the account Created and Handed over.
4. The sending job runs every 15 minutes; in development it can also be triggered by hand (`POST /api/notifications/run`). The duplicate rule to remember: the same template is never sent twice to the same candidate unless someone explicitly presses **Resend** in the Email Log.

---

## Added since this guide was first written

Practise these on the development system with made-up people only:

- **Prepare Offer** (Offer Management): pick a Selected candidate, check the seven fields, press **Save Offer**. As HR you may be able to view the offer but not save it; that depends on your role's permissions, which are still being confirmed (see the sign-off checklist).
- **The notification bell**: shows alerts addressed to your login email. Mark one as read and see the number fall.
- **WhatsApp / SMS text**: on a candidate page, preview, then **Copy Message**. Nothing is sent by the system.
- **Calendar invitation**: the Team Lead's interview email includes an .ics invite; **Resend** after a reschedule updates it.

---

## After practice: clean up

Demo candidates can't be deleted from the screens (by design — nothing is ever deleted). Leave the fictional records in the development database, or ask the technical owner to remove them with the documented cleanup used in validation. The current mentor-approved scope is **dummy/test data only** — never enter a real person's details while practising, and never touch the protected sample candidates 2002 and 2003. (If real data ever arrives in a future go-live phase, practice stops on that system entirely.)
