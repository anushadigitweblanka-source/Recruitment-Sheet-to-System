# data-maps/

Mappings between the source recruitment spreadsheet and the system's database: which sheet column feeds which table and column, with any transformation rules.

- One file per source sheet or per target table, whichever is clearer.
- Record the rule for every column: direct copy, transformed (how), derived, or intentionally dropped.
- Note unresolved mappings explicitly so they are not forgotten at import time.
