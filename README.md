# Portfólio — Nilo Lima Jr

Código-fonte do meu portfólio pessoal. Site estático gerado com **Astro**, estilizado com **Tailwind CSS** e publicado via **GitHub Pages**.

🌐 [nilo-lima.github.io](https://nilo-lima.github.io)

## Stack

- **Astro 4** — Static Site Generation
- **Tailwind CSS** — estilização utility-first
- **Content Collections** — blog em Markdown com schema Zod
- **GitHub Actions** — CI/CD automatizado para deploy

## Rodar localmente

```bash
npm install
npm run dev   # http://localhost:4321
```

## Deploy

Qualquer push para `main` aciona o workflow em `.github/workflows/deploy.yml`, que faz o build e publica automaticamente no GitHub Pages.
