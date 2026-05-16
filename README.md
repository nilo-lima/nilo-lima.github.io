<p align="center">
  <a href="https://nilo-lima.github.io" target="_blank">
    <img src="https://img.shields.io/badge/🌐_Acessar_Site-050505?style=for-the-badge&logoColor=38BDF8" alt="Site ao vivo">
  </a>
</p>

# Portfólio - Nilo Lima Jr

Código-fonte do meu portfólio pessoal. Site estático gerado com **Astro**, estilizado com **Tailwind CSS** e publicado via **GitHub Pages**.

Estética **Astro-Terminal**: dark mode profundo, tipografia mono, paleta `#050505 · #38BDF8 · #94A3B8`. Bilíngue PT-BR / EN com i18n manual via `src/i18n/ui.ts`.

<p align="left">
  <a href="https://github.com/nilo-lima/nilo-lima.github.io" target="_blank">
    <img src="https://img.shields.io/badge/Repositório-GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub">
  </a>
  <a href="https://linkedin.com/in/nilolima" target="_blank">
    <img src="https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn">
  </a>
</p>

---

## ✨ Recursos

- **Bilíngue PT-BR / EN** — alternância via navbar, i18n centralizado em `src/i18n/ui.ts`
- **Blog** com paginação (6 posts/página), filtro por tag, tempo de leitura e RSS feed em `/rss.xml`
- **Projetos** via Content Collections com grid, filtro por tag e badge de destaque
- **Certificações** com cartões de altura uniforme e link para Credly
- **Currículos para download** (Gestão, Infra, Sistemas, DevOps/Cloud) na seção Contato
- **OG image** 1200×630 gerada estaticamente para compartilhamento social
- **SEO completo** — canonical, hreflang, JSON-LD Person, Open Graph, Twitter Cards
- **Acessibilidade** — skip link, `aria-expanded`, `prefers-reduced-motion`, `:focus-visible`
- **Fontes self-hosted** via `@fontsource` (sem requisições ao Google)
- **Deploy automático** via GitHub Actions para GitHub Pages

---

## 🛠️ Stack Técnica

<table>
  <tr>
    <td align="center"><a href="https://astro.build/"><img src="https://cdn.simpleicons.org/astro/FF5D01" alt="astro" width="40" height="40"/><br/>Astro 4</a></td>
    <td align="center"><a href="https://tailwindcss.com/"><img src="https://www.vectorlogo.zone/logos/tailwindcss/tailwindcss-icon.svg" alt="tailwindcss" width="40" height="40"/><br/>Tailwind CSS</a></td>
    <td align="center"><a href="https://www.typescriptlang.org/"><img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/typescript/typescript-original.svg" alt="typescript" width="40" height="40"/><br/>TypeScript</a></td>
    <td align="center"><a href="https://github.com/features/actions"><img src="https://www.vectorlogo.zone/logos/github/github-tile.svg" alt="github-actions" width="40" height="40"/><br/>GitHub Actions</a></td>
    <td align="center"><a href="https://pages.github.com/"><img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/nodejs/nodejs-original.svg" alt="nodejs" width="40" height="40"/><br/>Node.js 18+</a></td>
  </tr>
</table>

---

## ⚙️ Pré-requisitos

- **Node.js** v18.17.1 ou superior
- **npm** v9+

---

## 🚀 Rodar localmente

```bash
npm install
npm run dev      # http://localhost:4321 — hot reload
npm run build    # gera dist/ para validar o build
npm run preview  # serve dist/ localmente
```

---

## 🏗️ Estrutura do Projeto

<details>
  <summary>Páginas e componentes</summary>

| Rota | Descrição |
|------|-----------|
| `/` | Home PT-BR (Hero, Sobre, Tech Stack, Certificações, Projetos, Experiência, Contato) |
| `/en/` | Espelho EN via i18n manual |
| `/projetos/` | Grid completo de projetos com filtro por tag |
| `/en/projects/` | Versão EN do grid de projetos |
| `/blog/` | Listagem paginada de posts com filtro por tag |
| `/blog/<slug>/` | Post individual em Markdown |
| `/rss.xml` | Feed RSS do blog |
| `/404.html` | Página de erro customizada |

</details>

<details>
  <summary>Adicionar um projeto</summary>

Crie `src/content/projects/NN-slug.md` com o frontmatter:

```yaml
---
title: "Nome do projeto"
description: "Descrição curta."
tags: ["Terraform", "AWS"]
link: "https://github.com/nilo-lima/repo"
pinned: false   # true para exibir na home (máx. 6)
order: 99       # ordem dos pinados na home (menor = primeiro)
---
```

O projeto aparece automaticamente em `/projetos` com filtro por tag. Nenhum outro arquivo precisa ser editado.

</details>

<details>
  <summary>Adicionar um post no blog</summary>

Crie `src/content/blog/YYYY-MM-DD-slug.md` com o frontmatter:

```yaml
---
title: "Título do post"
description: "Descrição para SEO."
pubDate: 2026-05-16
tags: ["DevOps", "AWS"]
draft: false
---
```

A paginação (6 posts/página) e o filtro por tag funcionam automaticamente.

</details>

<details>
  <summary>Atualizar currículos</summary>

Substitua os arquivos em `public/` mantendo os mesmos nomes:

| Arquivo | Perfil |
|---------|--------|
| `public/curriculo-gestao.pdf` | Gestão de TI |
| `public/curriculo-infra.pdf` | Infraestrutura |
| `public/curriculo-sistemas.pdf` | Sistemas |
| `public/curriculo-devops-cloud.pdf` | DevOps & Cloud |

Os links de download na seção Contato apontam diretamente para esses arquivos.

</details>

<details>
  <summary>Regenerar OG image</summary>

A imagem de preview social (`public/og.png`) é gerada pelo script `scripts/generate-og.mjs` usando `sharp`. Para atualizar após mudanças de branding:

```bash
npm run generate:og
```

</details>

---

## 🚢 Deploy

Qualquer push para `main` aciona o workflow em `.github/workflows/deploy.yml`, que executa `npm run build` e publica automaticamente no **GitHub Pages**.

---

## 📄 Licença

O código-fonte deste projeto é disponibilizado sob a licença **MIT**.  
O conteúdo editorial (textos, currículos, imagens pessoais) é proprietário — © Nilo Lima Jr, todos os direitos reservados.

---

## 💖 Apoie meu trabalho

Se você gosta dos meus projetos, considere:
- ⭐ Dar uma estrela neste repositório.
- 🐛 Reportar bugs ou sugerir melhorias via Issues.
- 🤝 Contribuir com código via Pull Request.
