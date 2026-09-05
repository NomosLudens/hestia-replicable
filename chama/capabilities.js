// Chama Local — capabilities estáticas do console puro do notebook.

export function getCapabilities() {
  return {
    reading: {
      health: true,
      metrics: true,
      events: true,
      snapshots: true,
      logs: true,
      config: true,
    },
    writing: {
      executeCommands: false,
      configureServices: false,
      manageBackups: false,
      modifyStorage: false,
      manageUsers: false,
    },
    mode: "tvbox-console",
  };
}
