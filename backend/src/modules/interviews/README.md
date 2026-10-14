# Module 3 – Direct Interview (backend)

**Implemented:** listing, recording, viewing and changing direct interviews, and the stage changes they cause.

| Route                       | Permission          | Purpose                                                        |
| --------------------------- | ------------------- | -------------------------------------------------------------- |
| `GET /api/interviews`       | `candidates.view`   | Candidates who have a direct interview, or are waiting for one |
| `GET /api/interviews/:id`   | `candidates.view`   | One direct interview with its candidate                        |
| `POST /api/interviews`      | `interviews.manage` | Record a direct interview for a candidate                      |
| `PATCH /api/interviews/:id` | `interviews.manage` | Change it; only the fields sent are changed                    |

Files: `interviews.routes.js` (HTTP), `interviews.service.js` (rules and stage changes), `interviews.validation.js` (field checks), `interviews.repository.js` (SQL).

Table: `interviews` (migration 004). Stage changes go through `../pipeline/pipeline.js`, which writes `pipeline_status`, `stage_history` and the audit log together.

## Rules

- A direct interview can be recorded only for a candidate at **Interview Scheduled**.
- **Interview Date/Time** is required and must carry a time zone.
- **Attendance** is `attended`, `not_attended` or empty (not known yet).
- **Scores**: Technical, AI, Communication, Confidence and Culture Fit, each a whole number from 0 to 10. All five are entered or none.
- **Total** (out of 50) is calculated by the database from the five scores. It is never accepted from the browser.
- **Status** (the decision) is `selected`, `not_selected` or `on_hold`. It needs Attended and all five scores.
- A candidate who did **not attend** cannot have scores or a status.
- **Not Selected** requires a reason for rejection; **On Hold** requires a reason for hold and may carry a next follow-up date. These are stored with the candidate's pipeline status, not on the interview.
- **Recommendation** has no approved list of values, so no value is accepted yet. The column exists for when the list is approved.

The database repeats the score range, all-or-none, attendance, decision and did-not-attend rules as constraints, so they hold even if the application is bypassed.

## Stage changes

| Outcome                              | Candidate's stage   |
| ------------------------------------ | ------------------- |
| Status: Selected                     | Selected            |
| Status: Not Selected                 | Rejected            |
| Status: On Hold                      | On Hold             |
| Attended, no status yet              | Interviewed         |
| Not Attended                         | Not Attended        |
| Nothing recorded yet                 | unchanged           |
| Everything recorded is cleared again | Interview Scheduled |

- A stage only changes when the outcome changes. Editing remarks or the interviewer alone changes nothing.
- Every change adds a `stage_history` row with who and when. Earlier rows are never altered.
- A candidate who has already moved beyond the interview (for example to an offer or joining) is not pulled back: the change is refused and nothing is saved.

Audit actions: `INTERVIEW_CREATE`, `INTERVIEW_UPDATE` (changed fields only) and `PIPELINE_STAGE_CHANGE`.

## Effect on Module 2

Once a direct interview exists for a candidate, the phone interview's result can no longer be changed (`phoneScreens.service.js`). Its other fields can still be edited. Without this guard, changing the phone result could move a candidate whose stage now belongs to the direct interview.

## Not part of this module

Selecting a candidate moves them to the **Selected** stage and nothing more. **No offer is created here.** Creating the offer, automatically or by hand, belongs to Module 4 – Offer Management.

## MENTOR CONFIRMATION REQUIRED

- **The stage mapping above.** The guide says "Selected goes to Offer Tracker, Not Selected to the Rejected sheet, On Hold to the On Hold sheet" and lists the stages, but does not spell out the stage for Attended-without-status, for Not Attended, or for a cleared record.
- **Attendance values.** `attended` and `not_attended` are used. The approved list has not been supplied (for example whether Rescheduled or Cancelled exist).
- **Recommendation values.** No approved list, so nothing can be saved in this field yet.
- **Interviewer storage.** Stored as plain text (`interviewer_name`), as in the workbook, because interviewers do not have logins. To be confirmed whether it should link to a user, and whether an interview can have several interviewers.
- **One direct interview per candidate, or several?** The table allows several (for example after a no-show). The application keeps one for now and refuses a second with a pointer to the first.
- **Automatic offer creation.** Whether Selected should create an offer record automatically. Left to Module 4; nothing is created today.
