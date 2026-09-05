# Códice API sobre Tailscale

A Station da TV Box funciona em loopback (`127.0.0.1:4519`), sem expor a API de arquivos abertamente para a rede local ou externa.

Como a Héstia precisa ser acessada pelo Códice de diferentes dispositivos autorizados (como celulares ou web browsers na mesma Tailnet) sem expor ou transferir os livros para a Nuvem pública, utilizaremos o **Tailscale Serve** para tunelar as requisições HTTPS privadas e locais diretamente para a porta local da Héstia.

---

## 🛠️ Como funciona a topologia

1. **Servidor Héstia (Kaline)**:
   A Station continua escutando em `127.0.0.1:4519` para fins de segurança, sem fazer bind em `0.0.0.0`.

2. **Tailscale Serve (HTTPS Privado)**:
   O Tailscale Serve oferece HTTPS privado e local na Tailnet. O Funnel permanece desativado (sem exposição pública na internet).
   Para iniciar o proxy reverso em background apontando para a porta HTTP local da Héstia:

   ```bash
   sudo tailscale serve --bg http://127.0.0.1:4519
   ```

   Para inspecionar e comprovar o status e a URL gerada:

   ```bash
   tailscale serve status
   ```

3. **Controle de Acesso em Camadas**:
   - **Acesso à Rede (Tailscale)**: Apenas dispositivos conectados e autorizados na mesma Tailnet privada podem resolver e alcançar a URL gerada pelo Tailscale Serve.
   - **Host Guard**: valida o cabeçalho `Host` contra os hosts explicitamente permitidos, reduzindo o risco de DNS rebinding.
   - **CORS Estrito**: Controla e restringe quais origens web executadas no navegador (como a interface web do Códice) podem fazer chamadas de API (`fetch`) à Héstia. Note que o CORS atua no nível do navegador e não serve como autenticação direta de rede.
   - **Supabase Auth + allowlist**: requisições públicas `GET` e `HEAD` de `/api/codice/*` exigem Bearer de usuário validado pelo Auth server e `user.id` explicitamente autorizado. Requisições `OPTIONS` validam apenas o preflight CORS, sem Bearer e sem consulta ao Supabase. O token da Station serve somente às rotas administrativas.

---

## 💾 Configuração Persistente

As variáveis devem ser salvas no arquivo protegido da Station, lido pelo systemd:

```bash
sudoedit /etc/default/hestia-station-agent
```

Adicione as variáveis de ambiente necessárias (usando placeholders genéricos para preservar dados privados):

```ini
HESTIA_STATION_ALLOWED_HOSTS="<HOST_PRIVADO>"
HESTIA_STORAGE_PATH="/KALINE"
HESTIA_CODICE_CORS_ORIGIN="https://<CODICE_ORIGIN_REDACTED>"
HESTIA_CODICE_SUPABASE_URL="https://<PROJETO>.supabase.co"
HESTIA_CODICE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_<CHAVE>"
HESTIA_CODICE_ALLOWED_USER_IDS="<UUID_SUPABASE>"
```

Após editar o arquivo, recarregue o systemd e reinicie o serviço para aplicar as configurações:

```bash
sudo systemctl daemon-reload
sudo systemctl restart hestia-station-agent
systemctl status hestia-station-agent --no-pager
```

Use somente chave publicável. Não há Range, upload ou import. Esta configuração não deve ser aplicada antes de o cliente Kódice estar preparado para enviar o Bearer Supabase; Station e cliente precisam ser implantados de forma coordenada.
