# 0015 — CI status on pull requests

- **Status:** Accepted (user answers, 2026-11-20)
- **Date:** 2026-11-20
- **Scope:** Show whether a pull request's checks pass or fail, and post failures to chat
- **Builds on:** [0006](0006-github-events.md) (events), [0014](0014-github-updates-in-chat.md) (chat)

## 1. Outcome

Pull requests linked to tasks show a **checks** badge ("Checks passing" or "Checks failing"). When checks newly fail on a pull request, its connected projects' chat gets a `checks.failed` update (0014; on by default).

## 2. Source: `check_suite` completed (approved)

- **Subscription:** the GitHub App subscribes to **Check suite**, which needs the **Checks: read** permission. You add this in the app's settings and then accept it on each installation.
- **Which actions:** DevTrack uses `check_suite.completed`. GitHub sends `requested` and `rerequested` to the app that runs the suite, not to us. The "running" state comes from `check_run.created` instead (§8).
- **Why `check_suite`:** each CI provider creates one suite per commit, and the suite completes once all of its runs have finished. That gives one result per provider (GitHub Actions, Vercel and so on) without handling every individual check run.
- **Assumption to confirm:** GitHub's docs don't say outright that an app receives other apps' completed suites. Merge bots depend on it, so we assume it. After enabling the permission, confirm that **Recent deliveries** in the app's settings show `check_suite` events from your CI. If they don't, the fallback is the `workflow_run` event, which covers GitHub Actions only and needs **Actions: read**.

## 3. How a PR's state is worked out

- **Head commit:** pull requests now store their head commit SHA (`head_sha`), filled in from every `pull_request` event. Pull requests stored before this change have no SHA until their next event.
- **Stored suites:** each completed suite is stored once per repository by its GitHub ID, with its head SHA, app slug, conclusion and completion time. If a later delivery for the same suite arrives (for example a re-run), it replaces the earlier result.
- **The rule:** a PR's checks state is worked out from the suites for its _current_ head SHA.
  - `failing` if any of them ended `failure`, `timed_out`, `cancelled` or `action_required`.
  - `passing` if all of them ended `success`, `neutral` or `skipped`.
  - `null` if there are none yet.
  - A new push changes the head SHA, so the state resets to `null` until that commit's results arrive.
- **Which PRs a suite applies to:** the suite payload's `pull_requests` (matched by GitHub PR ID), plus any open PR in the same repository with the same head SHA. The second rule covers forks, where GitHub sends an empty `pull_requests` list.

## 4. Chat and notifications

- **Chat:** when a PR's state goes from anything else to `failing`, every connected project with `checks.failed` enabled gets one chat message (0014). Later failing suites on the same commit don't post again. A new commit that fails posts again.
- **No other effects:** there are no bell notifications, and task status never changes (0006 §2).

## 5. Migration (additive)

```sql
ALTER TABLE github_pull_requests ADD COLUMN head_sha text;
ALTER TABLE github_pull_requests ADD COLUMN checks_state text CHECK (checks_state IN ('passing', 'failing'));
CREATE TABLE github_check_suites (
  id uuid PRIMARY KEY, repository_id uuid NOT NULL REFERENCES github_repositories ON DELETE CASCADE,
  github_suite_id bigint NOT NULL, head_sha text NOT NULL, app_slug text, conclusion text,
  completed_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repository_id, github_suite_id));
CREATE INDEX github_check_suites_repo_sha_idx ON github_check_suites (repository_id, head_sha);
```

Retention: suites are kept like other GitHub history (0008).

## 6. Tests

- **Badge state:**
  - a failing suite marks the PR `failing`;
  - a passing suite from a second app keeps it `failing`;
  - a re-run that succeeds turns it `passing`.
- **Head commit:**
  - a new head commit resets the state to `null`;
  - a suite with an empty `pull_requests` list still reaches its PR by head SHA;
  - a suite for an old commit doesn't change the current state.
- **Chat:** a failure posts once; a later failing suite on the same commit doesn't post again; a project with `checks.failed` switched off gets nothing.
- **Ignored deliveries:** non-`completed` actions and unconnected repositories.

## 7. Board cards (added 2026-11-22)

- Task responses carry `checks: 'passing' | 'failing' | null`, worked out from the task's linked PRs that are still **open**: `failing` if any of them fails, `passing` if some pass and none fail, otherwise `null`. Merged and closed PRs don't count.
- Board cards show it in the footer as an icon and a word ("Checks passing" / "Checks failing"), never color alone.
- When a PR's checks state changes, every project the repository is connected to gets a `github.pull_request.updated` event (`action: 'checks'`), so open boards and task pages refresh.
- **Test:** the task list reports `failing`, then `passing`, then `null` once the PR closes; tasks without a linked PR stay `null`.

## 8. Running state (added 2026-11-22)

- **Why:** on PR #76, Vercel and GitGuardian passed within seconds and the badge showed "passing" while GitHub Actions still ran for about two minutes.
- **Source:** the app also subscribes to **Check run** (same Checks: read permission). On `check_run.created`, the run's suite is stored as running: no conclusion, no `completed_at`, and `started_at` set to the run's start. Other `check_run` actions are ignored; the suite's `completed` event still carries the result.
- **The rule (replaces §3's list):** on the head commit, `failing` if any finished suite failed; otherwise `running` if any suite is still running; otherwise `passing` if every suite passed; `null` if there are none.
- **Re-runs and late deliveries:**
  - a run that starts after the suite's last result (a re-run) reopens the suite;
  - a `created` delivery for a run older than the suite's last result changes nothing;
  - a `completed` delivery older than the suite's latest run doesn't end that run.
- **Board and task pages:** "Checks running" with a clock icon, in the muted text color. On a task, the worst of its open PRs wins: failing, then running, then passing.
- **Chat:** unchanged. A failure posts when the state becomes `failing`, so a re-run that fails again posts again.
- **Limit:** if a quick suite finishes before CI even queues its first run, the badge can show "passing" for a few seconds.
- **Migration:**

```sql
ALTER TABLE github_pull_requests DROP CONSTRAINT github_pull_requests_checks_state_check;
ALTER TABLE github_check_suites ALTER COLUMN completed_at DROP NOT NULL;
ALTER TABLE github_check_suites ADD COLUMN started_at timestamptz;
ALTER TABLE github_pull_requests ADD CONSTRAINT github_pull_requests_checks_state_check
  CHECK (checks_state IN ('passing', 'running', 'failing'));
```

- **Tests:** running until the last started suite finishes (a quicker app passing doesn't turn it green); a late `created` for a finished run is ignored; a re-run goes failing → running → passing and ignores a redelivered older failure; a new commit resets; other `check_run` actions are ignored.
