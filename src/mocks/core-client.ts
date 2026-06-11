// Mock CoreRestClient — returns a static project list for dev/mock mode.

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const mockCoreClient = {
  getProjects: async () => {
    await delay(300);
    return [
      { id: "p1", name: "MyProject" },
      { id: "p2", name: "AnotherProject" },
      { id: "p3", name: "DevOps" },
    ];
  },
};
