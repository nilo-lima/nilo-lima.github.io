---
title: "Bastion Host na AWS: o único ponto de entrada que você controla de verdade"
description: "Como projetar um gateway SSH seguro para infraestrutura privada usando ProxyJump, Security Groups por referência e fail2ban, com toda a topologia provisionada via Terraform."
pubDate: 2026-05-19
tags: ["ssh", "security", "aws", "terraform", "networking", "iac", "devops", "bastion"]
source: "github"
sourceUrl: "https://github.com/nilo-lima/devops-master-lab/tree/main/projects/01-foundations/05-bastion-host"
---

## O problema com servidores "meio públicos"

Existe um padrão perigosamente comum em infraestruturas de pequenas e médias empresas: servidores com IP público, porta 22 aberta para `0.0.0.0/0`, autenticação por senha habilitada e nenhum mecanismo de detecção de intrusão. A justificativa é sempre a mesma: "é mais fácil de acessar".

O problema é que `0.0.0.0/0` na porta 22 significa que cada bot de brute force no planeta tem acesso ao formulário de login do seu servidor. Em questão de minutos após a criação de uma instância EC2 com essa configuração, os logs de autenticação já mostram centenas de tentativas de login vindas de IPs do mundo inteiro.

Um bastion host resolve isso com uma arquitetura simples e elegante: um único servidor com IP público, configurado exclusivamente para ser um ponto de passagem seguro. Todo o resto da infraestrutura fica em subnet privada, sem IP público, inacessível diretamente da internet.

## A arquitetura de rede

A topologia implementada neste projeto usa dois componentes fundamentais da AWS:

**Subnets separadas por intenção.** A subnet pública (`10.0.1.0/24`) tem uma Route Table com rota para o Internet Gateway, tornando instâncias nela acessíveis externamente quando têm IP público. A subnet privada (`10.0.2.0/24`) não tem essa rota, portanto instâncias nela só conseguem receber conexões de dentro da VPC.

**Security Groups por referência, não por CIDR.** O Security Group do servidor privado não abre a porta 22 para um bloco de IPs. Ele referencia o Security Group do bastion como origem permitida:

```hcl
resource "aws_security_group" "private" {
  ingress {
    from_port       = 22
    to_port         = 22
    protocol        = "tcp"
    security_groups = [aws_security_group.bastion.id]
  }
}
```

Isso significa que apenas instâncias que pertencem ao Security Group do bastion conseguem se conectar ao servidor privado. Não importa qual IP, não importa qual chave: se a conexão não vier do bastion, o Security Group descarta o pacote na camada de rede da AWS, antes mesmo de chegar ao processo SSH.

## ProxyJump: transparência sem comprometer segurança

A solução tradicional para acessar servidores privados via bastion é o SSH Agent Forwarding (`-A`). O problema é que Agent Forwarding funciona expondo o socket do agente SSH no servidor intermediário. Se o bastion for comprometido, o atacante pode usar esse socket para se autenticar em outros servidores como se fosse você, mesmo sem ter acesso à sua chave privada.

`ProxyJump` resolve isso de forma diferente: em vez de expor credenciais, ele cria um túnel TCP direto do cliente ao servidor de destino, passando pelo bastion apenas como relay de pacotes. O bastion não tem acesso à chave privada em momento algum.

A configuração no `~/.ssh/config`:

```
Host bastion
    HostName <IP_PUBLICO>
    User ubuntu
    IdentityFile ~/.ssh/bastion_lab_key

Host private-server
    HostName <IP_PRIVADO>
    User ubuntu
    IdentityFile ~/.ssh/bastion_lab_key
    ProxyJump bastion
```

O resultado é que `ssh private-server` a partir da máquina local funciona exatamente como `ssh bastion`: o túnel é estabelecido automaticamente, sem flags extras, sem comandos intermediários. Do ponto de vista do usuário, o bastion é invisível.

## fail2ban como última linha de defesa do ponto de entrada

O bastion tem IP público. Isso é inevitável: alguém precisa ser o ponto de entrada. Mas mesmo com o Security Group restringindo o ingress ao IP do desenvolvedor (`/32`), é boa prática assumir que esse controle pode ser contornado ou que o IP pode mudar.

O fail2ban foi configurado com três parâmetros cirúrgicos:

```ini
[sshd]
maxretry = 3
findtime = 600
bantime  = 3600
```

Três tentativas em 10 minutos resultam em ban de uma hora. Em um servidor onde o único usuário legítimo sabe exatamente qual chave usar, três tentativas falhas não são acidente, são um sinal inequívoco de atividade maliciosa.

O servidor privado não tem fail2ban. Sua proteção é a ausência de IP público e o Security Group que só aceita conexões vindas do bastion. Adicionar fail2ban lá seria ruído desnecessário em um servidor que, por design, não recebe conexões da internet.

## Hardening automatizado via user_data

Ambos os servidores são provisionados com scripts de hardening injetados via `user_data` do EC2:

```hcl
resource "aws_instance" "bastion" {
  user_data = file("${path.module}/../config/setup-bastion.sh")
}
```

O script desabilita autenticação por senha, bloqueia login root e reinicia o sshd antes mesmo de qualquer conexão humana chegar ao servidor:

```bash
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/'               /etc/ssh/sshd_config
sed -i 's/^#*MaxAuthTries.*/MaxAuthTries 3/'                       /etc/ssh/sshd_config
systemctl restart sshd
```

Isso garante que qualquer recriação do ambiente (`terraform destroy && terraform apply`) entrega servidores já endurecidos, sem etapas pós-provisionamento manuais. A infraestrutura nasce no estado final correto.

## Resultado da validação

Com a infraestrutura provisionada e o `~/.ssh/config` configurado, o resultado do `make validate`:

```
🔍 Testando acesso ao bastion...
ip-10-0-1-39
✅ Bastion OK
🔍 Testando acesso ao servidor privado via ProxyJump...
ip-10-0-2-53
✅ Private server OK
```

O hostname `ip-10-0-2-53` confirma que o servidor privado está na subnet `10.0.2.0/24`, sem IP público, acessível exclusivamente via ProxyJump pelo bastion.

## O que este projeto valida

A combinação de Security Groups por referência, ProxyJump e fail2ban representa o padrão mínimo aceitável para acesso SSH a infraestrutura em produção. Cada camada tem uma responsabilidade clara e independente:

| Camada | Onde atua | O que bloqueia |
|:--|:--|:--|
| Security Group bastion | Rede AWS | Qualquer IP diferente do desenvolvedor |
| Security Group privado | Rede AWS | Qualquer origem que não seja o bastion |
| fail2ban | SO do bastion | Tentativas de brute force no único ponto exposto |
| `PasswordAuthentication no` | sshd | Autenticação por senha em ambos os servidores |
| ProxyJump | Cliente SSH | Exposição de credenciais no servidor intermediário |

Nenhuma dessas camadas é suficiente sozinha. Juntas, elas criam um modelo de defesa em profundidade onde comprometer qualquer ponto isolado não é suficiente para ganhar acesso à infraestrutura interna.

Código disponível em [github.com/nilo-lima/devops-master-lab](https://github.com/nilo-lima/devops-master-lab/tree/main/projects/01-foundations/05-bastion-host).
