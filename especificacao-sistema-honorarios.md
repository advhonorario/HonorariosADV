# Sistema de Honorários Advocatícios — Especificação Funcional e Técnica

> Documento de construção. Serve como briefing único para implementação por desenvolvedor ou agente de código.
> Stack alvo: **HTML/CSS/JS modular + Supabase (Postgres) + Vercel + GitHub**.
> Versão 1.0 — a confirmar contra o arquivo `Contabilidade 2025.pptx` (ver seção 2).

---

## 1. Objetivo

Substituir o controle em planilha/apresentação por um aplicativo web onde o financeiro do escritório:

1. cadastra advogados, clientes, tipos de processo e tipos de serviço;
2. lança honorários recebidos em poucos segundos, dividindo o valor entre um ou vários advogados;
3. corrige ou estorna lançamentos errados sempre justificando o motivo;
4. audita tudo o que foi feito, por quem e quando;
5. acompanha indicadores em um painel e exporta o resultado para Excel e PowerPoint.

Três não-negociáveis orientam todas as decisões abaixo:

- **Velocidade de lançamento.** O caminho comum (cliente conhecido, advogado responsável, percentual padrão) deve ser concluído sem tirar as mãos do teclado.
- **Rastreabilidade total.** Nenhum dado financeiro muda sem registro de autor, valor anterior, valor novo e motivo.
- **Exatidão do centavo.** A soma dos rateios é sempre idêntica ao valor lançado, sem sobra de arredondamento.

---

## 2. Premissas e pendências

| # | Item | Situação |
|---|---|---|
| P1 | Indicadores, nomes de métricas e identidade visual do `Contabilidade 2025.pptx` | **Pendente.** O arquivo não foi recebido. A seção 9 traz o conjunto de indicadores proposto; ao receber o .pptx, reconciliar nomes, fórmulas e ordem dos slides. |
| P2 | Regra de retenção do escritório | Assumido: o escritório fica com o residual (100% − soma dos rateios). Confirmar se existe teto/piso. |
| P3 | Tributação | Assumido: o sistema controla valor bruto e valor líquido informados manualmente; não calcula ISS/IRRF. Se precisar, vira fase 2. |
| P4 | Comissão de indicação | Assumido: percentual do cliente, aplicado sobre o valor do lançamento, somado ao rateio como papel `indicacao`. |
| P5 | Volume esperado | Assumido: até 50 mil lançamentos e 60 usuários. O modelo aguenta muito mais, mas as materialized views foram dimensionadas para essa ordem. |

---

## 3. Arquitetura

```
GitHub (repositório)
   │  push na main
   ▼
Vercel  ──────────────────────────────────────────────┐
   ├── / (estático)   HTML + CSS + JS ES Modules      │
   │                  supabase-js v2, ECharts          │
   └── /api/*         Serverless Functions (Node 20)   │
          ├── export-xlsx.js      ExcelJS              │
          ├── export-pptx.js      PptxGenJS            │
          └── narrativa.js        descrições do deck   │
                       │ service_role (somente server) │
                       ▼                               │
Supabase ──────────────────────────────────────────────┘
   ├── Postgres  (tabelas, views, RPCs, triggers de auditoria)
   ├── Auth      (e-mail/senha + magic link)
   ├── RLS       (perfis: admin, financeiro, socio, advogado, leitura)
   └── Storage   (comprovantes de pagamento, opcional)
```

**Por que HTML + JS modular e não um framework.** O pedido é um HTML funcional. Módulos ES nativos com `supabase-js` via CDN dão inicialização abaixo de 1 s, zero etapa de build e manutenção direta pelo próprio usuário. As duas operações pesadas — gerar .xlsx e .pptx — ficam em funções serverless porque exigem bibliotecas Node e não devem rodar no navegador do usuário.

**Quando migrar para Next.js.** Só se aparecer necessidade de SSR, portal do cliente ou área pública indexável. O modelo de dados e as RPCs desta especificação continuam válidos sem alteração.

### 3.1 Ambientes

| Ambiente | Branch | Supabase | Uso |
|---|---|---|---|
| Produção | `main` | projeto `honorarios-prod` | escritório |
| Homologação | `develop` | projeto `honorarios-dev` | testes com dados fictícios |

Preview deploy automático da Vercel a cada pull request, apontando para o Supabase de homologação.

### 3.2 Variáveis de ambiente

```
# públicas — expostas no client, protegidas por RLS
SUPABASE_URL=
SUPABASE_ANON_KEY=

# privadas — apenas nas Serverless Functions
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=          # opcional, narrativa automática do PPT
```

A `service_role` nunca aparece em arquivo do diretório público. O client usa exclusivamente a `anon key` com RLS ativa.

---

## 4. Modelo de dados

Convenções: identificadores `uuid` com `gen_random_uuid()`, dinheiro em `numeric(14,2)`, percentuais em `numeric(6,3)` (permite 33,333%), timestamps em `timestamptz`, textos em pt-BR sem abreviação.

### 4.1 Tipos

```sql
create type perfil_usuario     as enum ('admin','financeiro','socio','advogado','leitura');
create type tipo_pessoa        as enum ('fisica','juridica');
create type papel_rateio       as enum ('responsavel','indicacao','parceria','correspondente','sucumbencia');
create type status_lancamento  as enum ('rascunho','confirmado','recebido','estornado');
create type origem_percentual  as enum ('padrao_advogado','padrao_servico','manual');
create type natureza_servico   as enum ('exito','fixo','hora','mensal','consultivo');
create type acao_auditoria     as enum ('INSERT','UPDATE','DELETE','LOGIN','EXPORT');
```

### 4.2 Usuários e perfis

```sql
create table usuarios (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null,
  email       text not null unique,
  perfil      perfil_usuario not null default 'leitura',
  advogado_id uuid references advogados(id),   -- vincula login ao advogado
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
```

### 4.3 Cadastro de advogados

