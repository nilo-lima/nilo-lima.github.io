# Portfólio — Nilo Lima Jr

Código-fonte do meu portfólio pessoal. Site estático gerado com **Astro**, estilizado com **Tailwind CSS** e publicado via **GitHub Pages**.

🌐 [nilo-lima.github.io](https://nilo-lima.github.io)

## Stack

- **Astro 4** — Static Site Generation
- **Tailwind CSS** — estilização utility-first
- **Content Collections** — projetos e blog em Markdown com schema Zod
- **GitHub Actions** — CI/CD automatizado para deploy

## Rodar localmente

```bash
npm install
npm run dev   # http://localhost:4321
```

## Adicionar um projeto

Crie um arquivo em `src/content/projects/` com o frontmatter:

```yaml
---
title: "Nome do projeto"
description: "Descrição curta."
tags: ["Terraform", "AWS"]
link: "https://github.com/nilo-lima/repo"
pinned: false   # true para exibir na home (máx. 6)
order: 99       # define a ordem dos pinados na home
---
```

O projeto aparece automaticamente em `/projetos` com filtro por tag. Nenhum outro arquivo precisa ser editado.

## Deploy

Qualquer push para `main` aciona o workflow em `.github/workflows/deploy.yml`, que faz o build e publica automaticamente no GitHub Pages.
