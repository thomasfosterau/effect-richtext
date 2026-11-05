---
"effect-richtext": patch
---

`Step.fromJSON` now rejects a non-string `stepType` as invalid input (`JSONError` "Invalid input for Step.fromJSON") instead of looking it up as a stringified key; a string `stepType` with no registered step still reports "No step type … defined". Error messages that list attribute types or marks now join them explicitly (the text is unchanged).
