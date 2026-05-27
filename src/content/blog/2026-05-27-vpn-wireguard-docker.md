---
title: "WireGuard em container: NET_ADMIN, geração de chaves sem dependências no host e wg syncconf para zero downtime"
description: "Como containerizar um servidor WireGuard com o mínimo de privilégios necessários, gerar chaves via Docker sem instalar wireguard-tools no host, e adicionar peers em produção sem derrubar conexões existentes."
pubDate: 2026-05-27
tags: ["wireguard", "vpn", "docker", "networking", "security", "linux", "devops", "foundations"]
source: "github"
sourceUrl: "https://github.com/nilo-lima/devops-master-lab/tree/main/projects/01-foundations/06-vpn-server-setup"
---

## Por que WireGuard e não OpenVPN

WireGuard está integrado ao kernel Linux desde a versão 5.6. O código-fonte completo tem aproximadamente 4.000 linhas — contra mais de 100.000 do OpenVPN. Isso não é apenas uma métrica de simplicidade: é uma superfície de ataque menor, uma base de código auditável por uma pessoa em um fim de semana, e um handshake que completa em cerca de 100ms usando ChaCha20/Poly1305.

A configuração de um peer WireGuard é um arquivo de texto com menos de 10 linhas. A configuração equivalente no OpenVPN exige uma PKI completa: CA, certificado do servidor, certificado do cliente, e arquivo de configuração com ~50 parâmetros. Para quem precisa de auditabilidade e reprodutibilidade, WireGuard é a escolha óbvia.

## `NET_ADMIN` versus `privileged: true`

WireGuard precisa criar interfaces de rede (`wg0`) e modificar tabelas de roteamento do kernel. A tentação comum ao containerizar isso é usar `privileged: true` no Docker Compose — funciona, mas concede acesso root completo ao host, incluindo a capacidade de montar filesystems, carregar módulos do kernel e modificar configurações de segurança.

A alternativa correta é declarar apenas as capabilities necessárias:

```yaml
cap_add:
  - NET_ADMIN
  - SYS_MODULE
devices:
  - /dev/net/tun
sysctls:
  net.ipv4.ip_forward: "1"
```

`NET_ADMIN` concede controle sobre interfaces de rede, rotas e iptables. `SYS_MODULE` é necessário para carregar o módulo `wireguard` se ele não estiver já ativo no kernel (em kernels 5.6+, está built-in e pode ser omitido). `/dev/net/tun` expõe o dispositivo de rede virtual que WireGuard usa. `ip_forward` habilita o roteamento de pacotes entre interfaces — necessário para que o servidor encaminhe tráfego dos peers para a internet.

O resultado é um container com permissões cirúrgicas: consegue fazer exatamente o que WireGuard precisa e nada mais.

## Geração de chaves sem instalar wireguard-tools no host

O problema com scripts de setup que chamam `wg genkey` diretamente é a dependência no host. Em uma máquina de desenvolvimento macOS, `wg genkey` não existe por padrão. Em um CI pipeline, exige instalação de pacotes antes de rodar o script. Em um servidor de produção recém-provisionado, pode estar desatualizado.

A solução é rodar a geração de chaves em um container descartável:

```makefile
setup:
	docker run --rm \
		-v "$(CURDIR)/config:/workspace/config" \
		-v "$(CURDIR)/scripts/gen-config.sh:/workspace/gen-config.sh:ro" \
		-v "$(CURDIR)/.env:/workspace/.env:ro" \
		-w /workspace \
		debian:bookworm-slim \
		bash -c "apt-get update -qq && apt-get install -y -qq wireguard-tools qrencode && bash gen-config.sh"
```

O container instala `wireguard-tools`, executa o script de geração e sai. As chaves são escritas nos volumes montados e ficam disponíveis no host. O host não precisa de nada além de Docker. Qualquer ambiente — laptop, CI, servidor — produz o mesmo resultado com o mesmo processo.

O `gen-config.sh` gera os pares de chaves do servidor e de cada peer, monta os arquivos `.conf` com os campos corretos e aplica `chmod 600` nos arquivos com chaves privadas:

```bash
SERVER_PRIVKEY=$(wg genkey)
SERVER_PUBKEY=$(echo "${SERVER_PRIVKEY}" | wg pubkey)

# Para cada peer:
PEER_PRIVKEY=$(wg genkey)
PEER_PUBKEY=$(echo "${PEER_PRIVKEY}" | wg pubkey)
```

