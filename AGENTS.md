# Signalmash Connect — Agent Context

Read `CLAUDE.md` first for project architecture, setup, and operating context.

QA coordination work must follow `docs/runbooks/qa-agent-playbook.md` and
`docs/runbooks/qa-task-workflow.md`. When asked to create, verify, hand off, or
announce manual QA, treat GitHub issues as the source of truth and Slack as the
notification layer.

## Git and pull-request workflow

- Treat `main` as read-only; never commit or push directly to `main`.
- Begin each task from an up-to-date `origin/main` on a dedicated `codex/<short-description>` branch.
- Keep each branch and PR focused.
- Preserve and stop on unexpected existing working-tree changes rather than resetting or overwriting them.
- Run the smallest relevant tests; for broad changes run `npm test`, `npm run lint`, and `npm run build`.
- Review the diff and ensure no secrets are included.
- Commit descriptively, push the branch, and open a PR targeting `main`.
- Report the PR URL and CI status.
- Never merge a PR without the user's explicit approval.
