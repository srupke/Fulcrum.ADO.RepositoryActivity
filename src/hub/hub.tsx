import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import ReactDOM from "react-dom";
import * as SDK from "azure-devops-extension-sdk";
import { getClient } from "azure-devops-extension-api";
import {
  GitRestClient,
  GitRepository,
  GitCommitRef,
  GitQueryCommitsCriteria,
  GitVersionType,
  GitVersionOptions,
  GitRefUpdate,
  PullRequestStatus,
  GitPullRequestSearchCriteria,
} from "azure-devops-extension-api/Git";
import { Page } from "azure-devops-ui/Page";
import { Header, TitleSize } from "azure-devops-ui/Header";
import { Card } from "azure-devops-ui/Card";
import {
  Table,
  ITableColumn,
  SimpleTableCell,
  TwoLineTableCell,
  SortOrder,
  ColumnSorting,
} from "azure-devops-ui/Table";
import { ArrayItemProvider } from "azure-devops-ui/Utilities/Provider";
import { TextField, TextFieldWidth } from "azure-devops-ui/TextField";
import { Button } from "azure-devops-ui/Button";
import { Checkbox } from "azure-devops-ui/Checkbox";
import { Spinner, SpinnerSize } from "azure-devops-ui/Spinner";
import "azure-devops-ui/Core/override.css";
import "./hub.scss";

interface RepoActivity {
  repo: GitRepository;
  commits: GitCommitRef[];
  prCount?: number;
  isLocked?: boolean;
  error?: string;
}

interface SortState {
  colId: string;
  order: SortOrder;
}

type LockStatus = "locking" | "error";
type UnlockStatus = "unlocking" | "error";
type BranchCreateStatus = "checking" | "creating" | "created" | "exists" | "error";

const DEFAULT_PROJECT = "MyProject";
const DEFAULT_DAYS = 14;

function toInputDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function getDefaultSinceDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - DEFAULT_DAYS);
  return toInputDate(d);
}