A chave pública do servidor vai no `[Peer]` de cada cliente. A chave pública de cada cliente vai no `[Peer]` do servidor. Nunca o contrário — chaves privadas nunca saem do dispositivo que as gerou.

## Split tunneling: `AllowedIPs` define o que passa pelo túnel

O `AllowedIPs` no config do peer é simultaneamente uma ACL e uma definição de rota. Quando definido como `0.0.0.0/0`, todo o tráfego do cliente passa pelo túnel — incluindo o tráfego para a rede Docker local, o que quebraria a conectividade do container de teste.

Com split tunneling:

```ini
[Peer]
AllowedIPs = 10.0.0.0/24
```

Apenas tráfego destinado à subnet VPN (`10.0.0.0/24`) é roteado pelo `wg0`. O resto continua pelo `eth0` padrão. O container de teste mantém acesso à rede Docker enquanto demonstra o roteamento correto pelo túnel — verificável com um ping direto ao IP VPN do servidor (`10.0.0.1`):

```
64 bytes from 10.0.0.1: icmp_seq=1 ttl=64 time=0.333 ms
4 packets transmitted, 4 received, 0% packet loss
```

## `wg syncconf` para adição de peers sem downtime

O fluxo ingênuo de adicionar um peer é `wg-quick down wg0 && wg-quick up wg0`. Isso funciona, mas desconecta todos os peers existentes por alguns segundos enquanto a interface é recriada.

O WireGuard tem um mecanismo específico para aplicar mudanças de configuração sem reiniciar a interface: `wg syncconf`. Ele compara a configuração atual em memória com a nova configuração e aplica apenas o diff:

```bash
wg-quick strip /etc/wireguard/wg0.conf | wg syncconf wg0 /dev/stdin
```

`wg-quick strip` remove os parâmetros que são entendidos apenas pelo `wg-quick` (como `PostUp`, `PostDown`, `DNS`) e produz um formato que o comando `wg` base consegue processar. `wg syncconf` aplica esse formato diretamente à interface em execução.

O resultado: novos peers aparecem na interface sem que os peers existentes percebam qualquer interrupção. Em produção, onde peers são usuários reais com sessões ativas, a diferença entre `wg syncconf` e reiniciar a interface é invisível versus perceptível.

## O DNS em containers Docker

`wg-quick` suporta um campo `DNS` no `[Interface]` do peer, que instrui o cliente a usar um servidor DNS específico ao conectar ao VPN. Na implementação, isso é feito via `resolvconf`, que modifica `/etc/resolv.conf`.

Em containers Docker, `/etc/resolv.conf` é gerenciado pelo runtime. Qualquer tentativa de modificação por um processo dentro do container resulta em erro ou é silenciosamente ignorada. A solução adotada foi comentar a linha DNS por padrão no config do peer de teste:

```ini
[Interface]
Address    = 10.0.0.2/32
PrivateKey = <key>
# DNS = 1.1.1.1   # Uncomment for real clients (mobile/desktop)
```

Clientes reais (mobile, desktop, VMs) devem descomentá-la. O container de teste funciona sem ela — e evita um erro silencioso que levaria tempo para diagnosticar.

## Validação do handshake

Com a stack no ar, `wg show` no servidor confirma que o peer estabeleceu o túnel:

```
interface: wg0
  public key: jTeB7TeKeytLTp3kC60tmq+IlgRiIBdoVbmQ4CW/rl4=
  listening port: 51820

peer: lJfIW9brr/CHomOqIqlDhG4ZM4vkuQKoaxoe0eYMYWA=
  endpoint: 172.21.0.3:41127
  allowed ips: 10.0.0.2/32
  latest handshake: 12 seconds ago
  transfer: 180 B received, 92 B sent
```

O `latest handshake` confirma que as chaves foram trocadas com sucesso. O `transfer` confirma que dados reais passaram pelo túnel — não apenas que o handshake foi completado mas que o canal criptografado está funcional.

WireGuard não mantém estado de "conexão ativa". O `PersistentKeepalive = 25` no peer envia um pacote a cada 25 segundos para manter o mapeamento NAT ativo em redes que fecham portas UDP ociosas. Sem ele, um peer atrás de NAT perde a capacidade de receber pacotes do servidor após alguns minutos de inatividade.

Código disponível em [github.com/nilo-lima/devops-master-lab](https://github.com/nilo-lima/devops-master-lab/tree/main/projects/01-foundations/06-vpn-server-setup).
