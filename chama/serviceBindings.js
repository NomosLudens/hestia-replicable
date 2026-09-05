// Chama Local — vínculos read-only com serviços já existentes na TV Box.
// Não instala, não configura, não inicia/para/reinicia nenhum destes serviços.

export function getServiceBindings() {
  return [
    {
      id: "tailscale",
      serviceName: "tailscaled",
      label: "Tailscale",
      role: "Serviço local observado",
    },
  ];
}

// Versão sanitizada (sem serviceName) para superfícies Presence-safe.
export function getPresenceServiceBindings() {
  return getServiceBindings().map(({ id, label, role }) => ({ id, label, role }));
}
