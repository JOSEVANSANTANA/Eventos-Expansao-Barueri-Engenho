# Radar Institucional

Central de produção de conteúdo financeiro. Abre no Chrome, varre o mercado do dia,
devolve pauta com fonte, roteiro pronto para teleprompter, CTA de banking, direção
audiovisual, SEO e prompt de thumbnail.

---

## Como abrir

**Opção 1 — servidor local (recomendado):**

```bash
cd radar-institucional
python3 -m http.server 8080
```

Abra `http://localhost:8080` no Chrome.

**Opção 2 — arquivo direto:** dê duplo clique em `index.html`.
Funciona, mas o service worker e a área de transferência ficam limitados no `file://`.

**Instalar como app:** com o servidor rodando, clique no ícone de instalação na
barra de endereços do Chrome. A ferramenta passa a abrir em janela própria.

---

## Configuração inicial (uma vez)

A ferramenta fala com **três provedores de IA**. Preencha as chaves que você tiver —
basta uma. Em cada trabalho você escolhe qual usar.

| Provedor | Onde pegar a chave | Começa com | Modelos |
|---|---|---|---|
| **Claude (Anthropic)** | console.anthropic.com/settings/keys | `sk-ant-` | Opus 5, Sonnet 5, Haiku 4.5 |
| **Gemini (Google)** | aistudio.google.com/apikey | `AIza` | 3.7 Flash, 3.1 Pro, 3.5 Flash, 2.5 Flash |
| **OpenRouter** | openrouter.ai/keys | `sk-or-` | catálogo vivo, ~400 modelos |

1. Abra **Configurações** e cole a(s) chave(s). O botão 👁 mostra o que foi colado —
   use quando um teste falhar, porque colagem torta é a causa mais comum
2. Clique em **Testar** em cada bloco — o teste faz uma chamada real

**A ferramenta não valida o formato da chave.** Cada provedor muda o formato dos seus
tokens sem aviso: chaves do Gemini, por exemplo, aparecem tanto como `AIza…` quanto como
`AQ.…`. Quem decide se a chave vale é a API, não um palpite de prefixo no cliente.

Espaços e quebras de linha são removidos automaticamente. Isso importa mais do que parece:
um `\n` invisível numa chave torna o cabeçalho HTTP inválido, e o navegador derruba a
chamada com um "network error" genérico, antes mesmo de sair da máquina.
3. Escolha o **provedor preferido** e o modelo de cada um
4. Preencha sua identidade (marca, certificações, bagagem)
5. Salvar

