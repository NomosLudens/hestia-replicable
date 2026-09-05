// Chama Local — plano/status de backups (stub honesto).
// Héstia não faz backup nenhum ainda — apenas retorna verdade.

export function getBackupsPlan() {
  return {
    status: "planned",
    description: "Subsistema de backup ainda não implementado",
    jobs: [],
    lastRun: null,
  };
}
