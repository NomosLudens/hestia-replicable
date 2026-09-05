# Guia de Integração Frontend do Códice

Este guia detalha como o seu frontend do Códice deve se comunicar com a API da Héstia através do túnel Tailscale, respeitando a arquitetura local-first e os renderizadores nativos do Códice.

## 1. Configurações de Ambiente

A URL da Héstia não deve ser hardcoded e deve permitir sobreposição local. A precedência é:

1. Configuração local (`localStorage["codice.hestia.baseUrl"]`)
2. Variável de ambiente (`VITE_HESTIA_BASE_URL`)
3. Vazio (desativado)

```env
# Exemplo de .env no frontend
VITE_HESTIA_BASE_URL=https://sua-maquina.tailnet-exemplo.ts.net
```

No servidor da **Héstia** (backend), as seguintes variáveis devem estar presentes:

```bash
export HESTIA_STATION_ALLOWED_HOSTS="<HOST_PRIVADO>"
export HESTIA_CODICE_CORS_ORIGIN="https://seu-codice.app" # URL do seu frontend
export HESTIA_CODICE_SUPABASE_URL="https://<PROJETO>.supabase.co"
export HESTIA_CODICE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_<CHAVE>"
export HESTIA_CODICE_ALLOWED_USER_IDS="<UUID_SUPABASE>"
```

---

## 2. Consumindo a API com Segurança e ArrayBuffer

Todos os livros (EPUB, PDF, TXT) devem ser trafegados via `ArrayBuffer` a partir da Héstia e repassados para os renderizadores internos já existentes no Códice. Não utilize iframes ou URLs diretas nas bibliotecas de renderização para garantir controle total (progresso, notas, fallback).

### A. Cliente Mínimo (Fetch Seguro)

```javascript
export const getHestiaBaseUrl = () => {
  const configured =
    localStorage.getItem("codice.hestia.baseUrl") || import.meta.env.VITE_HESTIA_BASE_URL || "";

  return configured.trim().replace(/\/+$/, "");
};

async function fetchHestiaJson(path, accessToken, timeoutMs = 8000) {
  const baseUrl = getHestiaBaseUrl();
  if (!baseUrl) throw new Error("HESTIA_NOT_CONFIGURED");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(path, `${baseUrl}/`);
    const response = await fetch(url, {
      method: "GET",
      mode: "cors",
      cache: "no-store", // Evita cache indevido no browser
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HESTIA_HTTP_${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}
```

### B. Listar o Catálogo (Library)

A Héstia só deve ser testada e consultada quando o usuário interagir com a fonte **Estação** no aplicativo. Nunca bloqueie o Códice caso a Héstia esteja offline.

```javascript
export async function fetchHestiaLibrary(accessToken) {
  const data = await fetchHestiaJson("/api/codice/library", accessToken);

  if (data?.schemaVersion !== 1 || !Array.isArray(data.books)) {
    throw new Error("HESTIA_LIBRARY_INVALID");
  }

  return data.books;
}
```

### C. Download Rígido (ArrayBuffer)

O arquivo só deve ser aceito se pertencer aos mimetypes definidos, e deve ser entregue integralmente como Buffer ao renderizador.

```javascript
export async function fetchHestiaBook(book, accessToken) {
  const baseUrl = getHestiaBaseUrl();
  const base = new URL(`${baseUrl}/`);
  const url = new URL(book.url, base);

  if (url.origin !== base.origin || !url.pathname.startsWith("/api/codice/books/")) {
    throw new Error("HESTIA_BOOK_URL_INVALID");
  }

  const response = await fetch(url, {
    method: "GET",
    mode: "cors",
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`HESTIA_BOOK_HTTP_${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";

  const allowed =
    contentType.includes("application/epub+zip") ||
    contentType.includes("application/pdf") ||
    contentType.includes("text/plain");

  if (!allowed) {
    throw new Error("HESTIA_BOOK_TYPE_INVALID");
  }

  return await response.arrayBuffer();
}
```

### D. Renderizando

```javascript
// Exemplo de integração nos motores existentes do Códice
const buffer = await fetchHestiaBook(book);

if (book.format === "epub") {
  await ensureEpubLibs();
  await renderEpub(buffer, savedProgress);
} else if (book.format === "pdf") {
  await ensurePdfLib();
  await renderPdf(buffer, savedProgress);
} else if (book.format === "txt") {
  await renderTxt(buffer, savedProgress);
}
```

---

## 3. Topologia e PWA (Regras Rigorosas)

1. **Service Worker**:
   O service worker do Códice **não deve cachear** nenhuma URL remota da Héstia (`/api/codice/*`, `*.ts.net`, arquivos transferidos). O acesso à Héstia deve ser operado em esquema estrito de `network-only`.
2. **Resiliência Local**:
   Quando a Héstia estiver inacessível, exiba: `"Biblioteca da Estação indisponível. Verifique se este aparelho está conectado ao Tailscale e se a Héstia está ativa."`. A biblioteca local e os livros em cache do app-shell devem continuar funcionando perfeitamente (Local-First).
3. **Tailscale Serve**:
   No servidor da Héstia, inicie o túnel apenas via Serve com persistência em background.
   ```bash
   sudo tailscale serve --bg http://127.0.0.1:4517
   ```
   Verifique o status com `tailscale serve status`. Não utilize o Funnel, o serviço é restrito à sua Tailnet.
4. **CORS e Autenticação**:
   CORS autoriza apenas a origem exata do frontend. A identidade é validada pelo Supabase Auth e o `user.id` precisa constar na allowlist da Station. A Tailnet continua sendo uma camada de rede, não substitui autenticação ou autorização.

Este guia descreve a integração futura. O cliente Kódice atual ainda não envia o Bearer; por isso, a Station autenticada não deve ser implantada isoladamente. A API continua sem Range e sem upload/import.

### Resumo do Fluxo

_Cloudflare entrega o Códice._  
_O celular entra na tailnet._  
_O navegador consulta a Héstia._  
_A Héstia transmite o arquivo._  
_O Códice lê o ArrayBuffer com seu leitor existente._
