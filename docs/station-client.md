# Limite do Station Client

Este documento foi consolidado. O contrato atual, as variáveis explícitas de `desktop`/`tvbox`, as rotas plurais e o procedimento operacional ficam em [`DEPLOYMENT.md`](DEPLOYMENT.md) e no [README](../README.md).

O navegador consulta apenas a origem da Héstia Console. O backend resolve uma configuração separada para cada Station, envia o Bearer correspondente server-to-server e devolve somente contratos sanitizados. URL e token nunca chegam ao frontend.

Os únicos IDs aceitos são `desktop` e `tvbox`; não há descoberta nem lista dinâmica.
