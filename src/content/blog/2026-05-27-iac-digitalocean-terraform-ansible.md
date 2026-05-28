---
title: "IaC na DigitalOcean: inventário Ansible gerado pelo Terraform e o problema do cloud-init timing"
description: "Como usar o recurso local_file do Terraform para eliminar o passo manual de copiar o IP do Droplet para o inventário Ansible, e por que o terraform apply retorna antes do servidor estar pronto para receber conexões."
pubDate: 2026-05-27
tags: ["terraform", "ansible", "digitalocean", "iac", "devops", "infrastructure", "linux", "foundations"]
source: "github"
sourceUrl: "https://github.com/nilo-lima/devops-master-lab/tree/main/projects/03-infrastructure/04-iac-digitalocean"
---

## O problema que ninguém documenta nos tutoriais de IaC

Todo tutorial de Terraform + Ansible para DigitalOcean tem a mesma lacuna: depois do `terraform apply`, o tutorial diz "copie o IP do output e cole no seu inventário Ansible". É o passo mais frágil do pipeline — e o mais desnecessário.

O objetivo desse projeto era um `make full-deploy` que fizesse o caminho completo sem intervenção humana: Terraform provisiona o Droplet, Ansible configura o servidor, e o inventário com o IP real é gerado automaticamente entre os dois passos.

## `local_file` como cola entre Terraform e Ansible

O Terraform tem um recurso `local_file` que escreve um arquivo no sistema de arquivos local como parte do `terraform apply`. Combinado com `templatefile()`, ele resolve exatamente o problema do inventário:

```hcl
resource "local_file" "ansible_inventory" {
  content = templatefile("${path.module}/../ansible/inventory.tpl", {
    droplet_ip   = digitalocean_droplet.web.ipv4_address
    project_name = var.project_name
  })
  filename        = "${path.module}/../ansible/inventory.ini"
  file_permission = "0644"
}
```

O template `inventory.tpl`:

```ini
[web]
${droplet_ip} ansible_user=root ansible_ssh_common_args='-o StrictHostKeyChecking=no'

[web:vars]
project_name=${project_name}
```

Quando o `terraform apply` termina, `ansible/inventory.ini` já existe com o IP correto. O Makefile encadeia os dois passos sem nenhum input manual:

```makefile
full-deploy: apply configure
	terraform -chdir=$(INFRA_DIR) output
```

O recurso `local_file` tem uma dependência implícita em `digitalocean_droplet.web.ipv4_address` — o Terraform sabe que precisa criar o Droplet antes de renderizar o template. O grafo de dependências resolve isso automaticamente.

## `TF_VAR_do_token`: o único jeito correto de injetar um token

O token da API da DigitalOcean não pode estar em `terraform.tfvars`, não pode ter `default` no `variables.tf`, e definitivamente não pode estar hardcoded em `main.tf`. O mecanismo correto é a convenção `TF_VAR_*` do Terraform:

```hcl
variable "do_token" {
  type      = string
  sensitive = true
}
```

```bash
# .env (gitignored)
TF_VAR_do_token=dop_v1_seu_token_aqui
```

```makefile
ifneq (,$(wildcard ./.env))
  include .env
  export
endif
```

O `include .env; export` no Makefile injeta as variáveis na sessão antes de qualquer comando Terraform. O resultado: `make plan` funciona sem o usuário precisar exportar nada manualmente, e o token nunca aparece em nenhum arquivo versionado.

A variável marcada como `sensitive = true` também impede que o valor apareça nos outputs do `terraform plan` — relevante quando o plan é logado em CI.

## Firewall em duas camadas com propósitos diferentes

O projeto usa `digitalocean_firewall` no Terraform e UFW no Ansible. Não é redundância — são camadas com responsabilidades distintas.

O `digitalocean_firewall` opera na camada de rede do datacenter:

```hcl
resource "digitalocean_firewall" "web" {
  name        = "${var.project_name}-fw"
  droplet_ids = [digitalocean_droplet.web.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  # ...
}
```

Pacotes bloqueados aqui nunca chegam ao Droplet — o kernel do servidor nem os vê. Isso significa que o firewall DO funciona mesmo se o servidor estiver comprometido, o UFW desabilitado, ou o iptables corrompido.

O UFW no Ansible é a defesa em profundidade: protege contra movimento lateral dentro da rede DO, contra bugs no firewall gerenciado, e fornece regras específicas por processo que o firewall de rede não consegue expressar.

## O problema do cloud-init timing

Essa é a parte que tutoriais ignoram: o `terraform apply` retorna quando a API da DigitalOcean confirma que o Droplet foi criado. Não quando o cloud-init terminou. Não quando o SSH está respondendo. Não quando o Python3 está instalado.

O `user_data` no Droplet executa um `cloud-init.sh` mínimo:

```bash
#!/bin/bash
set -euo pipefail
apt-get update -qq
apt-get install -y -qq python3 python3-pip
```

Sem o Python3, o Ansible falha silenciosamente na primeira task. O Makefile resolve com um `sleep 30` explícito no target `apply`:

```makefile
apply:
	terraform -chdir=$(INFRA_DIR) apply -auto-approve
	@echo "⏳ Aguardando cloud-init finalizar (30s)..."
	@sleep 30
```

Trinta segundos é o tempo suficiente para um Droplet com `s-1vcpu-1gb` completar o cloud-init numa região com latência baixa. A solução de produção correta seria um task `wait_for_connection` no início do playbook Ansible:

```yaml
- name: Aguardar SSH disponível
  ansible.builtin.wait_for_connection:
    timeout: 120
    delay: 10
```

Isso bloqueia o playbook até o Droplet responder em vez de fazer uma aposta num timeout fixo. Para um lab, `sleep 30` é honesto sobre a limitação — em produção, use `wait_for_connection`.

## Por que cloud-init mínimo e Ansible faz o trabalho pesado

A tentação é colocar toda a configuração no `user_data`: instalar Nginx, configurar UFW, tudo num script bash. Funciona na primeira execução. Não é idempotente. Não tem rollback. Não tem verificação de estado. Não é testável em isolamento.

O `cloud-init.sh` desse projeto instala apenas o Python3 — o mínimo para que o Ansible possa se conectar. Toda a lógica de configuração fica no playbook, que é:

- **Idempotente**: rodar duas vezes tem o mesmo resultado que rodar uma
- **Auditável**: cada task tem um nome que descreve o que faz
- **Versionado**: o estado desejado do servidor está no repositório
- **Testável**: pode ser executado contra qualquer host com o mesmo inventário

```yaml
- name: Enable UFW (default deny)
  community.general.ufw:
    state: enabled
    policy: deny
    direction: incoming
```

Um script bash que roda uma vez durante o boot não oferece nenhuma dessas garantias.

Código disponível em [github.com/nilo-lima/devops-master-lab](https://github.com/nilo-lima/devops-master-lab/tree/main/projects/03-infrastructure/04-iac-digitalocean).
