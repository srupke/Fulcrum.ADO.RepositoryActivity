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
  error?: string;
}

interface SortState {
  colId: string;
  order: SortOrder;
}

type LockStatus = "locking" | "locked" | "error";

const DEFAULT_PROJECT = "Credible";
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
            const commits = await gitClient.getCommits(
              repo.id!,
              criteria,
              trimmedProject
            );
            return { repo, commits };
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
  const SORT_COLS = ["", "name", "branch", "commits", "lastCommit", "", ""];

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
          setLockStatuses((prev) => ({ ...prev, [id]: "locked" }));
        } catch (e: any) {
          setLockStatuses((prev) => ({ ...prev, [id]: "error" }));
        }
      })
    );

    setLocking(false);
  }, [repoActivity, selectedIds, project]);

  // ── Columns ───────────────────────────────────────────────────────────────────

  const columns: ITableColumn<RepoActivity>[] = [
    {
      id: "select",
      name: "",
      // Select-all lives in the column header — renderHeaderCell must return a <th> (not a <div>)
      // because the Table uses the return value directly as the table header cell element.
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
          <a href={item.repo.webUrl} target="_top" className="repo-link bolt-link">
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
      width: -26,
    },
    {
      id: "lockStatus",
      name: "",
      renderCell: (_rowIndex, columnIndex, tableColumn, item) => {
        const status = lockStatuses[item.repo.id!];
        return (
          <SimpleTableCell
            key={`col-${columnIndex}`}
            columnIndex={columnIndex}
            tableColumn={tableColumn}
          >
            {status === "locking" && <Spinner size={SpinnerSize.small} />}
            {status === "locked" && (
              <span className="lock-icon" title="Branch locked">🔒</span>
            )}
            {status === "error" && (
              <span className="lock-error" title="Lock failed — check permissions">⚠</span>
            )}
          </SimpleTableCell>
        );
      },
      width: -7,
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
                placeholder="e.g. Credible"
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
                  <Button
                    text={
                      selectedIds.size > 0
                        ? `Lock ${selectedIds.size} ${selectedIds.size === 1 ? "Branch" : "Branches"}`
                        : "Lock Branches"
                    }
                    onClick={handleLock}
                    disabled={selectedIds.size === 0 || locking}
                    className="lock-button"
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
    </Page>
  );
};

SDK.init({ loaded: false });
ReactDOM.render(<Hub />, document.getElementById("root"));
