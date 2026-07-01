# QA Task Workflow

This repo uses one central org tracker for bugs, enhancements, and verification work:

- Project: [Simply RCS - QA / Bugs / Enhancements](https://github.com/orgs/codeflex-labs/projects/1)
- Template: [QA Task](../../.github/ISSUE_TEMPLATE/qa_task.yml)

Use a QA task issue whenever manual validation, live provider testing, billing verification, or release-gate testing needs a named owner and durable evidence.

## Operating Model

The GitHub issue is the execution record. The project board is the team queue. Reusable test instructions live in `docs/runbooks/`, and each QA task links to the runbook or PR it verifies.

Default labels:

- `qa:needs-verify`: the task is waiting for QA verification.
- `workflow:ready-for-agent`: the task has enough detail for someone to claim it.
- `qa:verified`: QA passed on the stated target environment.

Assignment:

- The assignee owns the current QA run.
- Unassigned QA tasks with `workflow:ready-for-agent` are available to pick up.
- If the person running QA cannot self-assign, they comment that they are claiming it and ask a maintainer to assign them.

Project status:

- `New`: captured, but not yet ready for execution.
- `Triaged`: understood, but needs more plan, access, or setup.
- `In Review`: implementation PR is under review.
- `QA:Needs-Verify`: ready for a QA owner to run.
- `Done`: verified or otherwise closed.
- `Potentially Stale`: needs refresh before anyone runs it.

The project automation moves PR-linked issues to `In Review` when a ready PR opens and to `QA:Needs-Verify` when the PR merges. Standalone QA tasks should be created with the QA Task template and checked into Project #1. If automation does not place the issue correctly, set the project status manually.

## Creating A QA Task

Create a QA Task issue in the repo that owns the work. Fill in:

- Linked work: PRs, epic issues, runbooks, specs, or related docs.
- Goal: the decision this QA run should unlock.
- Test context: exact environment, customer, CRM location, user, sender, device, provider, feature flags, and test data.
- Prerequisites: access, deployment state, seed data, secret-manager references, third-party setup, or timing constraints.
- Test plan: numbered steps with expected results.
- Pass criteria: concrete conditions required to call the task verified.
- Required evidence: screenshots, logs, provider records, diagnostics, analytics, billing records, or exports.
- Failure handling: what to do if blocked or if a defect is found.

Never paste credentials, API keys, tokens, webhook secrets, or provider portal passwords into QA issues. Link to the approved secret manager entry or name the access owner instead.

For production or live-tenant QA, call out every real customer, tenant, CRM location, sender, asset, billing record, or provider setting that could be changed. Prefer throwaway/dev fixtures for mutating flows unless the point of the test requires live data.

Keep one issue focused on one QA decision. If the test plan grows into separate environments, providers, or releases, create separate QA tasks and link them.

## Claiming A QA Task

To pick up an unassigned QA task:

1. Comment `I am claiming this QA run.`
2. Assign yourself, or ask a maintainer to assign you.
3. Confirm the project status is `QA:Needs-Verify`.
4. Run the exact test plan.
5. Post the required evidence as issue comments.
6. Add `qa:verified` only when all pass criteria are met.
7. Close the issue after verification, unless a maintainer wants it left open through release.

If you stop before finishing, leave a handoff comment with what was completed, what remains, and any partial evidence.

## Handling Failures

If QA is blocked:

- Leave the issue open.
- Comment with `Blocked:` and include the exact blocker, environment, and evidence.
- Keep `qa:needs-verify`.
- Do not add `qa:verified`.

If QA finds a defect:

- Open a separate bug issue using the Bug Report template.
- Link the bug from the QA task.
- Keep the QA task open until the fix is merged and the re-test passes.
- Use the QA task comments as the evidence trail, not as a substitute for a bug issue.

If the test plan is wrong or incomplete:

- Update the issue body or linked runbook.
- Comment with the reason for the change.
- Keep the task assigned if the same owner is continuing.
