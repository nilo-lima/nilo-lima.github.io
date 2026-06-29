---
title: "Desafio 03 - Beanstalk via CLI + ALB (Formação AWS Jun/2026)"
description: "Como fazer o deploy da BIA no Elastic Beanstalk via EB CLI com ALB e RDS PostgreSQL, separando ciclos de vida de infra e aplicação."
pubDate: "2026-06-29"
tags: ["aws", "elastic-beanstalk", "alb", "rds", "eb-cli", "docker", "formacao-aws", "devops"]
source: "artigo"
sourceUrl: "https://hotmart.com/pt-br/club/formacaoaws"
heroImage: "/images/blog/desafio-03-beanstalk_cli_alb.png"
---

## TL;DR

Deploy da BIA (Node.js + React + PostgreSQL) no Elastic Beanstalk usando o EB CLI com ALB como balanceador e RDS PostgreSQL 17 como banco de dados. O diferencial em relação ao D01: ambiente LoadBalanced com Application Load Balancer, separação entre provisionamento de infra e deploy da aplicação, e quatro patches obrigatórios no código da BIA para funcionar em produção.

## Contexto

A Formação AWS 5.0 propõe desafios mensais progressivos. O Desafio 03 é o terceiro da trilha **APPs Gerenciadas + IAM + CDN na AWS** de junho/2026 e eleva o nível em relação ao D01 (Beanstalk via console) em dois aspectos: a interface de deploy passa a ser o **EB CLI** e o ambiente passa a usar **ALB** em vez de Single Instance.

O objetivo é aprender o fluxo real de entrega contínua com EB CLI, da forma como equipes de engenharia trabalham em ambientes Beanstalk existentes, separando a responsabilidade de provisionamento da responsabilidade de deploy.

## Arquitetura Adotada

A topologia final ficou assim:

![Arquitetura Desafio 03](/images/blog/desafio-03-beanstalk-cli-alb.png)

```
Internet → ALB (porta 80) → EC2 t3.micro Docker AL2023 (porta 8080) → RDS PostgreSQL 17 (porta 5432)
                                    ↑
                            EB CLI (ZIP via S3)
```

**Componentes provisionados:**

| Recurso | Detalhe |
|---|---|
| VPC | 10.0.0.0/16, 2 subnets públicas + 2 privadas em us-east-1 |
| ALB | Application Load Balancer, listener HTTP:80 → TG:8080 |
| EC2 | t3.micro, Docker AL2023, subnet pública (SG restrito ao ALB) |
| RDS | PostgreSQL 17, db.t3.micro, subnet privada |
| S3 | Bucket de artefatos ZIP para cada versão deployada |

## Decisões Técnicas

### ADR-001: LoadBalanced + ALB em vez de SingleInstance

O D01 usou `SingleInstance` para simplicidade. O D03 exige explicitamente ALB, que habilita health checks avançados, roteamento por path/host e prepara a arquitetura para o D04 (CloudFront na frente do Beanstalk). Custo adicional: ~$0.008/h.

### ADR-002: Infra separada do deploy

A infra (VPC, SGs, RDS, IAM, S3, EB Application) é provisionada uma vez e muda raramente. O deploy da aplicação acontece com frequência. Separar os dois ciclos de vida é o padrão de mercado: a infra fica estável e o EB CLI cuida das versões da aplicação.

### ADR-003: EC2 em subnet pública sem NAT Gateway

NAT Gateway custa ~$0.045/h, quase 6x o custo do ALB. Para um lab com budget de US$5, não faz sentido. A EC2 fica em subnet pública, mas o Security Group aceita tráfego HTTP (porta 8080) **somente do SG do ALB**. O RDS permanece em subnet privada.

### ADR-004: Reutilizar patches da BIA do D01

O D01 identificou e validou quatro patches obrigatórios no repo `henrylle/bia`. Reutilizá-los via script evita regressões e economiza tempo de debugging.

## Implementação

### Passo 1: Provisionar a infra

```bash
cd terraform/
terraform init && terraform apply -auto-approve
```

Os outputs (endpoint do RDS, IDs de SG, nome do bucket S3) alimentam o script de deploy automaticamente.

### Passo 2: Empacotar a BIA com patches

O `scripts/package.sh` clona o repo, aplica os 4 patches e gera o ZIP com artefatos **na raiz** (requisito do Beanstalk):

