---
title: "14 containers, 3 redes, zero porta exposta: a stack de observabilidade do GLPI 11"
description: "Como adicionei Prometheus, Grafana, Loki e Alertmanager a uma stack GLPI 11 em producao, e os quatro problemas que me fizeram reescrever configs do zero."
pubDate: 2026-05-17
tags: ["docker", "prometheus", "grafana", "loki", "promtail", "devops", "observabilidade", "glpi", "mariadb", "redis"]
source: "github"
sourceUrl: "https://github.com/nilo-lima/glpi-docker-stack"
---

## O problema com "subir e torcer"

Colocar uma aplicacao em producao e a parte facil. A parte dificil e saber, antes que o usuario reclame, que o banco de dados esta com conexoes acima do normal, que o disco vai encher em 48 horas, ou que aquele container reiniciou tres vezes na madrugada.

Sem observabilidade, voce administra no escuro. Com ela, voce tem perguntas e respostas antes que os problemas virem incidentes.

Este projeto e a Fase 2 de uma stack Docker production-grade do GLPI 11. A Fase 1 tinha 6 containers - GLPI, MariaDB, Redis, Caddy, backup e cron. A Fase 2 adicionou 8 containers de observabilidade, totalizando 14. A regra principal foi uma: **nenhuma porta de banco, cache ou monitoramento exposta no host**.

---

## O que foi construido

A stack completa tem tres camadas separadas por redes Docker bridge:

| Rede | Funcao | Containers |
|:-----|:-------|:-----------|
| `frontend_net` | Borda TLS | Caddy, GLPI app, Grafana |
| `backend_net` | Dados | GLPI app, MariaDB, Redis, backup, exporters |
| `monitoring_net` | Metricas e logs | Prometheus, Grafana, Loki, Promtail, Alertmanager, exporters |

O Grafana esta em duas redes ao mesmo tempo: `frontend_net` para receber requisicoes via Caddy (subdominio com TLS automatico), e `monitoring_net` para consultar Prometheus e Loki internamente.

Os exporters (`mysqld-exporter` e `redis-exporter`) tambem estao em duas redes: `backend_net` para alcancar MariaDB e Redis, e `monitoring_net` para expor metricas ao Prometheus.

Nenhum servico de dados ou monitoramento tem porta mapeada para o host. O unico ponto de entrada externo e o Caddy na porta 443.

### Dashboards provisionados automaticamente

O Grafana sobe com quatro dashboards pre-configurados, sem nenhuma acao manual:

| Dashboard | ID | O que mostra |
|:----------|:---|:-------------|
| Node Exporter Full | 1860 | CPU, RAM, disco e rede do host |
| MySQL Overview | 14057 | Queries, conexoes e InnoDB do MariaDB |
| Redis Dashboard | 14091 | Memoria, hit ratio e comandos |
| Logs / App | 13639 | Logs centralizados por servico via Loki |

Os datasources Prometheus e Loki tambem sao provisionados automaticamente via arquivos YAML em `services/grafana/provisioning/datasources/`. O Grafana sobe e ja funciona.

---

## Quatro problemas reais encontrados

### 1. mysqld-exporter: permissao negada no `.my.cnf`

O exporter do MariaDB usa um arquivo `.my.cnf` para armazenar as credenciais do usuario de monitoramento. O script de setup gerava o arquivo com `chmod 600` - correto para seguranca, mas o container do exporter roda como `nobody` (UID 65534), nao como o usuario que criou o arquivo.

Resultado: `permission denied` e o exporter reiniciando em loop.

A correcao foi `chmod 644`. O arquivo nao contem a senha do root nem do usuario GLPI - apenas as credenciais do usuario `monitoring`, que tem somente `PROCESS, SELECT, REPLICATION CLIENT, SLAVE MONITOR`. O risco de leitura por outros processos do sistema e aceitavel dado que o container roda isolado.

Uma segunda decisao foi usar `.my.cnf` em vez de `DATA_SOURCE_NAME` como variavel de ambiente. Senhas geradas com `openssl rand -base64 32` frequentemente contem `@` ou `/`, que sao separadores na URL de DSN do MySQL. O `.my.cnf` nao tem essa restricao.

### 2. Promtail 3.x: a label que nao existe

A documentacao do Promtail para Docker Service Discovery menciona a label `__meta_docker_container_state`. A ideia era filtrar containers por estado (running) antes de enviar logs ao Loki.

