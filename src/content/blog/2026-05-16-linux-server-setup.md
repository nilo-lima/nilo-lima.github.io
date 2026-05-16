---
title: "Hardening de servidor Ubuntu: do root ao production-ready com Ansible"
description: "Como transformar um servidor Linux recém-criado em um ambiente seguro para produção, e por que automatizar esse processo com Ansible é a única abordagem profissional."
pubDate: 2026-05-16
tags: ["linux", "ansible", "security", "bash", "ufw", "fail2ban", "devops", "iac"]
source: "github"
sourceUrl: "https://github.com/nilo-lima/devops-master-lab/tree/main/projects/01-foundations/04-linux-server-setup"
---

## O problema com "configurar um servidor manualmente"

Todo time de infraestrutura já passou por isso: um servidor configurado manualmente por uma pessoa, em uma tarde, seguindo notas esparsas em um Confluence ou Notion. Meses depois, ninguém sabe exatamente o que está rodando nele, por que a porta 8080 está aberta, ou por que o usuário `admin` ainda tem acesso com senha.

O problema não é falta de conhecimento técnico, é a ausência de reproducibilidade. Configuração que existe apenas na memória de quem executou não é infraestrutura, é dívida técnica.

Este projeto resolve exatamente esse problema: hardening completo de um servidor Ubuntu, documentado em scripts Bash para aprendizado e automatizado em um Ansible Playbook para produção.

## As 9 camadas de segurança

O desafio do [roadmap.sh](https://roadmap.sh/projects/linux-server-setup) define nove configurações essenciais para um servidor production-ready:

| Camada | Ferramenta | O que protege |
|:-------|:-----------|:-------------|
| Usuário não-root | `useradd` + `sudoers` | Elimina o vetor de ataque direto ao root |
| SSH por chave | `sshd_config` | Torna brute-force matematicamente inviável |
| Firewall | UFW | Reduz a superfície de ataque a portas explícitas |
| Patches automáticos | `unattended-upgrades` | Fecha CVEs sem intervenção humana |
| Proteção brute-force | Fail2Ban | Bane IPs após tentativas repetidas de login |
| Timezone padronizado | `timedatectl` | Correlação correta de logs entre sistemas |
| Hostname significativo | `hostnamectl` | Identificação clara em ambientes multi-servidor |
| Gerenciamento de serviços | `systemctl` | Controle do ciclo de vida dos processos |
| Revisão de logs | `journalctl` | Visibilidade sobre o comportamento do sistema |

Cada uma dessas camadas tem um arquivo Bash dedicado. A ideia é que alguém novo na equipe possa ler o script, entender o que ele faz e executá-lo com confiança, não apenas copiar e colar um bloco monolítico de comandos.

## O "toque de mestre": Ansible Roles

Scripts Bash são excelentes para aprendizado. Mas em produção, a pergunta relevante é: se eu precisar configurar dez servidores iguais amanhã, quanto tempo isso leva?

Com scripts manuais: horas, com risco de inconsistência entre servidores.

Com o Ansible Playbook deste projeto: um comando.

```bash
ansible-playbook -i inventory.ini site.yml
```

O playbook é estruturado em seis roles independentes, cada uma responsável por exatamente uma camada de segurança. Essa separação não é estética; ela tem consequências práticas:

- Uma role pode ser reutilizada em outros projetos sem modificação
- Falhas são isoladas: se a role `fail2ban` falhar, as demais já aplicadas permanecem
- Cada role aceita variáveis via `defaults/main.yml`, permitindo personalização sem tocar no código

## Três problemas reais encontrados

**1. `((FAIL++))` quebra o script sob `set -e`**

O script de auditoria usa contadores para acumular resultados ao longo de 14 verificações. A sintaxe `((FAIL++))` é idiomática em bash, exceto que, quando `FAIL` vale zero, a expressão `((0))` retorna exit code 1. Com `set -e` ativo, isso mata o processo imediatamente após a primeira falha.

O resultado prático: o script parava na primeira verificação negativa sem executar as 13 restantes. A correção é usar `FAIL=$((FAIL + 1))`, que é uma expansão aritmética e sempre retorna exit code 0, ou remover o `-e` do conjunto de flags quando o script precisa ser resiliente a falhas parciais.

**2. Ansible com múltiplas chaves SSH no agente**

O erro `Too many authentication failures` apareceu ao rodar o playbook contra a VM Vagrant. O cliente SSH tentou todas as chaves carregadas no `ssh-agent` antes de usar a chave correta do Vagrant, e o servidor rejeitou a conexão após atingir `MaxAuthTries`.

A solução é uma linha no inventário:

```ini
ansible_ssh_extra_args='-o IdentitiesOnly=yes -o StrictHostKeyChecking=no'
```

`IdentitiesOnly=yes` instrui o cliente SSH a usar exclusivamente a chave definida em `IdentityFile`, ignorando o agente. Em ambientes com múltiplas chaves ativas, o que é o caso de qualquer máquina de desenvolvimento, essa opção é praticamente obrigatória.

**3. Handlers em Ansible têm diretório próprio**

A role `fail2ban` originalmente tinha o handler `Restart fail2ban` dentro de `tasks/main.yml`. O Ansible processou o arquivo sem erros de sintaxe, mas silenciosamente ignorou o handler durante a execução. O `notify: Restart fail2ban` nunca disparou.

Handlers devem estar em `roles/<nome>/handlers/main.yml`. Colocá-los em `tasks/` é válido sintaticamente, mas semanticamente inerte. É o tipo de bug que não gera erro algum, apenas comportamento incorreto em produção.

## O script de auditoria como smoke test

A última peça do projeto é o `07-security-audit.sh`, um script que verifica programaticamente cada uma das 14 configurações esperadas e reporta o resultado:

```
========================================
 AUDITORIA DE SEGURANCA DO SERVIDOR
========================================

--- Usuarios ---
  [PASS] Usuario sudo nao-root existe

--- SSH ---
  [PASS] Autenticacao por senha desabilitada
  [PASS] PubkeyAuthentication habilitada
  [PASS] MaxAuthTries configurado

--- Firewall ---
  [PASS] UFW ativo
  [PASS] SSH permitido no UFW

--- Fail2Ban ---
  [PASS] Fail2Ban instalado
  [PASS] Fail2Ban ativo
  [PASS] Jail SSH configurado

========================================
 RESULTADO: 14 verificacoes OK | 0 falhas
========================================
```

O script retorna exit code 0 em caso de sucesso total e exit code 1 em caso de qualquer falha. Isso o torna integrável em pipelines CI/CD, um `make audit` pode ser adicionado como etapa de validação pós-deploy.

## O que isso significa na prática

Um servidor Ubuntu configurado com este projeto tem:

- **Zero vetores de acesso por senha**: só chave RSA funciona
- **Superfície de ataque mínima**: UFW bloqueia tudo exceto portas explicitamente abertas
- **Proteção automática contra bots**: Fail2Ban bane IPs após 3 tentativas em 10 minutos
- **Patches de segurança sem intervenção**: `unattended-upgrades` aplica CVEs automaticamente
- **Estado auditável**: qualquer pessoa pode rodar `make audit` e verificar a conformidade

E o mais importante: qualquer servidor novo pode ser configurado identicamente em menos de dois minutos. Sem notas, sem memória, sem inconsistência.

Código disponível em [github.com/nilo-lima/devops-master-lab](https://github.com/nilo-lima/devops-master-lab/tree/main/projects/01-foundations/04-linux-server-setup).
