# Héstia — Local Install Smoke Test

## Objetivo

Testar a instalação real da Héstia em Linux Mint Xfce ou Debian/Ubuntu equivalente.

## Fluxo

```bash
npm ci
npm run lint
npm test
npm run build
npm run build-deb
sudo apt install ./dist-deb/hestia-console_*.deb
systemctl status hestia-console
curl -s http://127.0.0.1:4517/api/health
npm run doctor
```

## Teste visual

Abrir:

```txt
http://127.0.0.1:4517/
http://127.0.0.1:4517/sistema
http://127.0.0.1:4517/storage
http://127.0.0.1:4517/organizar
http://127.0.0.1:4517/servicos
http://127.0.0.1:4517/historico
http://127.0.0.1:4517/endpoints
```

## Estados esperados

- Se `/KALINE` não existir, mostrar aviso honesto.
- Se Ollama não estiver ativo, `/api/llm/health` deve retornar indisponível.
- Se Hermes root não existir, deve retornar erro estruturado.
- Nenhuma dessas situações deve quebrar o Console.

## Remoção

```bash
sudo apt remove hestia-console
```

Dados locais do usuário não devem ser apagados automaticamente.