```sql
create table advogados (
  id                 uuid primary key default gen_random_uuid(),
  nome               text not null,
  oab_numero         text,
  oab_uf             char(2),
  cpf_cnpj           text unique,
  email              text,
  telefone           text,
  percentual_padrao  numeric(6,3) not null default 0
                       check (percentual_padrao >= 0 and percentual_padrao <= 100),
  papel_preferencial papel_rateio not null default 'responsavel',
  chave_pix          text,
  banco              text,
  agencia            text,
  conta              text,
  observacao         text,
  ativo              boolean not null default true,
  criado_em          timestamptz not null default now(),
  criado_por         uuid references usuarios(id),
  atualizado_em      timestamptz,
  atualizado_por     uuid references usuarios(id)
);
create index idx_advogados_ativo on advogados (ativo, nome);
```

### 4.4 Tipos de processo e de serviço

```sql
create table tipos_processo (
  id       uuid primary key default gen_random_uuid(),
  codigo   text not null unique,      -- TRAB, CIV, PREV, TRIB, FAM, CRIM, CONS, EMP
  nome     text not null,
  area     text not null,
  ativo    boolean not null default true,
  ordem    smallint not null default 0
);

create table tipos_servico (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text not null unique,   -- EXITO, CONTRATUAL, HORA, MENSAL, PARECER
  nome                text not null,
  natureza            natureza_servico not null,
  percentual_sugerido numeric(6,3) check (percentual_sugerido between 0 and 100),
  ativo               boolean not null default true,
  ordem               smallint not null default 0
);
```

**Percentual por combinação.** O percentual padrão do advogado pode variar conforme a matéria e o tipo de serviço. Duas tabelas de exceção resolvem isso sem inflar o cadastro:

```sql
create table advogado_percentual (
  id               uuid primary key default gen_random_uuid(),
  advogado_id      uuid not null references advogados(id) on delete cascade,
  tipo_processo_id uuid references tipos_processo(id),
  tipo_servico_id  uuid references tipos_servico(id),
  percentual       numeric(6,3) not null check (percentual between 0 and 100),
  ativo            boolean not null default true,
  unique (advogado_id, tipo_processo_id, tipo_servico_id)
);
```

**Resolução do percentual sugerido** (a tela de lançamento usa esta ordem, do mais específico para o mais genérico):

1. `advogado_percentual` com processo **e** serviço correspondentes;
2. `advogado_percentual` só com o tipo de serviço;
3. `advogado_percentual` só com o tipo de processo;
4. `advogados.percentual_padrao`;
5. `tipos_servico.percentual_sugerido`;
6. zero — e o campo abre destacado pedindo preenchimento.

A origem escolhida é gravada em `lancamento_rateio.origem_percentual`, o que torna auditável quanto do faturamento saiu da regra.

### 4.5 Clientes

```sql
create table clientes (
  id                    uuid primary key default gen_random_uuid(),
  nome                  text not null,
  tipo_pessoa           tipo_pessoa not null default 'fisica',
  cpf_cnpj              text unique,
  email                 text,
  telefone              text,
  cidade                text,
  uf                    char(2),
  advogado_indicacao_id uuid references advogados(id),      -- quem indicou
  percentual_indicacao  numeric(6,3) default 0
                          check (percentual_indicacao between 0 and 100),
  origem                text,        -- indicação, marketing, recorrente, parceria
  data_cadastro         date not null default current_date,
  observacao            text,
  ativo                 boolean not null default true,
  criado_em             timestamptz not null default now(),
  criado_por            uuid references usuarios(id),
  atualizado_em         timestamptz,
  atualizado_por        uuid references usuarios(id)
);
create index idx_clientes_busca on clientes
  using gin (to_tsvector('portuguese', nome || ' ' || coalesce(cpf_cnpj,'')));
create index idx_clientes_indicacao on clientes (advogado_indicacao_id);
```

Quando o cliente tem indicador, a tela de lançamento **pré-carrega automaticamente** uma linha de rateio com papel `indicacao`, o advogado indicador e o `percentual_indicacao`. O usuário pode remover a linha, mas remover exige motivo.

### 4.6 Processos (opcional, recomendado)

```sql
create table processos (
  id               uuid primary key default gen_random_uuid(),
  numero_cnj       text unique,
  cliente_id       uuid not null references clientes(id),
  tipo_processo_id uuid not null references tipos_processo(id),
  comarca          text,
  vara             text,
  valor_causa      numeric(14,2),
  data_distribuicao date,
  encerrado        boolean not null default false
);
```

Permite responder "quanto rendeu este processo" e agrupar lançamentos parcelados. O lançamento pode existir sem processo vinculado.

### 4.7 Lançamentos e rateio

```sql
create table lancamentos (
  id               uuid primary key default gen_random_uuid(),
  numero           bigint generated always as identity,   -- número legível: #001428
  data_competencia date not null default current_date,
  data_pagamento   date,
  cliente_id       uuid not null references clientes(id),
  processo_id      uuid references processos(id),
  tipo_processo_id uuid not null references tipos_processo(id),
  tipo_servico_id  uuid not null references tipos_servico(id),
  descricao        text,
  valor_bruto      numeric(14,2) not null check (valor_bruto > 0),
  valor_base       numeric(14,2) not null check (valor_base > 0),  -- base do rateio
  forma_pagamento  text,
  status           status_lancamento not null default 'confirmado',
  observacao       text,
  estornado_em     timestamptz,
  estornado_por    uuid references usuarios(id),
  motivo_estorno   text,
  criado_em        timestamptz not null default now(),
  criado_por       uuid references usuarios(id),
  atualizado_em    timestamptz,
  atualizado_por   uuid references usuarios(id)
);
create index idx_lanc_periodo  on lancamentos (data_competencia desc) where status <> 'estornado';
create index idx_lanc_cliente  on lancamentos (cliente_id, data_competencia desc);
create index idx_lanc_status   on lancamentos (status, data_competencia desc);

create table lancamento_rateio (
  id                 uuid primary key default gen_random_uuid(),
  lancamento_id      uuid not null references lancamentos(id) on delete cascade,
  advogado_id        uuid not null references advogados(id),
  papel              papel_rateio not null default 'responsavel',
  percentual         numeric(6,3) not null check (percentual >= 0 and percentual <= 100),
  percentual_sugerido numeric(6,3),          -- o que o sistema propôs
  origem_percentual  origem_percentual not null default 'padrao_advogado',
  valor              numeric(14,2) not null check (valor >= 0),
  pago               boolean not null default false,
  data_repasse       date,
  observacao         text,
  unique (lancamento_id, advogado_id, papel)
);
create index idx_rateio_advogado on lancamento_rateio (advogado_id);
```

