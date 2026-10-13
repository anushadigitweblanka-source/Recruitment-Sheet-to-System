# Authentication Decision

**Status: waiting for mentor approval. Nothing described here has been built.**

## Why this decision is needed

Almost every table records who created or changed a row, so the `users` table must exist before any other. How people sign in decides what is stored about them. This is the last decision blocking the first database migration.

Two separate questions are involved:

- **Authentication — who is the user?** This document.
- **Authorization — what may the user do?** Decided by roles and permissions, which work the same way under every option below.

**What the task guide says**

- Four roles: Main user (everything, including salary and managing users), HR (no salary), Team lead (own team only, no salary), Intern/dev (test data only).
- Permissions must be checked on the server, not only hidden in the screen.
- Only the Main user may read or edit salary, and every view and change is logged (who, when).
- Every status change stores who changed it and when.
- To reveal a stored company-account password, the Main user "re-enters their own login password". This is the guide's only mention of a login password.
- "Manager" and "IT" are mentioned as people who receive mails or act on accounts, but are not defined as roles.

**What the guide does not say:** how users sign in, any password rules, how sessions work, or whether a company sign-in service exists.

## Option A – Application Email/Password

Users sign in with their email and a password that this application checks.

| Aspect              | Assessment                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Database            | Adds password storage (a one-way hash) plus reset and lockout details                                     |
| Password storage    | The application is responsible. Only a strong one-way hash is stored; the password itself never is        |
| Security            | Good if built carefully. The application carries the risk: resets, lockout and leaver removal are our job |
| Ease of development | Easiest. Works on a development machine with no outside service                                           |
| Roles/permissions   | Full support                                                                                              |
| Maintainability     | One more password for staff. Someone must deactivate leavers by hand                                      |
| Fit                 | Fits a small internal tool, and matches the guide's "re-enters their own login password" step             |

## Option B – Company SSO

Users click "Sign in with Google" (or Microsoft) and use their company account. The guide mentions Google Workspace and Microsoft 365, but does not say the company uses either.

| Aspect              | Assessment                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Database            | No password stored. Stores the provider's ID for each user                                 |
| Password storage    | None in this application                                                                   |
| Security            | Strongest. Two-step sign-in and leaver removal are handled by the company account          |
| Ease of development | Harder. Needs an administrator to register the application, and is awkward to test locally |
| Roles/permissions   | Full support. Roles are still assigned inside this application                             |
| Maintainability     | Best for staff: no extra password, and a disabled company account loses access at once     |
| Fit                 | Best for live use, **if** the company has such accounts for every user                     |

## Option C – Existing Company Authentication

Users sign in with the login they already have for another internal company system.

| Aspect              | Assessment                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Database            | No password stored here. Stores that system's user ID                                      |
| Password storage    | None here; this application depends on how well the other system protects passwords        |
| Security            | Unknown until that system is identified and reviewed                                       |
| Ease of development | Unknown. Only possible if that system offers a sign-in service other applications can call |
| Roles/permissions   | Roles would still be assigned inside this application                                      |
| Maintainability     | Ties this application to another system's uptime and changes                               |
| Fit                 | Cannot be judged. No such system has been confirmed for this project                       |

## Recommended Option

**Option A, built so that Option B can be added later without changing the `users` table.**

Reasons:

- No company sign-in service has been confirmed, so B and C cannot be started today.
- Email and password with strong one-way hashing is a normal, sound approach for an internal tool, and the simplest to build and test.
- It matches the guide's step where the Main user re-enters their login password.
- Keeping password details in their own table, separate from `users`, means a later move to company sign-in adds one column and removes one table. Nothing else changes.

If the mentor confirms that every user has a company Google or Microsoft account, Option B is the better choice for live use and should replace A before go-live.

**MENTOR APPROVAL REQUIRED.**

## Database Impact

The core of `users` is the same under every option:

| Field                      | Needed under | Purpose                          |
| -------------------------- | ------------ | -------------------------------- |
| `id`                       | A, B, C      | What every other table refers to |
| `email`                    | A, B, C      | Unique; identifies the person    |
| `full_name`                | A, B, C      | Shown on screens and in history  |
| `role_id`                  | A, B, C      | The user's role                  |
| `is_active`                | A, B, C      | Switch off instead of deleting   |
| `last_login_at`            | A, B, C      | Audit                            |
| `created_at`, `updated_at` | A, B, C      | Audit                            |

What differs:

| Option | Extra storage                                                                                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | A separate `user_credentials` table: password hash, when it was last changed, a must-change flag, failed-attempt count and lock time. A table of one-time reset tokens (stored hashed) is added with the login feature |
| B      | One column on `users` for the provider's user ID. No password data anywhere                                                                                                                                            |
| C      | One column on `users` for the other system's user ID. Anything further is unknown                                                                                                                                      |

Under every option, users are created inside this application by the Main user. Nobody can sign themselves up, and a person with no active user row cannot get in.

No plain-text or reversible password is stored under any option.

## Security Requirements

These apply whichever option is approved:

- Every request is checked on the server against the signed-in user's permissions.
- Salary has its own permissions, granted only to the Main user role.
- Every salary view and change is logged with the user's ID and the time. This works under all three options, because each ends with a known `users` row.
- Sign-ins, failed sign-ins, user changes and role changes are written to the audit log.
- Deactivating a user ends their access immediately.
- The sign-in session is kept in a cookie that scripts cannot read, and expires after a period of inactivity.
- The live system is served over HTTPS only.
- No password, hash or token ever appears in logs, error messages or audit records.

Additional requirements if Option A is approved:

- Passwords are stored only as a strong one-way hash (argon2id or bcrypt).
- A minimum password length, and a forced change at first sign-in.
- Repeated failed attempts lock the account for a time.
- Password resets use a one-time link that expires.

Still open, and not needed for the first migration: the final role list (whether "manager" and "IT" are roles) and which role receives which permission.

## Mentor Decision

Approved option: __________________

Approved by: __________________

Date: __________________
