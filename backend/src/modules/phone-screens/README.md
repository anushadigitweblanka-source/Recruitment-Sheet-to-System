# Module 2 – Phone Interview (backend)

**Implemented:** listing, recording, viewing and changing phone interviews, and the stage changes they cause.

| Route                                     | Permission          | Purpose                                            |
| ----------------------------------------- | ------------------- | -------------------------------------------------- |
| `GET /api/phone-interviews`               | `candidates.view`   | Every candidate with their phone interview, if any |
| `GET /api/candidates/:id/phone-interview` | `candidates.view`   | One candidate with their phone interview, or none  |
| `POST /api/phone-interviews`              | `interviews.manage` | Record a phone interview for a candidate           |
| `PATCH /api/phone-interviews/:id`         | `interviews.manage` | Change it; only the fields sent are changed        |

Files: `phoneScreens.routes.js` (HTTP), `phoneScreens.service.js` (rules and stage changes), `phoneScreens.validation.js` (field checks), `phoneScreens.repository.js` (SQL).

Table: `phone_screens`. Stage changes go through `../pipeline/pipeline.js`, which writes `pipeline_status`, `stage_history` and the audit log together.

The folder is named `phone-screens` to match the table.

## Rules

- **Result** is `selected`, `not_selected` or empty. These are the two results the task guide names. On Hold is not offered here.
- **Interview Date/Time** can only be set when the result is Selected, and must carry a time zone.
- **Not Selected** requires a reason for rejection. The reason is stored with the candidate's pipeline status, not on the phone interview.
- **Response** is optional and accepts exactly seven values: Interested, Not Interested, Call Back Later, No Answer, Busy, Not Reachable, Wrong Number. It describes the call and never changes the Result or the stage.
- **Mail status** is not stored. It will be read from the email log once emails are built.

## Stage changes

| Outcome                       | Candidate's stage   |
| ----------------------------- | ------------------- |
| Selected, with interview date | Interview Scheduled |
| Selected, no date yet         | Phone Screened      |
| Not Selected                  | Rejected            |
| No result yet                 | unchanged           |
| A recorded result is cleared  | Applied             |

- A stage only changes when the outcome changes. Editing the review alone changes nothing.
- Every change adds a `stage_history` row with who and when. Earlier rows are never altered.
- A candidate who has already moved beyond phone screening (for example to Interviewed) is not pulled back: the change of result is refused and nothing is saved.

Audit actions: `PHONE_SCREEN_CREATE`, `PHONE_SCREEN_UPDATE` (changed fields only) and `PIPELINE_STAGE_CHANGE`.

## MENTOR CONFIRMATION REQUIRED

- **The stage mapping above.** The guide says "Selected moves the candidate to Direct Interview automatically" and lists the stages, but does not spell out which stage each outcome gives.
- **One phone interview per candidate, or several attempts?** The table allows several. The application keeps one for now and refuses a second with a pointer to the first.
- **The Response values**, and how "No Response" becomes a stage.