**`valor_bruto` × `valor_base`.** Bruto é o que o cliente pagou. Base é o que entra no rateio (bruto menos custas, taxas de cartão, repasses de terceiros). Por padrão os dois campos são iguais e o segundo só aparece quando o usuário clica em "descontar da base".

### 4.8 Regra de arredondamento

Percentual × valor produz dízimas. Para a soma dos rateios bater com o centavo:

1. calcular `valor_i = round(base × percentual_i / 100, 2)` para cada linha;
2. calcular `residuo = base_rateada − Σ valor_i`, onde `base_rateada = base × Σ percentual_i / 100`;
3. distribuir o resíduo em centavos pelo método do maior resto — quem tem a maior parte fracionária descartada recebe o centavo primeiro;
4. o residual do escritório é sempre `valor_base − Σ valor_i`, calculado por diferença e nunca por percentual, o que elimina qualquer sobra.

O mesmo algoritmo roda no navegador (pré-visualização) e no Postgres (gravação). A gravação é a fonte da verdade; se divergir da pré-visualização, a tela recarrega os valores do servidor.

### 4.9 Validação do rateio

```sql
create or replace function fn_valida_rateio() returns trigger as $$
declare soma numeric(6,3);
begin
  select coalesce(sum(percentual),0) into soma
    from lancamento_rateio where lancamento_id = coalesce(new.lancamento_id, old.lancamento_id);
  if soma > 100.001 then
    raise exception 'A soma dos percentuais do rateio é %%. O limite é 100%%.', soma;
  end if;
  return null;
end $$ language plpgsql;

create constraint trigger tg_valida_rateio
  after insert or update or delete on lancamento_rateio
  deferrable initially deferred
  for each row execute function fn_valida_rateio();
```

`deferrable initially deferred` permite reordenar as linhas dentro de uma transação sem estourar a validação no meio do caminho.

---

## 5. Auditoria — o log de tudo

### 5.1 Tabela

```sql
create table logs_auditoria (
  id           bigint generated always as identity primary key,
  ocorrido_em  timestamptz not null default now(),
  usuario_id   uuid references usuarios(id),
  usuario_nome text,
  perfil       perfil_usuario,
  tela         text,              -- 'lancamento', 'advogados', 'dashboard', ...
  entidade     text not null,     -- nome da tabela
  registro_id  uuid,
  registro_ref text,              -- '#001428 — Construtora Aurora'
  acao         acao_auditoria not null,
  motivo       text,              -- obrigatório em UPDATE e DELETE
  dados_antes  jsonb,
  dados_depois jsonb,
  campos       text[],            -- apenas os campos que mudaram
  ip           inet,
  user_agent   text
);
create index idx_log_periodo  on logs_auditoria (ocorrido_em desc);
create index idx_log_entidade on logs_auditoria (entidade, registro_id, ocorrido_em desc);
create index idx_log_usuario  on logs_auditoria (usuario_id, ocorrido_em desc);
create index idx_log_dados    on logs_auditoria using gin (dados_depois jsonb_path_ops);
```

### 5.2 Trigger genérica

Um único gatilho serve todas as tabelas. O motivo e a tela chegam por variável de sessão, definida pela RPC antes da escrita — o que torna impossível alterar dados por fora do fluxo sem deixar o campo vazio e visível no relatório.

```sql
create or replace function fn_auditoria() returns trigger as $$
declare
  v_antes jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_depois jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_campos text[];
  v_usuario uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    select array_agg(key) into v_campos
      from jsonb_each(v_depois) d
     where d.value is distinct from v_antes -> d.key
       and d.key not in ('atualizado_em','atualizado_por');
    if v_campos is null then return coalesce(new, old); end if;
  end if;

  insert into logs_auditoria (
    usuario_id, usuario_nome, perfil, tela, entidade, registro_id,
    acao, motivo, dados_antes, dados_depois, campos
  )
  select v_usuario, u.nome, u.perfil,
         nullif(current_setting('app.tela', true), ''),
         tg_table_name,
         coalesce((v_depois->>'id')::uuid, (v_antes->>'id')::uuid),
         tg_op::acao_auditoria,
         nullif(current_setting('app.motivo', true), ''),
         v_antes, v_depois, v_campos
    from usuarios u where u.id = v_usuario;

  return coalesce(new, old);
end $$ language plpgsql security definer;
```

Aplicar em `advogados`, `clientes`, `tipos_processo`, `tipos_servico`, `advogado_percentual`, `processos`, `lancamentos`, `lancamento_rateio`:

```sql
create trigger tg_audit_lancamentos
  after insert or update or delete on lancamentos
  for each row execute function fn_auditoria();
-- repetir para as demais
```

`logs_auditoria` não tem UPDATE nem DELETE liberados para nenhum perfil. Retenção mínima de 5 anos; expurgo só por rotina administrativa documentada.

### 5.3 RPCs que exigem motivo

```sql
create or replace function rpc_salvar_lancamento(
  p_lancamento jsonb,
  p_rateio     jsonb,
  p_motivo     text default null
) returns uuid as $$
declare v_id uuid := (p_lancamento->>'id')::uuid;
begin
  if v_id is not null and coalesce(trim(p_motivo),'') = '' then
    raise exception 'Informe o motivo da alteração.' using errcode = 'P0001';
  end if;
  perform set_config('app.motivo', coalesce(p_motivo,''), true);
  perform set_config('app.tela', 'lancamento', true);
  -- upsert do cabeçalho, replace do rateio, recálculo dos valores com maior resto
  ...
  return v_id;
end $$ language plpgsql security definer;

create or replace function rpc_estornar_lancamento(p_id uuid, p_motivo text)
returns void as $$
begin
  if coalesce(trim(p_motivo),'') = '' then
    raise exception 'Informe o motivo do estorno.';
  end if;
  perform set_config('app.motivo', p_motivo, true);
  perform set_config('app.tela', 'lancamento', true);
  update lancamentos
     set status = 'estornado', estornado_em = now(),
         estornado_por = auth.uid(), motivo_estorno = p_motivo
   where id = p_id and status <> 'estornado';
end $$ language plpgsql security definer;
```

