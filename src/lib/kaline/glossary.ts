// Kaline — glossário explicativo do Héstia.
//
// Estes textos ficam no bundle do frontend (Héstia Console) — não contêm
// nenhum segredo. São descrições humanas curtas sobre unidades systemd
// comuns, estados do systemd e tipos de evento do Guardião. O frontend usa
// este glossário para mostrar tooltips e legendas sem precisar consultar o
// agent ou o systemd.
//
// A matching é por prefixo exato + alguns curingas. Quando o nome da
// unidade não bate em nenhuma regra, o consumidor cai para a `description`
// que o próprio systemd devolve (campo `description` do report da Station).

export type ServiceGlossaryEntry = {
  /** Prefixo (exato, sem .service). Igualdade exata também é aceita. */
  match: string;
  /** Título curto (≤ 60 chars) para o cabeçalho do tooltip. */
  title: string;
  /** Descrição humana — 1 a 3 frases. Linguagem direta. */
  description: string;
  /** Categoria opcional, para agrupar na legenda. */
  category:
    | "core"
    | "network"
    | "storage"
    | "io"
    | "security"
    | "observability"
    | "user"
    | "container"
    | "package"
    | "hardware"
    | "scheduler"
    | "hestia"
    | "kaos"
    | "desktop"
    | "other";
};

