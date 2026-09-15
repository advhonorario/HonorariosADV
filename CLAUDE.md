# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status do projeto

Este repositório ainda está na fase de especificação — não há código de aplicação, `package.json`, migrations ou testes implementados ainda. O único artefato de engenharia é `especificacao-sistema-honorarios.md`, que é a fonte de verdade completa (modelo de dados SQL, RLS, RPCs, telas, identidade visual, metas de performance). Antes de implementar qualquer parte do sistema, leia a seção relevante desse documento — não reimplemente decisões já tomadas nele nem invente estrutura alternativa sem justificativa.

Como ainda não existe código, não há comandos de build/lint/test para rodar. Quando o projeto for inicializado (Supabase CLI + deploy Vercel), este arquivo deve ser atualizado com os comandos reais (`supabase db reset`, `supabase migration new`, `vercel dev`, etc.).

## Stack e arquitetura

- **Frontend**: HTML + CSS + JS modular (ES Modules nativos), sem framework e sem etapa de build — `supabase-js` v2 via CDN. Isso é uma decisão deliberada (especificação §3), não uma limitação temporária; só migrar para Next.js se surgir necessidade de SSR, portal do cliente ou área pública indexável.
- **Backend**: Vercel Serverless Functions (Node 20) em `/api/*`, usadas apenas para as operações que exigem bibliotecas Node (exportação `.xlsx` via ExcelJS, `.pptx` via PptxGenJS) — nunca para lógica de negócio que pode viver em RPC do Postgres.
- **Dados**: Supabase (Postgres + Auth + RLS + Storage). Toda escrita de negócio passa por RPC `security definer`; o client nunca grava direto nas tabelas.
- **Ambientes**: branch `main` → Supabase `honorarios-prod`; branch `develop` → Supabase `honorarios-dev`. Preview deploys da Vercel apontam para o Supabase de homologação.
- Estrutura de diretórios planejada (especificação §12): `public/js/telas/*` por tela, `public/js/componentes/*` para UI compartilhada, `api/*` para as três functions, `supabase/migrations/*` numeradas sequencialmente.

## Regras de domínio não-óbvias

Estas regras vêm de decisões explícitas na especificação e são fáceis de violar sem reler o documento inteiro:

- **`valor_bruto` × `valor_base`**: bruto é o que o cliente pagou; base é o que entra no rateio (bruto menos custas/taxas/repasses). Por padrão são iguais. Nunca confundir os dois em cálculos.
- **Arredondamento por maior resto** (especificação §4.8): cada rateio é `round(base × percentual/100, 2)`; o resíduo de centavos vai para quem tem a maior parte fracionária descartada; o residual do escritório é sempre `valor_base − Σ valor_i` por diferença, nunca por percentual. O mesmo algoritmo deve rodar idêntico no navegador (preview) e no Postgres (gravação); o servidor é sempre a fonte da verdade em caso de divergência.
- **Lançamento nunca é apagado.** "Excluir" na UI sempre chama estorno (`status = 'estornado'`), preservando o registro no histórico. Exclusão física só existe para rascunhos nunca confirmados.
- **Toda alteração em registro já salvo, estorno, inativação ou remoção de linha de rateio exige motivo** (mínimo 10 caracteres), gravado via `set_config('app.motivo', ...)` antes da escrita, capturado pela trigger genérica de auditoria (`fn_auditoria`) em `logs_auditoria`. Não implementar nenhum caminho de escrita que contorne essa trigger.
- **Resolução de percentual sugerido** segue ordem estrita do mais específico ao mais genérico (advogado+processo+serviço → advogado+serviço → advogado+processo → percentual padrão do advogado → percentual sugerido do serviço → zero). A origem escolhida é sempre gravada em `origem_percentual`.
- **RLS por perfil** (`admin`, `financeiro`, `socio`, `advogado`, `leitura`): perfil `advogado` só enxerga seus próprios números; `service_role` só é usada dentro de Serverless Functions, nunca em código que chega ao client.
- Textos de interface e nomes de campo são em pt-BR, por extenso, sem abreviação — segue o padrão já usado no SQL da especificação (`percentual_padrao`, não `pct_pad`).

## Segredos

Nunca versionar a pasta `Senhas/` nem arquivos `.env*` (já cobertos pelo `.gitignore`). O repositório GitHub (`advhonorario/HonorariosADV`) é **público** — qualquer coisa commitada e enviada (`git push`) fica visível e persiste no histórico mesmo após remoção posterior.
