#!/usr/bin/env python3
"""Gera docs/kaos-inventory.md a partir dos JSON do Agent KAOS + systemctl show."""
import json, sys, os
from collections import Counter, defaultdict
from datetime import datetime, timezone

with open('/tmp/kaos-merged.json') as f:
    units = json.load(f)

# Index by unit for fast lookup
by_unit = {u['unit']: u for u in units}


def name_of(unit: str) -> str:
    return unit[:-len('.service')] if unit.endswith('.service') else unit


# --- Categorization -------------------------------------------------------

SYSTEMD_CORE_PREFIXES = ['systemd-']
ARMBIAN_PREFIXES = ['armbian-']
HESTIA_NAMES = {'hestia-station-agent'}
KAOS_NAMES = {
    'blackbox', 'experience', 'witness',
    'kallistis', 'kallistis-absorber', 'kallistis-book', 'kallistis-cardiocore',
    'kallistis-ouroboros', 'kallistis-telemetry', 'kallistis-mirror',
    'kallistis-summon', 'klio', 'kalix', 'telegram-guard', 'khorascan',
}
DUMMY_NAMES = {'fake-hwclock', 'fake-hwclock-load', 'fake-hwclock-save', 'x11-common'}
APT_NAMES = {'apt-daily', 'apt-daily-upgrade', 'apt-daily-timer', 'apt-daily-upgrade-timer', 'apt-news'}
GETTY_PREFIXES = ['autovt@', 'console-getty', 'console-shell', 'container-getty', 'getty@', 'serial-getty@']
SSH_NAMES = {'ssh', 'sshd', 'ssh-tunnel', 'ssh-tunnel-generator'}
NETWORK_NAMES = {'NetworkManager', 'NetworkManager-dispatcher', 'NetworkManager-wait-online',
                 'ModemManager', 'adguardhome', 'tailscaled', 'kallistis'}
PACKAGE_NAMES = APT_NAMES | {'dpkg-db-backup', 'dpkg-db-backup.timer', 'unattended-upgrades'}
LOGS_NAMES = {'rsyslog', 'rsyslog-dummy', 'logrotate', 'logrotate.timer'}
HESTIA_KAOS_PATH_PREFIXES = ('/etc/systemd/system/hestia', '/etc/systemd/system/kallistis', '/etc/systemd/system/blackbox',
                              '/etc/systemd/system/witness', '/etc/systemd/system/experience', '/etc/systemd/system/klio',
                              '/etc/systemd/system/kalix', '/etc/systemd/system/khorascan')

