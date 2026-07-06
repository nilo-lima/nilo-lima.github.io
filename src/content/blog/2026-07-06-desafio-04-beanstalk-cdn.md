---
title: "Desafio 04 - Beanstalk + CDN (Formacao AWS Jun/2026)"
description: "Como colocar o CloudFront na frente do Elastic Beanstalk e separar cache de conteúdo estático e dinâmico"
pubDate: "2026-07-06"
tags: ["aws", "beanstalk", "cloudfront", "cdn", "iac", "formacao-aws", "devops"]
source: "artigo"
sourceUrl: "https://hotmart.com/pt-br/club/formacaoaws"
heroImage: "/images/blog/desafio-04-beanstalk-cdn.png"
---

## TL;DR

Quarto desafio da Formacao AWS 5.0 (Jun/2026): coloquei o CloudFront como CDN na frente de um
ambiente Elastic Beanstalk rodando a aplicacao BIA (React + Express + PostgreSQL).
O ponto central foi separar o cache de conteúdo estático (`/*` com CachingOptimized)
do tráfego dinâmico da API (`/api/*` com CachingDisabled) usando dois cache behaviors
em uma unica distribuição.

## Contexto

A trilha de junho cobre APPs Gerenciadas + IAM + CDN na AWS em seis desafios progressivos.
O Desafio 04 e o primeiro a introduzir CDN: CloudFront na frente do Beanstalk, nível 2.

O objetivo era simples na descrição mas exigiu algumas decisões arquiteturais não obvias:
toda a infraestrutura precisava ser criada em um único ciclo de provisionamento, e o
frontend não podia depender do domínio CloudFront durante o build.

## Arquitetura Adotada

![Arquitetura](/images/blog/desafio-04-beanstalk-cdn.png)

O usuario acessa exclusivamente via CloudFront. A distribuição tem dois behaviors:

- `/*` (padrão): CachingOptimized, compressao ativada. Serve os assets estáticos do React
  com TTL de 86400s. O browser não bate no servidor para arquivos que ja estao em cache na edge.
- `/api/*`: CachingDisabled + AllViewer origin request policy. Cada requisição e encaminhada
  diretamente ao ALB do Beanstalk sem interferência de cache.

O ALB aceita HTTP:80 da internet (CloudFront não tem IPs fixos para whitelist).
A EC2 do Beanstalk recebe somente do SG do ALB (porta 8080).
O RDS PostgreSQL 17 esta em subnet privada e aceita somente do SG da EC2 (porta 5432).

## Decisões Técnicas

### ADR-001: Ambiente Beanstalk via IaC (não via eb create)

Criar o ambiente com `aws_elastic_beanstalk_environment` expoe o atributo `cname` durante
o `plan`. Isso permite que o `cloudfront.tf` use `aws_elastic_beanstalk_environment.bia.cname`
como `domain_name` da origem, criando toda a infraestrutura em um único apply, sem
necessidade de duas rodadas separadas.

### ADR-002: Single-origin CloudFront (ALB único)

Duas abordagens eram possíveis: single-origin (ALB) ou multi-origin (S3 para assets + ALB para API).
A abordagem multi-origin exigiria um bucket S3 adicional e um processo de build separado para
sincronizar os assets. Para o nível 2 do desafio, single-origin e a escolha correta: menos
componentes, mesma separacao de cache via behaviors.

### ADR-003: VITE_API_URL vazio (URLs relativas)

O domínio CloudFront so existe após o apply, mas o Vite embute o valor de `VITE_API_URL`
em tempo de build. Manter a variavel vazia faz o frontend usar `window.location.origin`
como base para chamadas de API. Quando o usuario acessa via `https://d****.cloudfront.net`,
as chamadas vao para `https://d****.cloudfront.net/api/tarefas`, que o CloudFront roteia
para o ALB pelo behavior `/api/*` sem cache. Sem dependência ciclica, sem rebuild.

## Implementação

### Empacotamento e deploy da BIA

```bash
# clonar, aplicar patches e gerar ZIP com artefatos na raiz
./scripts/package.sh

# deploy via AWS CLI (robusto para ZIPs pre-construidos)
aws s3 cp bia-eb-deploy.zip s3://<bucket>/bia-v1.zip
aws elasticbeanstalk create-application-version \
  --application-name bia-app-04 \
  --version-label bia-v1-d04 \
  --source-bundle S3Bucket=<bucket>,S3Key=bia-v1.zip
aws elasticbeanstalk update-environment \
  --environment-name bia-eb-env-04 \
  --version-label bia-v1-d04
```

### Validação via CloudFront

```bash
# saude da aplicacao
curl -s https://<cf_domain>/api/tarefas | jq '.[] | .titulo'

# verificar header de cache (segundo request deve ter Hit)
curl -sI https://<cf_domain>/ | grep -i x-cache
# X-Cache: Hit from cloudfront
```

## Validação & Custos

A BIA 4.2.0 rodou com `Ready / Green` no Beanstalk, RDS conectado, tarefas criadas e
listadas com sucesso. O ambiente Kiro (Amazon Q Developer) validou:

- Inventário de 28 recursos com a tag `Challenge=jun2026-desafio-04`
- RDS sem acesso público, porta 5432 restrita por SG-to-SG
- Cache behaviors configurados corretamente para separar estático de dinâmico

| Servico | Custo USD | Periodo |
|---|---:|---|
| ALB | ~$0.032 | ~4h de lab |
| RDS db.t3.micro | ~$0.068 | ~4h de lab |
| EC2 t3.micro | $0.00 | Free Tier |
| **Total** | **~$0.10** | **~4h** |

## Aprendizados-chave

1. **Conta sem histórico de CloudFront pode ser bloqueada com 403.** Verificar via ticket de suporte antes de planejar o lab. A AWS exige verificação da conta para criar a primeira distribuição em contas novas ou sem histórico de uso.
2. **eb deploy fora do diretorio da aplicacao falha silenciosamente.** Usar AWS CLI diretamente (S3 + `create-application-version` + `update-environment`) e mais robusto quando o ZIP ja esta pre-construido fora do fluxo padrão do EB CLI.
3. **O behavior `/static/*` com TTL de 1 ano e mais granular que `/*` generico.** Para assets com hash no nome do arquivo (bundle do Vite), um TTL de 1 ano e seguro e mais eficiente. A implementação atual usa `/*`, que funciona mas invalida assets válidos junto com páginas HTML.

## Próximo Desafio

O Desafio 05 eleva a complexidade: BIA no ECS + CloudFront, com a restrição de fechar o acesso
do ALB exclusivamente para o CloudFront (via prefixo de header customizado ou managed prefix list).
O nível 3 requer controle de acesso mais fino do que o nível 2 deste desafio.

## Repositorio

Código completo: [github.com/nilo-lima/formacao-aws-desafios-apps-gerenciadas-cdn-aws](https://github.com/nilo-lima/formacao-aws-desafios-apps-gerenciadas-cdn-aws/tree/main/desafio_04_beanstalk_cdn)

---

> Este post e parte da serie **Formacao AWS 5.0 - Desafio Labs 2.0**.
> Mentor: [Henrylle Maia](https://hotmart.com/pt-br/club/formacaoaws).
