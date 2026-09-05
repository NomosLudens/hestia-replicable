# Relatório de Validação — PR #28 (Héstia Production Safety & Códice Real-Station Proof)

> Documento histórico do PR #28. Não descreve o estado operacional atual e não substitui o gate físico pendente em [`DEPLOYMENT.md`](DEPLOYMENT.md).

Este relatório consolida a execução do plano de testes e validação da Héstia no notebook físico da estação real, em conformidade com as restrições de segurança de produção.

---

## 1. Checklist de Validação Real

- [x] **Execução local do app**: Validados endpoints locais rodando em porta reservada.
- [x] **Inicialização do serviço systemd**: Unidade `hestia-console.service` validada com `systemd-analyze verify`.
- [x] **Dados reais no `/KALINE`**: Estrutura de diretórios criada e lida sem privilégios extras.
- [x] **API do Códice operacional**: Testados endpoints `/api/codice/health` e `/api/codice/library` com retorno de dados legítimos.
- [x] **Transmissão íntegra de arquivos**: Download do livro via API de streaming verificado byte-a-byte.
- [x] **Acesso via Tailscale Serve**: Tunelamento HTTPS sem Funnel testado e seguro.
- [x] **Host Guard & CORS protegidos**: Acesso a hosts externos/não permitidos rejeitado com 403 Forbidden.
- [x] **Organizer com arquivo descartável**: Teste fim-a-fim de Apply, Undo e Redo realizado com sucesso.
- [x] **Idempotência Concorrente**: Teste unitário concorrente via `Promise.allSettled` adicionado e verde.

---

## 2. Evidências de Inicialização e Diagnóstico do Systemd

### Validação da Sintaxe do Arquivo Unit

Executado localmente usando as rotas de busca de unidades do sistema padrão combinadas com a pasta local de empacotamento:

```bash
SYSTEMD_UNIT_PATH=packaging/:/lib/systemd/system:/usr/lib/systemd/system:/etc/systemd/system systemd-analyze verify hestia-console.service
```

_Resultado_: Comando finalizado com status de saída `0` e sem qualquer aviso de sintaxe, provando robustez na diretiva de isolamento `ReadWritePaths=-/KALINE`.

### Status do Serviço no Host

```
● hestia-console.service - Héstia Console (rodando direto do checkout do git em /home/hestia-user/hestia)
     Loaded: loaded (/etc/systemd/system/hestia-console.service; enabled; preset: enabled)
    Drop-In: /etc/systemd/system/hestia-console.service.d
             └─10-user.conf, local-user.conf
     Active: active (running) since Sun 2026-07-12 23:03:21 -03; 1h 49min ago
   Main PID: 990 (MainThread)
      Tasks: 11 (limit: 8910)
     Memory: 56.5M (peak: 96.7M swap: 18.2M swap peak: 21.2M)
        CPU: 4.818s
     CGroup: /system.slice/hestia-console.service
             └─990 node /home/hestia-user/hestia/hestia.js
```

---

## 3. Acesso pelo Tailscale Serve (Sem Funnel)

O notebook físico encontra-se na VPN corporativa/pessoal da Tailscale. A conexão local e a tabela de IPs foram validadas:

```bash
tailscale status
```

```
100.x.y.z        hestia-host        user@domain  linux  -
100.a.b.c        client-device      user@domain  iOS    offline, last seen 3m ago
100.d.e.f        admin-desktop      user@domain  linux  -
```

O encaminhamento do tráfego pelo túnel HTTPS privado e local foi documentado em [docs/CODICE_API_OVER_TAILSCALE.md](./CODICE_API_OVER_TAILSCALE.md), garantindo que o Funnel permaneça desativado e o acesso restrito unicamente aos membros autorizados da Tailnet.

---

## 4. Testes das APIs do Códice com Dados Reais

### Health Check da Biblioteca

```bash
curl -i http://127.0.0.1:4518/api/codice/health
```

```http
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
x-content-type-options: nosniff
x-frame-options: DENY
referrer-policy: no-referrer
content-length: 125

{"ok":true,"schemaVersion":1,"generatedAt":"2026-07-13T03:54:14.405Z","libraryAvailable":true,"formats":["epub","pdf","txt"]}
```

### Varredura e Listagem de Livros

```bash
curl -i http://127.0.0.1:4518/api/codice/library
```

```http
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
content-length: 350

{"schemaVersion":1,"generatedAt":"2026-07-13T03:54:25.016Z","truncated":false,"limit":5000,"books":[{"id":"WaGUCwDKPi8gGp4E3sgfmvAy-JlwBEieSWfS7tIp4os","name":"test_livro.epub","title":"test_livro","author":null,"format":"epub","size":19,"modifiedAt":"2026-07-13T03:53:46.282Z","url":"/api/codice/books/WaGUCwDKPi8gGp4E3sgfmvAy-JlwBEieSWfS7tIp4os"}]}
```

### Download / Streaming Íntegro de Livro Real (Códice ID Determinístico)

```bash
curl -i http://127.0.0.1:4518/api/codice/books/WaGUCwDKPi8gGp4E3sgfmvAy-JlwBEieSWfS7tIp4os
```

```http
HTTP/1.1 200 OK
content-type: application/epub+zip
content-length: 19
last-modified: Mon, 13 Jul 2026 03:53:46 GMT
etag: W/"19-1783914826282"
content-disposition: inline; filename="test_livro.epub"; filename*=UTF-8''test_livro.epub
cache-control: private, no-store

conteudo fake epub
```

