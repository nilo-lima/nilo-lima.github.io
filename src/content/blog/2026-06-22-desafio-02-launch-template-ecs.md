---
title: "Desafio 02 - Como trocar o Security Group de um cluster ECS sem downtime"
description: "Launch Template versionado + Instance Refresh no ASG para alterar Security Groups de forma segura"
pubDate: "2026-06-22"
tags: ["aws", "ecs", "launch-template", "instance-refresh", "asg", "security-group", "formacao-aws", "devops"]
source: "artigo"
sourceUrl: "https://hotmart.com/pt-br/club/formacaoaws"
heroImage: "/images/blog/desafio-02-launch-template-ecs.png"
---

## TL;DR

Alterei o Security Group das instancias EC2 de um cluster ECS usando Launch Template versionado + Instance Refresh no ASG, sem derrubar a aplicacao BIA (Node.js + React + PostgreSQL). A troca levou ~2 minutos com zero downtime.

## Contexto

Este e o segundo desafio da trilha **APPs Gerenciadas + IAM + CDN na AWS** da Formacao AWS 5.0 (Jun/2026). O objetivo: alterar o Security Group associado as EC2 do cluster ECS via Launch Template.

O problema que este desafio resolve e real: voce nao pode simplesmente editar o Security Group de uma EC2 gerenciada por um Auto Scaling Group. O SG e definido no Launch Template, e qualquer mudanca exige uma nova versao do template + substituicao gradual das instancias.

## Arquitetura Adotada

![Arquitetura](/images/blog/desafio-02-architecture.png)

Componentes:
- **VPC Default** (us-east-1) com subnets publicas
- **ECS Cluster** (bia-ecs-02) com launch type EC2
- **Launch Template** (bia-lt-02) com AMI ECS-optimized AL2023
- **Auto Scaling Group** (bia-asg-02) com Instance Refresh configurado
- **RDS PostgreSQL 17** (db.t3.micro) para o banco da BIA
- **ECR** (bia-02) para a imagem Docker

## Decisoes Tecnicas

### ECS com EC2 (nao Fargate)

Launch Template + Instance Refresh so existe com instancias EC2 gerenciadas pelo usuario. No Fargate, a AWS abstrai completamente a camada de compute - nao ha instancias para trocar SG.

### Host networking sem ALB

Acesso direto via IP publico da EC2 na porta 8080. Sem ALB, economizamos ~US$0.19/dia e mantemos o foco no objetivo: Launch Template + Instance Refresh.

### Instance Refresh com MinHealthy=100%

A nova EC2 sobe antes da antiga ser terminada. Com MaxHealthy=200%, o ASG permite temporariamente 2 instancias (desired=1) durante a troca. Zero downtime garantido.

## O Fluxo da Troca

### Estado inicial (Launch Template v1)

- EC2 rodando com **SG-Original**: portas 80 e 8080 abertas
- BIA acessivel e funcional

### A acao (Launch Template v2)

1. Criada versao 2 do Launch Template com **SG-Novo** (portas 80, 8080 e 443)
2. ASG atualizado para usar a nova versao
3. Instance Refresh disparado automaticamente

### Resultado

- Nova EC2 lancada com SG-Novo
- Instancia antiga terminada apos nova estar saudavel
- BIA continua respondendo HTTP 200 no novo IP
- Duracao total: **~2 minutos e 32 segundos**

## Validacao

A aplicacao BIA (Node.js + React + PostgreSQL) continuou funcional durante e apos o Instance Refresh:

- HTTP 200 OK na porta 8080
- Frontend React carregando normalmente
- Persistencia no RDS PostgreSQL mantida

### Auditoria via Kiro

3 perguntas ao Kiro validaram independentemente:
1. **Inventario:** 18 recursos tagueados, 3 SGs auditados - todos SEGUROS
2. **Custos:** projecao mensal ~US$24.56 (RDS = 59% do custo)
3. **Arquitetura:** Instance Refresh Successful, LT v2, SG bia-ecs-novo-02 confirmado

## Custos

| Servico | Custo real (~2h) |
|---|---:|
| EC2 t3.micro | $0.00 (Free Tier) |
| RDS db.t3.micro | ~$0.034 |
| ECR + CloudWatch | ~$0.006 |
| **Total** | **~$0.04** |

Todos os 18 recursos tagueados com `Challenge=jun2026-desafio-02` para rastreabilidade no Cost Explorer.

## Aprendizados-chave

1. **Security Group e herdado do Launch Template** - nao da pra editar direto na instancia em execucao. A unica forma de trocar e criar uma nova versao do LT e substituir a instancia.
2. **Instance Refresh com MinHealthy=100% garante zero downtime** - a nova instancia sobe e e validada antes da antiga ser terminada.
3. **Sempre validar a porta real do container** - a BIA roda na 8080 em producao (nao 3001 como no dev). Configurar SGs sem testar a porta real e receita pra horas de debug.

## Proximos Passos

Desafio 03: BIA no Beanstalk via EB CLI com ALB e RDS. O foco muda de ECS para Beanstalk, mas agora com deploy via linha de comando em vez de console.

## Repositorio

Codigo completo: [github.com/nilo-lima/formacao-aws-desafios-apps-gerenciadas-cdn-aws](https://github.com/nilo-lima/formacao-aws-desafios-apps-gerenciadas-cdn-aws/tree/main/desafio_02_launch_template_ecs)

---

> Este post e parte da serie **Formacao AWS 5.0 - Desafio Labs 2.0**.
> Mentor: [Henrylle Maia](https://hotmart.com/pt-br/club/formacaoaws).