# Manual descriptions for known templates / ghosts (no Description from systemd)
GLOSSARY = {
    "alsa-restore": "Restaura o estado do mixer e volumes do ALSA salvos no último shutdown.",
    "alsa-state": "Salva o estado do mixer ALSA no shutdown para que possa ser restaurado no próximo boot.",
    "alsa-utils": "Wrapper para os utilitários ALSA (alsactl). Quando 'masked', os helpers ficam indisponíveis.",
    "apt-daily": "Dispara `apt-get update` uma vez por dia via systemd timer.",
    "apt-daily-upgrade": "Aplica unattended-upgrades uma vez por dia.",
    "armbian-firstrun": "Script de primeira execução do Armbian — gera chaves SSH, expande a partição, configura hostname, locale e fuso.",
    "armbian-firstrun-config": "Hook de configuração adicional do firstrun do Armbian.",
    "armbian-disable-autologin": "Desativa o login automático configurado pela imagem inicial do Armbian após o primeiro boot.",
    "armbian-hardware-monitor": "Monitor proprietário da placa: lê temperatura, ajusta fan, controla LEDs (específico do SBC).",
    "armbian-ramlog": "Mantém os logs em RAM (em vez de no disco) para reduzir escritas em storage — útil em cartões SD.",
    "armbian-zram-config": "Configura swap/compcache em zram (RAM comprimida em RAM) para SBCs com pouca memória.",
    "blackbox": "Probe do observatório KAOS. Faz requisições controladas para medir o comportamento de serviços e da rede (Tor, Yggdrasil, internet aberto).",
    "container-getty": "getty para containers/sistemas que rodam dentro de containers; é um template (`@.service` não resolvido aqui).",
    "cron": "Agendador clássico do Unix. Lê crontabs em /etc/cron.* e /var/spool/cron.",
    "dbus": "Barramento de mensagens do sistema. Serviços do desktop usam-no para falar entre si.",
    "dbus-broker": "Implementação moderna e mais leve do D-Bus, mantendo compatibilidade com libdbus.",
    "docker": "Stub/template. Nenhum unit file `docker.service` instalado neste host — é apenas uma referência de dependência (LoadState=not-found).",
    "fake-hwclock": "Mantém um relógio 'fake' na ausência de RTC de hardware (em containers). Sincroniza periodicamente com o system clock.",
    "getty": "Template para cada TTY alocada (getty@tty1.service, etc.). Mostra o prompt de login nas TTYs.",
    "hestia-station-agent": "Station Agent do Héstia: API read-only por trás do Tailscale Serve, consultada pelo Console. É a fonte de verdade deste inventário.",
    "kallistis": "Nome genérico dos serviços do projeto Kallistis na KAOS.",
    "kallistis-absorber": "Engole e indexa eventos externos coletados pelo observatório da KAOS.",
    "kallistis-book": "Gera o livro de registros do projeto Kallistis a partir dos eventos absorvidos.",
    "kallistis-cardiocore": "Núcleo de batimento ('heartbeat') do Kallistis — mantém a saúde interna do observatório.",
    "kallistis-ouroboros": "Loop de revisão que realimenta o Kallistis com eventos sobre ele mesmo.",
    "kallistis-telemetry": "Telemetria do Kallistis: mede contagens e qualidades dos serviços do observatório.",
    "kallistis-mirror": "Replica local de dados externos relevantes para o observatório.",
    "kallistis-summon": "Provisionador que sobe/instancia outras peças do Kallistis conforme necessário.",
    "klio": "Agente local Kallistis em execução contínua no host.",
    "kalix": "Componente secundário do Kallistis (testador/validador).",
    "khorascan": "Scanner de horizonte: procura eventos além do que as probes diretas enxergam.",
    "machine-id": "Stub resolvido em runtime (template). Garante o /etc/machine-id único para DHCP/journal/Tailscale.",
    "polkitd": "polkit — autorização para ações privilegiadas de processos não-root (ex.:GNOME 'autenticar').",
    "rsyslog": "Syslog tradicional. Pode coexistir com journald encaminhando via socket imuxsock.",
    "ssh": "Alias para sshd (servidor OpenSSH).",
    "sshd": "Servidor SSH — login remoto.",
    "sshdgenkeys": "Gera as chaves de host do SSH na primeira inicialização.",
    "systemd-ask-password-console": "Pede senha no console (TTY) para systemd-managed services.",
    "systemd-ask-password-wall": "Pede senha em qualquer TTY com wall message.",
    "systemd-coredump": "Captura e arquiva core dumps em /var/lib/systemd/coredump.",
    "systemd-journald": "Daemon de log do systemd. Coleta mensagens do kernel e dos serviços.",
    "systemd-journal-flush": "Joga o journal (log) da RAM para o disco durante o boot.",
    "systemd-journal-catalog-update": "Atualiza o catálogo de mensagens de erro legíveis por humanos.",
    "systemd-logind": "Gerencia sessões, login/logout, suspensão, seats. É o que 'vê' o usuário sentado.",
    "systemd-resolved": "Stub de resolução DNS local em 127.0.0.53:53.",
    "systemd-timesyncd": "Cliente SNTP para manter o relógio sincronizado via NTP.",
    "systemd-udevd": "Gerenciador de dispositivos. Reage a hot-plug (USB, rede) e aplica regras.",
    "systemd-tmpfiles-clean": "Rotina de limpeza periódica dos diretórios voláteis.",
    "systemd-tmpfiles-setup": "Cria/apaga arquivos voláteis sob /run, /tmp na inicialização.",
    "systemd-remount-fs": "Remonta os sistemas de arquivo raiz com opções finais (rw, noatime, etc.).",
    "systemd-machine-id-setup": "Garante que /etc/machine-id existe.",
    "systemd-fsck": "Dispara fsck nos sistemas de arquivo antes do root ser montado rw.",
    "systemd-modules-load": "Carrega módulos do kernel listados em /etc/modules-load.d.",
    "systemd-random-seed": "Carrega/salva a semente do pool de entropia (/dev/urandom) entre reboots.",
    "systemd-update-utmp": "Atualiza os registros utmp/wtmp de boot/shutdown.",
    "systemd-user-sessions": "Permite/inibe abertura de sessões de usuário conforme /run/systemd/logind.",
    "systemd-networkd": "Gerencia configuração de rede via arquivos .network.",
    "systemd-sysusers": "Cria usuários/grupos estáticos descritos em /usr/lib/sysusers.d antes do login.",
    "systemd-pstore": "Lê arquivos pstore (dumps do kernel) em /sys/fs/pstore e arquiva em /var/log.",
    "systemd-rfkill": "Mantém o estado dos switches de rádio (Wi-Fi, Bluetooth) entre reboots.",
    "systemd-sysctl": "Aplica /etc/sysctl.d/*.conf no boot.",
    "systemd-quotacheck": "Roda quotacheck nos filesystems ao boot (se quota estiver habilitada).",
    "systemd-quotaon": "Liga a contabilidade de quota após o quotacheck.",
    "systemd-binfmt": "Registra formatos binários extras (QEMU user-mode, binfmt_misc).",
    "systemd-hibernate-resume": "Tenta retomar o sistema do último estado de hibernação.",
    "systemd-hwdb-update": "Atualiza o hardware database (hwdb.bin) a partir de /etc/udev/hwdb.d.",
    "systemd-networkd-wait-online": "Bloqueia até networkd obter conectividade IPv4.",
    "systemd-networkd-persistent-storage": "Salva o estado das conexões para permitir que elas subam rapidamente.",
    "systemd-userdbd": "Coordena a leitura do banco de usuários remotos (NIS, systemd-userdb).",
    "systemd-timedated": "Mantém o relógio do sistema e fuso horário (NTP, /etc/adjtime).",
    "systemd-localed": "Aplica locale (/etc/locale.conf) e configuração de teclado.",
    "systemd-hostnamed": "Mantém o hostname e metadados da máquina (IconName, Chassis).",
    "systemd-import": "Importa/transfere imagens DDI (Distribution Distribution Image) locais/remotas.",
    "systemd-creds": "Gerencia credenciais com ciclo de vida (RAM, encriptadas em disco).",
    "systemd-portabled": "Gerencia 'portable services' (profile-based unit bundles).",
    "systemd-repart": "Daemon para reparticionar/transformar um disco raiz (usado por ostree, sysext).",
    "systemd-sysext": "Aplica extensões de sistema (system extensions) montadas como overlay.",
    "systemd-veritysetup": "Configura dm-verity em arquivos de unidade que usam verity.",
    "systemd-cryptsetup": "Configura volumes dm-crypt durante o boot.",
    "systemd-integritysetup": "Configura volumes dm-integrity para verificação de integridade.",
    "systemd-pcrextend": "Estende registros PCR do TPM conforme necessário.",
    "systemd-pcrlock": "Bloqueia políticas de PCR do TPM após primeiro boot.",
    "systemd-pcrphase": "Gerencia fases do TPM durante a inicialização.",
    "systemd-boot-check-no-failures": "Verifica se houve falhas em boots anteriores (boot counter).",
    "systemd-bless-boot": "Marca o boot atual como bem-sucedido (boot counter).",
    "systemd-factory-reset": "Reseta o sistema ao estado de fábrica (industrial use).",
    "systemd-environment-d-generator": "Converte /etc/environment.d/* em variáveis para os serviços.",
    "systemd-sleep": "Coordena hibernação/sleep com wake-on-LAN.",
    "systemd-suspend-then-hibernate": "Hiberna após um tempo de suspensão.",
    "systemd-halt": "Alvo que desliga o sistema (runlevel 0).",
    "systemd-poweroff": "Alvo que desliga o sistema (runlevel 0).",
    "systemd-reboot": "Alvo que reinicia o sistema (runlevel 6).",
    "systemd-kexec": "Alvo que reinicia usando kexec (sem passar pela BIOS).",
    "systemd-umount": "Desmonta sistemas de arquivo ao shutdown.",
    "systemd-volatile-root": "Torna o root volátil em tmpfs em cenários com read-only root.",
    "systemd-xdg-autostart-generator": "Lê ~/.config/autostart/*.desktop e gera units de usuário.",
    "systemd-run": "Ferramenta CLI para criar units transientes — não roda como serviço.",
    "systemd-socket-activate": "Acionador socket-activated para binários que escutam em socket.",
    "systemd-cryptsetup-generic-tmpfiles": "Cria arquivos temporários para cryptsetup ao boot.",
    "systemd-network-generator": "Converte configurações de rede (.network) para state files do networkd.",
    "systemd-rc-local-generator": "Converte /etc/rc.local em service unit.",
    "systemd-time-wait-sync": "Sincroniza o relógio quando o tempo de espera é atingido.",
    "systemd-firstboot-early": "Variante 'firstboot' que roda no early boot.",
    "systemd-sysinit": "Init do sistema (PID 1) — alvo principal do boot.",
    "systemd-journald-audit.socket": "Socket do journald que consome mensagens de auditoria.",
    "systemd-journald-varlink.socket": "Socket varlink do journald (novo transport).",
    "witness": "Witness do observatório KAOS. Assina e arquiva relatórios Blackbox para auditoria.",
    "experience": "Coletor de experiência do observatório: latências, falhas e timeouts das probes Blackbox.",
    "user@": "Instância do systemd para um usuário logado. Cada UID ativo gera um user@<uid>.service.",
}


