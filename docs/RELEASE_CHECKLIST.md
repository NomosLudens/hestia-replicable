# Héstia — Release Checklist

## Objetivo

Validar a Héstia como Station local instalável antes de considerar a versão fechada.

## 1. Limpeza do repo

```bash
git status --short
```

Não devem entrar:

- `node_modules/`
- `dist/`
- `dist-deb/`
- `*.deb`
- `.env`
- logs locais
- arquivos de `/KALINE`

## 2. Validação local

```bash
npm ci
npm run lint
npm test
npm run build
npm run build-deb
```

## 3. Verificar pacote

```bash
dpkg-deb --info dist-deb/*.deb
dpkg-deb --contents dist-deb/*.deb | grep -E 'hestia-console|desktop|icons|systemd|/opt/'
```

## 4. Instalação manual

```bash
sudo apt install ./dist-deb/hestia-console_*.deb
```

## 5. Serviço

```bash
systemctl status hestia-console
journalctl -u hestia-console -n 80 --no-pager
```

## 6. Health

```bash
curl -s http://127.0.0.1:4517/api/health
curl -s http://127.0.0.1:4517/api/storage/status
curl -s http://127.0.0.1:4517/api/llm/health
curl -s http://127.0.0.1:4517/api/hermes/status
```

## 7. Launcher

Abrir pelo menu do Linux Mint Xfce:

- Héstia Console abre;
- navegador abre em modo app ou fallback;
- app responde em `127.0.0.1:4517`.

## 8. Segurança

Confirmar:

- não escuta em `0.0.0.0` por padrão;
- `HESTIA_ALLOW_LAN` não vem ativado;
- `/api/local/*` exige confirmação;
- Hermes process-once exige `X-Hestia-Local-Confirm: hermes`;
- não há Supabase;
- não há OpenRouter;
- não há Syncthing como requisito.

## 9. Resultado

A release só passa se:

- instala;
- inicia;
- responde health;
- mostra Console;
- doctor roda;
- nenhum segredo vaza;
- nenhum endpoint perigoso ficou aberto.