// Ordem de avaliação: primeira regra que casa vence. Para prefixos
// sobrepostos (ex: systemd-journald vs systemd-journal-flush), coloque o
// mais específico primeiro.
export const SERVICE_GLOSSARY: ServiceGlossaryEntry[] = [
  // ---- core / PID 1 -----------------------------------------------------
  {
    match: "systemd-journal-flush",
    category: "core",
    title: "systemd-journal-flush",
    description: "Joga o journal (log) da RAM para o disco durante o boot. Roda uma vez e sai.",
  },
  {
    match: "systemd-journald",
    category: "core",
    title: "systemd-journald",
    description:
      "Daemon de log do systemd. Coleta mensagens do kernel e dos serviços, mantém o journal estruturado consultável via `journalctl`.",
  },
  {
    match: "systemd-journal-catalog-update",
    category: "core",
    title: "systemd-journal-catalog-update",
    description: "Atualiza o catálogo de mensagens de erro legíveis por humanos no journal.",
  },
  {
    match: "systemd-logind",
    category: "core",
    title: "systemd-logind",
    description:
      "Gerencia sessões de usuário, login/logout, suspensão e os seat managers. É o que 'vê' os usuários sentados.",
  },
  {
    match: "systemd-resolved",
    category: "core",
    title: "systemd-resolved",
    description:
      "Stub de resolução DNS local. Escuta em 127.0.0.53:53 e encaminha DNS para upstream (DHCP, Tailscale, configurado).",
  },
  {
    match: "systemd-timesyncd",
    category: "core",
    title: "systemd-timesyncd",
    description: "Cliente SNTP simples para manter o relógio do sistema sincronizado via NTP.",
  },
  {
    match: "systemd-networkd",
    category: "core",
    title: "systemd-networkd",
    description:
      "Gerencia configuração de rede via arquivos .network. Pode coexistir ou competir com NetworkManager.",
  },
  {
    match: "systemd-udevd",
    category: "core",
    title: "systemd-udevd",
    description:
      "Gerenciador de dispositivos. Reage a hot-plug (USB, rede) e aplica regras de /etc/udev/rules.d.",
  },
  {
    match: "systemd-tmpfiles-setup",
    category: "core",
    title: "systemd-tmpfiles-setup",
    description:
      "Cria/apaga arquivos voláteis sob /run, /tmp conforme /usr/lib/tmpfiles.d. Roda no boot.",
  },
  {
    match: "systemd-update-utmp",
    category: "core",
    title: "systemd-update-utmp",
    description: "Atualiza os registros utmp/wtmp de boot/shutdown (last, who).",
  },
  {
    match: "systemd-user-sessions",
    category: "core",
    title: "systemd-user-sessions",
    description: "Permite/inibe abertura de sessões de usuário conforme /run/systemd/logind.",
  },
  {
    match: "systemd-tmpfiles-clean",
    category: "core",
    title: "systemd-tmpfiles-clean",
    description: "Rotina de limpeza periódica (geralmente diária) dos diretórios voláteis.",
  },
  {
    match: "systemd-random-seed",
    category: "core",
    title: "systemd-random-seed",
    description:
      "Carrega / salva a semente do pool de entropia. Mantém a inicialização do /dev/urandom confiável entre reboots.",
  },
  {
    match: "systemd-remount-fs",
    category: "core",
    title: "systemd-remount-fs",
    description:
      "Remonta os sistemas de arquivo raiz com opções finais (rw, noatime, etc.) depois do early boot.",
  },
  {
    match: "systemd-machine-id-setup",
    category: "core",
    title: "systemd-machine-id-setup",
    description: "Garante que /etc/machine-id existe. Usado pelo journal, DHCP, Tailscale.",
  },
  {
    match: "systemd-sysusers",
    category: "core",
    title: "systemd-sysusers",
    description: "Cria usuários/grupos estáticos descritos em /usr/lib/sysusers.d antes do login.",
  },
  {
    match: "systemd-firstboot",
    category: "core",
    title: "systemd-firstboot",
    description:
      "Permite configurar locale, hostname, senha root na primeira inicialização do sistema.",
  },
  {
    match: "systemd-fsck",
    category: "core",
    title: "systemd-fsck",
    description:
      "Dispara fsck nos sistemas de arquivo marcados em /etc/fstab antes do root ser montado rw.",
  },
  {
    match: "systemd-modules-load",
    category: "core",
    title: "systemd-modules-load",
    description: "Carrega módulos do kernel listados em /etc/modules-load.d.",
  },

  // ---- network ----------------------------------------------------------
  {
    match: "NetworkManager",
    category: "network",
    title: "NetworkManager",
    description:
      "Gerenciador de conexões de rede padrão em distros desktop. Cuida de Wi-Fi, Ethernet, VPN e roteamento.",
  },
  {
    match: "NetworkManager-wait-online",
    category: "network",
    title: "NetworkManager-wait-online",
    description:
      "Bloqueia até NetworkManager obter conectividade. É alvo de Wants= para serviços que precisam de rede no boot.",
  },
  {
    match: "ModemManager",
    category: "network",
    title: "ModemManager",
    description:
      "Daemon para modem 3G/4G/5G. Trabalha em conjunto com NetworkManager para conexões celulares.",
  },
  {
    match: "wpa_supplicant",
    category: "network",
    title: "wpa_supplicant",
    description:
      "Cliente WPA/WPA2/WPA3 para Wi-Fi. O NetworkManager geralmente o orquestra indiretamente.",
  },
  {
    match: "tailscaled",
    category: "network",
    title: "tailscaled",
    description: "Daemon do Tailscale. Mantém a malha WireGuard, MagicDNS e ACLs da tailnet.",
  },
  {
    match: "avahi-daemon",
    category: "network",
    title: "avahi-daemon",
    description:
      "Implementação mDNS/DNS-SD para descoberta local (.local). Pense 'Bonjour do Linux'.",
  },
  {
    match: "ssh",
    category: "network",
    title: "ssh (OpenSSH server)",
    description:
      "Servidor SSH. Permite login remoto. Se você está vendo isto, provavelmente acessou esta máquina por ele.",
  },
  {
    match: "sshd",
    category: "network",
    title: "sshd",
    description:
      "Servidor SSH. Permite login remoto. Se você está vendo isto, provavelmente acessou esta máquina por ele.",
  },
  {
    match: "tor",
    category: "network",
    title: "Tor",
    description:
      "Daemon do Tor. Encaminha tráfego pela rede onion para anonimato. Usado pelo observatório da KAOS.",
  },
  {
    match: "yggdrasil",
    category: "network",
    title: "Yggdrasil",
    description:
      "Overlay IPv6 mesh-based criptografado ponto-a-ponto. Usado por parte da infraestrutura da KAOS para criar uma rede privada fora da internet.",
  },
  {
    match: "systemd-tmpfiles-setup-dev",
    category: "core",
    title: "systemd-tmpfiles-setup-dev",
    description: "Cria /dev/pts, /dev/shm e dispositivos básicos. Pré-requisito do udev.",
  },

  // ---- storage ----------------------------------------------------------
  {
    match: "smbd",
    category: "storage",
    title: "smbd (Samba)",
    description: "Servidor SMB/CIFS para compartilhamento de arquivos com Windows/macOS/Linux.",
  },
  {
    match: "nmbd",
    category: "storage",
    title: "nmbd (NetBIOS)",
    description:
      "Servidor de nomes NetBIOS. Necessário para que o Samba apareça na 'Rede' do Windows.",
  },
  {
    match: "winbind",
    category: "storage",
    title: "winbind",
    description: "Resolve usuários e grupos de domínios Active Directory para o Linux.",
  },

  // ---- io / logs --------------------------------------------------------
  {
    match: "rsyslog",
    category: "io",
    title: "rsyslog",
    description:
      "Syslog tradicional. Pode coexistir com journald encaminhando mensagens via socket imuxsock.",
  },
  {
    match: "auditd",
    category: "security",
    title: "auditd",
    description:
      "Daemon de auditoria do kernel. Registra chamadas de sistema sensíveis para conformidade e forense.",
  },

  // ---- hardware / som ---------------------------------------------------
  {
    match: "alsa-restore",
    category: "hardware",
    title: "alsa-restore",
    description: "Restaura o estado do mixer e volumes de som (ALSA) salvos no último shutdown.",
  },
  {
    match: "alsa-state",
    category: "hardware",
    title: "alsa-state",
    description:
      "Salva o estado do mixer ALSA no shutdown para ser restaurado na próxima inicialização.",
  },
  {
    match: "alsa-utils",
    category: "hardware",
    title: "alsa-utils",
    description: "Utilitários ALSA. Quando 'masked', os helpers alsactl são desabilitados.",
  },
  {
    match: "bluetooth",
    category: "hardware",
    title: "bluetooth",
    description: "Daemon BlueZ para Bluetooth (pairing, áudio, HID).",
  },
  {
    match: "armbian-firstrun",
    category: "hardware",
    title: "armbian-firstrun",
    description:
      "Primeira execução em SBCs Armbian (gera SSH keys, expande partição, configura hostname). Roda uma vez.",
  },
  {
    match: "armbian-hardware-monitor",
    category: "hardware",
    title: "armbian-hardware-monitor",
    description:
      "Monitor de hardware específico da placa (temperatura, fan, LED). Proprietário do Armbian.",
  },
  {
    match: "armbian-disable-autologin",
    category: "hardware",
    title: "armbian-disable-autologin",
    description: "Desliga autologin após o primeiro boot. Roda uma vez e sai.",
  },
  {
    match: "armbian-zram-config",
    category: "hardware",
    title: "armbian-zram-config",
    description:
      "Configura swap/compcache em zram (RAM comprimida em RAM). Comum em SBCs com pouca memória.",
  },

  // ---- security ---------------------------------------------------------
  {
    match: "polkit",
    category: "security",
    title: "polkit",
    description:
      "Framework de autorização para ações privilegiadas de processos não-root. A tela 'autenticar' do GNOME usa isto.",
  },
  {
    match: "firewalld",
    category: "security",
    title: "firewalld",
    description: "Gerenciador de firewall com zonas. Front-end sobre nftables/iptables.",
  },
  {
    match: "ufw",
    category: "security",
    title: "ufw",
    description: "Uncomplicated Firewall — front-end simples para iptables.",
  },
  {
    match: "apparmor",
    category: "security",
    title: "apparmor",
    description: "Mandatory Access Control (MAC) baseado em perfil por processo.",
  },
  {
    match: "fail2ban",
    category: "security",
    title: "fail2ban",
    description: "Ban automático de IPs após N tentativas falhas em sshd/Apache/etc.",
  },
  {
    match: "telegram-guard",
    category: "hestia",
    title: "telegram-guard",
    description:
      "Serviço customizado do Héstia: bot do Telegram que monitora e reporta incidentes.",
  },

  // ---- scheduler / cron -------------------------------------------------
  {
    match: "cron",
    category: "scheduler",
    title: "cron",
    description: "Agendador clássico do Unix. Lê crontabs em /etc/cron.* e /var/spool/cron.",
  },
  {
    match: "anacron",
    category: "scheduler",
    title: "anacron",
    description: "Roda tarefas do cron mesmo que o sistema tenha ficado desligado no horário.",
  },
  {
    match: "logrotate",
    category: "scheduler",
    title: "logrotate",
    description: "Rotaciona, comprime e expira arquivos de log diariamente/semanalmente.",
  },

  // ---- packages / updates ----------------------------------------------
  {
    match: "apt-daily",
    category: "package",
    title: "apt-daily",
    description: "Atualiza a lista de pacotes do APT (apt-get update). Roda diariamente via timer.",
  },
  {
    match: "apt-daily-upgrade",
    category: "package",
    title: "apt-daily-upgrade",
    description: "Roda unattended-upgrades diariamente para aplicar patches de segurança.",
  },
  {
    match: "unattended-upgrades",
    category: "package",
    title: "unattended-upgrades",
    description:
      "Atualiza pacotes automaticamente (sem interação) seguindo regras em /etc/apt/apt.conf.d.",
  },
  {
    match: "packagekit",
    category: "package",
    title: "packagekit",
    description: "Abstração de gerenciador de pacotes usada por GNOME Software, KDE Discover etc.",
  },
  {
    match: "snapd",
    category: "package",
    title: "snapd",
    description: "Daemon para pacotes snap. Mantém updates automáticas em background.",
  },
  {
    match: "fwupd",
    category: "package",
    title: "fwupd",
    description:
      "Atualizador de firmware via LVFS. Atualiza BIOS/SSD/controladores por update automático.",
  },

  // ---- observability / dashboard ---------------------------------------
  {
    match: "jellyfin",
    category: "observability",
    title: "jellyfin",
    description:
      "Servidor de mídia (filmes, séries, música) livre, sem tracking. Alternativa ao Plex/Emby.",
  },
  {
    match: "prometheus",
    category: "observability",
    title: "prometheus",
    description: "Coletor de métricas time-series com pull model.",
  },
  {
    match: "node_exporter",
    category: "observability",
    title: "node_exporter",
    description: "Exporter Prometheus para métricas de host (CPU, RAM, disco, rede).",
  },

  // ---- container --------------------------------------------------------
  {
    match: "docker",
    category: "container",
    title: "docker",
    description: "Daemon do Docker. Gerencia containers, imagens, redes e volumes.",
  },
  {
    match: "containerd",
    category: "container",
    title: "containerd",
    description: "Runtime de containers padrão da indústria. Usado pelo Docker e pelo Kubernetes.",
  },
  {
    match: "kubelet",
    category: "container",
    title: "kubelet",
    description:
      "Agente do Kubernetes que roda em cada node. Sobe pods e reporta estado ao control plane.",
  },

  // ---- user-level -------------------------------------------------------
  {
    match: "dbus-broker",
    category: "core",
    title: "dbus-broker",
    description:
      "Implementação moderna e mais leve do D-Bus, mantendo compatibilidade com libdbus.",
  },
  {
    match: "dbus",
    category: "core",
    title: "dbus",
    description:
      "Barramento de mensagens do sistema. Serviços do desktop usam-no para falar entre si.",
  },

  // ---- Héstia / KAOS / Kallistis ---------------------------------------
  {
    match: "hestia-station-agent",
    category: "hestia",
    title: "hestia-station-agent",
    description:
      "Station Agent da Héstia: API read-only por trás do Tailscale Serve que o Console consulta. Esta é a fonte de verdade deste inventário.",
  },
  {
    match: "hestia-console",
    category: "hestia",
    title: "hestia-console",
    description:
      "Runtime do Héstia Console. Serve o painel web em https://hestia.nomosludens.ia.br.",
  },
  {
    match: "blackbox",
    category: "kaos",
    title: "Blackbox (KAOS)",
    description:
      "Probe do observatório da KAOS. Faz requisições controladas para medir comportamento da rede (Tor, Yggdrasil, internet aberto).",
  },
  {
    match: "experience",
    category: "kaos",
    title: "Experience (KAOS)",
    description:
      "Coletor de experiência do observatório: registra latências, falhas e timeouts das probes Blackbox.",
  },
  {
    match: "witness",
    category: "kaos",
    title: "Witness (KAOS)",
    description: "Witness do observatório. Assina e arquiva relatórios Blackbox para auditoria.",
  },
  {
    match: "kallistis-absorber",
    category: "kaos",
    title: "kallistis-absorber",
    description: "Componente do projeto Kallistis: engole e indexa eventos externos.",
  },
  {
    match: "klio",
    category: "kaos",
    title: "klio",
    description: "Agente local Kallistis em execução.",
  },

  // ---- desktop / x11 ----------------------------------------------------
  {
    match: "display-manager",
    category: "desktop",
    title: "display-manager",
    description: "Gerenciador de login gráfico (GDM, LightDM, SDDM, etc.).",
  },
  { match: "gdm", category: "desktop", title: "gdm", description: "GNOME Display Manager." },
  {
    match: "lightdm",
    category: "desktop",
    title: "lightdm",
    description: "Light Display Manager. Leve, modular.",
  },
  {
    match: "sddm",
    category: "desktop",
    title: "sddm",
    description: "Simple Desktop Display Manager. Padrão em KDE Plasma.",
  },
  {
    match: "user@",
    category: "user",
    title: "user@.service",
    description:
      "Instância do systemd para um usuário logado. Cada UID ativo gera um user@<uid>.service.",
  },
];

