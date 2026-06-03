---
title: "Desafio 04 - NAT Gateway + ECS Privado (Formacao AWS Mai/2026)"
description: "Como isolar containers ECS Fargate em subnets privadas e garantir saida de internet segura via NAT Gateway - tudo provisionado com Terraform."
pubDate: "2026-06-08"
tags: ["aws", "nat-gateway", "ecs", "fargate", "terraform", "formacao-aws", "devops", "vpc"]
source: "artigo"
sourceUrl: "https://hotmart.com/pt-br/club/formacaoaws"
heroImage: "/images/blog/desafio-04-nat-gateway.png"
---

## TL;DR

Implementei o desafio **NAT Gateway + ECS Privado** da Mentoria Desafio Labs 2.0 (Formacao AWS 5.0 - Mai/2026).
A BIA roda no ECS Fargate em subnet privada, sem IP publico, com saida de internet exclusivamente via NAT Gateway.
Terraform provisionou 33 recursos em ~10 minutos. O objetivo central: provar que sem NAT Gateway, containers
Fargate em subnet privada nao sobem.

## Contexto

A trilha de maio/2026 da Formacao AWS 5.0 e focada em **Conectividade e Redes na AWS** - seis desafios
progressivos que cobrem VPC, ECS, EC2/SSM, NAT Gateway, VPC Peering e VPC Endpoints.

O desafio 04 e o ponto de inflexao da trilha: aqui a arquitetura passa de "tudo publico" (desafios 01-02)
para "tudo privado com saida controlada". O NAT Gateway e o elemento que viabiliza esse isolamento sem
perder a capacidade de pull de imagens, envio de logs e comunicacao com o ECS control plane.

O cenario: a aplicacao BIA (task manager com React + Node.js + PostgreSQL) precisa rodar em subnet privada
por razoes de seguranca, mas o ECS Fargate precisa de acesso a internet para funcionar. O NAT Gateway
resolve esse paradoxo.

## Arquitetura Adotada

![Arquitetura Desafio 04](/images/blog/desafio-04-nat-gateway.png)

A VPC `bia-04` usa CIDR `10.4.0.0/16` com 4 subnets em 2 AZs:

| Subnet | CIDR | Recursos |
|---|---|---|
| Publica A (us-east-1a) | 10.4.1.0/24 | ALB + NAT Gateway |
| Publica B (us-east-1b) | 10.4.2.0/24 | ALB (multi-AZ) |
| Privada A (us-east-1a) | 10.4.10.0/24 | ECS Fargate tasks |
| Privada B (us-east-1b) | 10.4.20.0/24 | ECS Fargate tasks + RDS |

O fluxo de rede tem dois caminhos distintos:

**Trafego entrante:** Internet -> IGW -> ALB (porta 80, subnet publica) -> ECS task (porta 8080, subnet privada)

**Trafego sainte (NAT):** ECS task -> Tabela de rotas privada -> NAT Gateway (subnet publica) -> IGW -> ECR / ECS API / CloudWatch

A task ECS tem `assign_public_ip = false` - validado em producao: `PublicDnsName = None` no describe-tasks.

## Decisoes Tecnicas

### ADR-001: ECS Fargate em vez de EC2 Launch Type

O desafio usa o modulo `shared/modules/ecs-fargate` em vez do EC2 launch type usado no desafio 02.
A motivacao e pedagogica: o objetivo aqui e entender o fluxo do NAT, nao gerenciar capacity providers
ou ASGs. O comportamento e identico para o aprendizado: sem NAT Gateway, a task Fargate fica em STOPPED
indefinidamente - exatamente como uma instancia EC2 sem rota de saida.

### ADR-002: Single NAT Gateway

O modulo `nat-gateway` suporta `single_nat = true` (1 NAT em 1 AZ) ou HA (1 NAT por AZ).
Para um lab de 3h com budget de $5, a escolha foi `single_nat = true`:

- 1 NAT GW = $0.045/h x 3h = $0.135
- 2 NAT GWs = $0.090/h x 3h = $0.270

Em producao com SLA, o correto e 1 NAT por AZ. Se us-east-1a falhar, tasks em us-east-1b perdem saida.
Documentado como desvio consciente no ADR-002.

### ADR-003: RDS criado diretamente, sem modulo bia-baseline