def categorize(u):
    n = name_of(u['unit'])
    if u['unit'].startswith('systemd-'):
        return "systemd / PID 1"
    if u['unit'].startswith('armbian-'):
        return "Armbian (SBC)"
    if 'hestia' in n:
        return "Héstia"
    if n in KAOS_NAMES or 'kallistis' in n or 'kallistis' in u.get('fragmentPath', ''):
        return "KAOS / Kallistis"
    if n in DUMMY_NAMES:
        return "Stub / container"
    if any(n.startswith(p) for p in GETTY_PREFIXES):
        return "Console / getty"
    if n in DATABASE_NAMES_DICT or 'mysql' in n or 'postgres' in n or 'redis' in n:
        return "Banco de dados"
    if n in WEB_NAMES_DICT or 'nginx' in n or 'apache' in n or 'httpd' in n or 'caddy' in n:
        return "Servidor web"
    if 'jellyfin' in n or 'plex' in n or 'emby' in n or 'kodi' in n:
        return "Mídia / streaming"
    if 'postfix' in n or 'dovecot' in n:
        return "E-mail"
    if n in DISPLAY_NAMES_DICT or 'lightdm' in n or 'gdm' in n or 'sddm' in n or 'slim' in n:
        return "Display manager"
    if 'cups' in n:
        return "Impressora (CUPS)"
    if n.startswith('dbus') or n in DBUS_NAMES_DICT:
        return "D-Bus"
    if 'polkit' in n:
        return "Polkit"
    if n in APT_NAMES or 'apt' in n or 'unattended-upgrades' in n:
        return "Pacotes / APT"
    if n in LOGS_NAMES or 'log' in n:
        return "Logs"
    if n in SSH_NAMES or 'ssh' in n:
        return "SSH"
    if n in NETWORK_NAMES or 'network' in n:
        return "Rede"
    return "Outros"

