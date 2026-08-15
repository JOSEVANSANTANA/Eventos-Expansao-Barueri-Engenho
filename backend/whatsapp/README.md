# Conectar o WhatsApp ao Cérebro

O objetivo: as mensagens do grupo chegam sozinhas, sem ninguém copiar e colar nada.

Existem três caminhos. Escolha um.

---

## Opção A — Evolution API no seu Mac (recomendada)

É a única que **lê mensagens de grupo**. Roda em Docker na sua máquina; a conversa
não passa por serviço de terceiros.

**Precisa de:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) e um
número de WhatsApp para parear (o mesmo esquema do WhatsApp Web).

```bash
cd backend/whatsapp
cp .env.exemplo .env
open -e .env                 # troque EVOLUTION_API_KEY por uma senha longa
docker compose up -d         # sobe Evolution + Postgres + Redis
bash conectar.sh             # cria a instância e abre o QR code
```

Escaneie o QR no celular (**WhatsApp → Configurações → Aparelhos conectados**). Depois:

```bash
bash conectar.sh grupos      # lista os grupos e os nomes exatos
bash conectar.sh status      # confere se está conectado
```

No `backend/.env` do Cérebro:

```
WHATSAPP_PROVIDER=evolution
WHATSAPP_API_KEY=<a mesma EVOLUTION_API_KEY>
WHATSAPP_GRUPOS=EXPANSAO OSASCO
```

Reinicie o Cérebro. Pronto: toda mensagem de texto do grupo passa pelo Gemini e vira
cartão quando for ideia ou tarefa.

> O Mac precisa estar ligado para capturar. Para o Cérebro subir sozinho no login,
> rode `bash instalar_servico.sh` na pasta `backend`.

### Como parar

```bash
docker compose down          # para os containers (dados preservados)
docker compose down -v       # apaga também os volumes e desconecta o número
```

---

## Opção B — WhatsApp Cloud API (oficial da Meta)

**Limite importante:** a API oficial **não entrega mensagens de grupo**, só conversas
diretas com o número comercial. Se o objetivo é ler o grupo da equipe, use a Opção A.

1. Crie um app em [developers.facebook.com](https://developers.facebook.com/) e adicione
   o produto **WhatsApp**.
2. Exponha o Cérebro em HTTPS (a Meta exige):
   `cloudflared tunnel --url http://127.0.0.1:8000`
3. Em **Configuration → Webhook**, informe:
   - **Callback URL:** `https://sua-url/webhook/whatsapp`
   - **Verify token:** o mesmo valor de `WHATSAPP_VERIFY_TOKEN`
   - Assine o campo `messages`.
4. No `backend/.env`:

```
WHATSAPP_PROVIDER=meta
WHATSAPP_VERIFY_TOKEN=<o que você digitou na Meta>
WHATSAPP_APP_SECRET=<App Secret, em Configurações básicas>
```

O `WHATSAPP_APP_SECRET` faz o Cérebro validar a assinatura `X-Hub-Signature-256` de cada
requisição — sem ele, qualquer um que descubra a URL consegue injetar mensagens.

---

## Opção C — Genérico (Atalhos do iOS, n8n, Make, Zapier)

Para quem já tem uma automação capturando as mensagens. Basta fazer um POST:

```bash
curl -X POST http://127.0.0.1:8000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -H "apikey: $WHATSAPP_API_KEY" \
  -d '{"text": "Vamos gravar no domingo", "sender": "Lívia",
       "group": "EXPANSAO OSASCO", "id": "identificador-unico"}'
```

```
WHATSAPP_PROVIDER=generico
WHATSAPP_API_KEY=<senha que a sua automação vai mandar no cabeçalho apikey>
```

O campo `id` é opcional, mas recomendado: com ele o Cérebro reconhece reenvios e não
cria o mesmo cartão duas vezes.

---

## O que o Cérebro descarta sozinho

| Situação | O que acontece |
| --- | --- |
| Mensagem sem texto (áudio, figurinha, foto sem legenda) | Ignorada. |
| Mensagem enviada pelo próprio número conectado | Ignorada (`WHATSAPP_IGNORAR_PROPRIAS=sim`). |
| Grupo fora de `WHATSAPP_GRUPOS` | Ignorada. |
| Mensagem repetida (mesmo `id`) | Ignorada — sem cartão duplicado. |
| Bate-papo classificado como `ignorar` pelo Gemini | Registrada no histórico, sem cartão. |
| Chegou com o Trello fora do ar ou sem internet | Vai para a fila e é reprocessada sozinha. |

## Segurança da porta aberta

Se você expõe o Cérebro para a internet (túnel), duas proteções ficam ativas:

- `SERVER_TOKEN` — exigido em todas as rotas do painel para acessos que não venham do
  próprio Mac. O `Cerebro Servidor.command` gera um automaticamente.
- Autenticação do webhook — `apikey` (Evolution/genérico) ou assinatura HMAC (Meta).
  Sem o valor correto, a requisição é recusada com 401 antes de chegar ao Gemini.
