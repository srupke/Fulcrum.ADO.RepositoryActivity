// Mock GitRestClient data — realistic enough to exercise every table column.

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function commit(
  id: string,
  message: string,
  authorName: string,
  daysBack: number
) {
  const date = daysAgo(daysBack);
  return {
    commitId: id,
    comment: message,
    author: { name: authorName, email: `${authorName.toLowerCase().replace(" ", ".")}@example.com`, date },
    committer: { name: authorName, email: `${authorName.toLowerCase().replace(" ", ".")}@example.com`, date },
    url: "#",
  };
}

const REPOS = [
  { id: "r1", name: "web-app",          defaultBranch: "refs/heads/main",    webUrl: "#" },
  { id: "r2", name: "api-service",      defaultBranch: "refs/heads/main",    webUrl: "#" },
  { id: "r3", name: "mobile-client",    defaultBranch: "refs/heads/develop", webUrl: "#" },
  { id: "r4", name: "data-pipeline",    defaultBranch: "refs/heads/main",    webUrl: "#" },
  { id: "r5", name: "shared-lib",       defaultBranch: "refs/heads/master",  webUrl: "#" },
  { id: "r6", name: "devops-scripts",   defaultBranch: "refs/heads/main",    webUrl: "#" },
  { id: "r7", name: "legacy-billing",   defaultBranch: "refs/heads/master",  webUrl: "#" },
  { id: "r8", name: "documentation",    defaultBranch: "refs/heads/main",    webUrl: "#" },
  { id: "r9", name: "auth-service",     defaultBranch: "refs/heads/main",    webUrl: "#" },
];

// Branches per repo — used by getRefs to simulate pre-existing branches.
const BRANCHES: Record<string, string[]> = {
  r1: ["main", "develop", "release/v2.0"],
  r2: ["main", "develop"],
  r3: ["develop", "feature/offline-mode"],
  r4: ["main"],
  r5: ["master", "feature/datepicker"],
  r6: ["main"],
  r7: ["master"],
  r8: ["main"],
  r9: ["main", "hotfix/jwt-patch"],
};

// Repos whose default branch starts locked in the mock environment.
const LOCKED_BRANCHES = new Set(["r2:main", "r5:master"]);

// Open PR counts per repo targeting the default branch.
const OPEN_PRS: Record<string, number> = {
  r1: 3,
  r2: 1,
  r3: 5,
  r4: 0,
  r5: 2,
  r6: 0,
  r7: 0,
  r8: 0,
  r9: 4,
};

// Commits per repo — repos r7 and r8 have none so they're filtered out.
const COMMITS: Record<string, ReturnType<typeof commit>[]> = {
  r1: [
    commit("a1b2c3", "feat: add dashboard filters for date range", "Alice Johnson", 1),
    commit("a1b2c4", "fix: correct timezone handling in report export", "Bob Smith", 3),
    commit("a1b2c5", "chore: update dependencies", "Alice Johnson", 5),
    commit("a1b2c6", "feat: new notification panel", "Carol White", 7),
    commit("a1b2c7", "fix: memory leak in real-time feed", "Bob Smith", 10),
  ],
  r2: [
    commit("b1c2d3", "feat: add /v2/reports endpoint with pagination", "Bob Smith", 2),
    commit("b1c2d4", "fix: rate limiter not resetting after window expiry", "Dave Brown", 4),
    commit("b1c2d5", "refactor: extract auth middleware into shared package", "Alice Johnson", 6),
    commit("b1c2d6", "test: add integration tests for billing module", "Dave Brown", 9),
  ],
  r3: [
    commit("c1d2e3", "feat: offline mode with local cache", "Carol White", 1),
    commit("c1d2e4", "fix: crash on iOS 17 when backgrounding app", "Eve Davis", 3),
  ],
  r4: [
    commit("d1e2f3", "chore: bump Spark version to 3.5.1", "Dave Brown", 8),
    commit("d1e2f4", "fix: duplicate records in nightly ETL run", "Alice Johnson", 11),
    commit("d1e2f5", "feat: add S3 sink for processed events", "Dave Brown", 13),
  ],
  r5: [
    commit("e1f2g3", "feat: add DateRangePicker component", "Eve Davis", 0),
    commit("e1f2g4", "fix: type narrowing in useAsync hook", "Carol White", 2),
    commit("e1f2g5", "docs: update component API reference", "Eve Davis", 4),
  ],
  r6: [
    commit("f1g2h3", "ci: parallelize test matrix across 4 agents", "Bob Smith", 5),
    commit("f1g2h4", "chore: rotate service principal credentials", "Bob Smith", 12),
  ],
  r7: [], // no recent commits — will be filtered out
  r8: [], // no recent commits — will be filtered out
  r9: [
    commit("i1j2k3", "feat: OIDC provider support for SSO", "Alice Johnson", 2),
    commit("i1j2k4", "security: patch JWT validation bypass (CVE-2024-1234)\n\nThis commit patches a critical vulnerability where crafted JWTs could\nbypass expiry validation. All tokens issued before this commit should\nbe considered potentially compromised.", "Dave Brown", 6),
  ],
};

export const mockGitClient = {
  getRepositories: async (_project: string) => {
    await delay(400);
    return REPOS;
  },

  getCommits: async (repoId: string, _criteria: any, _project: string) => {
    await delay(Math.random() * 300 + 100);
    return COMMITS[repoId] ?? [];
  },

  getRefs: async (repoId: string, _project: string, filter?: string) => {
    await delay(150);
    const branches = BRANCHES[repoId] ?? ["main"];
    const makeRef = (b: string) => ({
      name: `refs/heads/${b}`,
      isLocked: LOCKED_BRANCHES.has(`${repoId}:${b}`),
    });
    if (!filter) return branches.map(makeRef);
    // filter is "heads/<branchname>" — return exact match only
    const name = filter.replace(/^heads\//, "");
    return branches.includes(name) ? [makeRef(name)] : [];
  },

  getPullRequests: async (repoId: string, _criteria: any, _project: string) => {
    await delay(Math.random() * 200 + 100);
    const count = OPEN_PRS[repoId] ?? 0;
    return Array.from({ length: count }, (_, i) => ({ pullRequestId: i + 1 }));
  },

  updateRef: async (newRefInfo: any, _repoId: string, _filter: string, _project: string) => {
    await delay(600 + Math.random() * 600);
    return { ...newRefInfo };
  },
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
