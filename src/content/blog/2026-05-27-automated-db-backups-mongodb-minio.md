---
title: "Backup automatizado de MongoDB: cron, S3-compatible storage e o problema do ambiente mínimo do cron"
description: "Como construir um sistema de backup de banco de dados production-ready com mongodump, MinIO e AWS CLI — e por que o cron dentro do Docker não enxerga as variáveis de ambiente do container sem uma intervenção explícita."
pubDate: 2026-05-27
tags: ["mongodb", "docker", "backup", "minio", "s3", "cron", "bash", "automation", "devops"]
source: "github"
sourceUrl: "https://github.com/nilo-lima/devops-master-lab/tree/main/projects/05-automation/03-automated-db-backups"
---

## O que falha silenciosamente em todo tutorial de backup com cron + Docker

A maioria dos tutoriais de backup automatizado com cron dentro de containers termina com um script que funciona perfeitamente quando executado via `docker compose exec`, mas falha em silêncio quando o próprio cron tenta rodar o mesmo script às 00:00.

A causa é sempre a mesma e raramente explicada: o cron daemon executa cada job em um ambiente mínimo, sem as variáveis de ambiente que o Docker injeta via `env_file` ou `environment`. A variável `MONGO_HOST`, que funciona no terminal, simplesmente não existe quando o cron chama o script.

O resultado é um backup que "funciona em desenvolvimento" mas nunca executa em produção. Os logs mostram apenas `mongodump: command not found` ou `AWS_ACCESS_KEY_ID is not set` — erros que levam horas para rastrear se você não sabe onde procurar.

## A solução: persistir o ambiente antes de iniciar o cron

O fix é simples e deve acontecer no entrypoint do container, antes de qualquer coisa:

```bash
#!/bin/sh
set -e

printenv \
  | grep -E "^(MONGO_|S3_|AWS_|RETENTION_|WEBHOOK_)" \
  | awk -F= 'BEGIN{OFS="="} {
      val = substr($0, index($0,"=")+1)
      gsub(/"/, "\\\"", val)
      printf "export %s=\"%s\"\n", $1, val
    }' \
  > /etc/backup-env.sh

exec "$@"
```

O `entrypoint.sh` roda antes do `CMD ["cron", "-f"]` e escreve todas as variáveis relevantes em `/etc/backup-env.sh`. O crontab então faz `. /etc/backup-env.sh` antes do script:

```
0 */12 * * * root . /etc/backup-env.sh; /app/backup.sh >> /var/log/backup.log 2>&1
```

E o `backup.sh` também faz source do arquivo como primeira linha, para quando executado via `docker compose exec` em uma sessão que já tem as vars:

```bash
source /etc/backup-env.sh 2>/dev/null || true
```

O `|| true` garante que o script não falha se executado fora do container (durante desenvolvimento local, por exemplo). Este padrão — entrypoint persiste env, cron e script source explicitamente — elimina a classe inteira de falhas silenciosas por ambiente mínimo.

## `mongodump --archive`: um arquivo, não um diretório

O comportamento padrão do `mongodump` cria uma árvore de diretórios com arquivos `.bson` e `.metadata.json` separados para cada collection. Para backup + upload, isso significa comprimir o diretório após o dump, gerenciar a limpeza, e fazer upload de um arquivo que foi criado em dois passos.

O flag `--archive=FILE` resolve isso:

```bash
mongodump \
  --host="${MONGO_HOST}:${MONGO_PORT}" \
  --username="${MONGO_USER}" \
  --password="${MONGO_PASSWORD}" \
  --authenticationDatabase="admin" \
  --db="${MONGO_DB}" \
  --archive="${TMP_PATH}" \
  --gzip
```

`--archive` serializa o dump em um único arquivo binário. `--gzip` comprime inline durante a serialização. O resultado é um `.tar.gz` criado em uma única operação, pronto para upload. O restore usa a mesma interface:

```bash
mongorestore \
  --archive="${TMP_PATH}" \
  --gzip \
  --drop
```

`--drop` remove as collections existentes antes de restaurar. Em um cenário de recuperação real, você quer sobrescrever o estado corrompido com o estado do backup, não mesclar os dois.

## MinIO como proxy de provider

O desafio original sugere Cloudflare R2 como destino de armazenamento. O problema com isso em um ambiente de laboratório é a dependência de uma conta externa e credenciais reais para testar qualquer coisa.

MinIO resolve isso. É um servidor de object storage que implementa a API S3 completa. O mesmo script que faz upload para o MinIO local funciona com R2, AWS S3 ou qualquer storage S3-compatible — a única diferença é o `--endpoint-url`:

