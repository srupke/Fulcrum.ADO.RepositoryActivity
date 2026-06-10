# Fulcrum Repository Activity

An Azure DevOps extension that adds a **Repo Activity** hub to the Repos section. It shows every repository that has received commits to its default branch since a user-selected date, and provides bulk actions on the results.

---

## Features

### Repository Scanner
- Enter a **project name** and a **since date** (defaults to the last 14 days) and click **Scan Repositories**.
- Results are shown in a sortable table with columns: Repository, Default Branch, Commits, Last Commit (date + author), Last Commit Message.
- All columns except the checkbox and status columns are sortable by clicking the header.

### Bulk Actions (operate on selected rows)
All bulk actions work on the checked rows. Use the checkbox in the column header to select/deselect all.

| Action | Description |
|---|---|
| **Lock Branches** | Sets `isLocked = true` on the default branch of each selected repo. Prevents direct pushes; PRs are unaffected. Locks can be removed at any time in repo settings. |
| **Create Branch** | Type a branch name and click **Create Branch** (or press Enter). The extension checks each selected repo for a pre-existing branch with that name, warns about conflicts, and creates the branch from the tip commit of the default branch in all non-conflicting repos. |
| **Export Selected / Export All** | Downloads a UTF-8 CSV file (`repo-activity-YYYY-MM-DD.csv`) containing the current result set. Exports selected rows when any are checked; exports all results otherwise. |

### Status Column
The rightmost column shows per-row status icons after a bulk action:

| Icon | Meaning |
|---|---|
| 🔒 | Default branch locked |
| ✔ (green) | Branch created successfully |
| ⊘ (gray) | Branch already existed — skipped |
| ⚠ (red) | Operation failed — check permissions |

---

## Local Development

### Prerequisites

```
node >= 18
npm >= 9
```

Install dependencies once:

```bash
npm install
```

### Run with Mock Data (F5 in VS Code)

The project ships with a local mock that replaces the Azure DevOps SDK and API with realistic stub data, so you can develop without a live organization.

Press **F5** in VS Code (or run `npm run dev` in a terminal). The extension opens automatically at `http://localhost:3000/hub/hub.html`.

The mock includes:
- 9 repositories, 7 with recent commits
- Pre-existing branches per repo (useful for testing the Create Branch conflict-detection path — try creating a branch named `develop`)

To start the dev server manually:

```bash
npm run dev          # kills any process on port 3000, then starts webpack-dev-server with mock data
npm start            # equivalent, without the port-kill step
```

### Build

```bash
npm run build        # production build → dist/
npm run build:dev    # development build with source maps → dist/
npm run watch        # development build, rebuild on file change
```

---

## Publishing to the Marketplace

### Prerequisites

**1. Visual Studio Marketplace publisher account**

Create a publisher at [https://marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage). The publisher ID in `vss-extension.json` is currently `my-publisher` — replace it with the ID you register and it must match exactly.

**2. Personal Access Token (PAT)**

In Azure DevOps, create a PAT with the following scope:

- Organization: **All accessible organizations**
- Scope: **Marketplace → Publish**

Copy the token; you will pass it to `tfx` at publish time.

**3. tfx-cli** is already included as a dev dependency (`npm run package` and `npm run publish` use it via `npx`).

---

### Publish as Private (organization-only)

A private extension is only visible to organizations you explicitly share it with. This is the default (`"public": false` in `vss-extension.json`).

**Step 1 — Build and package**

```bash
npm run package
```

This runs `npm run build` followed by `tfx extension create`, producing a `.vsix` file in the `packages/` folder (e.g. `packages/my-publisher.fulcrum-repo-activity-1.0.0.vsix`).

**Step 2 — Publish**

```bash
npx tfx extension publish \
  --manifest-globs vss-extension.json \
  --token <your-PAT>
```

Or using the npm script (builds and publishes in one step — you will be prompted for the PAT interactively):

```bash
npm run publish
```

**Step 3 — Share with your organization**

After publishing, the extension is visible only to you. Share it with your Azure DevOps organization from the Marketplace publisher portal, or via CLI:

```bash
npx tfx extension share \
  --publisher my-publisher \
  --extension-id fulcrum-repo-activity \
  --share-with my-org \
  --token <your-PAT>
```

**Step 4 — Install in the organization**

In the target Azure DevOps organization, go to **Organization Settings → Extensions → Shared** and click **Install** next to the extension.

---

### Publish as Public (available to everyone)

> Public extensions are visible on the Marketplace to any Azure DevOps user. Ensure the extension is production-ready before making it public.

**Step 1 — Set `public: true`**

Edit `vss-extension.json`:

```json
"public": true,
```

**Step 2 — Verify the publisher is verified**

Microsoft requires a verified publisher for public extensions. Submit your publisher for verification at [https://marketplace.visualstudio.com/manage/publishers](https://marketplace.visualstudio.com/manage/publishers). Verification is a manual review process that can take a few days.

**Step 3 — Package and publish**

```bash
npm run package
npx tfx extension publish \
  --manifest-globs vss-extension.json \
  --token <your-PAT>
```

The extension will appear on the public Marketplace after passing Microsoft's automated content scan (usually within minutes for updates, longer for a first-time public publish).

---

### Updating an Existing Extension

Increment the `version` field in `vss-extension.json` (semver), then publish again:

```bash
npm run publish
```

`tfx` will update the existing listing in place. Installed instances in all organizations will be updated automatically by Azure DevOps.

---

### Scopes

The extension declares the `vso.code` scope, which grants read access to repositories and branches. No write scope is needed for scanning; the Lock Branches and Create Branch features use the same scope because branch locking and ref creation are permitted under `vso.code` for users who already have the appropriate repository permissions. If your organization enforces stricter scope policies, add `vso.code_manage` to the `scopes` array in `vss-extension.json`.

---

## Project Structure

```
src/
  hub/
    hub.tsx       # Main React component — all UI and API logic
    hub.scss      # Component styles (CSS custom properties for ADO theming)
    hub.html      # Entry HTML page
  mocks/
    sdk.ts        # Mock Azure DevOps Extension SDK
    api.ts        # Mock getClient() — returns mockGitClient
    git-client.ts # Stub data: repos, commits, branches
scripts/
  dev-start.js   # Kills port 3000, then starts webpack-dev-server
vss-extension.json  # Extension manifest
webpack.config.js   # Webpack 5 config; --env mock enables stub aliases
```

## Tech Stack

| | |
|---|---|
| Framework | React 16 (required by azure-devops-ui v2) |
| UI Components | azure-devops-ui v2 |
| ADO SDK | azure-devops-extension-sdk v4 |
| ADO API | azure-devops-extension-api v4 |
| Bundler | Webpack 5 |
| Language | TypeScript 5 |