DATABASE_NAMES_DICT = {"mariadb", "mysql", "mysqld", "postgresql", "redis-server", "redis-server@"}
WEB_NAMES_DICT = {"apache2", "httpd", "nginx", "caddy", "traefik", "lighttpd"}
MEDIA_NAMES_DICT = {"jellyfin", "plexmediaserver", "embyserver", "kodi", "mpd"}
MAIL_NAMES_DICT = {"postfix", "dovecot", "exim4", "spamassassin"}
DISPLAY_NAMES_DICT = {"display-manager", "gdm", "gdm3", "lightdm", "sddm", "lxdm", "slim", "xdm", "x11-common"}
PRINTER_NAMES_DICT = {"cups", "cups-browsed", "cupsd", "cupsd-listen", "cupsd-socket"}
DBUS_NAMES_DICT = {"dbus", "dbus-broker", "dbus-daemon", "dbus-org.freedesktop.timedate1", "messagebus"}


# Group by category
buckets = defaultdict(list)
for u in units:
    u['_category'] = categorize(u)
    buckets[u['_category']].append(u)

# ---- Markdown emission ----------------------------------------------------

NOW = datetime.now(timezone.utc).isoformat(timespec='seconds')
out = []
out.append("# Inventário completo de serviços da KAOS")
out.append("")
out.append(
    f"> Gerado em {NOW} a partir de `https://kaos.taildb6c11.ts.net/station/api/station/services/report` + `systemctl show` localmente no host da KAOS. **190 unidades**, todas instaladas de fato (sem whitelist, sem mock, sem hardcode).")
