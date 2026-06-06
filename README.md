# Portfólio - Nilo Lima Jr

Código-fonte do meu portfólio pessoal. Site estático gerado com **Astro**, estilizado com **Tailwind CSS** e publicado via **GitHub Pages**.

Estética **Astro-Terminal**: dark mode profundo, tipografia mono, paleta `#050505 · #38BDF8 · #94A3B8`. Bilíngue PT-BR / EN com i18n manual via `src/i18n/ui.ts`.

<p align="left">
  <a href="https://nilo-lima.github.io" target="_blank">
    <img src="https://img.shields.io/badge/🌐_Acessar_Portfólio-050505?style=for-the-badge&logoColor=38BDF8" alt="Acessar Portfólio">
  </a>
  <a href="https://github.com/nilo-lima/" target="_blank">
    <img src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub">
  </a>
  <a href="https://linkedin.com/in/nilolima" target="_blank">
    <img src="https://img.shields.io/badge/LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn">
  </a>
</p>

---

## ✨ Recursos

- **Bilíngue PT-BR / EN** — alternância via navbar, i18n centralizado em `src/i18n/ui.ts`
- **Blog** com paginação (6 posts/página), filtro por tag clicável, tempo de leitura, prev/next, posts relacionados e RSS em `/rss.xml`
- **Syntax highlighting** Shiki (`github-dark`) e botão COPIAR em todos os code blocks do blog
- **Barra de progresso de leitura** e share buttons nos posts — Web Share API nativa (mobile) com fallback para clipboard
- **Busca full-text** Pagefind em `/busca` com UI dark — atalho global `Ctrl+K`; widget embutido na 404
- **Páginas de tags** em `/tags/` (índice) e `/tags/[tag]/` (posts filtrados)
- **Projetos** via Content Collections — lista vertical com filtro por tag e badge de destaque
- **Certificações** com cartões de altura uniforme e links para Credly, Microsoft Learn e Accredible
- **Página `/certificados`** com ~185 certificados organizados por tema, thumbnails via Google Drive API
- **Currículos para download** (Gestão, Infra, Sistemas, DevOps/Cloud) em cards 2×2 com descrição
- **Página `/now`** — foco atual, aprendizado e stack do momento
- **Página `/uses`** e **`/en/uses`** — hardware, editor, ferramentas cloud & IA (inspirado em uses.tech)
- **Páginas `/en/now`** e **`/en/uses`** — versões EN de /now e /uses; footer lang-aware serve a rota correta por idioma
- **PWA instalável** — `site.webmanifest` + ícones 192/512 permitem adicionar ao homescreen mobile
- **Font preload** — woff2 self-hosted em `public/fonts/` com `<link rel="preload">` para Inter e JetBrains Mono elimina FOUT
- **OG images dinâmicas** por post, por página e por tag — PT e EN (1200×630, geradas com `sharp` no build)
- **SEO completo** — canonical, hreflang, JSON-LD Person + TechArticle + Breadcrumb, Open Graph, Twitter Cards
- **Analytics** Goatcounter — privacy-first, sem cookies, LGPD-friendly
- **Acessibilidade** — skip link, `aria-expanded`, `prefers-reduced-motion`, `:focus-visible`
- **Fontes self-hosted** em `public/fonts/` — woff2 com URLs estáveis, `font-display: swap`, sem requisições externas
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
npm install                # após clonar
npm run dev                # http://localhost:4321 — hot reload
npm run build              # OG posts → OG pages → astro build → pagefind
npm run preview            # serve dist/ localmente
npm run generate:og        # regenera public/og.png (home)
npm run generate:og-posts  # regenera OG de posts → public/og/posts/
npm run generate:og-pages  # regenera OG de páginas e tags → public/og/pages/
npm run generate:icons     # regenera public/icon-192.png e icon-512.png (PWA)
npm run sync:certs         # sincroniza certificados do Google Drive (requer credenciais)
```

---

## 🏗️ Estrutura do Projeto

<details>
  <summary>Páginas e componentes</summary>

| Rota | Descrição |
|------|-----------|
| `/` | Home PT-BR (Hero, Sobre, Tech Stack, Certificações, Projetos, Experiência, Vamos Conversar) |
| `/en/` | Espelho EN via i18n manual |
| `/projetos/` | Lista completa de projetos com filtro por tag |
| `/en/projects/` | Versão EN da lista de projetos |
| `/blog/` | Listagem paginada de posts com filtro por tag |
| `/blog/<slug>/` | Post individual — syntax highlighting, progress bar, share buttons, prev/next |
| `/tags/` | Índice de todas as tags com contagem de posts |
| `/tags/<tag>/` | Posts filtrados por tag |
| `/busca/` | Busca full-text Pagefind (atalho Ctrl+K) |
| `/now/` | Página /now — foco atual, aprendizado e stack (PT) |
| `/en/now/` | Mirror EN de /now |
| `/uses/` | Página /uses — hardware, editor, ferramentas cloud & IA (PT) |
| `/en/uses/` | Mirror EN de /uses |
| `/certificados/` | ~185 certificados de cursos organizados em 17 grupos temáticos |
| `/rss.xml` | Feed RSS do blog |
| `/404.html` | Página de erro com busca Pagefind embutida |

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
  <summary>Sincronizar certificados do Google Drive</summary>

A página `/certificados` é alimentada por `src/data/certificados.json`, gerado pelo script de sync. As thumbnails ficam em `public/certs-thumbnails/` (não versionado).

**Em produção:** o sync roda automaticamente no GitHub Actions a cada push para `main`, usando o secret `GDRIVE_CREDENTIALS`.

**Localmente:**
```bash
export GDRIVE_CREDENTIALS=$(cat /caminho/para/service-account.json)
npm run sync:certs
npm run build && npm run preview
```

Para adicionar uma nova pasta/grupo ao Drive, edite o mapeamento `FOLDER_LABELS` em `scripts/sync-drive-certs.mjs` e faça um novo push.

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

Qualquer push para `main` aciona o workflow em `.github/workflows/deploy.yml`, que executa em sequência:
1. **Sync de certificados** — `node scripts/sync-drive-certs.mjs` (requer o secret `GDRIVE_CREDENTIALS`)
2. **OG posts** — `node scripts/generate-og-posts.mjs` (imagens 1200×630 por post)
3. **OG pages** — `node scripts/generate-og-pages.mjs` (imagens por página e tag)
4. **Build Astro** — `astro build`
5. **Indexação Pagefind** — `npx pagefind --site dist`
6. **Lighthouse CI** — `treosh/lighthouse-ci-action@v12` (falha se Performance < 80)
7. **Publicação** — GitHub Pages

As thumbnails da página `/certificados` são baixadas automaticamente via Google Drive API a cada deploy e não ficam versionadas no repositório.

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
