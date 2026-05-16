---
title: "Do código ao container: deploy automatizado via GitHub Container Registry"
description: "Como construir um pipeline que publica uma imagem Docker no GHCR e a entrega em uma EC2 AWS automaticamente, sem compilar nada na máquina de produção."
pubDate: 2026-05-15
tags: ["cicd", "docker", "github-actions", "ghcr", "terraform", "nodejs", "devops", "containers"]
source: "github"
sourceUrl: "https://github.com/nilo-lima/devops-master-lab/tree/main/projects/05-automation/02-dockerized-service-deployment"
---

## O problema que o Container Registry resolve

No projeto anterior de CI/CD, o deploy funcionava assim: o GitHub Actions conectava via SSH à EC2, executava um `git clone` e rodava o `docker build` diretamente no servidor de produção. Funcionava, mas tinha um problema estrutural.

A máquina de produção estava fazendo trabalho de build. Ela precisava de ferramentas de desenvolvimento, de acesso ao repositório, de recursos de CPU e memória para compilar dependências. Um servidor de produção não deveria fazer nenhuma dessas coisas. Ele deveria apenas executar código já validado e empacotado.

É exatamente isso que um Container Registry resolve: separar **onde o código é construído** (o pipeline CI) de **onde ele é executado** (a infraestrutura).

## A arquitetura em três camadas

| Camada | Ferramenta | Responsabilidade |
|:-------|:-----------|:-----------------|
| Infraestrutura | Terraform | EC2 `t3.micro`, Security Group, Elastic IP, SSH Key RSA-4096 |
| Empacotamento | Docker + GHCR | Build da imagem, versionamento por SHA, publicação no registry |
| Entrega | GitHub Actions | Testes → Build → Push → Deploy via `docker pull` |

O GHCR (GitHub Container Registry) é o elo que conecta o pipeline ao servidor. A EC2 não precisa saber como construir a aplicação, ela só precisa saber onde buscar a imagem pronta.

## O serviço: autenticação HTTP nativa

A aplicação Node.js implementa dois endpoints com comportamentos distintos:

- `GET /`, resposta pública, sem autenticação
- `GET /secret`, protegida por Basic Auth, retorna a mensagem configurada via variável de ambiente

O Basic Auth foi implementado sem nenhuma biblioteca externa. O header `Authorization` chega no formato `Basic base64(usuario:senha)`. O servidor decodifica, compara com as variáveis de ambiente e responde adequadamente, 401 sem header, 403 com credenciais erradas, 200 com credenciais corretas.

Os testes cobrem os quatro cenários: rota pública, ausência de autenticação, credenciais incorretas e credenciais válidas. A suíte roda antes de qualquer build, código que não passa nos testes nunca chega ao registry.

## O pipeline em detalhe

O workflow é composto por três jobs com dependência explícita via `needs:`:

```
git push (main)
    │
    ▼
┌────────────────────────────────────────────────┐
│  Job: test                                      │
│  └── npm ci + npm test (Jest + cobertura)       │
└──────────────────────┬─────────────────────────┘
                       │ needs: test
                       ▼
┌────────────────────────────────────────────────┐
│  Job: build-push                                │
│  ├── Login no GHCR via GITHUB_TOKEN automático  │
│  ├── Tag por SHA do commit + tag latest         │
│  └── docker build + push para ghcr.io          │
└──────────────────────┬─────────────────────────┘
                       │ needs: build-push
                       ▼
┌────────────────────────────────────────────────┐
│  Job: deploy                                    │
│  ├── SSH na EC2 (appleboy/ssh-action)           │
│  ├── docker pull :latest                        │
│  ├── docker stop + rm (container anterior)      │
│  ├── docker run -e (secrets em runtime)         │
│  └── docker image prune -f                      │
└────────────────────────────────────────────────┘
```

A separação em três jobs tem uma consequência prática importante: se o job `test` falhar, os jobs `build-push` e `deploy` não executam. Nenhuma imagem quebrada chega ao GHCR. Nenhuma versão inválida chega à produção.

## Secrets em runtime, uma decisão de segurança

Existe uma tentação ao trabalhar com Docker: passar as variáveis sensíveis como `ARG` no `docker build`. É conveniente, mas é um problema de segurança sério.

Qualquer argumento passado em build-time fica registrado nas camadas da imagem. Com `docker history`, é possível visualizar esses valores mesmo em imagens marcadas como privadas. Isso vale para senhas, tokens e chaves de API.

A abordagem correta é injetar os secrets apenas em runtime, via `docker run -e`:

```
docker run -d \
  -e APP_USERNAME="..." \
  -e APP_PASSWORD="..." \
  -e SECRET_MESSAGE="..." \
  ghcr.io/owner/app:latest
```

Os valores existem exclusivamente na memória do processo em execução. Não estão na imagem. Não estão no registry. Não estão no filesystem da EC2. Apenas no GitHub Actions Secrets, que é exatamente onde devem estar.

## Três problemas reais que encontrei

**1. O arquivo `.terraform/` tinha 674MB e bloqueou o push para o GitHub.**
O diretório `.terraform/` contém os binários dos providers baixados pelo `terraform init`. O provider da AWS sozinho tem mais de 600MB. O GitHub rejeita pushes com arquivos acima de 100MB. A solução é garantir que `.terraform/` e `terraform.tfstate` estejam no `.gitignore` antes do primeiro `git add`, não depois.

**2. O `terraform.tfstate` contém a chave privada SSH em texto plano.**
O estado do Terraform é um arquivo JSON que registra o valor atual de todos os recursos gerenciados. Quando o recurso `tls_private_key` gera uma chave RSA, o valor completo da chave privada é armazenado no estado. Commitar esse arquivo equivale a publicar a chave privada da EC2 no repositório. O `terraform.tfstate` jamais deve ser versionado, o backend remoto (S3 + DynamoDB) é a solução correta para times.

**3. Workflows do GitHub Actions só funcionam na raiz do repositório.**
Em um monorepo com múltiplos projetos, a tentação é colocar o workflow dentro do diretório do projeto (`projects/.../github/workflows/`). O GitHub Actions ignora completamente qualquer arquivo fora de `.github/workflows/` na raiz. O filtro `paths:` no trigger resolve o problema de isolamento, cada workflow na raiz responde apenas às mudanças do seu projeto.

## A diferença entre `t2.micro` e `t3.micro`

A escolha do tipo de instância EC2 parece detalhe, mas tem impacto real. O `t3.micro` é geração mais recente, oferece baseline de CPU maior, burst ilimitado por padrão e é ligeiramente mais barato, mantendo elegibilidade ao Free Tier. Para novos projetos, não há razão técnica para escolher `t2` em regiões onde `t3` está disponível.

## Resultado

Um `git push` publica a aplicação em produção em menos de dois minutos. A EC2 não precisa de acesso ao repositório, não precisa de ferramentas de build, não acumula imagens antigas. O pipeline limpa automaticamente imagens não utilizadas após cada deploy.

A imagem no GHCR fica disponível com duas tags: a tag `sha-abcdef` para rastreabilidade e rollback preciso, e a tag `latest` para o deploy sempre buscar a versão mais recente sem precisar passar o SHA entre jobs.

Código disponível em [github.com/nilo-lima/devops-master-lab](https://github.com/nilo-lima/devops-master-lab/tree/main/projects/05-automation/02-dockerized-service-deployment).
