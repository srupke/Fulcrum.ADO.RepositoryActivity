// Mock for azure-devops-extension-api — used by webpack-dev-server in mock mode.
import { mockGitClient } from "./git-client";

// The real getClient() takes a client class and returns an instance.
// In mock mode we ignore the class and always return our mock.
export function getClient(_clientClass: any): any {
  return mockGitClient;
}
