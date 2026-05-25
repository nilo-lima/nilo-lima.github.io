---
title: "Desafio 03 - EC2 + SSH + SSM + Instance Connect (Formacao AWS Mai/2026)"
description: "5 formas de conectar a instancias EC2 na AWS: SSH direto, Bastion Host, EC2 Instance Connect, SSM Session Manager e EC2 Instance Connect Endpoint. Comparativo pratico com evidencias reais."
pubDate: "2026-05-24"
tags: ["aws", "ec2", "ssm", "instance-connect", "formacao-aws", "devops"]
source: "artigo"
sourceUrl: "https://hotmart.com/pt-br/club/formacaoaws"
heroImage: "/images/blog/desafio-03-ec2-ssm-ssh.png"
---

## TL;DR

Concluido o terceiro desafio da trilha **Conectividade e Redes na AWS** (Formacao AWS 5.0, Mai/2026): provisionar um ambiente completo na AWS e validar **5 metodos distintos de conectividade para EC2**, desde o SSH direto ate o EC2 Instance Connect Endpoint — cada um com seu perfil de seguranca, custo operacional e facilidade de uso. Custo total da sessao de lab: **~$0,30**.

---

## Contexto

A Mentoria Desafio Labs 2.0 da Formacao AWS 5.0 propoe 6 desafios mensais de networking na AWS. O desafio 03 e classificado como **Linear** (segue a progressao das aulas) e de nivel intermediario.

O objetivo central: entender na pratica como um desenvolvedor ou engenheiro de cloud pode se conectar a instancias EC2, especialmente aquelas em **subnets privadas sem IP publico** — que e o cenario real da maioria dos ambientes de producao.

A pergunta que guia o desafio: *"Como voce acessa sua EC2 sem expor portas desnecessarias na internet?"*

---

## Arquitetura

O ambiente provisionado consolida todos os cenarios em uma unica VPC:

**Componentes principais:**

| Recurso | Tipo | Finalidade |
|---|---|---|
| VPC `bia-vpc-03` | 10.0.0.0/16, 2 AZs | Rede isolada |
| Bastion Host | EC2 t3.micro AL2023, subnet publica | Jump server (Metodo 2) |
| NAT Gateway | EIP dedicado | Saida internet para SSM Agent |
| EC2 Linux | t3.micro AL2023, subnet privada | Alvo principal dos 5 metodos |
| EC2 Windows | t3.micro Win 2022, subnet privada | Validacao RDP via tunnel e ICE |
| RDS PostgreSQL 15 | db.t3.micro, subnet privada | Validacao de tunnels de banco |
| ICE Endpoint | Servico gerenciado AWS | Metodo 5: acesso privado sem bastion |
| IAM Instance Profile | AmazonSSMManagedInstanceCore | Habilita SSM em todas as instancias |

---

## Os 5 Metodos de Conectividade

### Metodo 1 - SSH Direto

O mais simples: instancia com IP publico, porta 22 aberta no Security Group, chave pem local.

```bash
ssh -i ~/.ssh/bia-lab-03 ec2-user@<IP_PUBLICO>
```

**Quando usar:** prototipagem rapida, bastion host.
**Risco:** porta 22 exposta na internet. Qualquer IP pode tentar autenticar.

---

### Metodo 2 - Bastion Host + Tunnel SSH

O bastion fica na subnet publica (porta 22 aberta). As instancias e o banco ficam na subnet privada. O acesso e feito via redirecionamento de porta local (tunnel).

```bash
# Abre tunnel SSH: porta local 2222 -> EC2 privada porta 22
ssh -i ~/.ssh/bia-lab-03 -L 2222:10.0.10.115:22 ec2-user@<BASTION_IP> -N -f

# Conecta via tunnel
ssh -i ~/.ssh/bia-lab-03 -p 2222 ec2-user@localhost

# Tunnel para o banco PostgreSQL
ssh -i ~/.ssh/bia-lab-03 -L 5433:<RDS_ENDPOINT>:5432 ec2-user@<BASTION_IP> -N -f
psql -h localhost -p 5433 -U postgres -d labdb
```

**Quando usar:** instancias privadas em ambientes legados sem SSM.
**Custo extra:** a EC2 bastion roda continuamente.

---

### Metodo 3 - EC2 Instance Connect

A AWS injeta uma chave SSH temporaria valida por **60 segundos** via API. Nao e necessario ter uma chave pem local nem a porta 22 permanentemente liberada para seu IP.

```bash
aws ec2-instance-connect ssh \
  --instance-id i-0731a92fa7b8e01b6 \
  --os-user ec2-user \
  --region us-east-1
```

Ou diretamente pelo console AWS: **EC2 > Connect > EC2 Instance Connect**.

**Quando usar:** acesso pontual de administracao sem gerenciar chaves fixas.

---

### Metodo 4 - SSM Session Manager

Zero portas abertas. Zero IP publico necessario. O SSM Agent, instalado por padrao nas AMIs Amazon Linux 2023, contata os endpoints do SSM via NAT Gateway e estabelece um canal seguro de volta.

```bash
# Sessao interativa
aws ssm start-session --target i-08fd87a51e2c1229d --region us-east-1

# Port Forwarding para RDS (sem abrir nenhuma porta de rede)
aws ssm start-session \
  --target i-08fd87a51e2c1229d \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["<RDS_ENDPOINT>"],"portNumber":["5432"],"localPortNumber":["5433"]}' \
  --region us-east-1
```

**Quando usar:** producao, ambientes com compliance rigoroso, auditoria completa via CloudTrail + Session Manager Logs.
**Prerequisito:** IAM Instance Profile com `AmazonSSMManagedInstanceCore` + NAT Gateway (ou VPC Endpoints).

---

