# Héstia — Modelos locais leves

A Héstia não baixa modelos automaticamente e não chama Hugging Face pelo backend. O usuário instala modelos manualmente via Ollama, e a Héstia apenas consulta o Ollama local em `127.0.0.1:11434`.

## Como a Héstia usa modelos

- `/api/llm/health` apenas detecta modelos disponíveis no Ollama local.
- `/api/llm/chat` só aceita modelos presentes na allowlist interna da Héstia.
- O modelo default global é `qwen2.5:1.5b`.
- Nenhum endpoint novo, UI nova ou runtime novo é necessário.

## Geral leve

Nome humano: **Qwen2.5 1.5B Instruct**

ID Ollama:

```txt
qwen2.5:1.5b
```

Uso recomendado: conversa leve, prompts, resumo, organização e fallback local.

Instalação manual:

```bash
ollama pull qwen2.5:1.5b
```

## Klio Coder leve

Nome humano: **Qwen2.5-Coder 1.5B Instruct Q8_0**

ID Ollama/HF:

```txt
hf.co/bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q8_0
```

Uso recomendado: Klio técnica local — HTML único, scripts pequenos, revisão curta, debug leve e prompts técnicos.

Instalação manual:

```bash
ollama run hf.co/bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q8_0
```
