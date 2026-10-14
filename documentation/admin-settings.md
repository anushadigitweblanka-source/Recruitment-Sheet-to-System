# Admin Settings (built 2026-10-14, uncommitted pending review)

The `/admin/settings` placeholder is now a real page for the application settings — exactly the four phase-duration rows the task guide defines and migration 006 seeded. **No setting can be created or deleted through the API**; only existing rows are editable.

## Settings exposed

| Key                              | Meaning                                                                                                             | Seeded value |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------ |
| `evaluation_days`                | Length of the 7-day evaluation (day 1 = join date)                                                                  | 7            |
| `probation_months`               | Probation length                                                                                                    | 3            |
| `probation_max_extension_months` | Maximum probation extension                                                                                         | 1            |
| `junior_months`                  | Junior stage length — stored, but the junior end date stays uncalculated until the mentor confirms the 9-month rule | 9            |

Module 5 reads these at **every gate decision** (`readLifecycleSettings`), so a change takes effect on the next decision with no restart (proven by test).

## API and permission

- `GET /api/admin/settings` — list (key, value, description, last changed)
- `PATCH /api/admin/settings/:key` — update one value

Both require `admin.manage` (the existing administration permission, reused — no new permission, no migration): 401 unauthenticated, 403 without it. Unknown key → 404, never created.

## Validation

Every current setting is a duration: the value must be a whole number from 1 to 365 (`422` otherwise, value unchanged). Saving an identical value is a no-op (no audit noise).

## Audit behaviour

Every real change writes one `SETTING_UPDATE` row through the existing `recordAudit` helper, in the same transaction as the update: actor, `details.key`, `old_values.value`, `new_values.value`, timestamp. No parallel audit mechanism.

## Frontend

`frontend/src/pages/SettingsPage.jsx`: one card per setting with label, the database description, current value, a number input, Save (disabled until changed / while saving), success and validation messages, last-changed time, and an info notice explaining when values take effect. States: loading, forbidden (administrators only), error with retry.
