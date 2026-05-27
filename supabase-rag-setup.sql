-- 1. Enable the pgvector extension to work with embedding vectors
create extension if not exists vector;

-- 2. Create the novel_embeddings table
-- This table stores text chunks and their embeddings for Retrieval-Augmented Generation.
create table if not exists novel_embeddings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  novel_id text not null,      -- ID of the rewrite novel
  chapter_id text not null,    -- ID of the chapter this chunk belongs to
  chapter_order int not null,  -- Order of the chapter (to prioritize recent events)
  content text not null,       -- The actual text chunk
  embedding vector(1536) not null, -- Assuming text-embedding-3-small (1536 dims)
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Create an index for faster similarity searches
-- Using ivfflat or hnsw. HNSW is recommended for pgvector > 0.5.0
create index on novel_embeddings using hnsw (embedding vector_cosine_ops);

-- 4. Create a match function for similarity search
-- This function is called from the client via Supabase RPC
create or replace function match_novel_embeddings (
  query_embedding vector(1536),
  match_novel_id text,
  match_user_id uuid,
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  content text,
  chapter_order int,
  similarity float
)
language sql stable
as $$
  select
    novel_embeddings.id,
    novel_embeddings.content,
    novel_embeddings.chapter_order,
    1 - (novel_embeddings.embedding <=> query_embedding) as similarity
  from novel_embeddings
  where novel_embeddings.novel_id = match_novel_id
    and novel_embeddings.user_id = match_user_id
    and 1 - (novel_embeddings.embedding <=> query_embedding) > match_threshold
  order by novel_embeddings.embedding <=> query_embedding
  limit match_count;
$$;

-- 5. Set up Row Level Security (RLS)
alter table novel_embeddings enable row level security;

-- Policy to allow users to insert their own chunks
create policy "Users can insert their own novel embeddings"
on novel_embeddings for insert
with check (auth.uid() = user_id);

-- Policy to allow users to select their own chunks
create policy "Users can read their own novel embeddings"
on novel_embeddings for select
using (auth.uid() = user_id);

-- Policy to allow users to delete their own chunks (useful if chapter is deleted)
create policy "Users can delete their own novel embeddings"
on novel_embeddings for delete
using (auth.uid() = user_id);