**Lançamento nunca é apagado.** "Excluir" na interface chama o estorno: o registro continua no banco com status `estornado`, sai de todos os indicadores e continua visível no histórico com o motivo. Exclusão física só existe para rascunhos nunca confirmados.

### 5.4 Permissões (RLS)

```sql
alter table lancamentos enable row level security;

create policy lanc_leitura on lancamentos for select using (
  exists (select 1 from usuarios u where u.id = auth.uid()
          and (u.perfil in ('admin','financeiro','socio','leitura')
               or exists (select 1 from lancamento_rateio r
                           where r.lancamento_id = lancamentos.id
                             and r.advogado_id = u.advogado_id)))
);

create policy lanc_escrita on lancamentos for all using (
  exists (select 1 from usuarios u where u.id = auth.uid()
          and u.perfil in ('admin','financeiro'))
);
```

| Perfil | Cadastros | Lançar | Alterar/estornar | Dashboard | Logs | Exportar |
|---|---|---|---|---|---|---|
| admin | sim | sim | sim | completo | completo | sim |
| financeiro | sim | sim | sim | completo | completo | sim |
| socio | leitura | não | não | completo | completo | sim |
| advogado | leitura | não | não | só os próprios números | só os próprios registros | próprios |
| leitura | leitura | não | não | completo | não | não |

---

## 6. Identidade visual

### 6.1 Direção

O vocabulário do escritório de advocacia dá a matéria-prima: papel de autos, tinta, carimbo de protocolo, ficha encadernada. A interface é **tinta sobre papel** — densa, silenciosa, com hierarquia feita por peso tipográfico e espaço, não por cor. A única cor forte do sistema é o bordô de carimbo, reservado a estorno e exclusão, o que faz esses momentos pesarem visualmente tanto quanto pesam na prática.

A ousadia fica concentrada em **um elemento**: a barra de rateio da tela de lançamento (seção 7.5). Todo o resto é contido.

**O que foi descartado e por quê:** o par bege-creme com serifada de alto contraste e acento terracota é hoje o visual padrão de interface gerada por IA e não diz nada sobre advocacia; dourado sobre preto é o clichê de "escritório premium" e envelhece mal em tela densa; o kit de cartões arredondados idênticos com sombra cinza esconde hierarquia justamente onde ela importa — um lançamento de R$ 180 mil não pode ter o mesmo peso visual de um de R$ 800.

### 6.2 Tokens

```css
:root {
  /* tinta — autoridade, texto, estrutura */
  --tinta-900:  #12332C;   /* títulos, valores, rail de navegação */
  --tinta-700:  #1F4A40;   /* botão primário, links */
  --tinta-500:  #35675B;   /* ícones ativos, segmentos de rateio */
  --tinta-300:  #7FA096;   /* segmentos secundários de rateio */

  /* papel — superfícies */
  --papel:      #F3F5F4;   /* fundo da aplicação */
  --papel-alto: #FFFFFF;   /* fichas, tabelas, modais */
  --papel-baixo:#E8EDEA;   /* cabeçalho de tabela, campos desabilitados */
  --linha:      #DCE2DF;   /* divisórias de 1px */

  /* texto */
  --texto:      #12332C;
  --texto-2:    #4A5A54;   /* rótulos, metadados */
  --texto-3:    #7C8A84;   /* placeholder, texto desabilitado */

  /* sinalização — uso restrito */
  --carimbo:    #8C2D26;   /* estorno, exclusão, erro */
  --carimbo-bg: #F7EBE9;
  --ambar:      #9C6F1C;   /* percentual alterado manualmente, pendência */
  --ambar-bg:   #FAF2E2;
  --confirma:   #2E7D62;   /* recebido, salvo */

  /* forma */
  --raio-ficha: 3px;       /* praticamente reto: ficha de papel, não cartão de app */
  --raio-campo: 2px;
  --raio-pilula:999px;     /* só em selos de status */
  --sombra-modal: 0 24px 48px -12px rgba(18,51,44,.28);
  --sombra-ficha: none;    /* fichas se separam por borda e fundo, não por sombra */

  /* ritmo — base 4 */
  --e1:4px; --e2:8px; --e3:12px; --e4:16px; --e5:24px; --e6:32px; --e7:48px;
}
```

Modo escuro fica fora do escopo da fase 1. O uso é diurno, em escritório, majoritariamente em desktop.

### 6.3 Tipografia

| Papel | Família | Uso |
|---|---|---|
| Títulos, números monetários em destaque | **Spectral** (400 / 600) | nome da tela, valor total do lançamento, KPIs do painel |
| Interface, tabelas, formulários | **IBM Plex Sans** (400 / 500 / 600) | tudo o mais |

```css
.valor-destaque { font-family: Spectral, Georgia, serif; font-size: 2.5rem;
                  font-weight: 600; letter-spacing: -.01em; font-variant-numeric: lining-nums; }
table, .campo-valor, .campo-percentual { font-variant-numeric: tabular-nums; }
```

Escala: 12 / 13 / 14 / 16 / 20 / 26 / 40 px. Corpo de tabela em 14 px com `line-height: 1.45`. Rótulos de campo em 13 px, peso 500, em caixa de frase — **não** em caixa alta.

`tabular-nums` em toda coluna numérica é obrigatório: é o que faz os centavos alinharem verticalmente e permite conferir uma coluna de valores com o olho, do jeito que o financeiro já faz no papel.

### 6.4 Movimento

Transições respondem a ação do usuário e nada mais: abertura de gaveta (180 ms, `cubic-bezier(.2,.8,.2,1)`), realce de linha recém-salva (fundo `--confirma` a 8% desaparecendo em 1,2 s), redesenho da barra de rateio (120 ms). Nada de entrada em cascata ao carregar a página. `@media (prefers-reduced-motion: reduce)` zera tudo.

---

## 7. Telas

### 7.1 Estrutura geral

```
┌────┬──────────────────────────────────────────────────────────────┐
│    │  Lançamentos            [busca /]   [período ▾]   Marina ▾  │
│ ▦  ├──────────────────────────────────────────────────────────────┤
│ ✎  │                                                              │
│ ⚖  │   conteúdo da tela (máx. 1280 px, respiro lateral de 32 px)  │
│ 👤 │                                                              │
│ ▤  │                                                              │
│ ⧉  │                                                              │
└────┴──────────────────────────────────────────────────────────────┘
 rail 64 px (expande para 232 px ao passar o mouse ou com Ctrl+B)
```

