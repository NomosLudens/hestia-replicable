# Inventário de serviços de uma Station Linux

Este documento registrava um **snapshot operacional completo de uma estação real**, incluindo hostname privado, contagens e a enumeração de unidades `systemd` daquele host.

A partir da organização pública do repositório, o snapshot detalhado deixa de ser mantido na árvore pública. Ele era útil para validação operacional, mas expunha detalhes de topologia e inventário que não são necessários para compreender ou reproduzir a arquitetura da Héstia.

O histórico Git permanece intacto.

## O que a validação comprova

A funcionalidade de inventário de serviços da Héstia é baseada na fonte real do host:

```text
Station Agent
  ↓
systemctl list-unit-files --type=service
  +
systemctl show <unit>
  ↓
normalização e validação
  ↓
Héstia Console
```

O relatório não depende de whitelist de serviços nem de catálogo mockado. A aplicação deve refletir o estado retornado pelo `systemd` da Station correspondente.

## Como validar em uma instalação própria

No host monitorado, compare a enumeração local com o relatório exposto pelo Agent autenticado:

```bash
systemctl list-unit-files --type=service --no-pager --no-legend --plain
```

Depois consulte a rota protegida da **sua própria Station**, usando o hostname privado e a credencial configurados localmente.

Não publique em documentação pública:

- hostname privado da Station;
- IPs internos;
- tokens;
- arquivos de ambiente;
- inventário operacional completo do host;
- caminhos ou dados que revelem informação desnecessária sobre a implantação real.

## Invariantes

```text
SERVICE_REPORT = READ_ONLY
SERVICE_REPORT = DYNAMIC_SYSTEMCTL
SERVICE_REPORT = COMPLETE_FOR_THE_TARGET_HOST
GENERIC_REMOTE_EXEC = ABSENT
```

A aceitação do recurso continua dependendo de validação no host real. Testes automatizados protegem o contrato, mas não substituem a comparação com o `systemd` da Station implantada.