function formatDateTime(date: Date | undefined): string {
  if (!date) return "";
  return (
    date.toLocaleDateString() +
    " " +
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

function branchName(repo: GitRepository): string {
  return repo.defaultBranch?.replace("refs/heads/", "") || "main";
}

const Hub: React.FC = () => {
  const [project, setProject] = useState(DEFAULT_PROJECT);
  const [sinceDate, setSinceDate] = useState(getDefaultSinceDate);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [repoActivity, setRepoActivity] = useState<RepoActivity[]>([]);
  const [totalRepos, setTotalRepos] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Selection & lock state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lockStatuses, setLockStatuses] = useState<Record<string, LockStatus>>({});
  const [locking, setLocking] = useState(false);

  // Unlock state
  const [unlockStatuses, setUnlockStatuses] = useState<Record<string, UnlockStatus>>({});
  const [unlocking, setUnlocking] = useState(false);

  // Actions dropdown / modal
  const [actionsOpen, setActionsOpen] = useState(false);
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  // Branch creation state
  const [newBranchName, setNewBranchName] = useState("");
  const [branchCreating, setBranchCreating] = useState(false);
  const [branchStatuses, setBranchStatuses] = useState<Record<string, BranchCreateStatus>>({});

  // Sort state
  const [sortState, setSortState] = useState<SortState | null>(null);

  useEffect(() => {
    SDK.init({ loaded: false }).then(async () => {
      await SDK.ready();
      SDK.notifyLoadSucceeded();
    });
  }, []);

  const scan = useCallback(async () => {
    const trimmedProject = project.trim();
    if (!trimmedProject || !sinceDate) return;

    setLoading(true);
    setErrorMsg(null);
    setScanned(false);
    setTotalRepos(0);
    setSelectedIds(new Set());
    setLockStatuses({});
    setUnlockStatuses({});
    setBranchStatuses({});

    try {
      const gitClient = getClient(GitRestClient);
      const repos = await gitClient.getRepositories(trimmedProject);
      setTotalRepos(repos.length);

      // Parse the local date at midnight to avoid timezone shifts
      const [year, month, day] = sinceDate.split("-").map(Number);
      const since = new Date(year, month - 1, day, 0, 0, 0, 0);

      const results = await Promise.all(
        repos.map(async (repo): Promise<RepoActivity> => {
          try {
            const branch = branchName(repo);
            const criteria = {
              fromDate: since.toISOString(),
              $top: 500,
              itemVersion: {
                version: branch,
                versionType: GitVersionType.Branch,
                versionOptions: GitVersionOptions.None,
              },
            } as GitQueryCommitsCriteria;
            const [commits, refs, pullRequests] = await Promise.all([
              gitClient.getCommits(repo.id!, criteria, trimmedProject),
              gitClient.getRefs(repo.id!, trimmedProject, `heads/${branch}`).catch(() => []),
              gitClient.getPullRequests(
                repo.id!,
                {
                  status: PullRequestStatus.Active,
                  targetRefName: repo.defaultBranch,
                } as GitPullRequestSearchCriteria,
                trimmedProject
              ).catch(() => []),
            ]);
            const ref = (refs as any[]).find((r: any) => r.name === `refs/heads/${branch}`);
            return { repo, commits, prCount: pullRequests.length, isLocked: ref?.isLocked };
          } catch (e: any) {
            return { repo, commits: [], error: e.message };
          }
        })
      );

      const withChanges = results
        .filter((r) => r.commits.length > 0)
        .sort((a, b) => {
          const aDate = a.commits[0]?.committer?.date;
          const bDate = b.commits[0]?.committer?.date;
          if (!aDate && !bDate) return 0;
          if (!aDate) return 1;
          if (!bDate) return -1;
          return bDate.getTime() - aDate.getTime();
        });

      setRepoActivity(withChanges);
      setScanned(true);
    } catch (e: any) {
      setErrorMsg(
        e.message ||
          "Failed to scan repositories. Verify the project name and that you have access."
      );
    } finally {
      setLoading(false);
    }
  }, [project, sinceDate]);

  // ── Sort ──────────────────────────────────────────────────────────────────────

  // Column index → colId mapping (must match the columns array order below)
  const SORT_COLS = ["", "name", "branch", "commits", "prs", "lastCommit", "", ""];

  const handleSortRef = useRef<(colIdx: number, order: SortOrder) => void>(() => {});
  handleSortRef.current = (colIdx, proposedOrder) => {
    const colId = SORT_COLS[colIdx];
    if (colId) setSortState({ colId, order: proposedOrder });
  };

  // Stable behavior instance — delegate always calls current ref to avoid stale closure
  const sortingBehavior = useMemo(
    () => [new ColumnSorting<RepoActivity>((idx, order) => handleSortRef.current(idx, order))],
    []
  );

  const displayItems = useMemo(() => {
    if (!sortState) return repoActivity;
    const sorted = [...repoActivity];
    const dir = sortState.order === SortOrder.ascending ? 1 : -1;
    sorted.sort((a, b) => {
      switch (sortState.colId) {
        case "name":
          return dir * (a.repo.name || "").localeCompare(b.repo.name || "");
        case "branch":
          return dir * branchName(a.repo).localeCompare(branchName(b.repo));
        case "commits":
          return dir * (a.commits.length - b.commits.length);
        case "prs":
          return dir * ((a.prCount ?? 0) - (b.prCount ?? 0));
        case "lastCommit": {
          const aT = a.commits[0]?.committer?.date?.getTime() ?? 0;
          const bT = b.commits[0]?.committer?.date?.getTime() ?? 0;
          return dir * (aT - bT);
        }
        default:
          return 0;
      }
    });
    return sorted;
  }, [repoActivity, sortState]);

  // ── Selection ─────────────────────────────────────────────────────────────────

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(
    (currentlyAllSelected: boolean) => {
      if (currentlyAllSelected) {
        setSelectedIds(new Set());
      } else {
        setSelectedIds(new Set(repoActivity.map((r) => r.repo.id!)));
      }
    },
    [repoActivity]
  );

  const allSelected =
    repoActivity.length > 0 && selectedIds.size === repoActivity.length;

  // ── Lock ──────────────────────────────────────────────────────────────────────

  const handleLock = useCallback(async () => {
    const toLock = repoActivity.filter((r) => selectedIds.has(r.repo.id!));
    if (toLock.length === 0) return;

    const branchList = toLock
      .map((r) => `  • ${r.repo.name}  (${branchName(r.repo)})`)
      .join("\n");

    const confirmed = window.confirm(
      `Lock default branch on ${toLock.length} ${toLock.length === 1 ? "repository" : "repositories"}?\n\n` +
        branchList +
        "\n\nDirect pushes will be blocked. Branches can be unlocked at any time."
    );
    if (!confirmed) return;

    setLocking(true);
    const gitClient = getClient(GitRestClient);
    const trimmedProject = project.trim();

    await Promise.all(
      toLock.map(async (activity) => {
        const id = activity.repo.id!;
        const branch = branchName(activity.repo);
        setLockStatuses((prev) => ({ ...prev, [id]: "locking" }));
        try {
          await gitClient.updateRef(
            {
              isLocked: true,
              name: activity.repo.defaultBranch,
              newObjectId: activity.commits[0]?.commitId || "",
              oldObjectId: activity.commits[0]?.commitId || "",
              repositoryId: id,
            } as GitRefUpdate,
            id,
            `heads/${branch}`,
            trimmedProject
          );
          setRepoActivity((prev) =>
            prev.map((a) => (a.repo.id === id ? { ...a, isLocked: true } : a))
          );
          setLockStatuses((prev) => { const next = { ...prev }; delete next[id]; return next; });
        } catch {
          setLockStatuses((prev) => ({ ...prev, [id]: "error" }));
        }
      })
    );

    setLocking(false);
  }, [repoActivity, selectedIds, project]);

  // ── Unlock ────────────────────────────────────────────────────────────────────

  const handleUnlock = useCallback(async () => {
    const toUnlock = repoActivity.filter((r) => selectedIds.has(r.repo.id!));
    if (toUnlock.length === 0) return;

    const branchList = toUnlock
      .map((r) => `  • ${r.repo.name}  (${branchName(r.repo)})`)
      .join("\n");

    const confirmed = window.confirm(
      `Unlock default branch on ${toUnlock.length} ${toUnlock.length === 1 ? "repository" : "repositories"}?\n\n` +
        branchList +
        "\n\nDirect pushes will be allowed again."
    );
    if (!confirmed) return;

    setUnlocking(true);
    const gitClient = getClient(GitRestClient);
    const trimmedProject = project.trim();

    await Promise.all(
      toUnlock.map(async (activity) => {
        const id = activity.repo.id!;
        const branch = branchName(activity.repo);
        setUnlockStatuses((prev) => ({ ...prev, [id]: "unlocking" }));
        try {
          await gitClient.updateRef(
            {
              isLocked: false,
              name: activity.repo.defaultBranch,
              newObjectId: activity.commits[0]?.commitId || "",
              oldObjectId: activity.commits[0]?.commitId || "",
              repositoryId: id,
            } as GitRefUpdate,
            id,
            `heads/${branch}`,
            trimmedProject
          );
          setRepoActivity((prev) =>
            prev.map((a) => (a.repo.id === id ? { ...a, isLocked: false } : a))
          );
          setUnlockStatuses((prev) => { const next = { ...prev }; delete next[id]; return next; });
        } catch {
          setUnlockStatuses((prev) => ({ ...prev, [id]: "error" }));
        }
      })
    );

    setUnlocking(false);
  }, [repoActivity, selectedIds, project]);

  // Close actions dropdown on outside click
  useEffect(() => {
    if (!actionsOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [actionsOpen]);

  // ── Create Branch ─────────────────────────────────────────────────────────────

  const handleCreateBranch = useCallback(async () => {
    const trimmedBranch = newBranchName.trim();
    if (!trimmedBranch || selectedIds.size === 0) return;

    if (!/^[a-zA-Z0-9._\-/]+$/.test(trimmedBranch)) {
      alert(
        "Invalid branch name. Use letters, numbers, dots, hyphens, underscores, or slashes."
      );
      return;
    }

    const toProcess = repoActivity.filter((r) => selectedIds.has(r.repo.id!));
    setBranchCreating(true);
    const gitClient = getClient(GitRestClient);
    const trimmedProject = project.trim();

    // Check which selected repos already have this branch
    const existsResults = await Promise.all(
      toProcess.map(async (activity) => {
        const id = activity.repo.id!;
        setBranchStatuses((prev) => ({ ...prev, [id]: "checking" }));
        try {
          const refs = await gitClient.getRefs(
            id,
            trimmedProject,
            `heads/${trimmedBranch}`
          );
          const exactMatch = (refs as any[]).some(
            (r) => r.name === `refs/heads/${trimmedBranch}`
          );
          return { id, exists: exactMatch };
        } catch {
          return { id, exists: false };
        }
      })
    );

    const conflicts = existsResults.filter((r) => r.exists);
    const toCreate = existsResults.filter((r) => !r.exists);

    if (conflicts.length > 0) {
      const conflictList = toProcess
        .filter((a) => conflicts.some((c) => c.id === a.repo.id!))
        .map((a) => `  • ${a.repo.name}`)
        .join("\n");

      if (toCreate.length === 0) {
        alert(
          `Branch "${trimmedBranch}" already exists in all selected repositories:\n\n${conflictList}`
        );
        conflicts.forEach(({ id }) =>
          setBranchStatuses((prev) => ({ ...prev, [id]: "exists" }))
        );
        setBranchCreating(false);
        return;
      }

      const createList = toProcess
        .filter((a) => toCreate.some((c) => c.id === a.repo.id!))
        .map((a) => `  • ${a.repo.name}`)
        .join("\n");

      const confirmed = window.confirm(
        `Branch "${trimmedBranch}" already exists in ${conflicts.length} ${
          conflicts.length === 1 ? "repository" : "repositories"
        }:\n\n${conflictList}\n\n` +
          `Create in the remaining ${toCreate.length} ${
            toCreate.length === 1 ? "repository" : "repositories"
          }?\n\n${createList}`
      );

      conflicts.forEach(({ id }) =>
        setBranchStatuses((prev) => ({ ...prev, [id]: "exists" }))
      );

      if (!confirmed) {
        toCreate.forEach(({ id }) =>
          setBranchStatuses((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          })
        );
        setBranchCreating(false);
        return;
      }
    }

    // Create the branch from each repo's latest commit
    await Promise.all(
      toCreate.map(async ({ id }) => {
        const activity = toProcess.find((a) => a.repo.id === id)!;
        const headSha = activity.commits[0]?.commitId || "";
        setBranchStatuses((prev) => ({ ...prev, [id]: "creating" }));
        try {
          await gitClient.updateRef(
            {
              name: `refs/heads/${trimmedBranch}`,
              newObjectId: headSha,
              oldObjectId: "0000000000000000000000000000000000000000",
              repositoryId: id,
            } as GitRefUpdate,
            id,
            `heads/${trimmedBranch}`,
            trimmedProject
          );
          setBranchStatuses((prev) => ({ ...prev, [id]: "created" }));
        } catch {
          setBranchStatuses((prev) => ({ ...prev, [id]: "error" }));
        }
      })
    );

    setBranchCreating(false);
  }, [repoActivity, selectedIds, newBranchName, project]);

  // ── Export ────────────────────────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    const items =
      selectedIds.size > 0
        ? repoActivity.filter((r) => selectedIds.has(r.repo.id!))
        : repoActivity;

    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;

    const headers = [
      "Repository",
      "Default Branch",
      "URL",
      "Commits",
      "Last Commit Date",
      "Last Author",
      "Last Commit Message",
    ];

    const rows = items.map((r) => {
      const last = r.commits[0];
      return [
        r.repo.name || "",
        branchName(r.repo),
        r.repo.webUrl || "",
        r.commits.length.toString(),
        last?.committer?.date ? last.committer.date.toISOString() : "",
        last?.author?.name || "",
        last?.comment?.split("\n")[0] || "",
      ].map(esc);
    });

    const csv = [
      headers.map(esc).join(","),
      ...rows.map((r) => r.join(",")),
    ].join("\n");

    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `repo-activity-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [repoActivity, selectedIds]);

  // ── Columns ───────────────────────────────────────────────────────────────────

  const columns: ITableColumn<RepoActivity>[] = [
    {
      id: "select",
      name: "",
      // renderHeaderCell must return a <th> with col-header-N class — the Table uses it
      // directly in the <tr>; a <div> would be foster-parented out by the browser.
      renderHeaderCell: (columnIndex) => (
        <th
          key={`col-header-${columnIndex}`}
          className={`bolt-table-header-cell col-header-${columnIndex}`}
          data-column-index={columnIndex}
          aria-colindex={columnIndex + 1}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="header-checkbox">
            <Checkbox
              checked={allSelected}
              onChange={() => handleSelectAll(allSelected)}
              label=""
            />
          </div>
        </th>
      ),
      renderCell: (_rowIndex, columnIndex, tableColumn, item) => (
        <SimpleTableCell
          key={`col-${columnIndex}`}
          columnIndex={columnIndex}
          tableColumn={tableColumn}
        >
          <Checkbox
            checked={selectedIds.has(item.repo.id!)}
            onChange={() => toggleSelect(item.repo.id!)}
            label=""
          />
        </SimpleTableCell>
      ),
      width: -4,
    },
    {
      id: "name",
      name: "Repository",
      sortProps: { sortOrder: sortState?.colId === "name" ? sortState.order : undefined },
      renderCell: (_rowIndex, columnIndex, tableColumn, item) => (
        <SimpleTableCell
          key={`col-${columnIndex}`}
          columnIndex={columnIndex}
          tableColumn={tableColumn}
        >
          <a
            href={`${item.repo.webUrl}?version=GB${branchName(item.repo)}`}
            target="_blank"
            rel="noreferrer"
            className="repo-link bolt-link"
          >
            {item.repo.name}
          </a>
        </SimpleTableCell>
      ),
      width: -22,
    },
    {
      id: "branch",
      name: "Default Branch",
      sortProps: { sortOrder: sortState?.colId === "branch" ? sortState.order : undefined },
      renderCell: (_rowIndex, columnIndex, tableColumn, item) => (
        <SimpleTableCell
          key={`col-${columnIndex}`}
          columnIndex={columnIndex}
          tableColumn={tableColumn}
        >
          <span className="branch-badge">{branchName(item.repo)}</span>
        </SimpleTableCell>
      ),
      width: -13,
    },
    {
      id: "commits",
      name: "Commits",
      sortProps: { sortOrder: sortState?.colId === "commits" ? sortState.order : undefined },
      renderCell: (_rowIndex, columnIndex, tableColumn, item) => (
        <SimpleTableCell
          key={`col-${columnIndex}`}
          columnIndex={columnIndex}
          tableColumn={tableColumn}
        >
          <span className="commit-count">
            {item.commits.length}
            {item.commits.length === 500 ? "+" : ""}
          </span>
        </SimpleTableCell>
      ),
      width: -8,
    },
    {
      id: "prs",
      name: "Open PRs",
      sortProps: { sortOrder: sortState?.colId === "prs" ? sortState.order : undefined },
      renderCell: (_rowIndex, columnIndex, tableColumn, item) => (
        <SimpleTableCell
          key={`col-${columnIndex}`}
          columnIndex={columnIndex}
          tableColumn={tableColumn}
        >
          {item.prCount ? (
            <a
              href={`${item.repo.webUrl}/pullrequests?_a=active&targetRefName=refs%2Fheads%2F${branchName(item.repo)}`}
              target="_blank"
              rel="noreferrer"
              className="pr-count pr-count--active"
            >
              {item.prCount}
            </a>
          ) : (
            <span className="pr-count">—</span>
          )}
        </SimpleTableCell>
      ),
      width: -8,
    },
    {
      id: "lastCommit",
      name: "Last Commit",
      sortProps: { sortOrder: sortState?.colId === "lastCommit" ? sortState.order : undefined },
      renderCell: (_rowIndex, columnIndex, tableColumn, item) => {
        const last = item.commits[0];
        return (
          <TwoLineTableCell
            key={`col-${columnIndex}`}
            columnIndex={columnIndex}
            tableColumn={tableColumn}
            line1={<span>{formatDateTime(last?.committer?.date)}</span>}
            line2={
              <span className="secondary-text">{last?.author?.name || ""}</span>
            }
          />
        );
      },
      width: -20,
    },
    {
      id: "message",
      name: "Last Commit Message",
      renderCell: (_rowIndex, columnIndex, tableColumn, item) => {
        const last = item.commits[0];
        const msg = last?.comment?.split("\n")[0] || "";
        return (
          <SimpleTableCell
            key={`col-${columnIndex}`}
            columnIndex={columnIndex}
            tableColumn={tableColumn}
          >
            <span className="commit-message" title={last?.comment || ""}>
              {msg}
            </span>
          </SimpleTableCell>
        );
      },
      width: -16,
    },
    {
      id: "status",
      name: "",
      renderCell: (_rowIndex, columnIndex, tableColumn, item) => {
        const lockSt = lockStatuses[item.repo.id!];
        const unlockSt = unlockStatuses[item.repo.id!];
        const branchSt = branchStatuses[item.repo.id!];
        return (
          <SimpleTableCell
            key={`col-${columnIndex}`}
            columnIndex={columnIndex}
            tableColumn={tableColumn}
          >
            <div className="status-cell">
              {lockSt === "locking" && <Spinner size={SpinnerSize.small} />}
              {lockSt === "error" && (
                <span className="lock-error" title="Lock failed — check permissions">⚠</span>
              )}
              {unlockSt === "unlocking" && <Spinner size={SpinnerSize.small} />}
              {unlockSt === "error" && (
                <span className="lock-error" title="Unlock failed — check permissions">⚠</span>
              )}
              {!lockSt && !unlockSt && item.isLocked === true && (
                <span className="lock-icon" title="Branch is locked">🔒</span>
              )}
              {!lockSt && !unlockSt && item.isLocked === false && (
                <span className="unlock-icon" title="Branch is unlocked">🔓</span>
              )}
              {(branchSt === "checking" || branchSt === "creating") && (
                <Spinner size={SpinnerSize.small} />
              )}
              {branchSt === "created" && (
                <span className="branch-created-icon" title="Branch created">✔</span>
              )}
              {branchSt === "exists" && (
                <span className="branch-exists-icon" title="Branch already exists — skipped">⊘</span>
              )}
              {branchSt === "error" && (
                <span className="lock-error" title="Branch creation failed — check permissions">⚠</span>
              )}
            </div>
          </SimpleTableCell>
        );
      },
      width: -9,
    },
  ];

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <Page className="hub-page">
      <Header
        title="Repository Activity"
        titleSize={TitleSize.Large}
        description="Repositories with commits to the default branch since the selected date"
      />

      <div className="hub-content">
        <Card className="settings-card">
          <div className="scan-controls">
            <div className="control-group">
              <label className="control-label">Project</label>
              <TextField
                value={project}
                onChange={(_, v) => setProject(v)}
                placeholder="e.g. MyProject"
                width={TextFieldWidth.standard}
              />
            </div>
            <div className="control-group">
              <label className="control-label">Since Date</label>
              <input
                type="date"
                value={sinceDate}
                onChange={(e) => setSinceDate(e.target.value)}
                className="date-input"
                max={toInputDate(new Date())}
              />
            </div>
            <div className="control-group control-group--action">
              <Button
                text="Scan Repositories"
                primary={true}
                onClick={scan}
                disabled={loading || !project.trim() || !sinceDate}
              />
            </div>
          </div>
        </Card>

        {errorMsg && (
          <div className="error-banner">
            <span className="error-icon">⚠</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {loading && (
          <div className="loading-container">
            <Spinner
              size={SpinnerSize.large}
              label={
                totalRepos > 0
                  ? `Scanning ${totalRepos} repositories...`
                  : "Loading repositories..."
              }
            />
          </div>
        )}

        {scanned && !loading && (
          <>
            <div className="results-toolbar">
              <div className="results-stats">
                <span className="results-headline">Repositories</span>
                <span className="results-stat">Scanned: <strong>{totalRepos}</strong></span>
                <span className="results-stat">With Changes: <strong>{repoActivity.length}</strong></span>
              </div>
              {repoActivity.length > 0 && (
                <div className="results-actions">
                  <div className="actions-dropdown" ref={actionsRef}>
                    <Button
                      text="Actions"
                      onClick={() => setActionsOpen((o) => !o)}
                      disabled={selectedIds.size === 0 || locking || unlocking || branchCreating}
                    />
                    {actionsOpen && (
                      <div className="actions-menu">
                        <button
                          className="actions-menu-item"
                          onClick={() => { setActionsOpen(false); handleLock(); }}
                        >
                          Lock Repository
                        </button>
                        <button
                          className="actions-menu-item"
                          onClick={() => { setActionsOpen(false); handleUnlock(); }}
                        >
                          Unlock Repository
                        </button>
                        <button
                          className="actions-menu-item"
                          onClick={() => { setActionsOpen(false); setBranchModalOpen(true); }}
                        >
                          Create Branch
                        </button>
                      </div>
                    )}
                  </div>
                  <Button
                    text={selectedIds.size > 0 ? "Export Selected" : "Export All"}
                    onClick={handleExport}
                  />
                  {selectedIds.size > 0 && (
                    <span className="selection-count">
                      {allSelected
                        ? `All ${repoActivity.length} selected`
                        : `${selectedIds.size} of ${repoActivity.length} selected`}
                    </span>
                  )}
                </div>
              )}
            </div>

            {repoActivity.length === 0 ? (
              <Card>
                <div className="no-results">
                  <p>
                    No repositories have commits to their default branch since{" "}
                    <strong>{sinceDate}</strong>.
                  </p>
                </div>
              </Card>
            ) : (
              <Card className="results-card">
                <Table<RepoActivity>
                  columns={columns}
                  itemProvider={new ArrayItemProvider(displayItems)}
                  behaviors={sortingBehavior}
                  role="table"
                  ariaLabel="Repository activity results"
                />
              </Card>
            )}
          </>
        )}
      </div>

      {branchModalOpen && (
        <div className="modal-overlay" onClick={() => setBranchModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Create Branch</span>
              <button className="modal-close" onClick={() => setBranchModalOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <label className="control-label">Branch Name</label>
              <input
                type="text"
                className="branch-name-input"
                placeholder="e.g. feature/my-branch"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newBranchName.trim()) {
                    setBranchModalOpen(false);
                    handleCreateBranch();
                  } else if (e.key === "Escape") {
                    setBranchModalOpen(false);
                  }
                }}
                autoFocus
              />
              <p className="modal-hint">
                Branch will be created from the latest commit in each of the{" "}
                {selectedIds.size} selected {selectedIds.size === 1 ? "repository" : "repositories"}.
              </p>
            </div>
            <div className="modal-footer">
              <Button text="Cancel" onClick={() => setBranchModalOpen(false)} />
              <Button
                text="Create Branch"
                primary={true}
                onClick={() => { setBranchModalOpen(false); handleCreateBranch(); }}
                disabled={!newBranchName.trim()}
              />
            </div>
          </div>
        </div>
      )}
    </Page>
  );
};

SDK.init({ loaded: false });
ReactDOM.render(<Hub />, document.getElementById("root"));
