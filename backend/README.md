# Cérebro de Operações — EXPANSAO OSASCO

Backend em Python que recebe mensagens do grupo (via webhook), classifica cada uma com o
Google Gemini atuando como Gerente de Projetos, e cria o cartão na coluna certa do Trello.

```
POST /webhook  →  Gemini (JSON estruturado)  →  Trello (cartão em IDEIAS ou TAREFAS)
```

| Classificação | Destino |
| --- | --- |
| `ideia` — referências, inspirações, material de apoio | lista `TRELLO_LIST_ID_IDEIAS` |
| `tarefa` — decisões, entregas com responsável ou prazo | lista `TRELLO_LIST_ID_TAREFAS` |
| `ignorar` — bate-papo | nada é criado (responde `200 {"status":"ignored"}`) |

---

# Modo app (recomendado no Mac)

Um duplo clique liga tudo: ambiente, servidor e painel no Google Chrome.

```bash
cd backend
bash instalar_app.sh
```

Isso cria **“Cérebro de Operações.app”** em `~/Applications`, com ícone próprio. A partir
daí, é só clicar no app (ou arrastá-lo para o Dock). Ele:

1. cria o ambiente virtual e instala as dependências na primeira execução;
2. cria o `.env` a partir do exemplo e abre no editor, se ainda não existir;
3. escolhe uma porta livre e sobe o servidor;
4. abre o painel no Chrome.

> Na primeira abertura o macOS pode barrar um app não assinado: clique com o botão direito
> no app → **Abrir** → **Abrir**. Só é preciso fazer isso uma vez.

Sem instalar o app, o duplo clique em `backend/Cerebro.command` no Finder faz o mesmo.

## O painel

| Área | O que faz |
| --- | --- |
| **Barra superior** | Estado do sistema, botão *Atualizar* e *Encerrar* (desliga o servidor). |
| **Configuração** | Aparece enquanto faltarem as listas: escolhe board e colunas e grava no `.env`. |
| **Processar mensagem** | Cola a mensagem, roda o Gemini e mostra o cartão criado (⌘+Enter envia). |
| **Board ao vivo** | Últimos cartões das colunas de Ideias e Tarefas, com prazo vencido em vermelho. |
| **Histórico da sessão** | O que foi processado desde que o app abriu, incluindo falhas. |

---

## 1. Instalação manual (sem o app)

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install fastapi uvicorn requests google-generativeai python-dotenv
```

Para reproduzir o ambiente exato depois, use `pip install -r requirements.txt`
(e `requirements-dev.txt` para rodar os testes).

## 2. Credenciais

```bash
cp .env.example .env
open -e .env          # preencha GEMINI_API_KEY, TRELLO_API_KEY e TRELLO_TOKEN
```

O `.env` está no `.gitignore` e nunca vai para o repositório.

## 3. Descobrir os IDs das listas do Trello

```bash
python get_trello_lists.py "EXPANSAO"
```

O script lista todos os boards e colunas da conta (somente leitura) e já sugere as linhas
prontas para colar no `.env`:

```
▸ BOARD EXPANSAO OSASCO
  id: 6612ab…  ·  https://trello.com/b/…
  • Banco de Ideias                  66aa11bb22cc33dd44ee55ff   ← TRELLO_LIST_ID_IDEIAS
  • A Fazer                          66aa11bb22cc33dd44ee5600   ← TRELLO_LIST_ID_TAREFAS
```

Sem argumento, ele mostra todos os boards. Copie os dois IDs para o `.env`.

## 4. Subir o servidor

```bash
uvicorn main:app --reload
```

ou `python main.py` (usa `HOST`/`PORT` do `.env`). No boot o terminal mostra:

```
──────────────────────────────────────────────────────────
  CÉREBRO DE OPERAÇÕES  · EXPANSAO OSASCO
  modelo   gemini-1.5-flash
  webhook  http://127.0.0.1:8000/webhook
  saúde    http://127.0.0.1:8000/health
──────────────────────────────────────────────────────────
21:04:11  ›  Lista de IDEIAS  → 66aa11bb22cc33dd44ee55ff
21:04:11  ›  Lista de TAREFAS → 66aa11bb22cc33dd44ee5600
21:04:11  ›  Pronto. Aguardando mensagens…
```

## 5. Teste local

```bash
curl -X POST http://127.0.0.1:8000/webhook \
  -H "Content-Type: application/json" \
  -d '{"text": "Pessoal, foi confirmado que haverá ceia na Estadual neste domingo, vamos gravar vídeos ao final do culto para divulgar a Vigília. Lívia já mandou as referências, Letícia vai fazer o roteiro hoje."}'
