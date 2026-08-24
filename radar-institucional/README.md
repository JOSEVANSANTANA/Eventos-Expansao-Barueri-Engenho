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

1. Crie uma chave em [openrouter.ai/keys](https://openrouter.ai/keys)
2. Na ferramenta, clique em **Configurações** e cole a chave
3. Clique em **Testar chave** para confirmar
4. Preencha sua identidade (marca, certificações, bagagem) — isso entra na voz do roteiro
5. Salvar

**Sobre a chave:** fica no `localStorage` do seu navegador e vai direto para a
OpenRouter. Não passa por servidor intermediário. Como é ferramenta local, não
publique esta página em endereço público com a chave dentro, e prefira uma chave
com limite de gasto definido no painel da OpenRouter.

---

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
5. **Publicar** — copie legenda, tags e descrição do bloco 7; gere a capa com o prompt
   do bloco 8.

**Injeção manual:** se você já viu algo no Google Trends ou no BuzzSumo, cole no campo
antes de varrer. Vai ser tratado como pista e validado — nunca aceito como verdade.

---

## De onde vêm os números

Todo indicador do painel vem de API pública em fonte primária, com data e link de auditoria:

| Fonte | O que traz |
|---|---|
| **BCB / SGS** | Selic, CDI, IPCA (mês e 12 meses), dólar e euro PTAX, IGP-M, poupança |
| **BCB / SGS — crédito** | Juros médios PF: total, crédito pessoal (a.a. e a.m.) e cheque especial |
| **BCB / Focus** | Expectativa de mercado para Selic, IPCA, PIB e câmbio |
| **IBGE / SIDRA** | IPCA (fonte cruzada) |
| **Busca web via OpenRouter** | Notícia das últimas 72h, com URL e data em cada citação |

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
└── js/
    ├── knowledge.js        mestres, concorrência, esteira de produtos
    ├── config.js           preferências e histórico (localStorage)
    ├── data.js             BCB, Focus, IBGE
    ├── prompts.js          engenharia de prompt e regras anti-alucinação
    ├── openrouter.js       cliente da API, streaming e citações
    ├── teleprompter.js     rolagem, espelho, velocidade
    └── app.js              orquestração e renderização
```

**Para editar a estratégia sem mexer em código de interface:** tudo que é conteúdo
estratégico está em `knowledge.js` (princípios, produtos, CTAs, objeções) e em
`prompts.js` (as regras que a IA obedece). São os dois arquivos que valem revisar
conforme a operação amadurece.

---

## Custo

Cada varredura e cada pacote são uma chamada à OpenRouter, cobrada por token, mais a
busca web (a partir de US$ 0,007 por consulta no Exa). Modelo mais forte gera roteiro
melhor e custa mais — dá para usar um modelo barato na varredura e um forte no pacote.
Defina limite de gasto no painel da OpenRouter.

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
