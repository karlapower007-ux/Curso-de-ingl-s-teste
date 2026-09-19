-- Consciência do Fabiano - private pgvector mirror
create extension if not exists vector;

create table if not exists public.rag_embeddings (
  id text primary key,
  document_id text not null,
  filename text not null default '',
  title text not null default '',
  author text not null default '',
  language text not null default 'pt',
  page integer not null default 0,
  chunk_index integer not null default 0,
  text text not null,
  embedding vector(384) not null,
  updated_at timestamptz not null default now()
);

create index if not exists rag_embeddings_document_idx
  on public.rag_embeddings(document_id);

alter table public.rag_embeddings enable row level security;
alter table public.rag_embeddings force row level security;

revoke all on table public.rag_embeddings from anon, authenticated;
grant select, insert, update, delete on table public.rag_embeddings to service_role;

drop policy if exists "deny public rag access" on public.rag_embeddings;
create policy "deny public rag access"
  on public.rag_embeddings
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function public.match_rag_embeddings(
  query_embedding vector(384),
  match_count integer default 100
)
returns table (
  id text,
  document_id text,
  filename text,
  title text,
  author text,
  language text,
  page integer,
  chunk_index integer,
  text text,
  score double precision
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,r.document_id,r.filename,r.title,r.author,r.language,
    r.page,r.chunk_index,r.text,
    1 - (r.embedding <=> query_embedding) as score
  from public.rag_embeddings r
  order by r.embedding <=> query_embedding
  limit greatest(1,least(match_count,100));
$$;

revoke all on function public.match_rag_embeddings(vector,integer) from public, anon, authenticated;
grant execute on function public.match_rag_embeddings(vector,integer) to service_role;
