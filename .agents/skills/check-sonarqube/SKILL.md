---
name: check-sonarqube
description: Check the SonarQube Cloud Quality Gate and resolve actionable PR findings after a push. Use alongside PR bot review comments when reviewing CI results, fixing Sonar issues, or checking whether a pushed PR passes the Quality Gate.
---

# Check SonarQube PR Quality Gate

Run from the repository root. This skill complements PR bot review: collect bot comments and Sonar findings for the **same PR and pushed revision**, address both in one pass, then check the new revision after the next push.

## Prerequisites

- `sonar` (SonarQube CLI), authenticated with `sonar auth login`; verify with `sonar auth status`. Never paste a token into a command, commit it, or log it.
- `gh`, authenticated with access to this repository and its PR checks.
- An open PR for the current branch. If the checkout is on `main`, a detached HEAD, or a branch without a PR, ask for the PR number and the branch to work on; never silently substitute a different PR.
- CI's `SonarQube Analysis` job in `.github/workflows/ci.yml` performs the authoritative PR scan. A local `sonar analyze` is not a substitute for it.

## 1. Identify the exact PR and CI run

```bash
git branch --show-current
git rev-parse HEAD
gh pr view --json number,url,headRefName,headRefOid,baseRefName
gh pr checks
```

Confirm the PR's `headRefName` is the branch being worked on and `headRefOid` matches the pushed commit you intend to review. If there are local commits not yet pushed, do not mistake the earlier PR analysis for the current code. Do not push on the user's behalf unless asked.

Wait until **CI / SonarQube Analysis** for that revision completes. Recheck `gh pr checks` after it finishes (do not stream indefinitely). If the scan is pending or failed, report that the Quality Gate cannot yet be verified for this revision; inspect the check's CI logs for a failed scan rather than treating an old Sonar result as current. Other test jobs may fail independently of the Quality Gate; report those separately.

## 2. Query the PR gate through `sonar`

Read the project key from `sonar-project.properties` for the gate request:

```bash
PROJECT_KEY=$(sed -n 's/^sonar\.projectKey[[:space:]]*=[[:space:]]*//p' sonar-project.properties)
test -n "$PROJECT_KEY" || exit 1
sonar api get "/api/qualitygates/project_status?projectKey=${PROJECT_KEY}&pullRequest=<PR_NUMBER>"
```

Record the gate status and failing conditions, including coverage, duplication, or security-hotspot review metrics even if there are no open code issues. Do not treat a successful CI scan alone as a passing gate.

## 3. Retrieve actionable findings

```bash
sonar list issues --pull-request <PR_NUMBER> --statuses OPEN,CONFIRMED --format json --page-size 500 --page 1
```

Fetch all pages of open issues and associate each actionable finding with its rule, path, and location in the checkout. Collect bot review comments for the same PR (including inline comments and review bodies) through the existing review workflow; for example:

```bash
gh pr view <PR_NUMBER> --json reviews,comments
gh api "repos/{owner}/{repo}/pulls/<PR_NUMBER>/comments" --paginate
```

Deduplicate overlapping findings, and check whether comments refer to an older diff before applying a fix.

Investigate failing gate conditions even when `issues` is empty: coverage requires tests for changed code, duplication needs a maintainable refactor, and security hotspots require human review in SonarQube. Do not lower thresholds, blanket-exclude files, or mark issues accepted/false-positive merely to make the gate green. If a finding is inapplicable, explain why and request an explicit decision rather than changing Sonar status automatically.

## 4. Fix and verify

Fix root causes in the current branch, including relevant bot feedback, and add focused regression tests. Follow repository instructions and run applicable checks (for frontend, `pnpm --filter app check` and `pnpm --filter app test:run`; for Rust core, `cargo check -p jot-deck-core` and `cargo test -p jot-deck-core`). Report the issue keys addressed and any remaining conditions or comments. Do not claim the remote gate is green based on local tests or a local `sonar analyze`.

After the fix is pushed, repeat steps 1–3 for the **new** PR head revision once its SonarQube CI analysis completes. Report the gate status, failing metrics if any, unresolved issue keys, and any unavailable check explicitly. If no PR or Sonar CLI authentication is available, stop at the prerequisite and explain what is needed; do not guess from a main-branch analysis.
