---
title: "Multi-container services: isolamento de rede, cache-aside e health checks como contratos de orquestração"
description: "Como construir uma aplicação multi-container production-ready com FastAPI, PostgreSQL, Redis e Nginx — com isolamento de rede em camadas, cache-aside pattern e startup determinístico via health checks declarativos."
pubDate: 2026-05-27
tags: ["docker", "docker-compose", "fastapi", "postgresql", "redis", "nginx", "containers", "devops", "networking"]
source: "github"
sourceUrl: "https://github.com/nilo-lima/devops-master-lab/tree/main/projects/02-containerization/06-multi-container-service"
---

## O problema com `docker run` em cascata

A maioria dos tutoriais de Docker Compose para aplicações multi-container resolve o problema de orquestração da maneira mais frágil possível: todos os serviços compartilham uma única rede padrão, a API fica exposta diretamente na porta do host, e a ordem de startup é controlada por `sleep` hardcoded nos entrypoints.

Isso funciona em ambiente de desenvolvimento. Em qualquer outro contexto, é uma receita para falhas intermitentes, superfície de ataque desnecessária e tempo de diagnóstico desperdiçado quando o Postgres ainda está inicializando enquanto a aplicação já está tentando conectar.

Este projeto implementa um URL Shortener como veículo para demonstrar três padrões que separam uma stack Docker funcional de uma stack Docker profissional.

## Isolamento de rede como controle de acesso

A decisão mais impactante na arquitetura multi-container não é qual banco de dados usar. É quantas redes Docker você cria.

Uma rede única padrão significa que qualquer container pode se comunicar com qualquer outro container. O Nginx consegue rotear tráfego direto ao PostgreSQL. A aplicação consegue se conectar ao Redis mesmo que você nunca tenha planejado isso. Qualquer container comprometido tem visibilidade total sobre a stack.

A implementação usa duas redes com responsabilidades distintas:

```yaml
networks:
  frontend-net:   # Nginx ↔ API
  backend-net:    # API ↔ PostgreSQL ↔ Redis
```

O Nginx pertence apenas à `frontend-net`. O PostgreSQL e o Redis pertencem apenas à `backend-net`. A API pertence às duas. O resultado é que o Nginx não tem rota para o banco de dados — não por firewall, não por regra de ACL, mas porque os containers simplesmente não estão na mesma rede Docker. O kernel do host descarta os pacotes antes mesmo de chegarem ao processo destino.

Combinado com a ausência de `ports` no serviço `api` no Compose (apenas o Nginx expõe a porta 80), a superfície de ataque externa se resume a um único ponto de entrada com responsabilidade bem definida.

## Health checks como contratos de prontidão

`depends_on` sem condição não garante nada além de ordem de criação de containers. O container filho começa a subir imediatamente após o pai ter sido criado, independentemente de o pai estar pronto para aceitar conexões.

A solução é declarar `healthcheck` em cada serviço com critérios funcionais, não de processo:

```yaml
postgres:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
    interval: 10s
    retries: 5

redis:
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s

api:
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
```

`pg_isready` verifica se o PostgreSQL aceita conexões TCP na porta correta para o usuário e banco especificados. `redis-cli ping` verifica se o processo Redis responde ao protocolo RESP. Nenhum dos dois é satisfeito apenas porque o processo do container está rodando.

O Compose bloqueia o startup do serviço filho até que todos os `service_healthy` sejam satisfeitos. O chain completo — postgres healthy → redis healthy → api healthy → nginx sobe — acontece de forma determinística sem nenhum `sleep`.

## Cache-aside: Redis como acelerador transparente

O endpoint de redirecionamento implementa cache-aside explícito:

```python
@app.get("/{code}")
def redirect_url(code: str, db: Session = Depends(get_db)):
    r = get_redis()
    cached = r.get(f"url:{code}")
    if cached:
        return RedirectResponse(url=cached, status_code=301)

    entry = db.query(models.URL).filter(models.URL.short_code == code).first()
    if not entry:
        raise HTTPException(status_code=404, detail="URL not found")

    r.setex(f"url:{code}", 60, entry.original_url)
    return RedirectResponse(url=entry.original_url, status_code=301)
```

A lógica é deliberadamente sequencial: Redis primeiro, PostgreSQL como fallback, escrita no Redis após o miss. O TTL de 60 segundos significa que URLs populares servidas centenas de vezes por minuto fazem uma única query SQL a cada 60 segundos. O resto é leitura de memória via protocolo RESP.

Cache-aside tem uma vantagem importante sobre cache-through ou read-through: a aplicação controla explicitamente quando algo vai para o cache e por quanto tempo. Não há estado oculto gerenciado por uma camada de abstração. Quando o Redis está indisponível, o fallback para o PostgreSQL acontece naturalmente — o `get_redis()` vai lançar uma exceção que pode ser tratada com um try/except se tolerância a falha do cache for um requisito.

## Multi-stage build: imagem final sem ferramentas de construção

O Dockerfile usa dois estágios com propósitos distintos:

```dockerfile
FROM python:3.12-slim AS builder
WORKDIR /app
COPY app/requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12-slim AS runtime
RUN useradd --create-home --shell /bin/bash appuser
WORKDIR /app
COPY --from=builder /install /usr/local
COPY app/ .
USER appuser
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

O estágio `builder` instala as dependências com pip em `/install`. O estágio `runtime` copia apenas o resultado — não o pip, não o cache de pacotes, não os metadados de instalação. A imagem final não tem capacidade de instalar novos pacotes em runtime, o que elimina uma categoria inteira de técnicas de persistência pós-comprometimento.

O `USER appuser` garante que o processo uvicorn roda sem privilégios de root dentro do container. Se o container for comprometido via vulnerabilidade na aplicação, o atacante opera como um usuário sem privilégios, sem acesso a caminhos do sistema que exigem root.

## O detalhe que não está no tutorial: `wget` em imagens slim

Um ponto prático que a maioria dos exemplos ignora: `python:3.12-slim` não inclui `wget` ou `curl`. Health checks que usam `wget -qO-` falham silenciosamente com `exec: wget: not found`, e o container entra em loop de `unhealthy` sem nenhuma mensagem clara no log.

A solução é usar a stdlib do Python, que sempre está disponível na imagem:

```yaml
healthcheck:
  test: ["CMD", "python3", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
```

Não há motivo para adicionar `wget` à imagem de runtime para satisfazer um health check. A linguagem já fornece HTTP client.

## Validação do isolamento

Com a stack no ar, o comportamento esperado é verificável diretamente:

```bash
# Porta 8000 não exposta — connection refused
curl http://localhost:8000/health
# curl: (7) Failed to connect to localhost port 8000

# Nginx como único ponto de entrada
curl -X POST http://localhost/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://roadmap.sh"}'
# {"short_code":"NXIOnk","short_url":"/NXIOnk","original_url":"https://roadmap.sh"}

# Redis armazena após o primeiro acesso
docker compose exec redis redis-cli get "url:NXIOnk"
# "https://roadmap.sh"
```

O primeiro curl falha porque a porta 8000 não está mapeada no host. O Redis confirma que o cache-aside funcionou: o segundo acesso ao mesmo código é servido de memória, sem query ao PostgreSQL.

Código disponível em [github.com/nilo-lima/devops-master-lab](https://github.com/nilo-lima/devops-master-lab/tree/main/projects/02-containerization/06-multi-container-service).
