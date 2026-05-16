---
title: "Desafio 02: Rodei a BIA no ECS com ALB em 2 AZs, e aprendi a pegadinha do VITE_API_URL"
description: "Como configurei a aplicação BIA no ECS EC2 launch type com ALB em alta disponibilidade, e o problema que quase me fez perder horas: VITE_API_URL hardcoded no Dockerfile."
pubDate: "2026-05-15"
tags: ["aws", "ecs", "terraform", "alb", "vpc", "devops", "formacao-aws"]
slug: "desafio-02-ecs-alb-multi-az"
---

# Desafio 02: Rodei a BIA no ECS com ALB em 2 AZs, e aprendi a pegadinha do VITE_API_URL

Este é o segundo de seis desafios do mês de **Conectividade e Redes na AWS** da Formação AWS 5.0.
Se o desafio 01 foi sobre criar uma VPC manualmente e lançar a BIA em uma EC2 pública, o desafio 02 sobe o nível:
**ECS EC2 launch type + Application Load Balancer + Multi-AZ.**

---

## O que foi construído

A arquitetura final conta com:

- **VPC customizada** `bia-vpc-02` (10.2.0.0/16) com 2 subnets públicas, uma em `us-east-1a` e outra em `us-east-1b`
- **2 EC2 t3.small** funcionando como ECS Container Instances (uma por AZ)
- **ECS Cluster** `bia-cluster-02` com Capacity Provider + Auto Scaling Group
- **ECS Service** `bia-svc-02` com `desired_count=2` e rolling deployment
- **ALB internet-facing** recebendo na porta 80 e roteando para as tasks na porta 8080
- **ECR** `bia-repo-02` com lifecycle policy (mantém as 5 últimas imagens)
- **RDS PostgreSQL 17.4** `bia-rds-02` Single-AZ (db.t3.micro) acessível apenas internamente
- **EC2 bia-dev** t3.micro para build, push e execução de migrations via SSM

Todo provisionamento foi feito via **Terraform**, consumindo módulos compartilhados (`vpc`, `bia-baseline`, `alb`) do monorepo.

---

## ECS EC2 launch type vs Fargate: por que escolhi EC2?

A escolha foi deliberada e educacional. O **Fargate** é serverless, você define a task e a AWS gerencia onde ela roda. Já o **EC2 launch type** exige que você configure:

- **Capacity Provider**: conecta o ECS ao ASG e gerencia o scaling das instâncias
- **Launch Template**: define AMI ECS-optimized, tipo de instância, `user_data` que registra a EC2 no cluster via `/etc/ecs/ecs.config`
- **Auto Scaling Group**: mantém o mínimo de instâncias disponíveis para hospedar as tasks

No desafio 04, quando formos para subnet privada com NAT Gateway, o Fargate entra em cena. Aprender EC2 launch type agora faz sentido para entender o que o Fargate abstrai.

---

## A pegadinha do VITE_API_URL (e como resolver)

Esse foi o problema mais importante do desafio, e o que mais vai fazer diferença em projetos reais.

O Dockerfile do repo `henrylle/bia` tem a seguinte linha:

```dockerfile
RUN cd client && VITE_API_URL=http://localhost:3001 npm run build
```

O **Vite** compila o frontend React em arquivos estáticos. Isso significa que `VITE_API_URL` **não é uma variável de runtime**, ela é resolvida no momento do `npm run build` e gravada literalmente no bundle JavaScript que vai para o navegador.

Passei `--build-arg VITE_API_URL=http://meu-alb.amazonaws.com` no `docker build`, mas o Dockerfile não tinha a diretiva `ARG`, então o parâmetro foi ignorado silenciosamente e a imagem foi construída apontando para `localhost`.

**A solução:** aplicar dois patches antes do build:

```bash
# Declara o ARG (aceita o --build-arg externo)
sed -i '/RUN cd client && VITE_API_URL=http/i ARG VITE_API_URL=http://localhost:3001' Dockerfile

# Usa a variável em vez do valor hardcoded
sed -i 's|VITE_API_URL=http://localhost:3001 npm run build|VITE_API_URL=${VITE_API_URL} npm run build|' Dockerfile
```

Depois do patch, o build com ALB ficou assim:

```bash
docker build \
  --build-arg VITE_API_URL=http://bia-02-alb-xxx.us-east-1.elb.amazonaws.com \
  -t <ecr_url>:latest .
```

Automatizei isso no script `scripts/build-push.sh`, que verifica se o patch já foi aplicado antes de rodar, idempotente.

---

## awsvpc no EC2 launch type: detalhe que pegou

O ECS Service usa `network_mode = "awsvpc"`, cada task recebe uma ENI (Elastic Network Interface) própria. Isso tem uma consequência importante nos Security Groups:

O **ALB precisa acessar diretamente o IP da task** (não o IP da EC2 que a hospeda). Portanto, o Security Group das tasks (`bia-ecs-tasks-02`) precisa ter ingress do SG do ALB, e não do SG das instâncias EC2.

Se você deixar o ingress apontar para o SG das instâncias, o health check do ALB vai falhar com `unhealthy`.

---

## Migrations via container efêmero

Uma das melhores práticas que aprendi neste desafio: **rodar migrations sem SSH**.

Em vez de entrar no container em execução, usei um `docker run --rm` efêmero direto na `bia-dev`:

```bash
docker run --rm \
  -e DB_HOST=bia-rds-02.ccx4oksoqgoo.us-east-1.rds.amazonaws.com \
  -e DB_PORT=5432 \
  -e DB_USER=postgres \
  -e DB_NAME=bia \
  -e DB_PWD=<senha> \
  <ecr_url>:latest \
  npx sequelize db:migrate
```

O container conecta no RDS, roda as migrations e sai. Clean, rastreável, sem estado.

---

## Custos: ~$0.23 em 3 horas

| Serviço | Custo |
|---|---:|
| 2× EC2 t3.small (ECS instances) | ~$0.14 |
| RDS db.t3.micro | ~$0.05 |
| ALB | ~$0.02 |
| Outros (EBS, CloudWatch) | ~$0.02 |
| **Total** | **~$0.23** |

O maior custo foi as EC2 do ASG, e essa é a lição FinOps: no EC2 launch type, as instâncias ficam alocadas **24/7** independente de ter tasks rodando. Se o objetivo é economizar, Fargate é mais eficiente para workloads intermitentes.

---

## Resultado

```bash
$ curl -I http://bia-02-alb-2133079818.us-east-1.elb.amazonaws.com
HTTP/1.1 200 OK
Content-Type: text/html; charset=UTF-8
X-Powered-By: Express
```

**BIA no ar, tarefa cadastrada, ALB balanceando entre 2 AZs.**

Próximo desafio: EC2 + SSH + SSM + Instance Connect, foco em modelos de conectividade e acesso seguro a instâncias.

---

## Código completo

Repositório: [formacao-aws-desafios-conectividade-redes-aws](https://github.com/nilo-lima/formacao-aws-desafios-conectividade-redes-aws)

---

*Parte da série **Formação AWS 5.0, Mentoria Desafio Labs 2.0** · Mai/2026 · Henrylle Maia*
