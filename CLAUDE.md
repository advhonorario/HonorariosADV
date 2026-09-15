# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status do projeto

`especificacao-sistema-honorarios.md` é a fonte de verdade completa (modelo de dados SQL, RLS, RPCs, telas, identidade visual, metas de performance). Antes de implementar qualquer parte do sistema, leia a seção relevante desse documento — não reimplemente decisões já tomadas nele nem invente estrutura alternativa sem justificativa.

**Fase 1 (banco) e Fase 2 (shell, login, cadastros) concluídas.** Próxima fase pendente: Fase 3 (tela de lançamento com rateio e barra) — ver especificação §13.

- Banco: 9 migrations em `supabase/migrations/` (`001` a `008` da Fase 1 + `009_rpcs_cadastros.sql` da Fase 2), aplicadas no projeto Supabase real. Não há ambiente local com Docker configurado nesta máquina — aplicar mudanças com `supabase db push --db-url <POSTGRES_URL_NON_POOLING> --include-all --yes` (variáveis em `.env.local`, nunca commitado) e sempre rodar `supabase db advisors --db-url <...> --type all --level warn` depois, esperando "No issues found".
- Frontend: `public/` (HTML/CSS/JS modular, sem build). Rodar localmente com `npx serve public`. Deploy: projeto Vercel `adv-honorarios/honorarios-adv`, já conectado ao repo GitHub (deploy automático a cada push em `main`) — produção em `https://honorarios-adv.vercel.app`. `SUPABASE_URL`/`SUPABASE_ANON_KEY` ficam hardcoded em `public/js/supabase.js` (são públicas por design, não há build step para injetar env vars no client).
- Usuário admin inicial já existe no Supabase (criado manualmente via SQL, não pelo fluxo de signup — não há tela de cadastro de usuário nesta fase).

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
- **`set_config` + o `update` precisam estar na mesma chamada.** O Supabase Data API (PostgREST) executa cada `update()`/`insert()` feito via REST como sua própria transação isolada — não dá para chamar `set_config` numa requisição e um `update` direto na tabela em outra e esperar que o motivo seja capturado. Por isso toda ação que exige motivo (estorno, inativação, alteração de percentual padrão, remoção de indicação) é uma RPC `security definer` que faz `set_config` + a escrita dentro do mesmo `plpgsql`. Edições sem motivo continuam podendo ser `update`/`insert` direto via REST, protegidas só por RLS.
- **RPCs `security definer` ignoram a RLS.** Toda RPC de escrita precisa checar o perfil explicitamente logo no início, e a checagem tem que ser NULL-safe: `coalesce(private.perfil_atual()::text, '') not in ('admin','financeiro')`, nunca `private.perfil_atual() not in (...)` puro — com perfil `NULL` (usuário autenticado sem linha em `usuarios`), a versão sem `coalesce` falha **aberta** (não dispara a exceção) em vez de negar acesso. Bug já cometido e corrigido nas RPCs da Fase 1; não reintroduzir nas próximas.
- **Resolução de percentual sugerido** segue ordem estrita do mais específico ao mais genérico (advogado+processo+serviço → advogado+serviço → advogado+processo → percentual padrão do advogado → percentual sugerido do serviço → zero). A origem escolhida é sempre gravada em `origem_percentual`.
- **RLS por perfil** (`admin`, `financeiro`, `socio`, `advogado`, `leitura`): perfil `advogado` só enxerga seus próprios números; `service_role` só é usada dentro de Serverless Functions, nunca em código que chega ao client.
- Textos de interface e nomes de campo são em pt-BR, por extenso, sem abreviação — segue o padrão já usado no SQL da especificação (`percentual_padrao`, não `pct_pad`).

## Segredos

Nunca versionar a pasta `Senhas/` nem arquivos `.env*` (já cobertos pelo `.gitignore`). O repositório GitHub (`advhonorario/HonorariosADV`) é **público** — qualquer coisa commitada e enviada (`git push`) fica visível e persiste no histórico mesmo após remoção posterior.