```

Resposta esperada:

```json
{
  "status": "created",
  "action_type": "tarefa",
  "title": "Gravar vídeos da Vigília após o culto",
  "card_url": "https://trello.com/c/AbC12345",
  "card_id": "66f0…",
  "due_date": "2026-08-16T15:00:00.000Z"
}
```

E, no terminal do servidor:

```
21:05:02  ›  Mensagem recebida — Pessoal, foi confirmado que haverá ceia na Estadual…
21:05:03  ›  Gemini classificou como TAREFA
21:05:04  ›  Cartão criado: Gravar vídeos da Vigília após o culto · prazo 2026-08-16T15:00:00.000Z
21:05:04  ›     https://trello.com/c/AbC12345
```

O payload aceita campos opcionais `sender` e `group`, que entram no contexto do Gemini e
no rodapé do cartão:

```bash
curl -X POST http://127.0.0.1:8000/webhook \
  -H "Content-Type: application/json" \
  -d '{"text": "Lívia mandou umas referências de transição de vídeo.", "sender": "Lívia", "group": "EXPANSAO OSASCO"}'
```

---

## Endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/` | Painel web. |
| `POST` | `/webhook` | Recebe `{"text", "sender?", "group?"}` e devolve o resultado do processamento. |
| `GET` | `/health` | Estado do serviço, modelo em uso e se as listas estão configuradas. |
| `GET` | `/api/status` | Estado detalhado para o painel (nomes das listas, usuário do Trello). |
| `GET` | `/api/boards` | Boards e colunas disponíveis. |
| `POST` | `/api/config/lists` | Grava `TRELLO_LIST_ID_IDEIAS` / `_TAREFAS` no `.env`. |
| `GET` | `/api/cards` | Últimos cartões das duas colunas. |
| `GET`/`DELETE` | `/api/history` | Histórico em memória da sessão. |
| `POST` | `/api/shutdown` | Encerra o servidor local (botão do painel). |
| `GET` | `/docs` | Swagger UI gerado pelo FastAPI. |

Códigos de erro: `422` payload inválido · `409` configuração pendente ·
`400` configuração inconsistente · `502` falha no Gemini ou no Trello
(o corpo traz `stage` e `detail`).

## Estrutura

```
backend/
├── Cerebro.command       # duplo clique: prepara tudo, sobe e abre o Chrome
├── instalar_app.sh       # cria o .app em ~/Applications, com ícone
├── main.py               # FastAPI: painel, API, lifespan, tratamento de erros
├── get_trello_lists.py   # utilitário de mapeamento de boards/listas
├── cerebro/
│   ├── config.py         # .env → Settings validado (e gravação do .env)
│   ├── models.py         # contratos, normalização de rótulos e datas
│   ├── gemini.py         # prompt do Gerente de Projetos + parsing do JSON
│   ├── trello.py         # cliente HTTP com retry e erros acionáveis
│   ├── pipeline.py       # orquestração mensagem → classificação → cartão
│   ├── history.py        # histórico em memória da sessão
│   └── console.py        # logging colorido do terminal
├── web/                  # painel (HTML/CSS/JS puro, sem CDN)
├── tools/criar_icone.py  # gera o ícone do app sem dependências
└── tests/                # 73 testes, sem chamadas de rede
```

## Testes

```bash
pip install -r requirements-dev.txt
pytest
```

A suíte (73 testes) cobre normalização de datas e rótulos, parsing de JSON malformado do modelo,
retentativa, roteamento das listas, gravação do `.env`, histórico e os códigos de erro do webhook. Gemini e Trello são
substituídos por dublês — nenhum teste cria cartão de verdade nem gasta cota de API.

## Decisões de projeto

- **Datas.** O Gemini devolve ISO; o backend converte para UTC no formato do Trello. Data
  sem hora vira 12:00 no fuso da equipe (`TIMEZONE`), para um prazo "de domingo" não
  aparecer como sábado à noite. Data impossível de interpretar vira `null` em vez de quebrar.
- **Classificação desconhecida vira `ignorar`.** Melhor perder uma classificação duvidosa
  do que poluir o board.
- **Descrição audível.** O cartão sempre carrega a mensagem original em citação, além do
  resumo da IA — o time consegue conferir o que a IA leu.
- **Retentativa seletiva.** Erro transitório (5xx, timeout) é repetido; erro de credencial
  ou de modelo não é, porque repetir não resolve.
- **Falha alta.** Erros do Gemini e do Trello viram `502` com `stage` explícito, para o
  emissor do webhook conseguir reenviar.

## Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| `API key not valid` | A `GEMINI_API_KEY` não é uma chave da Gemini API. Gere em <https://aistudio.google.com/apikey> (formato `AIza…`). |
| `404 models/gemini-1.5-flash is not found` | O modelo saiu do ar para a sua chave. Troque `GEMINI_MODEL` no `.env` (ex.: `gemini-2.5-flash`) — nada mais muda. |
| `Trello recusou as credenciais (401)` | `TRELLO_API_KEY`/`TRELLO_TOKEN` errados ou token expirado. |
| `recurso não encontrado (404)` | ID de lista errado no `.env`. Rode `python get_trello_lists.py`. |
| `Address already in use` | Outra coisa na porta 8000: `uvicorn main:app --port 8001`. |

> O pacote `google-generativeai` está em modo de manutenção (o Google recomenda o novo
> `google-genai`). Ele continua funcionando; a migração toca apenas `cerebro/gemini.py`.
