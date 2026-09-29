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
- **Fixar elemento:** clique no botão, passe o mouse na página e clique no elemento (Esc cancela). O painel acompanha as mudanças, mostra variação e sparkline, e reanalisa com o LLM no máximo a cada 15s.
- **Pausar LLM:** fica só com as estatísticas.
- **Pergunta:** digite no campo de baixo e aperte Enter.
- **Modelo:** troque no campo "Modelo" (precisa de `ollama pull <modelo>` antes).

## Testes

```bash
node test.mjs && node test-llm.mjs
```

Página de teste manual:

```bash
python3 -m http.server 8000
# abra http://localhost:8000/demo.html
```