**Qual escolher.** Para o pacote completo, prefira **Claude ou Gemini** — o JSON é longo
e estruturado, e modelos pequenos falham nele (foi exatamente o erro *"respondeu fora do
formato esperado"*). O Gemini recebe `responseMimeType: application/json`, que força saída
válida no nível do decodificador. Os gratuitos da OpenRouter servem bem para a varredura,
que é mais curta.

**Escolha por trabalho.** Com mais de uma chave preenchida, ao clicar em *Rodar varredura*
ou ao abrir uma pauta, a ferramenta pergunta qual IA usar. Dá para desligar essa pergunta
na própria caixa ou em Configurações.

**Reserva automática.** Se o provedor escolhido falhar por motivo que trocar resolve — sem
crédito, limite atingido, instabilidade — a ferramenta tenta os outros configurados sozinha.
Chave inválida não cai para o próximo: trocar de provedor não conserta chave errada.

**As chaves ficam só no seu navegador** (`localStorage`) e vão direto para cada provedor,
sem servidor intermediário. Defina limite de gasto no painel de cada um.

## O coletor de manchetes

**O problema que ele resolve:** nenhum feed de notícia libera CORS, então o navegador não
consegue lê-los sozinho. E a busca web da OpenRouter é paga — sem saldo, não roda.

**A solução:** o `servidor.py` que os atalhos já sobem colhe notícia do lado do servidor,
onde CORS não se aplica. Sem instalar nada, sem chave, sem custo — só a biblioteca padrão
do Python.

### 47 fontes

| Grupo | Quantas | Quais |
|---|---|---|
| **Consultas Google News BR** | 15 | macro, inflação, bolsa, câmbio, tributos, dividendos, imóveis, crédito, previdência, cripto, empresas, fiscal, proteção, varejo, regulação |
| **Consultas Google News internacional** | 6 | Fed/FOMC, inflação EUA, Wall Street, geopolítica e commodities, bancos centrais, emergentes |
| **Veículos brasileiros** | 8 | Folha Mercado, G1 Economia, Estadão Economia, InfoMoney, Money Times, Seu Dinheiro, Exame Invest, CVM |
| **Veículos internacionais** | 10 | New York Times (Business e Economy), CNBC (Finance e Economy), Yahoo Finance, Investing.com (Geral e Economia), MarketWatch, WSJ Markets, Federal Reserve |
| **Via Google News** | 6 | Reuters, Bloomberg, Financial Times, Valor Econômico, CNN Brasil, Folha |
| **Google Trends** | 2 | Brasil e Estados Unidos |

Medido: **cerca de 2.400 manchetes financeiras de 47 fontes em 14 segundos**, em português
e inglês, cobrindo 28 frentes. Cache de 5 minutos; *Colher manchetes agora* força coleta nova.

As listas ficam no topo do `servidor.py`. **É lá que se abre ou fecha o leque.**

### O filtro de pertinência

Feed geral e consulta por site trazem polícia, futebol e trânsito junto. Toda manchete
passa por um léxico financeiro em português e inglês — se não fala de dinheiro, não entra.
Isso derruba cerca de 20% do volume bruto e é o que impede "escada rolante do metrô" de
virar pauta de investimento.

Nomes de veículo também viram stopword automaticamente: sem isso, *valor*, *financial*,
*bloomberg* e *paulo* (de Folha de S.Paulo) apareciam como se fossem assunto.

### Quando a coleta falha

Se a coleta voltar vazia, a tela mostra **fonte por fonte o que aconteceu**, com a mensagem
de erro exata. Coleta vazia sem explicação era um bug — o usuário ficava sem saber se não
houve notícia ou se algo quebrou.

O erro mais provável no macOS é certificado: Python instalado do python.org não usa o
chaveiro do sistema e falha em toda conexão https até rodar
`Install Certificates.command`. O coletor detecta isso, tenta o pacote `certifi`, e em
último caso roda sem verificação — **avisando na tela**, com a instrução de correção.

## Por que as pautas não repetem mais

Três travas, e a primeira era um bug grave.

**1. Janela de tempo na consulta.** As consultas temáticas iam ao Google News **sem
operador de tempo**, e o Google devolve os melhores resultados de *todos os tempos* —
que não mudam nunca. Medido: a consulta de tributos trazia mediana de **98 dias** de
idade, com 1 item em 60 nas últimas 24h. Com `when:2d`, 100% nas últimas 24h. Era esta a
razão de a ferramenta repetir imposto de renda, previdência e salário mínimo dia após dia.

**2. Corte duro de idade.** Matéria com mais de 60h não entra na análise. Ponderar
recência não bastava: material velho ainda somava volume e amplitude, e um assunto perene
acumulado ao longo de semanas vencia uma notícia de hoje.

**3. Memória entre coletas.** O servidor guarda o volume de cada assunto por coleta
(`memoria-coletas.json`, últimas 20). Isso permite responder às duas perguntas que
decidem pauta:

| Selo | O que significa | Efeito na nota |
|---|---|---|
| **novo** | nunca apareceu nas coletas anteriores | +26 |
| **em alta** | volume cresceu 1,4× ou mais | até +22 |
| **recorrente** | apareceu em 3+ coletas sem crescer | **−10 a −32** |

A penalidade de recorrência é a régua: um assunto que ocupa o topo há dias afunda sozinho,
por mais que o noticiário continue publicando sobre ele.

## Como um assunto é identificado

**Só bigramas.** Palavra solta é sempre uma de duas coisas: categoria (*crédito*,
*inflação*) ou verbo de manchete (*dispara*, *alerta*, *defende*). Nenhuma das duas é
pauta. Exigir duas palavras resolve por construção — *"Ibovespa dispara"* é assunto,
*"dispara"* sozinho não é.

Sobre isso, três filtros medidos no próprio material do dia:

- **Palavras das minhas consultas viram stopword automaticamente.** Se eu busco por
  "inflação", achar "inflação" no resultado é tautologia. São 110 palavras derivadas
  sozinhas — a lista se corrige quando alguém editar as consultas.
- **Cabeça de categoria.** Palavra que encabeça 3+ bigramas frequentes (*juros* puxa
  *alta de juros*, *corte de juros*…) é categoria e sai.
- **Recheio de manchete.** Bigrama formado só de verbos e marcadores (*"atinge maior"*,
  *"nesta feira"*) descreve a construção da frase, não o fato.

O resultado, medido: onde antes vinham *imposto de renda*, *previdência* e *salário
mínimo* todo dia, agora vêm *bond yields*, *banco central holandês move ouro*, *BC prepara
medidas contra endividamento*, *Bank of Canada segura juros*, *pesquisa Quaest move o
Ibovespa* e *tensões com o Irã*.

## Termômetro de viralização

A nota **não é opinião do modelo**. É calculada a partir da cobertura real, com cinco
componentes visíveis na aba Termômetro:

| Componente | Peso | O que mede |
|---|---|---|
| **Amplitude** | 28 | em quantos veículos diferentes o assunto bateu |
| **Velocidade** | 26 | quão recente é a cobertura (últimas 6h contam 3×, 24h 2×, 72h 1×) |
| **Volume** | 16 | quantas matérias no total |
| **Tensão** | 16 | quanto atrito as manchetes carregam (léxico de conflito) |
| **Busca** | 8 | volume no Google Trends, quando o termo aparece lá |

Bônus para assunto que cruza mais de uma frente (+6) e para assunto nomeado por duas
palavras (+6).

**Como ele separa assunto de categoria.** Esse foi o problema difícil. "Crédito",
"juros" e "mercado" aparecem em quase toda matéria de economia — são o nome da
editoria, não pauta. A ferramenta resolve em duas passadas: primeiro mede quantos
bigramas diferentes cada palavra encabeça; palavra que se combina com três ou mais
coisas ("juros" puxa *alta de juros*, *corte de juros*, *juros altos*…) é categoria e
sai da lista. O que sobra são assuntos de verdade: *dívida pública*, *imposto de renda*,
*inadimplência*, *crédito imobiliário*, *reforma tributária*, *Braskem*.

Cada pauta gerada mostra se a temperatura é **medida** (copiada do coletor) ou
**estimada** (o modelo julgou, quando a pauta não veio da lista).

## Como ela evita repetir pauta

Três travas, todas no prompt:

1. Os temas dos **últimos 12 pacotes salvos** vão junto com a instrução explícita de não
   repetir. Um tema só pode voltar com ângulo declaradamente diferente.
2. A varredura é obrigada a cobrir **pelo menos 4 frentes distintas** entre as 14.
3. Cada pauta deve apontar para um **produto diferente** da esteira sempre que possível —
   seis pautas terminando no mesmo produto é falha de varredura.

Salvar os pacotes no Histórico não é opcional: é o que alimenta a trava.

## Escolha de modelo

A OpenRouter é um roteador, e a ferramenta usa isso a favor: em vez de cravar um
modelo, ela lê o catálogo vivo (`/api/v1/models`, endpoint público) e **pontua cada
modelo** para esta tarefa específica — escrever roteiro longo em português e devolver
JSON válido. A pontuação está explícita em `js/openrouter.js`, na função `pontuar()`,
e segue a ordem em que as coisas quebram na prática:

| Peso | Critério | Por quê |
|---|---|---|
| +1000 | é o `openrouter/free` | roteador oficial: distribui a carga, é o que menos esbarra em limite |
| +200 / −400 | tamanho do modelo | ≥90B ganha, <15B perde: modelo pequeno não sustenta roteiro de 12 min |
| +250 | suporta `structured_outputs` | JSON quebrado é a segunda falha mais comum |
| +120 | texto puro (não multimodal) | segue instrução melhor |
| ~×12 | log₂ do contexto | importa, mas menos que o resto |

Modelos que não servem são descartados antes: geradores de música, classificadores
de segurança, embeddings, TTS e modelos `stealth/` (que registram os prompts).

No seletor você vê os **três grupos** — Automático, Gratuitos e Pagos — com a lista
completa lida da OpenRouter na hora. Escolher um modelo específico não desliga a
proteção: ele vai como primeiro da fila e os gratuitos ficam de reserva atrás.

## Por que a varredura sempre devolve algo

Cada chamada percorre uma **cascata** de até 7 modelos (`chamarComCascata`). Ela trata
dois casos separadamente:

- **402, sem créditos.** A busca web é cobrada por consulta, mesmo com modelo gratuito.
  Então 402 com busca ligada é quase sempre a busca, não o modelo. A cascata **desliga
  a busca e repete o mesmo modelo** — e o resultado vem marcado.
- **429, limite atingido.** Espera progressiva e passa para o próximo modelo.
  O tier gratuito dá 20 chamadas por minuto e 50 por dia.

Qualquer outra falha simplesmente avança para o próximo da fila.

### O que muda quando a busca não roda

Isso importa mais que tudo, então a ferramenta grita em vez de sussurrar: aparece um
**aviso vermelho no topo** das pautas e do pacote dizendo que não houve busca web.

E o prompt muda junto — não é o mesmo pedido com menos informação. Em modo sem busca,
o modelo é **proibido** de citar notícia, evento, lei ou qualquer número que não esteja
literalmente no bloco de dados do Banco Central, e proibido de inventar URL. As pautas
saem do contraste entre os indicadores reais, que é material forte por si só: juro real
contra custo do crédito, poupança contra cheque especial, IPCA corrente contra
expectativa do Focus.

Traduzindo: **sem saldo você continua recebendo pauta e roteiro**, com números
verdadeiros e datados — só não recebe novidade das últimas 72 horas. Para ligar a
busca, basta ter saldo na OpenRouter (a partir de US$ 0,007 por consulta).

## Fluxo de trabalho diário

```
Abrir  →  Rodar varredura  →  Escolher pauta  →  Gerar pacote  →  Teleprompter  →  Gravar
```

1. **Radar do Dia** — os indicadores do Banco Central carregam sozinhos. Clique em
   *Rodar varredura do dia*. A ferramenta busca na web o que está quente nas últimas
   72 horas e devolve 6 a 8 pautas ordenadas por temperatura viral.
2. **Escolher a pauta** — clique no card. O pacote completo é gerado.
3. **Revisar a checagem** — antes de gravar, olhe o bloco 9. Se houver dado marcado
   como `NÃO VERIFICADO`, resolva ou corte a frase.
4. **Teleprompter** — botão no topo. Espaço = play/pause, setas = velocidade, Esc = sair.
   Contagem regressiva de 3 antes de começar a rolar.
5. **Publicar** — copie legenda, tags e descrição do bloco 7; gere a capa com o prompt
   do bloco 8.

**Injeção manual:** se você já viu algo no Google Trends ou no BuzzSumo, cole no campo
antes de varrer. Vai ser tratado como pista e validado — nunca aceito como verdade.

---

## Velocidade do teleprompter

Dois modos, no seletor da barra inferior.

**Automática (padrão).** A ferramenta lê o próprio roteiro e calcula a rolagem:

1. Conta as palavras **faladas** — as marcações `[ASSIM]` não entram, você não as lê em voz alta.
2. Soma o tempo das **pausas** que o roteiro pede. `[PAUSA DRAMÁTICA]` vale 1,4s,
   `[PAUSA CURTA]` 0,6s, mudanças de tom 0,3–0,5s. Sem isso o texto sobe rápido demais,
   porque o silêncio não conta palavra mas consome tempo.
3. Divide a altura rolável pela duração: `duração = palavras ÷ ppm × 60 + pausas`.

Você controla só uma coisa — **o ritmo de fala em palavras por minuto**. O padrão é 150,
que é uma locução firme em português. A rolagem se ajusta sozinha, inclusive quando você
muda o tamanho da fonte (fonte maior estica o texto e exige mais px/s para a mesma duração).

O painel embaixo mostra a conta e **compara com a duração que o roteiro pediu**:

- `no alvo de 55s` — pode gravar.
- `roteiro pede 55s — 13s a mais; use 189 ppm` — dá para resolver acelerando a fala.
- `roteiro pede 10min: corte ~200 palavras (não dá para resolver só com a velocidade)` —
  quando o ajuste necessário sai da faixa humana (100 a 200 ppm), o problema é o tamanho
  do texto, e a ferramenta diz quantas palavras sobram ou faltam em vez de sugerir um
  ritmo que ninguém consegue.

**Manual.** Pixels por segundo direto, para quem prefere no olho.

## De onde vêm os números

Todo indicador do painel vem de API pública em fonte primária, com data e link de auditoria:

| Fonte | O que traz |
|---|---|
| **BCB / SGS** | Selic, CDI, IPCA (mês e 12 meses), dólar e euro PTAX, IGP-M, poupança |
| **BCB / SGS — crédito** | Juros médios PF: total, crédito pessoal (a.a. e a.m.) e cheque especial |
| **BCB / Focus** | Expectativa de mercado para Selic, IPCA, PIB e câmbio |
| **IBGE / SIDRA** | IPCA (fonte cruzada) |
| **Coletor local** | ~1.400 manchetes de Google News, Google Trends e 4 veículos |
| **Busca web via OpenRouter** | camada extra, opcional e paga, quando há saldo |

O **juro real ex-ante** é calculado, não copiado: `(1 + Selic) / (1 + IPCA esperado) - 1`.
O método aparece no tooltip do card.

Os cartões de **crédito aparecem em vermelho**: são custo que o cliente paga, não
rendimento que ele recebe. São o material bruto mais forte para conteúdo de crédito
com garantia, consórcio e reestruturação de dívida — o contraste entre o que a pessoa
paga hoje e o que ela poderia pagar é o argumento inteiro. Os rótulos dessas séries
foram conferidos um a um no Portal de Dados Abertos do BCB, porque códigos vizinhos
medem coisas diferentes (20741 é cheque especial, 20742 é crédito pessoal).

Se um indicador falhar, ele é **omitido** e a IA recebe aviso explícito para não
inventar valor no lugar. Dado ausente é sempre melhor que dado inventado.

---

## As três blindagens

**1. Anti-alucinação.** O prompt exige fonte para cada número. Sem fonte, o modelo
escreve `[NÃO VERIFICADO]` em vez de preencher. A busca web fica ligada por padrão e
cada afirmação volta com URL. O bloco de checagem lista dado a dado o que tem e o que
não tem lastro, e um alerta vermelho aparece no topo do pacote quando algo ficou aberto.

**2. Compliance CEA/ANCORD.** O prompt proíbe recomendação de ativo específico, promessa
de rentabilidade e expressões como "garantido" ou "vai subir". O CTA é sempre convite a
diagnóstico, nunca oferta de ativo. Disclaimer entra automático em toda exportação.

**3. Perfis não confirmados.** Na aba Concorrência, quem está marcado como *a validar*
não é afirmado pelo sistema — a busca confirma antes de usar.

---

## Estrutura

```
radar-institucional/
├── index.html              telas e layout
├── manifest.json  sw.js    PWA (instalável, abre offline)
├── css/app.css             interface
├── servidor.py             coletor de manchetes + servidor local
└── js/
    ├── knowledge.js        mestres, concorrência, esteira de produtos
    ├── config.js           preferências e histórico (localStorage)
    ├── data.js             BCB, Focus, IBGE, e a coleta do servidor
    ├── prompts.js          engenharia de prompt e regras anti-alucinação
    ├── ia.js               os três provedores de IA, com reserva automática
    ├── catalogo.js         catálogo vivo de modelos da OpenRouter
    ├── teleprompter.js     rolagem, espelho, velocidade
    └── app.js              orquestração e renderização
```

**Para editar a estratégia sem mexer em código de interface:** tudo que é conteúdo
estratégico está em `knowledge.js` (princípios, produtos, CTAs, objeções) e em
`prompts.js` (as regras que a IA obedece). São os dois arquivos que valem revisar
conforme a operação amadurece.

---

## Custo

No modo **Automático** com modelos gratuitos, os tokens não custam nada — o limite é de
uso, não de dinheiro: 20 chamadas por minuto e 50 por dia (1.000 por dia se você já
comprou US$ 10 em créditos alguma vez).

O que custa é a **busca web**: a partir de US$ 0,007 por consulta. É o único item que
exige saldo, e é o que separa "pauta com notícia de hoje" de "pauta com dado do Banco
Central". Uns poucos dólares cobrem meses de produção diária.

Modelos pagos geram roteiro melhor e custam por token. Defina limite de gasto no painel
da OpenRouter de qualquer forma.

---

## Limites conhecidos

- **Google Trends, BuzzSumo, Semrush e Ahrefs** não têm API pública gratuita que funcione
  direto do navegador. A aba Fontes abre a consulta certa em um clique e você cola o
  resultado. A varredura por IA cobre o restante com busca web real.
- **Ibovespa e cotação de ações** não entram no painel: as APIs gratuitas passaram a
  exigir token. A busca web traz o dado com fonte quando a pauta pede.
- **Histórico e configurações** ficam neste navegador. Use *Exportar tudo* para backup.
- A **série 432 (Selic meta)** exibe a data final de vigência da meta, que pode ser
  futura — é assim que o BCB publica, e o link no card permite auditar.
