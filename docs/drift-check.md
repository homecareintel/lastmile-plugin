# Weekly drift check

This is the brief for the weekly Factory task that keeps the skills in step with the Route Optimization service. Run it against this repo's `main`.

## What the check compares

`npm run drift` runs `scripts/drift/snapshot.mjs`. It finds the commit of the latest successful `prod` deployment of `homecareintel/routeoptimization-agent` on GitHub, and reads the service source at that commit through `gh api`. From the source it builds a snapshot:

- each tool's name, title, the four hints (read-only, destructive, idempotent, open-world), argument names and required arguments
- the checklist prompt names and the checklist domains
- the error codes
- the run statuses, proposal statuses, compile profile states, and the run failure codes for orphaned and shut-down runs
- content hashes of each domain checklist and of the server instructions

It compares the snapshot with the reviewed baseline in `drift/service-surface.json`. The service commit is recorded in the baseline but is not compared, so a new deployment that changes none of these is not drift.

Exit codes:

- `0`: no drift.
- `1`: drift. The markdown report on standard output lists each change and the skills that mention the changed name or code. It flags new tools that no skill mentions yet.
- `2`: parse failure, or the source could not be read. The script could not read the service source as it expects, so it compared nothing. The errors are on standard error.

## Rules

- Use only the GitHub access this host already has (`gh`). Store no credentials, tokens or secrets anywhere.
- Never call the live Route Optimization server. Everything comes from the source on github.com.
- Never move the marketplace pin (the `ref` in `.claude-plugin/marketplace.json`). Installs move only when a maintainer releases.
- Never merge. A person reviews and merges the PR.
- Do not copy source text from routeoptimization-agent into this repo. That repo is private and this one is public. Describe changes in your own words.

## Steps

1. Check out an up-to-date `main`. The scripts use only Node built-ins, so there is nothing to install.
2. Run `npm run drift` and keep its standard output as the report.
3. Exit `0`: stop. Change nothing and open nothing.
4. Exit `2`: fail the task with the script's error output as the reason. Do not run `--write` and do not open a PR. A person has to update the script to match the service's new source layout.
5. Exit `1`: drift. Continue:
   1. Create a branch from `main` named `drift/<first 7 characters of the service commit>`. The commit is in the report's first line.
   2. Run `npm run drift -- --write` to refresh the baseline.
   3. Edit the skills listed under "Skills to review" so they match the service. Read the changed parts of the service source with `gh` to see what each change means. For a new tool that no skill mentions, add it where an operator would need it, or say in the PR why no skill needs it yet.
   4. Run `npm test`, `npm run check` and `claude plugin eval . --no-publish`. Fix what fails. If something still fails and the cause is not in the skills, open the PR as a draft and say what fails.
   5. Run `npm run drift` again and confirm it exits `0`.
   6. Commit the baseline and the skill edits, push the branch, and open a PR to `main`. The PR body is the report from step 2, followed by a short list of the skill edits and the check results.
   7. If a drift PR from an earlier week is still open, close it with a comment that links the new one.
