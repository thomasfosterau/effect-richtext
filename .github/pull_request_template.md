## Summary

Describe what changed and why. If this closes an issue, add `Closes #N` so it auto-closes on merge to `trunk`.

## Verification

Run the gates in [AGENTS.md](https://github.com/thomasfosterau/effect-richtext/blob/trunk/AGENTS.md#verification) and list each command with its final pass/fail. If a gate could not run, say which and why.

## Changeset

Name the changeset(s) under `.changeset/`, or say why none is needed (see [AGENTS.md](https://github.com/thomasfosterau/effect-richtext/blob/trunk/AGENTS.md#branches-and-pull-requests)).

## Notes

Anything reviewers should pay special attention to: exported signatures, the `sideEffects` list, behaviour ported from ProseMirror that must stay compatible with it, the `compat/*` facade's fidelity to ProseMirror's API.
