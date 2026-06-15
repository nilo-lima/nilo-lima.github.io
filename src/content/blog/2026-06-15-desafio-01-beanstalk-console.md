---
title: "Desafio 01 - BIA no Elastic Beanstalk: do zero ao Docker com RDS PostgreSQL"
description: "Como colocar a BIA no Elastic Beanstalk com Docker AL2023 e RDS em subnet privada - e os 4 problemas que aprendi no caminho"
pubDate: "2026-06-15"
tags: ["aws", "elastic-beanstalk", "docker", "rds", "postgresql", "formacao-aws", "devops"]
source: "artigo"
sourceUrl: "https://hotmart.com/pt-br/club/formacaoaws"
heroImage: "/images/blog/desafio-01-beanstalk-console.png"
---

## TL;DR

Primeiro desafio da **Formacao AWS 5.0 - Mentoria Desafio Labs 2.0** de junho de 2026: coloquei a
aplicacao BIA (Node.js + React + PostgreSQL) no **Elastic Beanstalk** com plataforma Docker AL2023,
comunicando com **RDS PostgreSQL 17** em subnet privada.

Resolvi 4 problemas que nao estao documentados em lugar nenhum - e que custaram horas de debug.

## Contexto

A trilha de junho de 2026 cobre **APPs Gerenciadas + IAM + CDN na AWS** com 6 desafios. O primeiro
coloca a BIA - uma aplicacao de gerenciamento de tarefas do mentor Henrylle Maia - no Elastic
Beanstalk.

A BIA tem backend em Node.js + Express + Sequelize, frontend React + Vite, e banco PostgreSQL. O
desafio exige usar `github.com/henrylle/bia` (nao a variante `bia-eb` pre-adaptada), o que significa
que as adaptacoes para o Beanstalk ficam por nossa conta.

## Arquitetura Adotada

![Arquitetura](/images/blog/desafio-01-beanstalk-console.png)

Topologia simples e economica:

- **VPC** com 2 subnets publicas + 2 privadas em 2 AZs
- **Beanstalk Single Instance** (EC2 t3.micro, Docker AL2023) - sem ALB para economizar ~US$0.008/h
- **RDS PostgreSQL 17** (db.t3.micro) em subnet privada - porta 5432 restrita via Security Group
- **Security Groups** em camadas: EB aceita HTTP:80, RDS aceita apenas do SG do EB

## Decisoes Tecnicas

### ADR-001: Single Instance sem ALB

ALB custa US$0.008/h mesmo sem trafego. Para um lab de estudo que roda por horas, e desperdicio. O
Beanstalk Single Instance funciona com IP elastico e e suficiente para validar o objetivo.

### ADR-002: Plataforma Docker AL2023

Plataforma atual (v4.13.2), com suporte nativo ao `compose.yml`, sem deprecacoes. A BIA ja tem
Dockerfile otimizado com Node 22 slim e build multi-stage.

### ADR-003: RDS em subnet privada

Porta 5432 nunca exposta publicamente. O Security Group do RDS permite entrada apenas do SG do
Beanstalk. Isso segue o principio de menor privilegio e e uma boa pratica padrao na AWS.

### ADR-004: Deploy via ZIP com compose adaptado

O Beanstalk Docker detecta automaticamente o `compose.yml` na raiz do ZIP e orquestra os containers.
Adaptar o compose da BIA significa: remover o servico de banco local (o RDS e externo) e ajustar a
porta para 8080:8080.

## Os 4 Problemas Que Me Custaram Tempo

### 1. ZIP com artefatos na raiz

O Beanstalk Docker exige que `compose.yml` e `Dockerfile` estejam na **raiz** do ZIP.

```bash
# Errado: cria subpasta interna no ZIP
zip -r deploy.zip minha-pasta/

# Correto: artefatos na raiz
cd minha-pasta && zip -r ../deploy.zip .
```

### 2. VITE_API_URL e compile-time, nao runtime

O Vite embute variaveis de ambiente no bundle no momento do build - nao quando o container sobe.
Com `ARG VITE_API_URL=http://localhost:3001`, o browser em producao chamava `localhost`.

Solucao: deixar a variavel vazia. Com URL vazia, o React faz chamadas relativas (`/api/tarefas`)
que funcionam em qualquer ambiente sem configuracao adicional.

```dockerfile
# Antes (quebrado): chama localhost em producao
ARG VITE_API_URL=http://localhost:3001

# Depois (correto): URLs relativas funcionam em qualquer ambiente
ARG VITE_API_URL=
```

```javascript
// client/src/App.jsx
const apiUrl = import.meta.env.VITE_API_URL || "";
// Com string vazia, fetch("/api/tarefas") usa o mesmo host da pagina
```

### 3. Migrations Sequelize no Beanstalk

O `.ebextensions` executa antes dos containers subirem - nao serve para migrations. O
`.platform/hooks/postdeploy` pode funcionar, mas requer permissoes corretas e falha com erro pouco
claro.

Solucao mais elegante: integrar a migration no start do Node:

```json
"scripts": {
  "start": "npx sequelize db:migrate && node server"
}
```

A migration do Sequelize e idempotente. Se a tabela ja existe, ela nao faz nada. Simples e seguro.

### 4. DB_PWD vs DB_PASSWORD

O `config/database.js` da BIA usa `DB_PWD`, nao `DB_PASSWORD`. Setar a variavel errada causa erro
de autenticacao no PostgreSQL sem mensagem clara no painel do Beanstalk.

Sempre verifique as variaveis esperadas no codigo antes de configurar no console.

## Validacao

Ambiente com status **Green**, RDS **Available**, tarefas persistindo apos reload:

```bash
# Smoke test
curl -s http://<eb-url>/api/versao
# {"versao":"Bia 4.2.0"}

curl -s http://<eb-url>/api/tarefas
# [{"id":1,"descricao":"teste","createdAt":"..."}]
```

## Custos

Para ~4h de lab:

| Servico | Custo | Observacao |
|---|---:|---|
| RDS db.t3.micro | ~US$0.10 | Unico fora do Free Tier |
| EC2 t3.micro | US$0.00 | Free Tier (750h/mes) |
| **Total** | **~US$0.10** | |

## Aprendizados-chave

1. **ZIP sem subdiretorio e regra obrigatoria.** Erro silencioso que deixa o deploy verde mas o app nao sobe.
2. **Vite embute variaveis no build.** Use URLs relativas para o frontend funcionar em qualquer ambiente.
3. **Integre migrations no start do Node.** Mais simples e confiavel que hooks do Beanstalk.
4. **Verifique os nomes das variaveis no codigo.** A BIA usa DB_PWD, nao DB_PASSWORD.
5. **Events > Health badge.** O painel de eventos do Beanstalk mostra o erro real, o badge apenas indica o estado.

## Proximo Passo

**Desafio 02:** Alterar o Security Group da EC2 do cluster ECS via Launch Template + Instance Refresh
no ASG. Deadline: 22/06/2026.

## Repositorio

Codigo completo: [github.com/nilo-lima/formacao-aws-desafios-beanstalk-cdn-apps-gerenciadas](https://github.com/nilo-lima/formacao-aws-desafios-beanstalk-cdn-apps-gerenciadas/tree/main/desafio_01_beanstalk_console)

---

> Este post e parte da serie **Formacao AWS 5.0 - Desafio Labs 2.0**.
> Mentor: [Henrylle Maia](https://hotmart.com/pt-br/club/formacaoaws).
