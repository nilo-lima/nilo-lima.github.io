---
title: "Desafio 05 - VPC + VPC Peering multi-regiao (Formacao AWS Mai/2026)"
description: "Como estabeleci comunicacao cross-region entre us-east-1 e us-east-2 via VPC Peering usando Terraform com dual-provider e validei com ICMP/SSH via IPs privados."
pubDate: "2026-06-08"
tags: ["aws", "vpc-peering", "terraform", "formacao-aws", "devops", "redes"]
source: "artigo"
sourceUrl: "https://hotmart.com/pt-br/club/formacaoaws"
heroImage: "/images/blog/desafio-05-vpc-peering.png"
---

## TL;DR

Implementei o desafio **VPC + VPC Peering multi-regiao** da Mentoria Desafio Labs 2.0 (Formacao AWS 5.0 - Mai/2026) usando **Terraform com dual-provider e aliases de regiao**, provisionando 22 recursos em us-east-1 e us-east-2 com um unico `terraform apply`. Resultado: ping e SSH cross-region funcionando via IPs privados, sem trafego pela internet publica. Custo total: ~$0.06 para uma sessao de ~2h.

## Contexto

O quinto desafio da trilha **Conectividade e Redes na AWS** sobe um nivel de complexidade: nao basta criar uma VPC funcional. Aqui o objetivo e conectar duas VPCs em regioes diferentes — us-east-1 e us-east-2 — e provar que o trafego flui via IPs privados atraves do VPC Peering, sem passar pela internet publica.

O VPC Peering e um dos recursos de rede mais fundamentais da AWS: permite conectar VPCs como se estivessem na mesma rede, sem a latencia e o custo de um VPN ou de um Transit Gateway para cenarios simples ponto-a-ponto.

O grande desafio tecnico nao esta no peering em si, mas em **gerenciar dois providers Terraform para regioes diferentes** de forma elegante — e em entender a restricao do VPC Peering cross-region com aceitacao automatica.

## Arquitetura Adotada

Dois ambientes espelhados, um em cada regiao:

- **VPC east1** (`10.0.0.0/16`, us-east-1) com subnet publica, IGW e EC2
- **VPC east2** (`10.1.0.0/16`, us-east-2) com subnet publica, IGW e EC2
- **VPC Peering** (`pcx-090cd78943e7d584a`) conectando as duas VPCs
- **Rotas** em ambas as route tables apontando o CIDR da VPC par para o peering
- **CloudWatch Logs** em cada regiao para observabilidade

Os IGWs existem apenas para SSH de gestao do operador. Todo o trafego de validacao (ping e SSH cross-region) usa exclusivamente os IPs privados via peering.

## Decisoes Tecnicas

### ADR-001: Dual-provider Terraform com aliases de regiao

O Terraform nao suporta variáveis dentro de blocos `provider`, entao nao da para parametrizar a regiao dinamicamente. A solucao e declarar dois providers com aliases:

```hcl
provider "aws" {
  alias  = "useast1"
  region = "us-east-1"
}

provider "aws" {
  alias  = "useast2"
  region = "us-east-2"
}
```

Cada modulo ou recurso recebe o provider correto via `provider = aws.useastN` ou `providers = { aws = aws.useastN }`. Beneficio: estado unificado em um unico `terraform.tfstate` — `apply` e `destroy` sao atomicos.

### ADR-002: CIDRs nao sobrepostos por design

VPC Peering tem uma restricao hard: os CIDRs das VPCs participantes **nao podem se sobrepor**. Qualquer sobreposicao impede a criacao do peering com erro imediato da API. Adotei o padrao `10.N.0.0/16`:

| VPC | Regiao | CIDR |
|---|---|---|
| bia-vpc-05-east1 | us-east-1 | 10.0.0.0/16 |
| bia-vpc-05-east2 | us-east-2 | 10.1.0.0/16 |

### ADR-003: EC2 em subnet publica sem NAT Gateway

O objetivo e validar peering via IPs privados — subnets privadas + NAT Gateway custariam ~$0.09/h extra sem nenhum beneficio tecnico para o desafio. EC2 em subnet publica com `associate_public_ip_address = true` cobre o acesso de gestao e reduz o custo da sessao em ~5x.