export type StateGlossaryEntry = {
  state: string;
  short: string;
  detail: string;
  color: "ok" | "warn" | "bad" | "neutral" | "muted";
};

export const ACTIVE_STATE_GLOSSARY: StateGlossaryEntry[] = [
  {
    state: "active",
    short: "Em execução",
    detail:
      "A unidade está rodando agora: processo existe, sockets escutando, timer agendando, mount montado.",
    color: "ok",
  },
  {
    state: "inactive",
    short: "Parado, sem erro",
    detail:
      "A unidade está parada, mas não falhou. Sobe normalmente quando acionada (enable + start) ou quando outra unidade a pedir.",
    color: "neutral",
  },
  {
    state: "activating",
    short: "Iniciando",
    detail:
      "Estado de transição: o systemd está levando a unidade do estado 'inactive' para 'active' (pré-start, post-start, etc).",
    color: "warn",
  },
  {
    state: "deactivating",
    short: "Parando",
    detail: "Estado de transição: o systemd está parando a unidade (pre-stop, stop, post-stop).",
    color: "warn",
  },
  {
    state: "reloading",
    short: "Recarregando configuração",
    detail: "A unidade continua rodando, mas está aplicando uma nova configuração (SIGHUP-style).",
    color: "warn",
  },
  {
    state: "failed",
    short: "Falhou",
    detail:
      "O processo principal saiu com código não-zero ou falhou em pré-condições. Veja ExecMainStatus e Result para o motivo. 'systemctl reset-failed' limpa.",
    color: "bad",
  },
  {
    state: "maintenance",
    short: "Em manutenção",
    detail:
      "A unidade está em modo de manutenção: um ExecStartPre/Start falhou mas ela continua para diagnóstico.",
    color: "warn",
  },
  {
    state: "unknown",
    short: "Estado desconhecido",
    detail:
      "O systemd não conseguiu determinar o estado. Geralmente transient unit que acabou de aparecer ou LoadState=not-found.",
    color: "muted",
  },
];