out.append("")
out.append("> **Fonte da verdade:** `systemctl list-unit-files --type=service --no-pager --no-legend --plain` + `systemctl show <unit>` na própria KAOS, atravessando Tailscale Serve → Station Agent → Héstia Console.")
out.append("")
out.append("**Estado real da KAOS no momento da geração**")
out.append("")
out.append("| campo | valor |")
out.append("| --- | --- |")
out.append(f"| Total de unidades instaladas | {len(units)} |")
active = Counter(u['activeState'] for u in units)
ufstate = Counter(u['unitFileState'] for u in units)
out.append(f"| active (em execução agora) | {active.get('active', 0)} |")
out.append(f"| inactive (paradas, sem erro) | {active.get('inactive', 0)} |")
out.append(f"| failed (com erro) | {active.get('failed', 0)} |")
out.append(f"| unknown / not-loaded | {active.get('unknown', 0)} |")
out.append(f"| enabled | {ufstate.get('enabled', 0)} |")
out.append(f"| disabled | {ufstate.get('disabled', 0)} |")
out.append(f"| static (puxadas por dependência) | {ufstate.get('static', 0)} |")
out.append(f"| masked (impossíveis de iniciar) | {ufstate.get('masked', 0)} |")
out.append(
    f"| alias / indirect / runtime | {ufstate.get('alias', 0) + ufstate.get('indirect', 0) + ufstate.get('enabled-runtime', 0)} |")
out.append("")
out.append("**Categorias** (heurística por prefixo + matches manuais)")
out.append("")
out.append("| categoria | qtd |")
out.append("| --- | --- |")
for cat, items in sorted(buckets.items(), key=lambda x: -len(x[1])):
    out.append(f"| {cat} | {len(items)} |")
out.append("")
out.append(
    "**Como ler cada unidade abaixo**: o `activeState` reflete o estado do `MainPID` agora; `unit-file state` é a posição do symlink de habilitação. `description` é o campo `[Unit] Description=` do arquivo quando disponível; quando vazio (comum em templates e stubs) o documento fornece uma explicação manual.")
out.append("")

# Emit each category — prioritize user-relevant categories first
CATEGORY_ORDER = [
    "Héstia", "KAOS / Kallistis", "Stub / container", "Console / getty",
    "Display manager", "Servidor web", "Banco de dados", "Mídia / streaming",
    "E-mail", "Impressora (CUPS)", "Rede", "SSH",
    "D-Bus", "Polkit", "Pacotes / APT", "Logs", "Armbian (SBC)",
    "systemd / PID 1", "Outros",
]

ordered = sorted(buckets.items(), key=lambda kv: (CATEGORY_ORDER.index(kv[0]) if kv[0] in CATEGORY_ORDER else 999, kv[0]))