### ADR-004: Aceitacao automatica via `aws_vpc_peering_connection_accepter`

VPC Peering cross-region nao suporta `auto_accept = true` no recurso requester — o pedido fica em `pending-acceptance`. A solucao Terraform e usar o recurso `aws_vpc_peering_connection_accepter` com o provider da regiao accepter:

```hcl
resource "aws_vpc_peering_connection_accepter" "east2" {
  provider                  = aws.useast2
  vpc_peering_connection_id = aws_vpc_peering_connection.east1_to_east2.id
  auto_accept               = true
}
```

Com `depends_on` nas rotas apontando para o accepter, o `apply` produz peering `active` em uma unica execucao.

## Implementacao em IaC

O ponto central do `main.tf`:

```hcl
# Requester (us-east-1)
resource "aws_vpc_peering_connection" "east1_to_east2" {
  provider    = aws.useast1
  vpc_id      = module.vpc_east1.vpc_id
  peer_vpc_id = module.vpc_east2.vpc_id
  peer_region = "us-east-2"
  tags        = merge(local.common_tags, { Name = "bia-peering-05-east1-east2" })
}

# Accepter (us-east-2)
resource "aws_vpc_peering_connection_accepter" "east2" {
  provider                  = aws.useast2
  vpc_peering_connection_id = aws_vpc_peering_connection.east1_to_east2.id
  auto_accept               = true
  tags                      = merge(local.common_tags, { Name = "bia-peering-05-accepter" })
}

# Rota east1 -> east2
resource "aws_route" "east1_to_east2" {
  provider                  = aws.useast1
  route_table_id            = module.vpc_east1.public_route_table_id
  destination_cidr_block    = var.vpc_cidr_east2
  vpc_peering_connection_id = aws_vpc_peering_connection.east1_to_east2.id
  depends_on                = [aws_vpc_peering_connection_accepter.east2]
}
```

## Validacao e Custos

Tres smoke tests executados com sucesso:

1. **SSH externo east1** — `ssh -i ~/.ssh/bia-05 ec2-user@<ip-publico-east1>` - PASS
2. **Ping east2 via peering** — `ping -c 4 10.1.1.126` (dentro da east1) - PASS
3. **SSH east2 via peering** — `ssh ec2-user@10.1.1.126` com agent forward - PASS

| Servico | Custo USD |
|---|---:|
| EC2 t3.micro x2 | ~$0.04 |
| Data Transfer cross-region | ~$0.01 |
| CloudWatch Logs | ~$0.01 |
| **Total** | **~$0.06** |

## Aprendizados-chave

1. **`aws_vpc_peering_connection_accepter` e obrigatorio para cross-region** — sem ele o peering fica em `pending-acceptance` para sempre.
2. **`depends_on` nas rotas nao e opcional** — o Terraform tenta criar as rotas em paralelo com o accepter; sem dependencia explicita, o apply falha porque o peering ainda nao esta `active`.
3. **SSH agent forwarding** (`-A`) e a forma correta de testar SSH via peering sem expor chaves privadas dentro das instancias.
4. **Dual-provider com aliases** e o padrao canônico do Terraform para multi-regiao — workspaces nao resolvem esse problema, aliases sim.
5. **CIDRs nao sobrepostos sao prerequisito hard** da API AWS, nao uma boa pratica — vale planejar o esquema de enderecamento antes de qualquer apply.

## Proximo Desafio

**Desafio 06: VPC Endpoint + SSM + EC2 Instance Connect** — acesso seguro a instancias em subnet privada sem NAT Gateway, usando endpoints de interface para SSM e EC2 Instance Connect Endpoint.

## Repositorio

Codigo completo: [github.com/nilo-lima/formacao-aws-desafios-mai2026](https://github.com/nilo-lima/formacao-aws-desafios-mai2026/tree/main/desafio_05_vpc_peering)

---

> Este post e parte da serie **Formacao AWS 5.0 - Desafio Labs 2.0**.
> Mentor: [Henrylle Maia](https://hotmart.com/pt-br/club/formacaoaws).
