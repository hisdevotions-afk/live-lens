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
  - **Equações e problemas de suficiência de dados (GMAT), resolvidos em código.** A extensão resolve equações de **uma variável** (lineares, quadráticas, racionais, com potências, raiz e módulo), acha todas as soluções reais, exclui onde o denominador zera e mostra o cartão **Resolução (feita em código)**. Em problemas no formato "(1) … (2) …" ela resolve cada afirmação sozinha e depois juntas, e conclui com a letra pela convenção padrão do GMAT (A: só a (1) basta; B: só a (2); C: só juntas; D: cada uma sozinha; E: nem juntas). Também resolve problemas de **propriedades de inteiros** ("n é divisível por 6?", com afirmações como "n é divisível por 3", "n é par", "n é primo", "n > 10" ou uma equação): verifica por enumeração de 1 a 5000 (ou -5000 a 5000) se cada afirmação, e as duas juntas, fazem a resposta ser sempre sim, sempre não (ou um valor único), e mostra exemplos que provam a insuficiência. A letra vem das **alternativas da própria página**, mesmo embaralhadas; sem as cinco alternativas, vale a convenção padrão. Se qualquer frase não for reconhecida por inteiro, o código não responde e o LLM assume. Quando o código resolve tudo, **o LLM não é chamado**: a resposta e a **explicação também saem do código** (uma frase por afirmação, com os exemplos e contraexemplos verificados) e terminam com **"Alternativa: X"**. O botão Reanalisar fica desativado nesse caso. Isso é deliberado: testado com o `qwen2.5:3b`, ele contradizia o cálculo ("isto não está nos dados"), inventava uma linha "Juntas:" que não existia e trocava a letra, mesmo recebendo a resolução pronta. Sem resolução em código, o modelo é instruído a terminar com a alternativa, mas a letra dele não é garantida.
  - **Fórmulas renderizadas** (MathJax, KaTeX, MathJax v2 e imagens com `alt` em TeX, como na Wikipédia) são lidas do DOM da página. O navegador não inclui a fórmula no texto selecionado (só deixa quebras de linha), por isso a extensão a busca no MathML/anotação TeX.
  - Funciona com **problemas de matemática e lógica** colados com LaTeX (`\( 3x - 9 = 0 \)`, `\[ x^2 = 9 \]`): a pergunta pode estar no meio do texto ("…qual é o valor de x? (1) … (2) …"), o LaTeX vira símbolos legíveis (também na resposta) e as estatísticas, sem sentido nesse caso, são omitidas.
  - Pergunta que os dados não cobrem é respondida com o conhecimento geral do modelo, avisando "Isto não está nos dados:". Sem nenhum dado, responde normalmente.
  - Fixar outro elemento ou selecionar um texto comum volta ao modo análise.
- **Modelo:** abra as configurações (ícone de controles no canto superior direito do painel) e troque o "Modelo do Ollama" (precisa de `ollama pull <modelo>` antes).

## Atualizar a extensão e diagnosticar

- Depois de atualizar os arquivos, abra `chrome://extensions` e clique no ícone de **recarregar** (seta circular) no card do Live Lens; depois recarregue as abas abertas. Sem isso o Chrome continua rodando a versão antiga.
- A **versão** aparece ao lado do nome, no topo do painel (ex.: `v0.3.0`). Se ela não bate com a do `manifest.json`, a extensão não foi recarregada.
- Se algo não for reconhecido, abra as configurações (ícone de controles) → **Diagnóstico**: ele mostra o texto exato que a extensão recebeu e como o interpretou (modo, pergunta, dados). O botão **Copiar diagnóstico** ajuda a reportar o caso. Quando a seleção tem fórmulas ou imagens, ele inclui também o campo `html` com um trecho do HTML real da seleção (sem o miolo dos SVG), que mostra como a página guarda a matemática.

## Limitações conhecidas

