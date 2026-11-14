# Skill evals

These cases run the six skills against mock stand-ins for the
`route-optimization` tools, so they never contact the real service. Each
case checks one rule a skill edit could quietly break: setup stays
read-only, a rule is never reported live before approval, an
inexpressible rule is recorded as unsupported, delivery needs its own
explicit yes, an account with no tenant gets the invite-only answer,
explanations come only from solver output, and an instruction inside a
tool result is never followed.

Run the suite from the repo root:

```
claude plugin eval . --ablation none --no-publish
```

Add `--runs 1 -j 4` for a quicker pass. The run uses model calls on your
own Claude account, which is why it stays out of CI. It must pass at the
default threshold of 1.0 before a release and on every drift refresh PR.

`--ablation none` matters: every grader is marked to score in both arms,
so a no-plugin baseline arm would be scored and fail.

## Layout

- `mocks/route-optimization/` holds the suite-wide mocks: one file per
  tool describing a healthy pilot workspace. A case's own `mocks/`
  directory overrides them file by file.
- `mocks/route-optimization/_tools.json` is the tool listing the mocks
  serve. It mirrors `drift/service-surface.json` (names, titles, hints
  and argument names). Update it when a drift refresh changes the
  baseline.
- Graders check tool calls wherever the rule is about calls, and use a
  model judge only for wording.
- The three `deliver-*` cases resume a short hand-written transcript
  (`transcript.jsonl`). Their prompts start with `/lastmile:lm-optimization`
  because the transcript never loads the skill, as a real conversation
  would have. Without the skill in context the agent delivers on "send
  it", which is the failure the case exists to catch.
