# Live Lens

Extensão do Chrome que mostra, num painel lateral, estatísticas exatas e uma análise por LLM **local** (Ollama) do que você seleciona na página ou de um elemento fixado que muda em tempo real. Custo zero, e nada sai da sua máquina.

## 1. Preparar o Ollama (uma vez)

```bash
ollama pull qwen2.5:3b
```

## 2. Liberar CORS e subir o Ollama (toda vez que for usar)

O Ollama bloqueia pedidos vindos de extensões por padrão. Suba assim:

```bash
OLLAMA_ORIGINS='chrome-extension://*' ollama serve
```

Se o Ollama um dia virar serviço systemd:

```bash
sudo systemctl edit ollama
# adicione:
# [Service]
# Environment="OLLAMA_ORIGINS=chrome-extension://*"
sudo systemctl restart ollama
```

## 3. Instalar a extensão

1. Abra `chrome://extensions`.
2. Ligue **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha esta pasta (`live-lens`).
4. Fixe o ícone da extensão na barra, se quiser.
5. **Recarregue as abas que já estavam abertas**, porque a extensão só entra em páginas carregadas depois da instalação.

## 4. Usar

- Clique no ícone do Live Lens para abrir o painel lateral.
- **Selecione** texto ou células de uma tabela: as estatísticas aparecem na hora e a análise do LLM vem logo abaixo.
- **Fixar elemento:** clique no botão, passe o mouse na página e clique no elemento (Esc cancela). Clicar numa célula fixa a **tabela inteira**; **Shift+clique** fixa exatamente o elemento sob o mouse (ex.: um KPI dentro de uma célula). O painel acompanha as mudanças, mostra variação e sparkline, e reanalisa com o LLM no máximo a cada 15s (contados a partir do fim da análise anterior). Uma seleção sua tem prioridade na tela: o elemento fixado continua atualizando a variação e o gráfico, mas não troca a seleção que você está lendo até você fixar de novo.
- **Soltar:** o **×** ao lado do nome do elemento fixado. Enquanto há algo fixado, o botão de fixar vira **Trocar**.
- **Pausar LLM:** fica só com as estatísticas.
- **Pergunta:** digite no campo de baixo e aperte Enter. Ela é respondida sobre a seleção atual (ou o elemento fixado); sem nenhum dos dois, responde como pergunta geral.
- **Selecionar uma pergunta** (ex.: "Quanto é 15% de R$ 1.234,56?" ou "Qual produto tem a maior receita?"): o painel entra no modo **Pergunta**.
  - Se a pergunta tem uma **conta** (`X% de Y`, ou `+ - × ÷` com parênteses), o resultado aparece na hora na linha **Cálculo**, feito em código, exato e sem depender do LLM (funciona até com o LLM pausado).
  - Se há um **elemento fixado**, a pergunta é respondida sobre os dados dele, com as estatísticas exatas no prompt. Sem elemento fixado, ela é respondida sozinha.
  - Se você seleciona **dados e a pergunta juntos** (ex.: uma tabela mais uma linha "Qual cliente mora em Natal?"), a pergunta é separada e o resto da seleção vira os dados.
  - Funciona com **problemas de matemática e lógica** colados com LaTeX (`\( 3x - 9 = 0 \)`, `\[ x^2 = 9 \]`): a pergunta pode estar no meio do texto ("…qual é o valor de x? (1) … (2) …"), o LaTeX vira símbolos legíveis (também na resposta) e as estatísticas, sem sentido nesse caso, são omitidas.
  - Pergunta que os dados não cobrem é respondida com o conhecimento geral do modelo, avisando "Isto não está nos dados:". Sem nenhum dado, responde normalmente.
  - Fixar outro elemento ou selecionar um texto comum volta ao modo análise.
- **Modelo:** abra as configurações (ícone de controles no canto superior direito do painel) e troque o "Modelo do Ollama" (precisa de `ollama pull <modelo>` antes).

## Atualizar a extensão e diagnosticar

- Depois de atualizar os arquivos, abra `chrome://extensions` e clique no ícone de **recarregar** (seta circular) no card do Live Lens; depois recarregue as abas abertas. Sem isso o Chrome continua rodando a versão antiga.
- A **versão** aparece ao lado do nome, no topo do painel (ex.: `v0.3.0`). Se ela não bate com a do `manifest.json`, a extensão não foi recarregada.
- Se algo não for reconhecido, abra as configurações (ícone de controles) → **Diagnóstico**: ele mostra o texto exato que a extensão recebeu e como o interpretou (modo, pergunta, dados). O botão **Copiar diagnóstico** ajuda a reportar o caso.

## Limitações conhecidas

- **Injeção de prompt.** Os modelos locais pequenos seguem ordens escondidas no texto que você seleciona (testado: `qwen2.5:3b` obedece em parte, `qwen2.5:7b` obedece por completo, e um modelo maior não resolveu). O painel só mostra texto, sem ações, mas a análise pode ser enganada. Use em páginas em que você confia e trate a análise como sugestão; **as estatísticas são calculadas em código e não sofrem disso**.
- **Cálculo.** O mini-calculador cobre `X% de Y` e cadeias com `+ - × ÷` e parênteses. Não entende palavras ("dividido por", "média de 10, 20 e 30") nem `15% de 200 + 10`; nesses casos ele não mostra o cálculo e só o LLM responde (menos confiável em contas).
- **Precisão do LLM.** Ele pode apontar "outlier" onde não há (as estatísticas exatas ficam logo acima) ou trocar linhas da tabela. Confie nos números do bloco de estatísticas, não nos do texto.
- **Matemática.** O 3B resolve as contas passo a passo, mas a conclusão de problemas de "suficiência de dados" (a afirmação (1) sozinha basta?) pode vir fraca. O `qwen2.5:7b` raciocina melhor nisso, porém leva ~2 min em CPU e é pior contra injeção de prompt; troque-o nas configurações só quando precisar.
- **Velocidade.** Em CPU cada análise leva de ~10s a ~70s (a primeira, a frio, é a mais lenta; o 7b chega a ~85s). Com um elemento fixado, a nova análise só começa 15s depois de a anterior terminar.

## Testes

```bash
node test.mjs && node test-llm.mjs
```

Página de teste manual:

```bash
python3 -m http.server 8000
# abra http://localhost:8000/demo.html
```