O modulo `bia-baseline` cria Security Groups orientados a EC2 (`bia-dev`/`bia-web`). Aqui o RDS precisa
aceitar conexoes do SG do ECS task, nao de uma instancia EC2. Criar o RDS diretamente no `main.tf` permite
configurar o `source_security_group_id` correto sem gambiarra no modulo.

## Implementacao em IaC

O ponto-chave do desafio em Terraform: tasks ECS em subnet privada, com `depends_on` no NAT Gateway
para garantir que as rotas estejam configuradas antes das tasks tentarem se registrar no ECS control plane.

```hcl
module "ecs" {
  source = "../../shared/modules/ecs-fargate"

  name_prefix      = local.name_prefix
  subnet_ids       = module.vpc.private_subnet_ids   # subnet privada!
  assign_public_ip = false                            # sem IP publico!

  environment_variables = [
    { name = "DB_HOST", value = aws_db_instance.bia.address },
    { name = "DB_PORT", value = "5432" },
    { name = "DB_NAME", value = "bia" },
    { name = "DB_USER", value = "postgres" },
    { name = "DB_PWD",  value = var.rds_password },
  ]

  depends_on = [module.nat_gw]   # NAT GW e rotas prontos antes das tasks
}
```

O SG do RDS usa `source_security_group_id` - sem CIDR aberto, apenas o SG do ECS pode conectar:

```hcl
resource "aws_security_group_rule" "rds_from_ecs" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.rds.id
  source_security_group_id = aws_security_group.ecs.id  # source-SG, nao CIDR
}
```

## Validacao e Custos

Evidencias coletadas apos o deploy:

**ECS task sem IP publico:**
```
SubnetId     : subnet-0e4fc41f7386eb031  (privada 10.4.20.0/24)
PrivateIP    : 10.4.20.168
PublicDnsName: None   <-- prova do isolamento
```

**NAT Gateway disponivel:**
```
State    : available
PublicIP : 52.21.84.197  (EIP alocado)
SubnetId : subnet-08cb8597161b2d81b  (publica 10.4.1.0/24)
```

**Smoke tests:**
```bash
curl http://bia-04-alb-714862263.us-east-1.elb.amazonaws.com/        # HTTP 200
curl http://bia-04-alb-714862263.us-east-1.elb.amazonaws.com/api/versao  # "Bia 4.2.0"
curl http://bia-04-alb-714862263.us-east-1.elb.amazonaws.com/api/tarefas # CRUD completo
```

**Custos estimados (lab de 3h):**

| Servico | Custo USD |
|---|---:|
| NAT Gateway | ~$0.14 |
| RDS db.t3.micro | ~$0.05 |
| ALB | ~$0.02 |
| ECS Fargate | ~$0.01 |
| ECR | ~$0.00 |
| **Total** | **~$0.22** |

## Aprendizados-chave

1. **NAT Gateway e obrigatorio para Fargate em subnet privada.** Sem ele, o container nao consegue
   puxar a imagem do ECR nem se registrar no ECS control plane. O servico fica em STOPPED
   indefinidamente - sem log de erro obvio no console. O `depends_on = [module.nat_gw]` e critico.

2. **Migrations Sequelize via ECS run-task.** Sem ECS Exec habilitado (requer task role com SSM),
   o caminho mais limpo para rodar `sequelize db:migrate` e um `aws ecs run-task` com command override,
   reutilizando as mesmas env vars da task definition. O `sequelize-cli` como devDependency sobrevive
   ao `npm prune --production` no contexto root do container.

3. **Single NAT vs HA e uma decisao consciente.** Em lab, $0.14 vs $0.27 parece trivial. Em producao
   com 10 AZs e trafego continuo, a diferenca e $324/mes vs $648/mes. A documentacao do ADR garante
   que o desvio nao vire divida tecnica silenciosa.

## Proximos Passos

O desafio 05 vai escalar o conceito: **VPC Peering entre regioes**. Duas VPCs em regioes diferentes
se comunicando via peering, sem transitar pela internet publica. O desafio pedagogico: configurar
as tabelas de rotas nos dois lados e entender por que VPC Peering nao e transitivo.

## Repositorio

Codigo completo: [github.com/nilo-lima/formacao-aws-desafios-mai2026](https://github.com/nilo-lima/formacao-aws-desafios-mai2026/tree/main/desafio_04_nat_gateway)

---

> Este post e parte da serie **Formacao AWS 5.0 - Desafio Labs 2.0**.
> Mentor: [Henrylle Maia](https://hotmart.com/pt-br/club/formacaoaws).
