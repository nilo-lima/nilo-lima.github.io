---
title: "Do git push ao servidor: CI/CD completo com GitHub Actions e Ansible"
description: "Como construir uma pipeline que testa, valida e implanta automaticamente um serviço Node.js em AWS EC2, sem nenhuma intervenção manual após o commit."
pubDate: 2026-05-11
tags: ["cicd", "github-actions", "ansible", "terraform", "docker", "nodejs", "devops"]
source: "github"
sourceUrl: "https://github.com/nilo-lima/devops-master-lab/tree/main/projects/05-automation/01-nodejs-service-deployment"
---

## O que separa um projeto de laboratório de um projeto profissional

Saber criar um servidor Node.js é o ponto de partida. O que diferencia um engenheiro sênior é a capacidade de entregar esse serviço de forma **repetível, auditável e sem dependência de etapas manuais**. Um deploy manual feito via SSH é um risco: depende de quem está disponível, do ambiente local de quem executa, e de uma série de passos que não estão documentados em nenhum lugar, apenas na memória de alguém.

Este projeto resolve exatamente isso. Um `git push` na branch `main` dispara automaticamente os testes, valida a qualidade do código, e implanta a versão atualizada na infraestrutura AWS sem nenhuma intervenção.

## A arquitetura em camadas

O projeto integra três pilares que já existiam no lab em projetos isolados e os conecta em um fluxo único:

| Camada | Ferramenta | Responsabilidade |
|:-------|:-----------|:-----------------|
| Infraestrutura | Terraform | EC2, Security Group, Elastic IP |
| Configuração | Ansible | Docker, Nginx, deploy do container |
| Entrega | GitHub Actions | Testes, build, execução do Ansible |

A separação de responsabilidades é intencional. O Terraform cuida do que existe (recursos AWS). O Ansible cuida do que está configurado (software e serviços). O GitHub Actions orquestra quando e em que ordem tudo acontece.

## O pipeline em detalhe

O workflow é disparado apenas quando arquivos do projeto são modificados, um path filter evita que mudanças em outros projetos do monorepo acionem deploys desnecessários.

```
git push (main)
    |
    +- Job: Testes (Jest + cobertura)
    |
    +- Job: Deploy via Ansible (needs: test)
        +- SSH Agent carrega a chave privada
        +- Inventário dinâmico com IP da EC2
        +- ansible-playbook --tags app
```

O job de deploy só executa se os testes passarem. Isso garante que nenhuma versão quebrada chega ao servidor.

## Quatro problemas reais que encontrei

**1. Repositório privado trava o clone na EC2 silenciosamente.**
O Ansible tentava clonar via HTTPS. A EC2 não tem credenciais GitHub, o processo ficou aguardando input por mais de dez minutos sem emitir erro. A solução foi garantir que o repositório fosse público. Para repositórios privados, a alternativa correta é uma deploy key configurada no GitHub.

**2. Security Group restrito ao IP do desenvolvedor bloqueia o runner do CI.**
O GitHub Actions usa pools de IPs dinâmicos, diferentes do IP local. Ao restringir a porta SSH ao IP pessoal, o pipeline falhava no `ssh-keyscan` sem uma mensagem de erro clara. Para pipelines CI/CD que precisam de acesso SSH à infraestrutura, a porta 22 precisa estar acessível para os ranges de IP do GitHub Actions.

**3. `echo` não preserva chaves SSH multi-linha no CI.**
A forma comum de escrever a chave privada em disco via `echo "$SECRET" > key.pem` falha silenciosamente com chaves RSA, as quebras de linha são perdidas, e o arquivo resultante não é uma chave PEM válida. A solução é usar `webfactory/ssh-agent`, que carrega a chave diretamente no agente SSH do runner sem gravar em disco.

**4. Módulos Ansible têm incompatibilidades de versão não documentadas.**
O módulo `community.docker.docker_image` falhou com um parâmetro que está na documentação oficial mas não existe na versão instalada. Substituir por `ansible.builtin.command` com chamadas diretas ao CLI do Docker elimina a dependência de versão e torna o comportamento completamente previsível.

## O que a containerização muda no deploy

Usar Docker na EC2 em vez de rodar o Node.js diretamente tem uma consequência prática importante: **o rollback é trivial**. Se uma versão nova apresentar problema, basta rodar `docker run` com a tag da versão anterior. Não há estado local para desfazer, não há dependências do sistema para restaurar.

O Dockerfile segue o padrão multi-stage: o stage de build instala todas as devDependencies e executa os testes. O stage de runtime copia apenas o código e as dependências de produção. A imagem final é menor e não carrega ferramentas de desenvolvimento.

## O que fica de fora (próximos passos)

- **Remote state no S3** com locking via DynamoDB para trabalho em time.
- **Notificação no Slack** ao final de cada deploy, com link para o job no GitHub Actions.
- **Rollback automático**: se o health check falhar após o deploy, o pipeline deveria reverter para a imagem anterior automaticamente.
- **Ambiente de staging** com aprovação manual antes de chegar à produção.

## Resultado

Uma pipeline que qualquer membro do time pode entender lendo o arquivo de workflow. Sem runbook de deploy. Sem dependência de quem tem a chave SSH no laptop. Apenas um `git push` e o código vai para o ar.

Código disponível em [github.com/nilo-lima/devops-master-lab](https://github.com/nilo-lima/devops-master-lab/tree/main/projects/05-automation/01-nodejs-service-deployment).