```bash
./scripts/package.sh
# Gera: bia-eb-deploy.zip
```

Os patches aplicados:

```bash
# 1. VITE_API_URL vazio: React usa URLs relativas (ALB roteia tudo)
sed -i 's|VITE_API_URL=http://localhost:[0-9]*|VITE_API_URL=|g' Dockerfile

# 2. Migrations automáticas no start
sed -i 's|"start": "node server"|"start": "npx sequelize db:migrate \&\& node server"|' package.json

# 3. App.jsx: fallback de URL relativa
content.replace('import.meta.env.VITE_API_URL || "http://localhost:8080"',
                'import.meta.env.VITE_API_URL || ""')

# 4. VersionInfo.jsx: origem correta independente de porta
const getApiUrl = () => {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  return window.location.origin; // funciona no ALB (porta 80 implícita)
};
```

### Passo 3: Deploy via EB CLI

```bash
eb init     # selecionar app bia-app-03 e plataforma Docker AL2023
eb create bia-eb-env-03 \
  --elb-type application \
  --instance-type t3.micro

eb setenv \
  DB_HOST=<rds_endpoint> \
  DB_USER=bia \
  DB_PWD=<senha> \
  DB_NAME=bia \
  PORT=8080

eb deploy   # faz upload do ZIP para S3 e atualiza o ambiente
```

### Passo 4: Validação

```bash
./scripts/validate.sh

# Resultado:
# [PASS] GET / retorna HTTP 200
# [PASS] GET /api/health retorna HTTP 200
# [PASS] GET /api/tarefas retorna JSON com data (dbTime=41ms)
# [PASS] Ambiente EB status Green
# [PASS] Porta 80 acessível no ALB
# Resultados: 5 PASS / 0 FAIL
```

### Passo 5: Cleanup

```bash
# Ordem obrigatória: EB primeiro, depois infra
eb terminate bia-eb-env-03 --force
cd terraform/ && terraform destroy -auto-approve
```

## Validação & Custos

**Sessão de validação de ~1h em 29/06/2026:**

| Serviço | Custo/h | Sessão 1h |
|---|---:|---:|
| EC2 t3.micro (Free Tier) | $0.000 | $0.00 |
| Application Load Balancer | $0.008 | $0.008 |
| RDS db.t3.micro | $0.017 | $0.017 |
| S3 + transferência | - | ~$0.00 |
| **Total** | | **~$0.025** |

O ALB é o diferencial de custo do D03 vs D01. Sem NAT Gateway, o custo total ficou abaixo de US$0.03 para a sessão inteira.

## Aprendizados-chave

1. **VITE_API_URL é variável de build, não de runtime.** O Vite a compila no bundle JavaScript durante o `npm run build` do Dockerfile. O repo usa a variável inline no comando `RUN` (sem prefixo `ARG`), então o `sed` precisa buscar o padrão correto (sem o prefixo ARG), ou a linha não é encontrada.

2. **Fallback de URL não pode assumir porta.** O `getApiUrl()` original verificava `window.location.port === '8080'` para retornar `window.location.origin`. No ALB, a porta 80 é implícita e não aparece na URL, então a verificação falhava e retornava `http://localhost:8080`. A solução: usar `window.location.origin` diretamente como fallback, sem verificação de porta.

3. **Rotas da BIA são em português.** O endpoint de tarefas é `/api/tarefas`, não `/api/tasks`. Qualquer smoke test com `/api/tasks` retorna 404.

4. **Destruir na ordem certa.** O `eb create` cria SGs adicionais fora do controle do Terraform. Rodar `terraform destroy` antes do `eb terminate` deixa esses SGs órfãos e bloqueia a remoção da VPC.

## Próximos Passos

O **Desafio 04** coloca o CloudFront na frente do Beanstalk como CDN, com conteúdo estático e dinâmico passando pelo CloudFront. A arquitetura do D03 serve de base direta para o D04.

## Repositório

Código completo: [github.com/nilo-lima/formacao-aws-desafios-apps-gerenciadas-cdn-aws](https://github.com/nilo-lima/formacao-aws-desafios-apps-gerenciadas-cdn-aws/tree/main/desafio_03_beanstalk_cli_alb)

---

> Este post é parte da série **Formação AWS 5.0 - Desafio Labs 2.0**.
> Mentor: [Henrylle Maia](https://hotmart.com/pt-br/club/formacaoaws).