- **Enunciado fora da seleção.** Se você seleciona só as afirmações e as alternativas de um problema de suficiência (marcadores `(1)`, `(2)` e alternativas A–E), sem a pergunta, a extensão lê os até 4 blocos de texto **logo acima** da seleção e usa o mais próximo que tenha uma pergunta como enunciado. Isso só acontece nesse formato (seleções comuns não leem nada além do selecionado), e a interface avisa: a origem mostra "enunciado lido logo acima da seleção" e a pergunta usada aparece no cartão; o Diagnóstico traz o campo `contexto`. Se não achar nenhuma pergunta, o painel avisa "Falta o enunciado" em vez de calcular estatística dos números soltos.
- **Suficiência de dados que o código não resolve.** Quando a seleção tem cara de problema de suficiência (`(1)`, `(2)`, alternativas) e nenhuma etapa do motor entende as afirmações, o LLM responde como fallback, e o `qwen2.5:3b` **erra a conclusão** (testado: às vezes escolhe a letra certa por sorte com uma explicação sem sentido). O painel mostra o aviso "Não consegui resolver em código" acima da resposta. Se a versão instalada for anterior à que conhece a propriedade usada, o resultado é o mesmo: confira a versão no topo do painel.
- **Fórmulas que são só imagem ou canvas** (sem `alt`, sem MathML) não têm texto para ler; nesses casos o Diagnóstico mostra `visual` com a contagem de `img`/`svg`/`canvas` da seleção. Ler a imagem exigiria um modelo de visão no Ollama (não implementado).
- **Injeção de prompt.** Os modelos locais pequenos seguem ordens escondidas no texto que você seleciona (testado: `qwen2.5:3b` obedece em parte, `qwen2.5:7b` obedece por completo, e um modelo maior não resolveu). O painel só mostra texto, sem ações, mas a análise pode ser enganada. Use em páginas em que você confia e trate a análise como sugestão; **as estatísticas são calculadas em código e não sofrem disso**.
- **Cálculo.** O mini-calculador cobre `X% de Y` e cadeias com `+ - × ÷` e parênteses. Não entende palavras ("dividido por", "média de 10, 20 e 30") nem `15% de 200 + 10`; nesses casos ele não mostra o cálculo e só o LLM responde (menos confiável em contas).
- **Precisão do LLM.** Ele pode apontar "outlier" onde não há (as estatísticas exatas ficam logo acima) ou trocar linhas da tabela. Confie nos números do bloco de estatísticas, não nos do texto.
- **Propriedades de inteiros.** Só reconhece: divisível por / múltiplo de K, par, ímpar, primo, quadrado perfeito, cubo perfeito, "possui exatamente K divisores", "divisível por exatamente K primos distintos", positivo, negativo, comparações (`>`, `maior que`…), `=` e equações, com "e" entre elas. Aceita **uma ou duas variáveis** (por exemplo "Se x e y são inteiros positivos, x>y, então x−y é divisível por 6?", com expressões como `x−y`, `xy`, `x/y`, `x+y` e restrições como `x>y`); com duas, verifica de 1 a 100 para cada uma, e três ou mais variáveis caem no LLM. Exige "inteiro" no enunciado ("natural" é ambíguo por causa do zero e cai no LLM) e verifica só até 5000: uma propriedade que só falhe além disso passaria despercebida.
- **Matemática.** O solucionador cobre só uma variável e igualdades (sem sistemas, sem desigualdades como `x > 0`, sem texto misturado à equação); a busca das raízes é numérica (varre de -10⁹ a 10⁹, verifica cada raiz na equação e converte para fração quando bate), não uma prova simbólica. Fora disso, o LLM responde como antes, e o `qwen2.5:3b` acerta as contas parciais mas conclui mal problemas de suficiência; o `qwen2.5:7b` também errou a conclusão e leva ~2 min em CPU.
- **Velocidade.** Em CPU cada análise leva de ~10s a ~70s (a primeira, a frio, é a mais lenta; o 7b chega a ~85s). Com um elemento fixado, a nova análise só começa 15s depois de a anterior terminar.

## Testes

```bash
node test.mjs && node test-llm.mjs && node test-algebra.mjs
```

Página de teste manual:

```bash
python3 -m http.server 8000
# abra http://localhost:8000/demo.html
```