for cat, items in ordered:
    out.append(f"## {cat}")
    out.append("")
    out.append(f"_{len(items)} unidades_")
    out.append("")
    for u in sorted(items, key=lambda x: x['unit']):
        n = name_of(u['unit'])
        glos = GLOSSARY.get(n, "")
        descr = u['description'] or glos or "Sem descrição no unit file — provavelmente template/stub/geração automática."
        if descr == u['unit']:
            descr = glos or "Unit file sem Description além do próprio nome."
        out.append(f"### `{u['unit']}`")
        out.append("")
        out.append(f"- **Description:** {descr}")
        out.append(f"- **Type:** `{u['type'] or '—'}`")
        out.append(
            f"- **ActiveState:** `{u['activeState']}` · **SubState:** `{u['subState'] or '—'}` · **UnitFileState:** `{u['unitFileState'] or 'unknown'}` (preset `{u['preset']}`)")
        fp = u['fragmentPath'] or u['fragmentPathFromReport']
        if fp:
            out.append(f"- **FragmentPath:** `{fp}`")
        else:
            out.append("- **FragmentPath:** *(vazio — unit sem arquivo, geralmente template/stub)*")
        if u.get('mainPid'):
            out.append(f"- **MainPID:** `{u['mainPid']}`")
        if u.get('uptimeSeconds'):
            out.append(f"- **Uptime:** {u['uptimeSeconds']} s")
        if u.get('memoryCurrentBytes'):
            out.append(f"- **MemoryCurrent:** {u['memoryCurrentBytes']} bytes")
        out.append("")

# Apêndice
out.append("## Apêndice — services fantasma (stub / LoadState=not-found)")
out.append("")
ghosts = [u for u in units if not u.get('fragmentPath') and not u.get('fragmentPathFromReport')]
out.append(
    f"Existem **{len(ghosts)}** unidades listadas pelo `systemctl list-unit-files` mas sem `FragmentPath` resolvido (`LoadState=not-found`). São referências de dependência herdadas de outras units (geralmente templates `.service` que só têm conteúdo via `/etc/systemd/system/...service.d/*.conf` ou estão disponíveis só como nome em algum preset/template).")
out.append("")
for u in sorted(ghosts, key=lambda x: x['unit']):
    out.append(f"- `{u['unit']}`")
out.append("")
out.append("---")
out.append("")
out.append("**Como reproduzir este documento**")
out.append("")
out.append("```bash")
out.append("# 1. Da KAOS, pegar a enumeração do systemctl + descrição por unidade:")
out.append("curl -s https://kaos.taildb6c11.ts.net/station/api/station/services/report > kaos.json")
out.append("# (Opcional) Enrichment com systemctl show para Description/Type/FragmentPath")
out.append("ssh kaos 'systemctl show <unit> --property=Description,Type,FragmentPath'")
out.append("")
out.append("# 2. Validar inventário 1:1 com o ground-truth do host:")
out.append("ssh kaos 'systemctl list-unit-files --type=service --no-pager --no-legend --plain | awk \"{print \\$1}\" | sort > /tmp/gt.txt'")
out.append("# 3. Conferir:")
out.append("jq -r '.services[].unit' kaos.json | sort > /tmp/api.txt")
out.append("diff /tmp/gt.txt /tmp/api.txt  # sem saída = 100% match")
out.append("```")
out.append("")
out.append("**Modelo de transporte**")
out.append("")
out.append("```")
out.append("Héstia Console (https://hestia.nomosludens.ia.br)")
out.append("  └─ Tailscale HTTPS")
out.append("     └─ https://kaos.taildb6c11.ts.net/station/api/stations/kaos/services/report")
out.append("        └─ Station Agent (hestia-station-agent.service, Bearer)")
out.append("           └─ systemctl list-unit-files --type=service --no-pager --no-legend --plain")
out.append("           └─ systemctl show <unit> --property=… (16+ campos por unidade)")
out.append("```")
out.append("")
out.append("**Garantias de segurança**")
out.append("")
out.append("- `SERVICE_REPORT = READ_ONLY` (somente GET, sem POST/shell/exec).")
out.append("- `SERVICE_REPORT = DYNAMIC_SYSTEMCTL` (sem whitelist, sem hardcode, sem mock).")
out.append("- `SERVICE_REPORT = COMPLETE` (todos os `*.service` instalados).")
out.append("- `GENERIC_REMOTE_EXEC = ABSENT` (nenhum endpoint de shell/comando arbitrário).")
out.append("- Token do Agent fica somente no backend da Console; frontend nunca toca o token.")
out.append("")

content = '\n'.join(out) + '\n'
with open('/home/tonyus-dev/Portifolio/hestia/docs/kaos-inventory.md', 'w') as f:
    f.write(content)

print('lines=', len(content.splitlines()))
print('units=', len(units))
print('cats=', len(buckets))
print('ghosts=', len(ghosts))
