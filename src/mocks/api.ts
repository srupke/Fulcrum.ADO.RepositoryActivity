// Mock for azure-devops-extension-api — used by webpack-dev-server in mock mode.
import { mockGitClient } from "./git-client";
import { mockCoreClient } from "./core-client";

// Route to the correct mock based on the client class name.
export function getClient(clientClass: any): any {
  if (clientClass?.name === "CoreRestClient") return mockCoreClient;
  return mockGitClient;
}
