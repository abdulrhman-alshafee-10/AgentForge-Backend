# Phase 06 — RAG (Retrieval Augmented Generation)

## Overview

Add document ingestion and retrieval. Users upload PDF, TXT, or Markdown files. The system extracts text, chunks it, embeds each chunk, and stores vectors in `pgvector`. A retrieval service returns top-K chunks for a query, scoped to the tenant.

## Learning objectives

- Design an ingestion pipeline: upload → extract → chunk → embed → store.
- Choose chunking strategies and understand their trade-offs.
- Work with embedding models and vector dimensionality.
- Query `pgvector` efficiently with the right index type.

## Concepts to study

- Text extraction libraries for PDF, TXT, Markdown.
- Chunking strategies: fixed-size, sentence-aware, recursive, semantic.
- Overlap between chunks and why it matters.
- Embedding models (OpenAI, Cohere, local) and their dimensions.
- `pgvector` index types (`ivfflat`, `hnsw`) and their parameters.
- Metadata filtering combined with vector search.

## Features to implement

- `DocumentsModule`:
  - `POST /documents` (multipart upload) → creates `Document(UPLOADED)` and enqueues an ingestion job.
  - `GET /documents`, `GET /documents/:id`, `DELETE /documents/:id`, `POST /documents/:id/reindex`.
- Ingestion pipeline (as a service used by a job; the queue infrastructure is fully realized in Phase 09, but a synchronous placeholder is acceptable here):
  1. Load file bytes from storage.
  2. Extract text.
  3. Chunk with configurable strategy and overlap.
  4. Batch-embed chunks.
  5. Insert `Embedding` rows.
  6. Update `Document.status` to `INDEXED`.
- `VectorStoreModule`:
  - `similaritySearch({ tenantId, query, k, filters })` returns chunks with content + metadata.
- `RagModule`:
  - `retrieveContext({ tenantId, query, k })` orchestrates search + optional re-ranking.

## Architecture changes

- Introduce `documents/` and `vector-store/` modules.
- Add an `EmbeddingsProvider` abstraction (swap OpenAI, local, etc.).
- Add object storage adapter (local filesystem for dev, S3-compatible for prod).

## Database changes

- Populate the `Document` and `Embedding` tables.
- Add a `pgvector` index (`ivfflat` with a sensible `lists` value initially).
- Add `Document.status` state transitions.

## Required API endpoints

See Section 8 of `docs/api.md`.

## Acceptance criteria

- Uploading a PDF results in `Document.status = INDEXED` and `Embedding` rows.
- Similarity search returns ranked, tenant-scoped chunks.
- Reindexing replaces old embeddings atomically.
- Deleting a document deletes its embeddings.
- Cross-tenant queries return zero rows.

## Suggested reading

- LangChain documentation: Text Splitters, Retrievers.
- `pgvector` README and its `HNSW` blog posts.
- "Chunking strategies for LLM applications" articles.

## Suggested exercises

1. Add a cross-encoder re-ranker step on top of vector search.
2. Experiment with three chunking strategies and measure retrieval quality on a small evaluation set.
3. Add per-document `metadata` (author, source URL, tags) and support filtering by tags in search.
4. Compare `ivfflat` and `hnsw` performance for your dataset size.
5. Add a "citations" feature: the retrieval service returns chunk IDs; the agent must include them in its final response.