Ordem do rail, por frequência de uso: **Lançar · Painel · Clientes · Advogados · Tabelas · Registro de alterações**. O item ativo recebe uma barra de 3 px em `--tinta-500` à esquerda e fundo `--tinta-900` mais claro — sem ícone colorido nem pílula.

Barra superior fixa com: título da tela, busca global (atalho `/`), seletor de período que persiste entre telas, e menu do usuário.

### 7.2 Advogados

**Lista.** Tabela com nome, OAB, percentual padrão, papel preferencial, nº de lançamentos no período, valor recebido no período, situação. Busca incremental, filtro por situação, ordenação por qualquer coluna. Linha inativa aparece com texto em `--texto-3` e selo "inativo".

**Ficha (gaveta lateral de 560 px).** Três blocos:

1. *Identificação* — nome, OAB (número + UF), CPF/CNPJ com máscara e validação de dígito, e-mail, telefone.
2. *Repasse* — percentual padrão, papel preferencial, dados bancários e chave PIX.
3. *Percentuais por combinação* — tabela editável de exceções (tipo de processo × tipo de serviço × percentual). Botão "adicionar exceção" abre uma linha nova com dois seletores e um campo de percentual. É aqui que se cadastra "neste advogado, trabalhista por êxito é 40%, o resto é 30%".

Advogado com lançamento vinculado **não pode ser excluído** — apenas inativado, e a inativação pede motivo. Inativo some dos seletores de novos lançamentos mas continua nos históricos e relatórios.

### 7.3 Tabelas (tipos de processo e de serviço)

Tela única com duas abas. Lista simples com código, nome, área/natureza, percentual sugerido, situação e ordem de exibição (arrastável). Edição em linha, sem gaveta — são cadastros curtos e estáveis.

### 7.4 Clientes

**Lista.** Nome, CPF/CNPJ, cidade/UF, **quem indicou**, percentual de indicação, total faturado no período, último lançamento.

**Ficha.** Identificação, contato, e o bloco *Origem*: seletor de advogado indicador (busca por nome/OAB), percentual de indicação e campo livre de origem. Ao escolher o indicador, o sistema mostra a prévia: "toda vez que este cliente for lançado, X entra no rateio com N% como indicação — é possível remover linha a linha no lançamento".

Abaixo, histórico dos últimos lançamentos do cliente com link direto para edição.

### 7.5 Lançamento — a tela central

É a tela que define o sistema. Meta: **lançamento comum concluído em menos de 20 segundos, sem mouse.**

```
┌─ Novo lançamento ────────────────────────────┬─ Rateio ──────────────────┐
│                                              │                           │
│ Cliente        [ Construtora Aurora    ▾ ]   │  R$ 45.000,00             │
│ Processo       [ 0801234-55.2024.8.09  ▾ ]   │  ▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒░░░░░░░   │
│ Tipo processo  [ Trabalhista           ▾ ]   │                           │
│ Tipo serviço   [ Êxito                 ▾ ]   │  R. Andrade    30%  13.500│
│ Competência    [ 14/09/2026            📅]   │  C. Mendes     10%   4.500│
│ Pagamento      [ 14/09/2026            📅]   │  P. Lima (ind)  5%   2.250│
│ Forma          [ PIX                   ▾ ]   │  ─────────────────────────│
│                                              │  Escritório    55%  24.750│
│ Valor bruto    [ R$      45.000,00       ]   │                           │
│ ▸ descontar da base do rateio                │  Salvar (Ctrl+S)          │
│                                              │  Salvar e novo (Ctrl+↵)   │
│ Advogados                          + Alt+A   │                           │
│ ┌──────────────────────────────────────────┐ │                           │
│ │ [R. Andrade ▾][Responsável ▾][30,0 🔒][×]│ │                           │
│ │ [C. Mendes  ▾][Parceria    ▾][10,0 🔒][×]│ │                           │
│ │ [P. Lima    ▾][Indicação   ▾][ 5,0 🔒][×]│ │                           │
│ └──────────────────────────────────────────┘ │                           │
│ Descrição      [                         ]   │                           │
└──────────────────────────────────────────────┴───────────────────────────┘
```

**Comportamento dos campos**

- Todo seletor é um *combobox* com busca: digitar filtra, `↓/↑` navega, `Enter` escolhe, `Tab` avança. Nunca é preciso abrir lista com o mouse.
- Ao escolher o **cliente**: preenche o tipo de processo e o tipo de serviço mais usados por ele nos últimos 12 meses, carrega os processos ativos no seletor seguinte e, se houver indicador, insere a linha de indicação já com o percentual.
- Ao escolher o **processo**: fixa o tipo de processo e o cliente.
- Ao escolher tipo de processo/serviço: **recalcula os percentuais sugeridos** de todas as linhas de rateio pela ordem de resolução da seção 4.4.
- **Valor**: máscara monetária pt-BR digitando da direita para a esquerda (`4500000` vira `R$ 45.000,00`). Aceita colar valor com ou sem separadores.
- "Descontar da base" abre um campo de dedução com justificativa curta (custas, taxa de cartão, repasse a terceiro). A barra de rateio passa a mostrar bruto e base lado a lado.

**Campo de percentual — o pedido central**

Cada linha nasce com o percentual padrão preenchido e **bloqueado**, com um cadeado discreto ao lado. Um clique no cadeado, ou `Enter` com o campo focado, libera a digitação. Quando o valor digitado difere do sugerido:

- o campo ganha borda e selo em `--ambar` com o texto "alterado";
- ao passar o mouse, aparece "padrão: 30% · alterado para 35%";
- `origem_percentual` vai para `manual` e isso alimenta o indicador "% de lançamentos fora do padrão" no painel;
- se o lançamento **já existia**, salvar exige o pop-up de motivo (7.6).

Clicar de novo no cadeado restaura o valor sugerido.

**Linhas de advogados**

Quantidade livre. `Alt+A` adiciona linha e já foca o seletor de advogado. `×` remove. Papel padrão vem de `advogados.papel_preferencial`. O mesmo advogado pode aparecer duas vezes desde que com papéis diferentes (ex.: responsável + indicação); repetição de advogado e papel é bloqueada na hora, com aviso na própria linha.