export const UNIT_FILE_STATE_GLOSSARY: StateGlossaryEntry[] = [
  {
    state: "enabled",
    short: "Habilitado, sobe no boot",
    detail:
      "Possui symlink em /etc/systemd/system/<preset>/. O systemd inicia a unidade no boot (ou quando acionada por outra).",
    color: "ok",
  },
  {
    state: "disabled",
    short: "Desabilitado",
    detail:
      "Não há symlink. Não sobe automaticamente. Pode ser iniciada manualmente com 'systemctl start <unit>'.",
    color: "neutral",
  },
  {
    state: "static",
    short: "Estático, dependência indireta",
    detail:
      "Não tem seção [Install] — não pode ser habilitada/desabilitada diretamente. É puxada por outras unidades (Wants=, Requires=) ou pelo preset.",
    color: "neutral",
  },
  {
    state: "masked",
    short: "Mascarado (impossível iniciar)",
    detail:
      "Symlink para /dev/null. Nem manualmente. Precisa de 'systemctl unmask' para reverter. Use com cuidado.",
    color: "bad",
  },
  {
    state: "generated",
    short: "Gerado em runtime",
    detail: "Unit file sintética criada pelo systemd-generator (ex.: systemd-networkd, nspawn).",
    color: "neutral",
  },
  {
    state: "transient",
    short: "Transiente",
    detail: "Criada por API (systemd-run, .busctl) e que some quando o último consumidor fechar.",
    color: "neutral",
  },
  {
    state: "bad",
    short: "Arquivo de unidade inválido",
    detail:
      "Não passou no parse. Reveja o conteúdo do arquivo. Veja 'systemd-analyze verify <unit>'.",
    color: "bad",
  },
  {
    state: "indirect",
    short: "Indireto",
    detail:
      "Marcada como habilitada mas só porque outra unidade (alias) referencia-a. Não tem [Install] próprio.",
    color: "neutral",
  },
];

