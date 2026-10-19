# Phase-end reminder email template (proposal)

**Status: PROPOSED. Requires company approval. Not yet stored or active in any database.**

## Why it is needed

The 24-hour reminders for the Evaluation, Probation and Junior phases
(`evaluation_end`, `probation_end`, `junior_end`) all send the one mail type
`phase_end_reminder` (`emailTypes.js`, Auto send mode). Scheduled delivery
looks up an **active** template of that type and fails with
`No active email template exists for type "phase_end_reminder"` if there is
none.

A missing template is **not** what made the existing Failed notifications fail.
Those rows were marked failed when they were created, because no HR or manager
address is saved in Settings (`Blocked, missing: HR or manager address
(Settings)`). The missing template is a second blocker that would show up once
the addresses are set.

## Proposed wording

Subject:

```
Reminder: {name} - phase ends tomorrow ({date})
```

Body:

```
Hello,

This is a reminder that the current phase for {name} ({position}) ends tomorrow, {date}, at 17:30 (office closing, Asia/Colombo).

Please review it and record the decision (Pass, Extend or Discontinue, as the phase allows) in the Recruitment System before the phase ends.

Regards,
Recruitment System
```

Send mode: Auto. Active: yes (once approved).

## Supported placeholders

`{name}`, `{position}`, `{date}`, `{time}`, `{venue}`, `{team_lead}`. The two
Company CV placeholders exist only for the interview mails. For a phase
reminder `{date}` is the phase end date and `{time}` is empty, so the 17:30 is
written in the text. Template validation does not check placeholders: an
unsupported one such as `{phase}` would be saved and sent as literal text.

## Not possible with the current placeholders

The task guide lists more content for these mails: join date, phase start,
a link to the evaluation form or review link, and Pass/Extend/Discontinue
buttons. There are no placeholders for these, and the wording above does not
pretend to provide them. Adding them needs a code change and a decision.
The same text is also used for all three phases, because there is no phase
placeholder.

## Activating it safely (needs your separate approval for the database write)

1. Get the wording approved by the company.
2. Save HR and manager addresses in Settings (`reminder_hr_emails`,
   `reminder_manager_emails`). Otherwise new reminders are blocked again.
3. In the app, open Email Templates and create one `phase_end_reminder`
   template (check first that none exists, so there is no duplicate). Use the
   admin screen, not SQL, so it is audited.
4. Confirm the mail mode is `development` (nothing is sent) while checking.
5. The three existing Failed reminders are not retried automatically, and
   saving Settings does not reschedule them. A replacement has to be created
   through an authorized action, if wanted.