**Barra de rateio (o elemento de destaque)**

Barra horizontal única, largura total do painel, dividida em segmentos proporcionais ao percentual. Advogados em tons da família tinta, do mais escuro (maior fatia) ao mais claro; o residual do escritório em hachura diagonal fina sobre `--papel-baixo`, deixando claro que é sobra calculada e não fatia atribuída. Cada segmento tem rótulo com nome, percentual e valor em reais.

Ela redesenha a cada tecla. Se a soma passar de 100%, a barra estoura o contêiner com a faixa excedente em `--carimbo` listrado e o botão de salvar desabilita com a mensagem "a soma dos percentuais é 105%. Ajuste para no máximo 100%." — a mensagem diz o número atual, não apenas que está errado.

**Atalhos**

| Tecla | Ação |
|---|---|
| `Ctrl+S` | salvar |
| `Ctrl+Enter` | salvar e abrir novo lançamento com cliente e tipos mantidos |
| `Alt+A` | adicionar advogado ao rateio |
| `Alt+D` | duplicar o último lançamento salvo |
| `/` | busca global |
| `Esc` | fechar gaveta/modal sem salvar (pede confirmação se houver alteração) |

**Lançamentos recentes, na mesma tela**

Abaixo do formulário, tabela dos últimos lançamentos com número, data, cliente, tipo, valor, advogados (avatares com iniciais), status e a coluna de ações. É por aqui que se corrige o que foi lançado errado, sem sair da tela:

- **clique na linha** → abre em modo edição no formulário acima, rolando a página para o topo e destacando a ficha com borda em `--tinta-500` e o selo "editando #001428";
- **duplo clique em uma célula de valor ou percentual** → edição direta na linha, para o caso mais comum (digitou 4.500 em vez de 45.000);
- **menu de ações** (`⋯`) → duplicar, estornar, ver histórico de alterações deste lançamento;
- filtro rápido por "meus lançamentos de hoje", "alterados", "estornados";
- toda linha estornada permanece visível, com texto riscado, selo em `--carimbo` e o motivo acessível ao passar o mouse.

**Rascunho automático.** O formulário salva estado em `sessionStorage` a cada 2 s. Fechou o navegador por engano, ao voltar aparece a faixa "há um lançamento não concluído de Construtora Aurora — retomar / descartar".

### 7.6 Pop-up de motivo

Modal de 520 px, foco preso, `Esc` cancela. Aparece em: alteração de lançamento já salvo, estorno, exclusão de qualquer cadastro, inativação de advogado ou cliente, alteração de percentual padrão e remoção de linha de indicação.

```
┌─ Confirmar alteração ───────────────────────────┐
│ Lançamento #001428 — Construtora Aurora         │
│                                                 │
│ O que muda                                      │
│   Valor bruto     R$ 45.000,00 → R$ 54.000,00   │
│   R. Andrade %    30,0 → 35,0                   │
│   R. Andrade R$   13.500,00 → 18.900,00         │
│                                                 │
│ Motivo da alteração *                           │
│ [ Correção de nota fiscal ▾ ]                   │
│ [                                             ] │
│ [                                             ] │
│                             mínimo 10 caracteres│
│                                                 │
│              [ Cancelar ]  [ Salvar alteração ] │
└─────────────────────────────────────────────────┘
```

- O bloco "o que muda" é gerado por diferença entre o estado original e o atual, campo a campo, incluindo os valores recalculados do rateio. O usuário vê exatamente o que vai gravar.
- O seletor traz motivos frequentes (correção de digitação, correção de nota fiscal, renegociação com o cliente, acordo de rateio revisto, estorno por devolução, lançamento em duplicidade) **e** aceita texto livre. O texto livre é obrigatório, mínimo de 10 caracteres, e o botão só habilita quando preenchido.
- No estorno, o botão fica em `--carimbo` e o texto é "Estornar lançamento" — a ação mantém o mesmo nome do início ao fim, inclusive no aviso de confirmação.
- O motivo vai para `logs_auditoria.motivo` via `set_config`, junto do diff completo.

### 7.7 Registro de alterações (logs)

Tela única para o histórico de **todas** as telas.

**Filtros:** período (com presets), usuário, tela, entidade, ação, e busca livre dentro do motivo e dos dados (`jsonb_path_ops` no índice, então busca por "Aurora" encontra o log mesmo sem o registro existir mais).

**Lista:** linha do tempo agrupada por dia. Cada item mostra horário, autor, ação com selo colorido (`INSERT` neutro, `UPDATE` âmbar, `DELETE`/estorno bordô), a referência legível do registro e a primeira linha do motivo.

**Detalhe (expansão da linha):** diff em duas colunas, "antes" e "depois", com apenas os campos alterados em destaque e os demais recolhidos. Valores monetários e percentuais formatados; `jsonb` cru disponível num "ver dados técnicos" para o perfil admin.

**Histórico por registro:** qualquer ficha ou lançamento tem "ver histórico", que abre esta mesma tela já filtrada naquele `registro_id`. É o caminho mais usado na prática — ninguém abre o log inteiro, abre o log de um lançamento específico.

Exportação do log filtrado em Excel, registrada ela própria como `EXPORT` no log.

---

## 8. Painel de indicadores

> **Reconciliar com `Contabilidade 2025.pptx`.** O conjunto abaixo é a proposta; ao receber o arquivo, alinhar nomenclatura, fórmulas e ordem de apresentação, mantendo os nomes que os advogados já usam.

### 8.1 Faixa de indicadores

Oito números no topo, em duas linhas de quatro. Cada um traz o valor em Spectral 40 px, o rótulo em 13 px e a variação contra o período anterior em texto pequeno — sem seta colorida gigante, sem cartão com sombra.

| Indicador | Fórmula |
|---|---|
| Honorários no período | `Σ valor_bruto` de lançamentos não estornados |
| Base de rateio | `Σ valor_base` |
| Repasse a advogados | `Σ lancamento_rateio.valor` |
| Retenção do escritório | `base − repasse`, com o % ao lado |
| Ticket médio | `honorários ÷ nº de lançamentos` |
| Receita por indicação | `Σ` rateio com papel `indicacao`, e quanto isso representa do total |
| Fora do padrão | % de linhas com `origem_percentual = 'manual'` |
| Prazo médio de recebimento | média de `data_pagamento − data_competencia` em dias |

