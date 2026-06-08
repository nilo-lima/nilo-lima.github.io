---
title: "Desafio 06 - VPC Endpoint + SSM + EC2 Instance Connect (Formacao AWS Mai/2026)"
description: "Como acessei uma EC2 em subnet 100% privada sem NAT Gateway, sem IP publico e sem bastion, usando SSM Session Manager e EC2 Instance Connect Endpoint via VPC Endpoints."
pubDate: "2026-06-08"
tags: ["aws", "vpc-endpoint", "ssm", "ec2-instance-connect", "terraform", "formacao-aws"]
source: "artigo"
sourceUrl: "https://hotmart.com/pt-br/club/formacaoaws"
heroImage: "/images/blog/desafio-06-vpc-endpoint.png"
---

## TL;DR

Implementei o desafio **VPC Endpoint + SSM + EC2 Instance Connect** da Mentoria Desafio Labs 2.0 (Formacao AWS 5.0 - Mai/2026): uma EC2 em subnet 100% privada, sem NAT Gateway, sem IP publico, acessada exclusivamente via SSM Session Manager e EC2 Instance Connect Endpoint. Custo total: ~$0.10 para uma sessao de ~2h.

## Contexto

O sexto e ultimo desafio da trilha **Conectividade e Redes na AWS** fecha o ciclo com um conceito poderoso: voce nao precisa de internet para gerenciar suas instancias AWS. Usando VPC Endpoints, e possivel acessar o SSM, fazer SSH e ate instalar pacotes — tudo dentro da rede privada da AWS, sem NAT Gateway e sem expor portas ao internet publico.

Este e o padrao recomendado pela AWS para ambientes de producao com requisitos de seguranca elevados: instancias em subnets privadas totalmente isoladas, gerenciadas via plano de controle AWS.

## Arquitetura Adotada

Uma VPC com apenas subnet privada:

- **VPC** `bia-vpc-06` (10.0.0.0/16) em us-east-1
- **Subnet privada** 10.0.2.0/24 — sem IGW funcional, sem NAT
- **EC2** t3.micro (Amazon Linux 2023) sem IP publico, com IAM Role SSM
- **3 endpoints Interface SSM** (ssm, ssmmessages, ec2messages) — SSM Session Manager
- **EC2 Instance Connect Endpoint** — SSH sem internet
- **S3 Gateway Endpoint** (gratuito) — `dnf install` sem NAT
- **SEM NAT Gateway, SEM bastion host**

## Decisoes Tecnicas

### ADR-001: VPC somente com subnet privada

O objetivo e provar que gerenciamento nao exige internet. Uma VPC com subnet publica + NAT tornaria o desafio identico ao 04. Com `public_subnets = []` no modulo VPC, a subnet privada nao tem rota de saida — todo acesso passa pelos endpoints.

### ADR-002: SSM Session Manager vs Bastion Host

| Criterio | Bastion Host | SSM Session Manager |
|---|---|---|
| EC2 extra | Sim (~$8/mes) | Nao |
| Porta 22 exposta | Sim | Nao |
| Auditoria IAM | Nao nativo | Sim (CloudTrail) |

Para labs curtos o custo e equivalente, mas SSM elimina uma superficie de ataque inteira.

### ADR-003: EC2 Instance Connect Endpoint

SSH para instancias privadas sem VPN, sem bastion, sem IP publico. A AWS CLI gera um certificado temporario (60s) e abre um tunel SSH pelo endpoint. Autorizacao controlada por IAM.

### ADR-004: S3 Gateway Endpoint gratuito

Amazon Linux 2023 busca pacotes em repos hospedados no S3. O Gateway Endpoint e gratuito (sem custo de hora nem de dados) e permite `dnf install` sem NAT — a solucao idiomatica da AWS.

## Implementacao em IaC

O ponto central — IAM Role para SSM e os endpoints:

```hcl
resource "aws_iam_role" "ssm" {
  name = "bia-ssm-role-06"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ssm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
```

```hcl
module "vpc_endpoints" {
  source = "../../shared/modules/vpc-endpoints"

  enable_ssm_endpoints        = true  # ssm + ssmmessages + ec2messages
  enable_ec2_instance_connect = true  # SSH sem internet
  enable_s3_gateway           = true  # dnf install gratuito
  enable_ecr_endpoints        = false
}
```

## Validacao e Custos

Cinco testes executados com sucesso:

1. SSM registrado com `PingStatus=Online`
2. `aws ssm start-session` - sessao interativa sem internet
3. `curl http://example.com` dentro da instancia - timeout (sem saida para internet)
4. `aws ec2-instance-connect ssh` - SSH via EIC Endpoint
5. SSM Port Forward + `curl http://localhost:8080` - HTTP server respondendo

| Servico | Custo USD |
|---|---:|
| EC2 t3.micro | ~$0.02 |
| Endpoints Interface x3 SSM | ~$0.06 |
| EIC Endpoint | ~$0.02 |
| S3 Gateway | $0.00 |
| **Total** | **~$0.10** |

## Aprendizados-chave

1. **SSM sem internet requer os 3 endpoints** (ssm + ssmmessages + ec2messages) com `private_dns_enabled = true` — qualquer um faltando e a sessao nao abre.
2. **EIC Endpoint demora 3-8 min para provisionar** — o recurso mais lento desta arquitetura.
3. **`SSH_AUTH_SOCK=""` resolve "too many authentication failures"** — o SSH agent oferece muitas chaves antes da chave EIC, causando desconexao.
4. **S3 Gateway e gratuito** — zero custo adicional para `dnf install` sem NAT.
5. **Este padrao elimina o NAT Gateway** (~$0.045/hora) para workloads que precisam apenas de gerenciamento — economia significativa em producao.

## Este Foi o Ultimo Desafio do Mes

6/6 desafios da trilha **Conectividade e Redes na AWS** entregues em Mai/2026:

| # | Desafio | Nivel |
|---|---|:---:|
| 01 | VPC + Subnet Publica | 1/3 |
| 02 | VPC + ECS + ALB | 2/3 |
| 03 | EC2 + SSH + SSM + Instance Connect | 2/3 |
| 04 | NAT Gateway + ECS Privado | 2/3 |
| 05 | VPC Peering multi-regiao | 3/3 |
| 06 | VPC Endpoint + SSM + EIC Endpoint | 3/3 |

## Repositorio

Codigo completo: [github.com/nilo-lima/formacao-aws-desafios-mai2026](https://github.com/nilo-lima/formacao-aws-desafios-mai2026/tree/main/desafio_06_vpc_endpoint)

---

> Este post e parte da serie **Formacao AWS 5.0 - Desafio Labs 2.0**.
> Mentor: [Henrylle Maia](https://hotmart.com/pt-br/club/formacaoaws).