export function findServiceEntry(unit: string): ServiceGlossaryEntry | null {
  const name = unit.endsWith(".service") ? unit.slice(0, -".service".length) : unit;
  for (const entry of SERVICE_GLOSSARY) {
    if (entry.match === name) return entry;
    if (entry.match.endsWith("@") && name.startsWith(entry.match)) return entry;
  }
  return null;
}

export function describeService(
  unit: string,
  systemdDescription: string,
): { title: string; description: string; category?: string } {
  const hit = findServiceEntry(unit);
  if (hit) {
    return { title: hit.title, description: hit.description, category: hit.category };
  }
  // Fallback: usar a Description do systemd. Se ela for idêntica ao nome da
  // unit (caso comum em units mal-comentadas), devolver um texto genérico.
  const trimmed = (systemdDescription ?? "").trim();
  if (!trimmed || trimmed === unit || trimmed === `${unit.replace(".service", "")}`) {
    return {
      title: unit,
      description:
        "Sem descrição adicional conhecida para esta unidade. Veja o campo FragmentPath no report para localizar o arquivo e ler o cabeçalho [Unit] Comment=, se existir.",
    };
  }
  return { title: unit, description: trimmed };
}

// ---- Eventos do Guardião --------------------------------------------------

export type EventGlossaryEntry = {
  match: string; // prefix match em event.type (ex.: "station.")
  title: string;
  detail: string;
};

