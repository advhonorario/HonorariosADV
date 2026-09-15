-- Extensões e schema auxiliar
create extension if not exists pgcrypto;

-- Schema para funções auxiliares que não devem ficar expostas pela Data API
create schema if not exists private;

-- Tipos enumerados (especificação §4.1)
create type perfil_usuario     as enum ('admin','financeiro','socio','advogado','leitura');
create type tipo_pessoa        as enum ('fisica','juridica');
create type papel_rateio       as enum ('responsavel','indicacao','parceria','correspondente','sucumbencia');
create type status_lancamento  as enum ('rascunho','confirmado','recebido','estornado');
create type origem_percentual  as enum ('padrao_advogado','padrao_servico','manual');
create type natureza_servico   as enum ('exito','fixo','hora','mensal','consultivo');
create type acao_auditoria     as enum ('INSERT','UPDATE','DELETE','LOGIN','EXPORT');