```bash
aws s3 cp "${TMP_PATH}" "s3://${S3_BUCKET}/${BACKUP_FILE}" \
  --endpoint-url "${S3_ENDPOINT}" \
  --no-progress
```

Para o MinIO local em Docker Compose: `S3_ENDPOINT=http://minio:9000`.
Para Cloudflare R2: `S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com`.
Para AWS S3 padrão: `S3_ENDPOINT=https://s3.us-east-1.amazonaws.com`.

A troca de provider é uma mudança de variável de ambiente, não de código. Isso é portabilidade operacional real — você desenvolve e testa localmente com MinIO, e faz deploy com R2 ou S3 sem tocar no script.

## Retenção: a ordem das operações importa

A política de retenção deleta backups mais antigos que `RETENTION_DAYS`. A questão é: quando deletar?

O script usa `set -euo pipefail`. Qualquer falha — incluindo falha no upload — encerra o script imediatamente com exit code não-zero. A lógica de retenção está posicionada após o upload:

```bash
# 3. Upload — se falhar, o script termina aqui
aws s3 cp "${TMP_PATH}" "s3://${S3_BUCKET}/${BACKUP_FILE}" \
  --endpoint-url "${S3_ENDPOINT}" \
  --no-progress

# 4. Retenção — só executa se o upload foi bem-sucedido
aws s3 ls "s3://${S3_BUCKET}/" \
  --endpoint-url "${S3_ENDPOINT}" \
  | awk '{print $4}' \
  | grep "^mongodb-" \
  | while read -r obj; do
      OBJ_TS="${obj#mongodb-}"
      OBJ_TS="${OBJ_TS%.tar.gz}"
      if [[ "${OBJ_TS}" < "${CUTOFF}" ]]; then
        aws s3 rm "s3://${S3_BUCKET}/${obj}" --endpoint-url "${S3_ENDPOINT}"
      fi
    done
```

Se o upload falhar (sem espaço no bucket, credenciais expiradas, storage indisponível), o backup antigo permanece intacto. Você nunca fica sem backup porque o novo falhou e o antigo foi deletado antes da confirmação.

## O check de conectividade sem dependências extras

A imagem de backup é baseada em `debian:bookworm-slim` e contém apenas o necessário: `mongodump`, `awscli`, `cron` e `curl`. Não há `mongosh` para fazer um ping de conectividade antes do dump.

A solução usa o `/dev/tcp` do bash, um pseudo-arquivo que abre uma conexão TCP quando lido:

```bash
timeout 5 bash -c "cat < /dev/null > /dev/tcp/${MONGO_HOST}/${MONGO_PORT}" 2>/dev/null || {
  notify "FAILURE" "Cannot connect to MongoDB at ${MONGO_HOST}:${MONGO_PORT}"
  exit 1
}
```

Se o MongoDB não responder em 5 segundos, o script falha imediatamente com uma mensagem clara e dispara a notificação. Sem dependência de `nc`, `telnet`, `mongosh` ou qualquer outra ferramenta — apenas bash.

## Resultado da validação

Com a stack no ar, o ciclo completo em 2 segundos:

```
[2026-05-27T23:03:52Z] === Backup started: mongodb-2026-05-27T23-03-52.tar.gz ===
[2026-05-27T23:03:52Z] Checking MongoDB connectivity at mongodb:27017...
[2026-05-27T23:03:52Z] Running mongodump...
done dumping labdb.products (50 documents)
[2026-05-27T23:03:52Z] Archive created: mongodb-2026-05-27T23-03-52.tar.gz (4.0K)
[2026-05-27T23:03:52Z] Uploading to s3://db-backups/...
upload: tmp/mongodb-2026-05-27T23-03-52.tar.gz to s3://db-backups/...
[2026-05-27T23:03:53Z] Applying retention policy (7 days)...
[2026-05-27T23:03:54Z] SUCCESS: Backup (4.0K) completed in 2s
```

Após drop manual da collection e restore:

```
[2026-05-27T23:04:14Z] finished restoring labdb.products (50 documents, 0 failures)
[2026-05-27T23:04:14Z] 50 document(s) restored successfully.
```

Um backup sem restore testado não é um backup. É apenas um arquivo em um bucket.

Código disponível em [github.com/nilo-lima/devops-master-lab](https://github.com/nilo-lima/devops-master-lab/tree/main/projects/05-automation/03-automated-db-backups).