Na versao 3.x, essa label simplesmente nao existe no pipeline de relabeling. A consequencia de um filtro `action: keep` em uma label inexistente e silenciosa: **todos os targets sao descartados**. O Promtail subia, reportava saude OK, mas enviava zero logs ao Loki.

O filtro correto para isolar apenas os containers do projeto e por label do Docker Compose:

```yaml
- source_labels: [__meta_docker_container_label_com_docker_compose_project]
  action: keep
  regex: glpi-dev
```

Essa label existe e e confiavel. O Promtail passou a coletar logs de todos os 14 containers corretamente.

### 3. Healthcheck em imagem scratch e bash sem wget

Dois problemas distintos de healthcheck:

**redis-exporter** usa imagem scratch - apenas o binario Go estatico, sem shell, sem wget, sem curl. Qualquer `CMD` no healthcheck falharia com "executable not found". A solucao foi desabilitar o healthcheck interno (`test: ["NONE"]`) e monitorar a saude indiretamente: se o Prometheus nao conseguir fazer scrape na porta 9121, o alerta `TargetDown` dispara automaticamente.

**promtail** usa Debian slim, que tem bash mas nao tem wget. O healthcheck padrao `wget -qO- http://localhost:9080/ready` falhava com exit 127. A solucao foi usar TCP via bash:

```yaml
test: ["CMD", "bash", "-c", "echo > /dev/tcp/localhost/9080"]
```

O `/dev/tcp` e um pseudo-arquivo do bash que abre uma conexao TCP. Se a porta estiver respondendo, o comando retorna 0. Se nao estiver, retorna 1. Sem dependencia de wget, curl ou qualquer binario adicional.

### 4. Variavel de template do Grafana Community

Os dashboards da comunidade Grafana (baixados do grafana.com) usam variaveis de template como `${DS_LOKI}` e `${DS_PROMETHEUS}` para referenciar datasources. Quando o datasource e provisionado via arquivo YAML (nao criado manualmente), o UID real e `loki` e `prometheus` - nao o nome de template que a comunidade usa.

O resultado: o dashboard carregava, mas todos os paineis mostravam `Datasource ${DS_LOKI} was not found`.

A correcao e substituir as variaveis no JSON antes de commitar:

```bash
sed -i 's/\${DS_LOKI}/loki/g' dashboard.json
sed -i 's/\${DS_PROMETHEUS}/prometheus/g' dashboard.json
```

Dashboards baixados diretamente do grafana.com precisam dessa substituicao para funcionar com provisionamento automatico.

---

## Decisoes de arquitetura que valem registrar

**Stack unificada, nao dependente.** A Fase 2 inclui todos os servicos da Fase 1. Nao ha redes externas declaradas, nao ha dependencia de estado de outra stack. Um unico `docker compose up -d` sobe tudo. O custo e nao poder rodar as duas fases simultaneamente no mesmo host sem conflito de nomes de container - mitigado com `COMPOSE_PROJECT_NAME` diferente por fase.

**Usuário de monitoramento com privilegios minimos.** O `mysqld-exporter` conecta com um usuario `monitoring` que tem apenas os privilegios necessarios para coletar metricas. Nao tem acesso a dados do GLPI, nao pode escrever nada, nao pode alterar schema.

**Alertmanager como stub intencional.** O Alertmanager esta configurado com um receiver `blackhole` - ele recebe alertas do Prometheus mas nao os entrega a ninguem. Isso e intencional: a regra de alerta funciona, o pipeline funciona, mas o destino (email, Slack, PagerDuty) fica para o operador configurar sem precisar alterar a stack.

---

## O que fica depois de tudo rodando

Com a stack completa:

- Qualquer pico de CPU ou memoria no host gera alerta via Prometheus antes de virar problema
- Logs de todos os 14 containers ficam acessiveis no Grafana com filtro por servico
- O tempo de resposta do MariaDB e o hit ratio do Redis ficam visiveis em dashboard
- Backups acontecem as 03:00 com verificacao de integridade e rotacao automatica de 14 dias
- TLS automatico via Caddy para GLPI e Grafana com certificados Let's Encrypt reais

A diferenca entre "subir e torcer" e "subir e saber" e exatamente essa stack.

Codigo disponivel em [github.com/nilo-lima/glpi-docker-stack](https://github.com/nilo-lima/glpi-docker-stack).
