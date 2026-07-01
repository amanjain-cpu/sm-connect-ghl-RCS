# QA Agent Playbook

Use this playbook when Codex or Claude is asked to create, review, hand off, or announce a manual QA task.

One-line invocation:

```text
Use the Codeflex QA agent playbook to create a claimable GitHub QA task, add it to the central project, and give me a Slack-ready handoff.
```

## Source Of Truth

- Process: `docs/runbooks/qa-task-workflow.md`
- Issue template: `.github/ISSUE_TEMPLATE/qa_task.yml`
- Central tracker: [Simply RCS - QA / Bugs / Enhancements](https://github.com/orgs/codeflex-labs/projects/1)
- Project status for ready QA work: `QA:Needs-Verify`
- Ready labels: `qa:needs-verify`, `workflow:ready-for-agent`
- Passed label: `qa:verified`

GitHub is the durable queue and evidence record. Slack is only the notification layer. Fleet is the cross-repo cockpit that can watch these issues and notify Slack when work is ready.

## Agent Rules

- Create one QA issue per clear QA decision.
- Make the issue owner-neutral so any qualified teammate can claim it.
- Include linked PRs/issues/runbooks, goal, environment, prerequisites, test plan, pass criteria, required evidence, and failure handling.
- Add labels `qa:needs-verify` and `workflow:ready-for-agent`.
- Add the issue to Project #1 and set status to `QA:Needs-Verify`.
- Leave the issue unassigned unless the user names an owner.
- Never paste secrets, credentials, API keys, tokens, webhook secrets, or provider passwords into issues.
- For production or live-tenant QA, call out every real customer, tenant, CRM location, sender, asset, billing record, or provider setting that could be changed.
- After creating or verifying a task, return a Slack-ready message that tells teammates how to claim it.

## Execution Checklist

When acting as the QA task agent:

1. Read `docs/runbooks/qa-task-workflow.md` and `.github/ISSUE_TEMPLATE/qa_task.yml`.
2. Gather the linked work: PR, issue, epic, runbook, release, or feature.
3. Draft the QA issue body using the QA Task sections.
4. Create the issue with labels `qa:needs-verify` and `workflow:ready-for-agent`.
5. Add it to [Project #1](https://github.com/orgs/codeflex-labs/projects/1).
6. Verify the project item status is `QA:Needs-Verify`; set it manually if automation did not.
7. Verify the issue is open, unassigned unless a specific owner was requested, and safe to post.
8. Return a Slack-ready announcement.

Useful verification command:

```sh
gh issue view <issue-number> \
  --repo codeflex-labs/signalmash-connect \
  --json number,title,state,url,labels,assignees,projectItems
```

If the issue is missing the project or status, use the GitHub project APIs or `gh project item-edit` to add the item and set `Status = QA:Needs-Verify`. Query the project field/option ids at runtime instead of hardcoding them in the issue body.

## Create A QA Task

Use this prompt for Codex or Claude:

```text
Create a GitHub QA Task for this work:

<describe feature / PR / issue / release gate>

Follow docs/runbooks/qa-agent-playbook.md and docs/runbooks/qa-task-workflow.md.
Use the QA Task issue structure.
Add labels qa:needs-verify and workflow:ready-for-agent.
Add it to codeflex-labs Project #1 with status QA:Needs-Verify.
Leave it unassigned unless I name a specific owner.
Never include secrets in the issue.
Return the issue URL and a Slack-ready announcement.
```

Minimum issue body sections:

- Linked work
- Goal
- QA type
- Target environment
- Channel
- Test context
- Prerequisites
- Test plan
- Pass criteria
- Required evidence
- Failure handling
- Claim instructions

## Verify A QA Task Is Ready

Use this prompt for Claude review or Codex verification:

```text
Review this QA Task issue for readiness:

<issue URL>

Confirm:
- It is open and claimable.
- It has labels qa:needs-verify and workflow:ready-for-agent.
- It is in codeflex-labs Project #1 with status QA:Needs-Verify.
- It has linked work, goal, test context, prerequisites, test plan, pass criteria, required evidence, and failure handling.
- It does not ask testers to paste secrets.
- It warns about production/live-data mutation when relevant.

Return approve/block with findings and a Slack-ready message if approved.
```

## Slack Announcement Template

After a QA task is ready, post this to the QA channel:

```text
New QA task ready to claim:

<title>
<issue URL>

How to claim:
1. Comment on the GitHub issue: "I am claiming this QA run."
2. Assign yourself if you can, or ask a maintainer to assign you.
3. Fill in the Environment/Test Context section before testing.
4. Run the checklist and post evidence directly in the issue.
5. If you find a defect, open a separate bug issue and link it back.

Notes:
- GitHub is the source of truth for status and evidence.
- Do not paste credentials, tokens, provider passwords, or secrets into the issue.
- If blocked, comment `Blocked:` with the exact blocker and evidence.
```

Add task-specific notes below the template, such as whether a provider portal, CRM test account, live customer, or billing evidence is required.

## When QA Finishes

If QA passes:

- Confirm evidence is attached to the issue.
- Add `qa:verified`.
- Move the project item to `Done`, or close the issue if that is the team convention for the task.

If QA is blocked:

- Keep `qa:needs-verify`.
- Leave the issue open.
- Comment `Blocked:` with exact blocker, environment, and evidence.
- Do not add `qa:verified`.

If QA finds a defect:

- Open a separate Bug Report issue.
- Link the bug from the QA task.
- Keep the QA task open until the re-test passes.

## Common Agent Output

When done, return:

- Issue URL
- Project status
- Labels
- Assignee, or `Unassigned / ready to claim`
- Slack-ready announcement
- Any blocked setup or access that still needs a human