### Metodo 5 - EC2 Instance Connect Endpoint

O metodo mais recente da AWS (GA em 2023). Um servico gerenciado que funciona como proxy de rede dentro da VPC — sem EC2 bastion, sem porta aberta, com suporte a SSH (Linux) e RDP (Windows).

```bash
# Terminal 1: abre tunnel via ICE Endpoint
aws ec2-instance-connect open-tunnel \
  --instance-id i-08fd87a51e2c1229d \
  --remote-port 22 \
  --local-port 2222 \
  --region us-east-1

# Terminal 2: SSH pelo tunnel local
ssh -i ~/.ssh/bia-lab-03 -p 2222 ec2-user@localhost

# Tunnel RDP para Windows
aws ec2-instance-connect open-tunnel \
  --instance-id i-0662953c151af3956 \
  --remote-port 3389 \
  --local-port 13389 \
  --region us-east-1
```

**Quando usar:** instancias privadas sem bastion EC2, acesso RDP a Windows privado, ambientes onde o custo do bastion nao se justifica.
**Custo:** ~$0,01/h por endpoint + $0,01/GB de dados processados.

---

## Comparativo Final

| Metodo | Porta aberta? | IP publico? | Auditoria | Custo extra |
|---|:---:|:---:|---|---|
| SSH Direto | Sim (22) | Sim | Nenhuma | Nenhum |
| Bastion + Tunnel | Sim (bastion) | Bastion | Nenhuma | EC2 rodando |
| Instance Connect | Nao | Opcional | Parcial | Nenhum |
| SSM Session Manager | Nao | Nao | Completa | Nenhum* |
| ICE Endpoint | Nao | Nao | Parcial | ~$0,01/h |

*SSM requer NAT Gateway ou VPC Endpoints em subnets privadas.

**Recomendacao para producao:** SSM Session Manager + CloudTrail habilitado. Para acesso RDP a Windows privado: ICE Endpoint.

---

## Decisoes Tecnicas

**Ambiente unico consolidado:** em vez de replicar os ambientes progressivos das aulas, provisionei tudo em um unico apply. Custo concentrado em uma sessao de ~3h, todos os metodos testados no mesmo ambiente.

**Chave RSA separada para Windows:** Windows AMIs nao suportam Ed25519. Descoberto no apply — o RunInstances retornou erro imediato. Solucao: segundo key pair RSA 4096 exclusivo para a instancia Windows. A chave RSA tambem e necessaria para descriptografar a senha inicial do Administrator via console AWS (funcao "Get Windows Password" exige formato PEM classico).

**Security Groups sem regras inline:** `sg-ec2-private` e `sg-ice-endpoint` se referenciam mutuamente, criando dependencia circular se as regras forem definidas inline. Solucao: criar os SGs vazios e adicionar todas as regras via `aws_security_group_rule` como recursos separados.

**Senha do RDS com caracteres proibidos:** o RDS rejeita `/`, `@`, `"` e espaco no campo de senha. O `terraform plan` passa sem erro — o problema so aparece no `terraform apply`. Lembrete para documentar no README.

---

## Validacao e Custos

Todos os 5 metodos foram validados com prints de evidencia:

- SSH direto ao bastion funcionando
- Tunnel SSH via bastion conectando na EC2 Linux privada (`10.0.10.115`)
- EC2 Instance Connect via browser (sem chave local)
- SSM Session Manager na EC2 privada (zero portas abertas)
- SSM Port Forwarding conectando ao RDS PostgreSQL (`psql` com `labdb=#`)
- ICE Endpoint SSH na EC2 Linux privada
- ICE Endpoint RDP na EC2 Windows privada (senha descriptografada via console)

**Custo real da sessao de ~3h:**

| Servico | Custo estimado |
|---|---:|
| NAT Gateway | $0,14 |
| RDS db.t3.micro | $0,05 |
| EC2 t3.micro x 2 | $0,06 |
| ICE Endpoint | $0,03 |
| **Total** | **~$0,30** |

---

## Aprendizados-chave

1. **Ed25519 nao funciona com Windows AMIs** — a AWS exige RSA para instancias Windows. Criar um key pair RSA separado e necessario, e a chave privada precisa estar em formato PEM classico para o console AWS descriptografar a senha do Administrator.

2. **SSM e o metodo mais seguro para producao** — zero portas abertas, auditoria completa, sem IP publico. O unico prerequisito e o IAM Instance Profile correto e saida de rede para os endpoints do SSM.

3. **ICE Endpoint elimina o bastion EC2** — um servico gerenciado que substitui o bastion host tradicional, com suporte nativo a RDP para Windows. Custa menos do que manter uma EC2 bastion rodando continuamente.

4. **Dependencia circular em Security Groups** — quando dois SGs se referenciam mutuamente, usar `aws_security_group_rule` separados em vez de regras inline resolve o problema sem workarounds.

5. **SSM Port Forwarding e extremamente versatil** — com um unico comando, redireciona SSH, RDP ou qualquer porta TCP (incluindo bancos de dados) sem abrir nenhuma porta de rede diretamente.

---

## Proximo Desafio

**Desafio 04 - NAT Gateway:** rodar a BIA (aplicacao containerizada) em subnet privada com saida para internet via NAT Gateway, usando ECS. Prazo: 08/06/2026.

---

## Repositorio

Codigo completo, ADRs e guia de execucao:
[github.com/nilo-lima/formacao-aws-desafios-mai2026](https://github.com/nilo-lima/formacao-aws-desafios-mai2026/tree/main/desafio_03_ec2_ssm_ssh)

---

> Este post faz parte da serie **Formacao AWS 5.0 - Desafio Labs 2.0**.
> Mentor: [Henrylle Maia](https://hotmart.com/pt-br/club/formacaoaws).
