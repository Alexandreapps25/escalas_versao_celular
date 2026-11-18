# Escalas Versão Celular — IAOSORN

App de escala da Igreja Apostólica O Senhor Onipotente Reina (IAOSORN).

## Arquivo principal
`escalas_versao_celular.html` — único arquivo HTML (PWA), tudo inline.

## Artifact publicado
https://claude.ai/artifact/LuEihwPmtEiuYnWYuzyvbm

## Branch de desenvolvimento
`claude/wonderful-gauss-cs6gtn`

## Senhas do app
- Membros e Pregação: `271842`

## Estrutura do app
- 3 abas: **Escalas** (📋), **Membros** (👥 — senha), **Pregação** (🎤 — senha)
- Dados salvos em `localStorage` (sem servidor, tudo no celular)

## Chaves localStorage
```
iaosorn_nomes_v2       → array de nomes dos membros
iaosorn_contadores_v1  → contadores de escala por membro
iaosorn_telefones_v1   → {nome: telefone} para WhatsApp
iaosorn_palavra_idx    → {idx, dia} versículo do dia (aba Escalas)
iaosorn_preg_vers_idx  → {idx} versículo rotativo (Avisar Escalados Pregação)
iaosorn_pregacao_v1    → escalas de pregação por mês
```

## Membros padrão
`AP MALU, BPO ALEXANDRE, BPA FABIANA, PR JARBAS, PRA LUANA, PRA MEYRE, EV JOÃO PAULO, EV RAFAEL, MISS VAL, DIAC ROSE, DIAC MAX, DIAC ENILDA`

## Funções importantes
- `getTelefones()` / `salvarTelefones(t)` — lê/salva telefones
- `linkWA(tel, msg)` — gera link `https://wa.me/55{tel}?text=...`
- `avisarEscalados()` — avisa escalados da aba Escalas
- `avisarEscaladosPreg()` — avisa escalados da Pregação (mensagem individual por dia)
- `getPalavraDoDia()` — versículo diário (avança ao mudar de dia)
- `getVersiculoPreg()` — versículo para notificação de pregação (avança a cada envio)
- `renderizarPregacao()` — renderiza lista de pregação do mês atual
- `compartilharPregacao()` — envia escala completa do mês no WhatsApp

## Restrições importantes
- `prompt()` e `confirm()` NÃO funcionam dentro do artifact — usar modais HTML customizados
- WhatsApp links: `https://wa.me/55{DDDnumero}?text={encodedMsg}`

## Instalação no celular
- **Android Chrome**: Menu → Adicionar à tela inicial
- **iPhone Safari**: Compartilhar → Adicionar à Tela de Início
- **APK**: workflow `build-apk.yml` no GitHub Actions gera o .apk via Capacitor
