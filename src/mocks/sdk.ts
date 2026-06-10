// Mock for azure-devops-extension-sdk — used by webpack-dev-server in mock mode.
// All methods no-op or immediately resolve so the component initialises normally.

export function init(_options?: { loaded?: boolean }): Promise<void> {
  return Promise.resolve();
}

export function ready(): Promise<void> {
  return Promise.resolve();
}

export function notifyLoadSucceeded(): void {}

export function notifyLoadFailed(_e: Error): void {}

export function getHost() {
  return { id: "mock-host", name: "CredibleBH", type: 1 };
}

export function getWebContext() {
  return {
    account: { id: "mock", name: "CredibleBH" },
    project: { id: "mock-project", name: "Credible" },
    user: { id: "mock-user", name: "Dev User" },
  };
}
