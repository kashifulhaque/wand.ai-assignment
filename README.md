# wand.ai assignment

**[Loom video](https://www.loom.com/share/7f998ee611f649b38f75df60d8b40ad5?sid=1a6d131e-b172-4e52-afc5-a4f37ce5d72c)**

This project is a **document-aware Q&A system** with feedback loops and external enrichment.

It combines:
* **FastAPI backend** for PDF upload, embedding, search, and Q&A.
* **Next.js (Bun) frontend** for a lightweight UI.
* **Qdrant (in-memory)** for semantic search.
* **SentenceTransformers** for embeddings.
* **OpenRouter-hosted LLMs** (OpenAI + GPT-4o-mini) for answer generation and completeness analysis.

---

## Design Decisions

* **Vector search (Qdrant in-memory)**
  Kept ephemeral/in-memory to stay lightweight. Persisting to disk or external DB would be production-ready, but unnecessary under the time cap.

* **PDF text extraction with `fitz` (PyMuPDF)**
  Chosen for speed and reliability over rolling custom parsers. Trade-off: no table/figure handling, just text chunks.

* **Chunking strategy (500 characters)**
  Fixed size chunks make embedding simple. A smarter split (semantic segmentation, overlap windows) would improve retrieval but was skipped for time.

* **Completeness analysis via LLM**
  Instead of hand-crafted heuristics, the system asks an LLM to judge answer confidence and highlight missing info. This gave flexibility at the cost of extra API calls.

* **External enrichment (Wikipedia/ArXiv)**
  Added as a proof-of-concept auto-fetch layer. In practice, only Wikipedia integration was fully wired up due to time.

* **Feedback loop**
  Feedback vectors (query + answer + rating) are embedded and stored in Qdrant. This lays groundwork for RLHF-like improvements, though no model fine-tuning is wired yet.

---

## Trade-offs

* **Minimal frontend**: simple upload + query UI. No styling polish or authentication.
* **No persistent storage**: Qdrant runs in-memory, uploads live on local volume. Restart = clean slate.
* **Limited enrichment**: Only Wikipedia tested; ArXiv integration left stubbed.
* **Simplified deployment**: Docker Compose manages backend + frontend only, no dedicated Qdrant container.
* **Single-user assumption**: No scaling or concurrency stress testing.

---

## Running Locally

### Requirements

* [Docker](https://docs.docker.com/get-docker/) + [Docker Compose](https://docs.docker.com/compose/)
* [OpenRouter API key](https://openrouter.ai/)

### 1. Clone repo & set environment

```bash
git clone https://github.com/kashifulhaque/wand.ai-assignment
cd https://github.com/kashifulhaque/wand.ai-assignment
export OPENROUTER_API_KEY=sk-or-v1-XXXXXX
```

### 2. Start containers

```bash
docker compose up --build -d
```

* Backend: [http://localhost:8000](http://localhost:8000)
* Frontend: [http://localhost:3000](http://localhost:3000)

### 3. Test the flow

1. **Upload a PDF**

   ```bash
   curl -F "file=@example.pdf" http://localhost:8000/upload/
   ```

2. **Embed it**

   ```bash
   curl -X POST "http://localhost:8000/embed/" -H "Content-Type: application/json" \
     -d '{"filenames": ["example.pdf"]}'
   ```

3. **Ask a question**

   ```bash
   curl -X POST "http://localhost:8000/qa/enhanced/" -H "Content-Type: application/json" \
     -d '{"query": "What is the main topic of the paper?"}'
   ```

   → Returns answer, confidence, missing info, enrichment suggestions.

4. **Submit feedback**

   ```bash
   curl -X POST "http://localhost:8000/feedback/" -H "Content-Type: application/json" \
     -d '{"query":"...","answer":"...","rating":4}'
   ```

Or, just open the frontend at [http://localhost:3000](http://localhost:3000) to upload & query interactively.

---

## Future Improvements

* Persist Qdrant to disk or external DB.
* Smarter chunking (overlap + semantic splits).
* Enrichment beyond Wikipedia (ArXiv, news, domain-specific).
* Frontend UX polish + history view.
* Multi-user support, auth, and rate-limits.