Indicadores de qualidade, em linha secundária menor: nº de estornos e valor estornado, lançamentos sem processo vinculado, clientes novos no período.

### 8.2 Gráficos

1. **Evolução mensal (13 meses).** Colunas de honorários + linha de retenção do escritório, com o mesmo período do ano anterior em contorno claro atrás. Responde "estamos melhores que ano passado" sem exigir contas.
2. **Onde o escritório ganha.** Mapa de calor tipo de processo × tipo de serviço, valor por célula. É o gráfico que costuma mudar decisão de alocação de equipe.
3. **Ranking de advogados.** Barras horizontais ordenadas por repasse, com o percentual médio praticado ao lado de cada nome.
4. **Concentração de clientes (Pareto).** Barras dos 10 maiores + linha de percentual acumulado. Mostra dependência de poucos clientes.
5. **Indicação × carteira própria.** Barras empilhadas mensais, para medir o retorno do programa de indicação.
6. **Composição por tipo de processo.** Barras horizontais ordenadas — não pizza; pizza com sete fatias não é comparável a olho.

**Cruzamento de filtros.** Clicar em qualquer elemento de gráfico filtra todo o painel por aquele valor, acrescentando um selo removível na barra de filtros. Dois cliques voltam ao estado anterior.

### 8.3 Filtros

Barra fixa acima dos indicadores: período (mês atual, mês anterior, trimestre, ano, 12 meses, personalizado), advogado (múltipla), cliente (múltipla), tipo de processo, tipo de serviço, papel no rateio, status, forma de pagamento, faixa de valor, e duas chaves — "incluir estornados" e "somente alterados manualmente".

O estado dos filtros vive na URL (`#/painel?de=2026-01-01&ate=2026-09-14&adv=uuid,uuid`). Consequências práticas: o link colado no WhatsApp abre o painel exatamente igual para o sócio, o botão voltar do navegador funciona, e as exportações recebem exatamente o mesmo conjunto de filtros que está na tela.

### 8.4 Desempenho do painel

- Uma única chamada `rpc_painel(p_filtros jsonb)` devolve indicadores e todas as séries em um `jsonb`. Nada de seis requisições paralelas.
- Meses fechados vêm de `mv_honorarios_mensal` (materialized view, refresh por `pg_cron` a cada 15 min); o mês corrente é calculado ao vivo e unido no `union all`. Painel de 12 meses responde abaixo de 300 ms com 50 mil lançamentos.
- Biblioteca de gráficos: **Apache ECharts** — canvas (rápido com muitos pontos), `getDataURL()` pronto para embutir no PowerPoint e tema customizável para os tokens da seção 6.2.
- Nenhuma agregação no navegador. O Postgres agrega, o JS desenha.

---

## 9. Exportações

Ambas as rotas recebem o mesmo objeto de filtros da tela e **reconsultam o banco no servidor** com `service_role`. O client nunca envia os dados a exportar — envia o recorte. Isso garante que a planilha e o deck batem com o banco, não com o que estava em cache na tela.

### 9.1 Excel — `POST /api/export-xlsx`

Biblioteca: **ExcelJS**. Abas:

| Aba | Conteúdo |
|---|---|
| Resumo | os oito indicadores, período e filtros aplicados por extenso |
| Lançamentos | uma linha por lançamento, com todas as colunas e os advogados concatenados |
| Rateio | uma linha por advogado por lançamento — é a aba que o financeiro usa para conferir repasse |
| Por advogado | consolidado: valor, nº de lançamentos, % médio, participação |
| Por tipo | matriz processo × serviço |
| Parâmetros | filtros, usuário que exportou, data e hora |

Formatação: cabeçalho em `--tinta-900` com texto branco, painel congelado na primeira linha, autofiltro, `R$ #,##0.00` nas colunas monetárias, `0,0%` nos percentuais, largura ajustada ao conteúdo, linha de totais com fórmula `SUBTOTAL(109;...)` — que recalcula quando o usuário filtra dentro do Excel.

Nome do arquivo: `honorarios_2026-01-a-2026-09_gerado-14-09-2026.xlsx`.

### 9.2 PowerPoint — `POST /api/export-pptx`

Biblioteca: **PptxGenJS**, 16:9, com master aplicando a paleta e a tipografia da seção 6 (substituir pelo master do `Contabilidade 2025.pptx` quando o arquivo chegar).

Sequência de slides:

1. **Capa** — período, data de geração, filtros aplicados.
2. **Resumo executivo** — os oito indicadores + um parágrafo de leitura do período.
3. **Evolução mensal** — gráfico nativo de colunas + linha, editável dentro do PowerPoint.
4. **Onde o escritório ganha** — mapa de calor como imagem PNG em alta (`getDataURL({pixelRatio:3})`), já que o tipo não existe nativamente.
5. **Ranking de advogados** — gráfico de barras nativo + tabela dos 10 primeiros.
6. **Concentração de clientes** — Pareto.
7. **Indicação** — retorno do programa.
8. **Observações** — estornos, lançamentos fora do padrão, pendências de repasse.

**Descrição automática de cada slide.** Bloco de texto abaixo do gráfico, gerado a partir dos próprios números: variação contra o período anterior, maior contribuição, concentração e desvio relevante. Exemplo do que sai:

> Setembro fechou em R$ 312.400, 18% acima de agosto e o melhor mês do ano. Trabalhista por êxito respondeu por 41% do total. Os três maiores clientes concentraram 52% da receita — participação 9 pontos acima da média dos últimos doze meses.

Regras determinísticas cobrem o caso padrão. Com `ANTHROPIC_API_KEY` configurada, `/api/narrativa` reescreve os parágrafos com mais fluidez a partir dos mesmos números — os números nunca são gerados pelo modelo, apenas o texto ao redor.

---

## 10. Desempenho e usabilidade

**Metas mensuráveis**

