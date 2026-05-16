---
title: "IaC na prática: servidor web na AWS sem nenhuma etapa manual"
description: "Como Terraform e Ansible eliminam completamente o trabalho manual de provisionamento, da chave SSH ao Nginx, tudo criado por código em dois comandos."
pubDate: 2026-05-09
tags: ["terraform", "ansible", "aws", "iac", "devops"]
source: "github"
sourceUrl: "https://github.com/nilo-lima/devops-master-lab/tree/main/projects/03-infrastructure/03-iac-aws-ec2"
---

## O problema que IaC resolve

Todo time de infraestrutura já viveu este ciclo: alguém cria um servidor manualmente, documenta os passos em uma wiki, a wiki fica desatualizada em semanas, e na próxima vez que precisam reproduzir o ambiente, descobrem que faltam etapas. O servidor vira um *snowflake*, único, irreproduzível, impossível de auditar.

Infrastructure as Code existe para acabar com isso. Não é sobre usar uma ferramenta nova; é sobre tratar infraestrutura com o mesmo rigor que tratamos código: versionada, revisada, testável e reproduzível por qualquer pessoa com as credenciais certas.

## O projeto

Este lab implementa o desafio [IaC on DigitalOcean](https://roadmap.sh/projects/iac-digitalocean) do roadmap.sh, adaptado para **AWS**. O objetivo é provisionar e configurar um servidor web sem nenhuma etapa manual, do zero ao Nginx respondendo na porta 80, com dois comandos:

```bash
make up        # Terraform cria toda a infraestrutura
make configure # Ansible configura o sistema operacional
```

## Arquitetura da solução

O projeto usa três providers Terraform com responsabilidades bem definidas:

| Provider | O que faz |
|:---------|:----------|
| `hashicorp/aws` | EC2, Security Group, Key Pair, Elastic IP |
| `hashicorp/tls` | Gera o par de chaves RSA-4096 **localmente** |
| `hashicorp/local` | Salva a chave privada com `chmod 0600` |

A separação entre `tls` e `aws` é intencional: a chave privada **nunca trafega para a AWS**. O provider TLS gera o par localmente, o Terraform registra apenas a chave pública via `aws_key_pair`, e a privada é salva em disco com permissão restrita. É o mesmo princípio de zero-trust aplicado ao provisionamento.

Após o `terraform apply`, um script extrai os outputs (`instance_ip`, `private_key_path`) e gera o inventário Ansible automaticamente, sem copiar IPs manualmente.

## Três armadilhas que encontrei

**1. Caminhos relativos quebram em pipelines.**
O Terraform salva a chave com path relativo ao diretório `terraform/`: `./../iac-aws-ec2.pem`. Quando o Ansible executa da raiz do projeto, esse caminho não resolve. A solução é `realpath` no script de orquestração, converte para caminho absoluto antes de escrever o inventário.

**2. Arquivos INI do Ansible são sensíveis a quebras de linha.**
Ao tentar passar `ansible_ssh_common_args='-o StrictHostKeyChecking=no'` diretamente no inventário, a linha quebrou silenciosamente. O Ansible interpretou a segunda linha como um hostname, erro sutil, difícil de diagnosticar. A solução correta é um `ansible.cfg` com `host_key_checking = False`.

**3. Docker ≠ servidor real para serviços de segurança.**
No projeto anterior deste lab, as roles Ansible rodavam contra containers Docker sem capabilities de kernel, `fail2ban` não podia iniciar. No EC2 real, omitir `enabled: true` no serviço significa que a proteção contra brute-force morre no próximo reboot. Contexto de execução muda as boas práticas.

## O que ficou de fora (próximos passos)

- **Remote state no S3** com state locking via DynamoDB, essencial em times.
- **Security Group restrito por IP**, a versão atual libera SSH de `0.0.0.0/0` para facilitar o laboratório, mas em produção o acesso deve ser limitado ao IP do operador ou a uma VPN.
- **Módulo Terraform reutilizável**, encapsular o padrão EC2 + EIP + SG para reuso em outros projetos do lab.

## Resultado

Um repositório que qualquer engenheiro pode clonar, configurar credenciais AWS e ter um servidor funcional em menos de três minutos. Sem wiki, sem runbook, sem etapas esquecidas. Apenas código.

Código disponível em [github.com/nilo-lima/devops-master-lab](https://github.com/nilo-lima/devops-master-lab/tree/main/projects/03-infrastructure/03-iac-aws-ec2).