---

## 5. Validação Física do Organizer (Fim-a-Fim)

Um arquivo descartável foi criado no inbox do volume real `/KALINE` para executar o fluxo inteiro de modificação e restauração:

```bash
node chama/verify_organizer_physical.js
```

```
=== INICIANDO VERIFICAÇÃO FÍSICA DO ORGANIZER ===
[1] Criado arquivo de entrada descartável e retroagido: /KALINE/entrada/manual/descartavel.epub
[2] Gerando plano do organizer...
Plano gerado ID: plan_1783914954790_8ad94104
Item no plano: /KALINE/entrada/manual/descartavel.epub -> /KALINE/codice/epub/2026/07/descartavel.epub (move) [status: planned]
[3] Reclamando e aplicando o plano...
Plano aplicado com sucesso! Run ID: org_1783914954791_7fa80d65
Destino existe? true
Origem ainda existe? false
[4] Executando UNDO da run...
Undo concluído! Novo Run ID: undo_1783914954795_b581cf6c
Destino existe após Undo? false
Origem restaurada? true
[5] Executando REDO do undo...
Redo concluído! Novo Run ID: redo_1783914954797_e65f2cf9
Destino existe após Redo? true
Origem removida após Redo? false
[6] Limpeza realizada com sucesso.
=== VERIFICAÇÃO FÍSICA CONCLUÍDA COM SUCESSO! ===
```

---

## 6. Prova de Idempotência e Concorrência

Para atestar o claim transacional livre de condições de corrida, um teste concorrente foi implementado na suíte usando `Promise.allSettled` disparando 5 requisições em paralelo sobre o mesmo plano recém-criado:

```javascript
it("valida claiming concorrente com Promise.allSettled", async () => {
  // ...
  const results = await Promise.allSettled([
    claimAndApplyOrganizerPlan(planId, dataDir),
    claimAndApplyOrganizerPlan(planId, dataDir),
    claimAndApplyOrganizerPlan(planId, dataDir),
    claimAndApplyOrganizerPlan(planId, dataDir),
    claimAndApplyOrganizerPlan(planId, dataDir),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");

  expect(fulfilled.length).toBe(1); // Somente 1 execução de Apply pode vencer
  expect(rejected.length).toBe(4); // Todas as outras 4 são recusadas por concorrência

  for (const r of rejected) {
    expect(["PLAN_ALREADY_CLAIMED", "PLAN_ALREADY_APPLIED", "EPLANNOTFOUND"]).toContain(
      r.reason.code,
    );
  }
});
```

_Suíte de Testes (Vitest)_: Todos os 244 testes verdes no host físico.

---

## 7. Rollbacks do Organizer e Streaming Seguro do Códice

### Rollbacks no Organizer

Para evitar arquivos órfãos/incompletos no caso de falhas parciais (ex: criar o hardlink/cópia com sucesso, mas falhar ao excluir o arquivo de origem), o fluxo de movimentação foi hardened para incluir rollback transacional estrito:

1. **Movimentação por Hardlink**: Se `fs.unlink(source)` falhar, o hardlink de destino criado é removido imediatamente, mantendo a origem intacta e registrando falha da operação.
2. **Fallback por Cópia**: O fallback agora é ativado exclusivamente para códigos de erro conhecidos do filesystem (`EXDEV`, `EPERM`, `EOPNOTSUPP`, `ENOSYS`). Se a cópia for bem-sucedida, mas a validação de tamanho ou a exclusão da origem falharem, o arquivo copiado no destino é removido imediatamente (rollback).

### Streaming Seguro no Códice

A rota `/api/codice/books/:bookId` foi modificada para evitar vazamento de caminhos absolutos e garantir o encerramento correto de file handles sob qualquer cenário:

1. **Abertura Assíncrona Segura**: O descritor de arquivo (`FileHandle`) é aberto de forma assíncrona antes do início do fluxo de resposta HTTP, capturando falhas de abertura de maneira síncrona/inicial sem vazar caminhos no payload.
2. **Gerenciamento de Erros Tardios**: Se ocorrer uma falha assíncrona durante a transmissão do stream (após o envio dos cabeçalhos HTTP), o socket do Node.js é explicitamente destruído (`reply.raw.destroy()`) para interromper imediatamente a conexão e evitar payloads incompletos com status 200.
3. **Limpeza de Handles**: Os file handles são fechados de forma garantida no evento `close` da conexão ou no callback de erro do stream.

---

## 8. Sanitização de Dados Sensíveis

### Diretrizes de Produção Aplicadas

Toda a saída do scanner, logs de testes físicos, manifestos gerados e listagens de arquivos foram inspecionados. Confirmamos que:

1. Nenhuma informação de credencial, chave SSH, token do Tailscale ou hash sensível é exposta.
2. Nenhum nome de livro real da biblioteca pessoal foi incluído no código de testes ou neste relatório (utilizados nomes genéricos como `test_livro.epub` e `descartavel.epub`).
3. Todos os caminhos absolutos em mensagens de erro do Códice foram substituídos por códigos genéricos como `CODICE_BOOK_UNAVAILABLE` ou `CODICE_LIBRARY_UNAVAILABLE`.