| Métrica | Alvo |
|---|---|
| Carregamento inicial (LCP, 4G) | < 1,5 s |
| Resposta a interação (INP) | < 200 ms |
| JS na primeira carga | < 160 KB comprimido |
| Salvar lançamento | < 400 ms do `Ctrl+S` ao selo de confirmação |
| Painel de 12 meses | < 500 ms |
| Lançamento completo por usuário treinado | < 20 s |

**Como chegar lá**

- ECharts importado apenas na rota do painel (`import()` dinâmico); ExcelJS e PptxGenJS ficam no servidor e nunca chegam ao navegador.
- Cadastros (advogados, clientes, tipos) carregados uma vez por sessão em `Map` na memória e revalidados por `postgres_changes` do Supabase Realtime — os comboboxes filtram localmente, sem ida ao servidor a cada tecla.
- Tabelas com mais de 200 linhas usam janela virtual; abaixo disso, DOM direto.
- Gravação otimista: a linha aparece na lista assim que o `Ctrl+S` é acionado, com o número definitivo chegando do servidor logo depois. Se falhar, a linha volta destacada em `--carimbo` com "não foi salvo — tentar de novo", e os dados continuam no formulário.
- Fontes com `font-display: swap` e `preconnect`; ícones em sprite SVG inline, sem biblioteca de ícones.

**Acessibilidade e robustez**

Navegação completa por teclado com foco sempre visível (contorno de 2 px em `--tinta-700`), contraste mínimo 4,5:1 em todo texto, rótulo associado a cada campo, erro anunciado por `aria-live`, `prefers-reduced-motion` respeitado. Erro nunca se desculpa nem generaliza: diz o que aconteceu e o que fazer.

---

## 11. Segurança

- RLS ativa em todas as tabelas; `anon key` no client, `service_role` só em Serverless Function.
- Toda escrita passa por RPC `security definer` com validação no servidor. Percentual, soma e cálculo de valores nunca confiam no que veio do navegador.
- `logs_auditoria` sem política de `update` ou `delete` para qualquer perfil.
- Sessão expira em 8 horas; reautenticação para alterar percentual padrão ou estornar lançamento acima de um valor a definir.
- LGPD: CPF/CNPJ e dados bancários só visíveis a `admin` e `financeiro` (mascarados nos demais perfis via view); exportação de dados pessoais registrada no log.
- Backup: point-in-time recovery do Supabase ativado, com teste de restauração trimestral.

---

## 12. Estrutura do repositório

```
honorarios-adv/
├── public/
│   ├── index.html                # shell + rail + área de conteúdo
│   ├── assets/
│   │   ├── css/  tokens.css  base.css  componentes.css  telas.css
│   │   ├── fonts/
│   │   └── icones.svg
│   └── js/
│       ├── app.js                # roteador por hash, sessão, layout
│       ├── supabase.js           # cliente único
│       ├── store.js              # cache de cadastros + realtime
│       ├── formato.js            # moeda, percentual, data, CPF/CNPJ
│       ├── componentes/
│       │   ├── combobox.js  gaveta.js  modal-motivo.js
│       │   ├── tabela.js    barra-rateio.js  selo.js  toast.js
│       └── telas/
│           ├── lancamento.js  advogados.js  clientes.js
│           ├── tabelas.js     logs.js       painel.js
├── api/
│   ├── export-xlsx.js
│   ├── export-pptx.js
│   └── narrativa.js
├── supabase/
│   ├── migrations/
│   │   ├── 001_tipos.sql          004_lancamentos.sql
│   │   ├── 002_cadastros.sql      005_auditoria.sql
│   │   ├── 003_clientes.sql       006_views_painel.sql
│   │   └── 007_rls.sql            008_rpcs.sql
│   └── seed.sql                   # tipos de processo/serviço iniciais
├── vercel.json
└── README.md
```

`vercel.json` com `cleanUrls`, cabeçalhos de cache (`immutable` para assets versionados, `no-store` para `index.html`) e CSP restringindo `connect-src` ao domínio do Supabase.

---

## 13. Fases de entrega

| Fase | Entrega | Critério de conclusão |
|---|---|---|
| 1 | Banco completo, migrations, RLS, seed | `supabase db reset` reconstrói tudo do zero |
| 2 | Shell, login, cadastros de advogado/cliente/tipos | um usuário cadastra sem ajuda |
| 3 | Tela de lançamento com rateio e barra | lançamento em menos de 20 s, soma sempre exata |
| 4 | Edição, estorno, pop-up de motivo, logs | nenhuma alteração entra sem motivo registrado |
| 5 | Painel com filtros e cruzamento | carrega em menos de 500 ms com dados reais |
| 6 | Exportações Excel e PowerPoint | planilha confere com a tela, centavo a centavo |
| 7 | Migração dos dados de 2025 e ajuste fino | fechamento do mês feito integralmente no sistema |

---

## 14. Checklist de aceite

- [ ] Soma dos rateios é sempre igual ao valor da base, sem sobra de centavo, em 100 lançamentos de teste com percentuais quebrados (33,33% / 33,33% / 33,34%).
- [ ] Percentual padrão aparece preenchido e bloqueado; desbloqueio permite digitar; alteração fica marcada e rastreada.
- [ ] Número livre de advogados por lançamento, incluindo o mesmo advogado em papéis diferentes.
- [ ] Nenhuma alteração ou estorno é gravado sem motivo com pelo menos 10 caracteres.
- [ ] Lançamento estornado desaparece dos indicadores e permanece no histórico com o motivo.
- [ ] Log mostra o antes e o depois campo a campo, para todas as telas, com filtro e busca por motivo.
- [ ] Advogado só enxerga os próprios números (testar com login de perfil `advogado`).
- [ ] Excel abre com totais que batem com o painel; PowerPoint sai com gráficos e descrições corretas.
- [ ] Painel responde abaixo de 500 ms com 12 meses de dados reais.
- [ ] Toda a tela de lançamento é operável apenas pelo teclado.

---

## 15. Para fechar a versão 1.1

1. **`Contabilidade 2025.pptx`** — reconciliar indicadores, nomes e identidade do deck com a seção 8 e com o master de exportação da 9.2.
2. Confirmar as premissas P2 a P4 da seção 2.
3. Lista real dos tipos de processo e de serviço usados hoje, para o `seed.sql`.
4. Definir o valor a partir do qual o estorno exige reautenticação.