export const EVENT_GLOSSARY: EventGlossaryEntry[] = [
  {
    match: "wake.requested",
    title: "Solicitação de despertar",
    detail:
      "O Console encaminhou uma solicitação de despertar ao executor configurado. O Guardião marca este evento quando aceita o pedido; a estação ainda precisa responder ao health.",
  },
  {
    match: "station.X.up", // pseudo-prefix — see findEventEntry
    title: "Estação voltou",
    detail:
      "A estação voltou a responder ao /api/station/health. O Guardião volta a considerá-la 'online' e libera ações de escrita (organizer, updates) para ela.",
  },
  {
    match: "station.X.down",
    title: "Estação offline",
    detail:
      "A estação deixou de responder (timeout, conexão recusada, AUTH_FAILED ou contrato incompatível). Gera incidente crítico até ela voltar.",
  },
  {
    match: "service.X.up",
    title: "Serviço restaurado",
    detail:
      "Um serviço local do Console (jellyfin, smbd, tailscaled, telegram-guard) voltou a ficar disponível.",
  },
  {
    match: "service.X.down",
    title: "Serviço indisponível",
    detail:
      "Um serviço local do Console reportou falha ou deixou de responder. Não impede a operação da Console, mas precisa atenção.",
  },
];

export function findEventEntry(type: string): EventGlossaryEntry | null {
  for (const entry of EVENT_GLOSSARY) {
    // Padrões com placeholder "X" no `match` (ex.: "station.X.up") casam
    // contra qualquer evento do mesmo formato.
    if (entry.match.includes("X")) {
      const pattern =
        "^" + entry.match.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("X", ".+") + "$";
      const re = new RegExp(pattern);
      if (re.test(type)) return entry;
    } else if (type === entry.match || type.startsWith(entry.match + ".")) {
      return entry;
    }
  }
  return null;
}

export const CATEGORY_LABEL: Record<ServiceGlossaryEntry["category"], string> = {
  core: "core / PID 1",
  network: "rede",
  storage: "armazenamento",
  io: "I/O e logs",
  security: "segurança",
  observability: "observabilidade",
  user: "sessão de usuário",
  container: "containers",
  package: "pacotes e updates",
  hardware: "hardware",
  scheduler: "agendador",
  hestia: "Héstia",
  kaos: "KAOS",
  desktop: "desktop / login gráfico",
  other: "outros",
};
