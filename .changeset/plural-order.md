---
'@everylocale/core': patch
'@everylocale/cli': patch
---

Plural categories are recorded and compared in canonical CLDR order (`pluralCategories(locale, type)` in core). Node.js 22 and 24 report them in different orders, so a release pulled on one could fail `everylocale check` on the other with `plural_rules_changed`. Releases recorded in another order still pass, since the check compares the categories as sets.
