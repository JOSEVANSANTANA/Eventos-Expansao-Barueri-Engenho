# Cérebro de Operações — EXPANSAO OSASCO

Backend em Python que lê as mensagens da equipe, classifica cada uma com o Google Gemini
atuando como Gerente de Projetos, e cria o cartão na coluna certa do Trello. Roda no seu
Mac, com painel no Chrome.

```
WhatsApp (ou painel)  →  fila local  →  Gemini  →  Trello
                            ↑
                     nada se perde se a internet cair
```

| Classificação | Destino |
| --- | --- |
| `ideia` — referências, inspirações, material de apoio | lista `TRELLO_LIST_ID_IDEIAS` |
| `tarefa` — decisões, entregas com responsável ou prazo | lista `TRELLO_LIST_ID_TAREFAS` |
| `ignorar` — bate-papo | nada é criado (fica só no histórico) |

---

# 1. Instalar (uma vez)

```bash
cd backend
bash instalar_app.sh
```

Cria **“Cérebro de Operações.app”** em `~/Applications`, com ícone próprio. A partir daí é
só clicar no app (ou arrastá-lo para o Dock). Ele prepara o ambiente, sobe o servidor e
abre o painel no Chrome.

> Na primeira abertura o macOS pode barrar um app não assinado: botão direito no app →
> **Abrir** → **Abrir**. Só uma vez.

Sem instalar o app, o duplo clique em `backend/Cerebro.command` faz o mesmo.

# 2. Preencher as chaves

Na primeira execução o `.env` é criado e aberto no editor. Preencha:

```
GEMINI_API_KEY=...      # https://aistudio.google.com/apikey
TRELLO_API_KEY=...      # https://trello.com/power-ups/admin
TRELLO_TOKEN=...
```

Salve e rode o app de novo.

# 3. Escolher as colunas

No painel, aba **Operação**: clique em **Carregar boards**, escolha o board e as duas
colunas, e salve. O Cérebro grava os IDs no `.env` sozinho.

Pronto — já dá para colar uma mensagem em **Processar mensagem** e ver o cartão nascer.

---

## O painel

Três abas:

### Operação
Processa mensagem colada, mostra o board ao vivo (prazo vencido em vermelho) e o
histórico com origem (painel ou WhatsApp), status e erros. Botão **Reprocessar fila**
devolve para a fila o que falhou.

### Estúdio Criativo
Usa a mesma chave do Gemini para **produzir**, não só classificar:

- **Gerar ideias** — você dá o tema ("divulgação da Vigília de sexta"), ele lê o board
  para não repetir o que já existe e devolve pauta nova com formato, esforço e prazo
  sugerido. Você marca o que aprova e manda para o Trello com um clique.
- **Organizar o board** — lê as duas colunas e devolve prioridades (com o motivo),
  cartões duplicados que podem ser fundidos, lacunas e próximos passos. Não altera nada
  no Trello: é leitura e recomendação.

### Conexões
Configura o WhatsApp e mostra o estado da rede (onde está escutando, se exige token).

---

## Online e offline

**Toda mensagem é gravada em SQLite antes de qualquer chamada externa.** Se o Gemini, o
Trello ou a sua internet estiverem fora do ar, a mensagem fica pendente e é reprocessada
sozinha — com espera crescente (1, 2, 4… até 60 minutos), até 8 tentativas. Nada se perde
entre reinícios do app, porque o banco fica em `backend/dados/cerebro.db`.

Erro que repetir não resolve (chave inválida, lista inexistente) não fica em loop: vira
`erro` na hora e espera você arrumar — depois é só clicar em **Reprocessar fila**.

O contador na barra superior mostra quantas estão na fila.

### Modo servidor

```bash
bash "Cerebro Servidor.command"
```

Publica na rede local (`0.0.0.0`), gera um **token de acesso** e mostra:

- o endereço do painel para abrir em outro aparelho: `http://SEU-IP:8000/?token=...`
- a URL do webhook para o WhatsApp
- o comando de túnel para receber de fora da rede

Quem acessa do próprio Mac nunca precisa do token; de fora, é obrigatório.

### Rodar sempre (sem janela aberta)

```bash
bash instalar_servico.sh          # sobe junto com o login e reinicia se cair
bash instalar_servico.sh remover  # desfaz
```

Log em `~/Library/Logs/CerebroOperacoes.log`. O Mac precisa estar ligado e logado.

---

## WhatsApp automático

Para as mensagens do grupo chegarem sozinhas: **[backend/whatsapp/README.md](whatsapp/README.md)**.

Resumo das opções:

| Provedor | Lê grupos? | Como |
| --- | --- | --- |
| **Evolution API** (recomendado) | Sim | Docker no seu Mac + QR code. `cd whatsapp && docker compose up -d && bash conectar.sh` |
| **Meta Cloud API** | Não (só conversa direta) | App na Meta + túnel HTTPS |
| **Genérico** | Depende da sua automação | Atalhos do iOS, n8n, Make, Zapier fazem POST no webhook |

O Cérebro descarta sozinho: mensagem sem texto, mensagem sua, grupo fora da lista e
mensagem repetida (mesmo `id`) — sem cartão duplicado.

---

## Endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/` | Painel web. |
| `POST` | `/webhook` | Mensagem avulsa `{"text", "sender?", "group?"}`. |
| `POST` | `/webhook/whatsapp` | Entrada do provedor de WhatsApp (autenticação própria). |
| `GET` | `/webhook/whatsapp` | Handshake da Meta (`hub.challenge`). |
| `GET` | `/health` | Sinal de vida. |
| `GET` | `/api/status` | Estado completo: listas, fila, WhatsApp, rede. |
| `GET` | `/api/boards` | Boards e colunas do Trello. |
| `POST` | `/api/config/lists` · `/api/config/whatsapp` | Gravam no `.env`. |
| `GET` | `/api/cards` | Últimos cartões das duas colunas. |
| `GET`/`DELETE` | `/api/history` | Histórico persistente. |
| `POST` | `/api/fila/reprocessar` | Devolve os erros para a fila. |
| `POST` | `/api/estudio/ideias` | Gera pauta nova. |
| `POST` | `/api/estudio/organizar` | Analisa o board. |
| `POST` | `/api/estudio/criar-cartoes` | Cria no Trello as ideias aprovadas. |
| `POST` | `/api/shutdown` | Encerra o servidor. |
| `GET` | `/docs` | Swagger UI. |

Erros: `422` payload inválido · `409` configuração pendente · `401` token/assinatura
inválidos · `502` falha no Gemini ou no Trello (o corpo traz `stage` e `detail`).

### Teste pelo Terminal

```bash
curl -X POST http://127.0.0.1:8000/webhook \
  -H "Content-Type: application/json" \
  -d '{"text": "Pessoal, foi confirmado que haverá ceia na Estadual neste domingo, vamos gravar vídeos ao final do culto para divulgar a Vigília. Lívia já mandou as referências, Letícia vai fazer o roteiro hoje."}'
```

---

## Estrutura

```
backend/
├── Cerebro.command           # duplo clique: sobe e abre o Chrome
├── Cerebro Servidor.command  # modo servidor (rede local + token)
├── instalar_app.sh           # cria o .app em ~/Applications
├── instalar_servico.sh       # sobe junto com o login do Mac
├── main.py                   # FastAPI: painel, API, webhooks, worker da fila
├── get_trello_lists.py       # mapeia boards/listas pelo terminal
├── cerebro/
│   ├── config.py             # .env → Settings (e gravação do .env)
│   ├── db.py                 # fila persistente em SQLite
│   ├── models.py             # contratos, normalização de rótulos e datas
│   ├── gemini.py             # classificação (Gerente de Projetos)
│   ├── estudio.py            # criação e organização (Diretor de Criação)
│   ├── whatsapp.py           # tradutores Evolution/Meta/genérico
│   ├── trello.py             # cliente HTTP com retry
│   ├── pipeline.py           # mensagem → classificação → cartão
│   └── console.py            # logging colorido
├── web/                      # painel (HTML/CSS/JS puro, sem CDN)
├── whatsapp/                 # Evolution API em Docker + conectar.sh
├── tools/criar_icone.py      # ícone do app, sem dependências
└── tests/                    # 150 testes, sem chamadas de rede
```

## Testes

```bash
pip install -r requirements-dev.txt
pytest
```

150 testes cobrindo normalização de datas e rótulos, JSON malformado do modelo,
retentativa, fila offline com backoff, tradutores de WhatsApp (incluindo assinatura
HMAC da Meta), estúdio criativo, token de rede e os códigos de erro das rotas. Gemini,
Trello e WhatsApp são substituídos por dublês — nenhum teste faz chamada de rede, cria
cartão ou gasta cota.

## Decisões de projeto

- **Grava antes de processar.** A mensagem entra no banco antes da primeira chamada
  externa; é o que permite sobreviver a queda de rede sem perder nada.
- **Retentativa seletiva.** Erro transitório volta para a fila com espera crescente;
  credencial inválida ou lista inexistente viram erro imediato, porque repetir só
  queimaria cota.
- **Classificação desconhecida vira `ignorar`.** Melhor perder uma classificação duvidosa
  do que poluir o board.
- **Descrição auditável.** O cartão sempre carrega a mensagem original em citação, além
  do resumo da IA.
- **Duas temperaturas.** Classificar usa 0.2 (consistência); criar usa 0.9 (variedade).
- **Nada de CDN.** O painel é HTML/CSS/JS local: funciona sem internet.

## Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| `API key not valid` | A `GEMINI_API_KEY` não é uma chave da Gemini API. Gere em <https://aistudio.google.com/apikey> (formato `AIza…`). |
| `404 models/gemini-1.5-flash is not found` | O modelo saiu do ar para a sua chave. Troque `GEMINI_MODEL` no `.env` (ex.: `gemini-2.5-flash`). |
| `Trello recusou as credenciais (401)` | `TRELLO_API_KEY`/`TRELLO_TOKEN` errados ou token expirado. |
| `recurso não encontrado (404)` | ID de lista errado. Reconfigure pelo painel. |
| Mensagens do grupo não chegam | Confira `bash whatsapp/conectar.sh status` e se o nome em `WHATSAPP_GRUPOS` bate com o do grupo. |
| Fila crescendo | Abra o histórico: o erro de cada mensagem aparece embaixo dela. |
| `Address already in use` | Outra coisa na porta: o `Cerebro.command` já procura porta livre sozinho. |

> O pacote `google-generativeai` está em modo de manutenção (o Google recomenda o novo
> `google-genai`). Continua funcionando; a migração toca `cerebro/gemini.py` e
> `cerebro/estudio.py`.
