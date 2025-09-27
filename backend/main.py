from dotenv import load_dotenv
load_dotenv()

import os
import json
import requests
from uuid import uuid4
from pathlib import Path
from typing import Dict, List, Optional, Any
from datetime import datetime
from dataclasses import dataclass

import fitz
import torch
from openai import OpenAI
from qdrant_client.http import models
from qdrant_client import QdrantClient
from sentence_transformers import SentenceTransformer
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if torch.cuda.is_available():
    device = "cuda"
elif torch.backends.mps.is_available():
   device = "mps"
else:
    device = "cpu"

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

qdrant = QdrantClient(":memory:")
COLLECTION_NAME = "pdf_chunks"
FEEDBACK_COLLECTION = "answer_feedback"

for collection_name, vector_size in [(COLLECTION_NAME, 384), (FEEDBACK_COLLECTION, 384)]:
    if collection_name not in [c.name for c in qdrant.get_collections().collections]:
        qdrant.recreate_collection(
            collection_name=collection_name,
            vectors_config=models.VectorParams(size=vector_size, distance=models.Distance.COSINE),
        )

embedder = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2", device=device)

llm_client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY")
)

class EnhancedAnswer(BaseModel):
    answer: str
    confidence: float
    missing_info: List[str]
    source_files: List[str]
    enrichment_suggestions: List[Dict[str, Any]]
    relevance_score: float

class FeedbackRequest(BaseModel):
    query: str
    answer: str
    rating: int  # 1-5 scale
    feedback_text: Optional[str] = None

class AutoEnrichmentRequest(BaseModel):
    query: str
    missing_info: List[str]
    max_sources: int = 3

@dataclass
class EnrichmentStrategy:
    strategy_type: str
    description: str
    action: str
    priority: int
    estimated_confidence_boost: float

EXTERNAL_SOURCES = {
    "wikipedia": {
        "base_url": "https://en.wikipedia.org/api/rest_v1/page/summary/",
        "enabled": True
    },
    "arxiv": {
        "base_url": "http://export.arxiv.org/api/query?search_query=",
        "enabled": True
    }
}

def analyze_completeness(query: str, retrieved_docs: List[Dict], answer: str) -> Dict:
    completeness_prompt = f"""
    Analyze the completeness of this Q&A interaction:

    Question: {query}
    Retrieved Documents: {json.dumps(retrieved_docs, indent=2)}
    Generated Answer: {answer}

    Provide a JSON response with:
    {{
        "confidence": <float 0-1>,
        "completeness_score": <float 0-1>,
        "missing_info": [<list of specific missing information>],
        "uncertainty_areas": [<list of areas where information is uncertain>],
        "relevance_score": <float 0-1>,
        "answer_quality": <"excellent"|"good"|"fair"|"poor">
    }}

    Be specific about what information is missing and why the confidence is at that level.
    """

    try:
        completion = llm_client.chat.completions.create(
            model="openai/gpt-5-mini",
            messages=[
                {"role": "system", "content": "You are an expert at analyzing document completeness and answer quality. Always respond with valid JSON."},
                {"role": "user", "content": completeness_prompt}
            ],
            response_format={"type": "json_object"},
            reasoning = { "effort": "minimal" }
        )

        analysis = json.loads(completion.choices[0].message.content)
        return analysis
    except Exception as e:
        print(f"Error in completeness analysis: {e}")
        return {
            "confidence": 0.5,
            "completeness_score": 0.5,
            "missing_info": ["Unable to analyze completeness"],
            "uncertainty_areas": [],
            "relevance_score": 0.5,
            "answer_quality": "fair"
        }

def generate_enrichment_suggestions(query: str, missing_info: List[str], current_docs: List[str]) -> List[Dict]:
    suggestions = []

    # Strategy 1: Document-based enrichment
    if missing_info:
        suggestions.append({
            "type": "document_upload",
            "priority": 1,
            "description": f"Upload documents containing: {', '.join(missing_info[:3])}",
            "action": "Upload additional PDFs with specific focus on the missing topics",
            "estimated_improvement": "High",
            "missing_topics": missing_info
        })

    # Strategy 2: External source enrichment
    for info in missing_info[:2]:  # Top 2 missing info items
        suggestions.append({
            "type": "external_search",
            "priority": 2,
            "description": f"Search external sources for: {info}",
            "action": f"Auto-fetch from Wikipedia/ArXiv about '{info}'",
            "estimated_improvement": "Medium",
            "search_query": info
        })

    # Strategy 3: Query refinement
    suggestions.append({
        "type": "query_refinement",
        "priority": 3,
        "description": "Refine your question to be more specific",
        "action": f"Try asking: '{query} specifically focusing on {missing_info[0] if missing_info else 'key details'}'",
        "estimated_improvement": "Medium"
    })

    # Strategy 4: Multi-source combination
    if len(current_docs) > 1:
        suggestions.append({
            "type": "cross_reference",
            "priority": 4,
            "description": "Cross-reference multiple documents for comprehensive answer",
            "action": "Expand search to retrieve top 3-5 relevant chunks instead of just 1",
            "estimated_improvement": "Medium"
        })

    return suggestions

async def auto_enrich_from_external_sources(query: str, missing_info: List[str], max_sources: int = 2) -> Dict:
    enriched_content = []

    for info_item in missing_info[:max_sources]:
        try:
            wiki_url = f"{EXTERNAL_SOURCES['wikipedia']['base_url']}{info_item.replace(' ', '_')}"
            response = requests.get(wiki_url, timeout=5)

            if response.status_code == 200:
                wiki_data = response.json()
                enriched_content.append({
                    "source": "Wikipedia",
                    "topic": info_item,
                    "content": wiki_data.get("extract", ""),
                    "url": wiki_data.get("content_urls", {}).get("desktop", {}).get("page", "")
                })
        except Exception as e:
            print(f"Error fetching from Wikipedia: {e}")

    if enriched_content:
        await store_enriched_content(enriched_content, query)

    return {
        "enriched_sources": len(enriched_content),
        "content": enriched_content,
        "status": "success" if enriched_content else "no_results"
    }

async def store_enriched_content(enriched_content: List[Dict], original_query: str):
    points = []
    for content in enriched_content:
        if content["content"]:
            chunk_size = 500
            text = content["content"]
            chunks = [text[i:i+chunk_size] for i in range(0, len(text), chunk_size)]

            embeddings = embedder.encode(chunks).tolist()

            for i, (chunk, vector) in enumerate(zip(chunks, embeddings)):
                points.append(models.PointStruct(
                    id=str(uuid4()),
                    vector=vector,
                    payload={
                        "filename": f"enriched_{content['source']}_{content['topic']}",
                        "chunk_id": i,
                        "text": chunk,
                        "metadata": text,
                        "source_type": "external_enrichment",
                        "source_name": content["source"],
                        "original_query": original_query,
                        "enriched_at": datetime.now().isoformat(),
                        "url": content.get("url", "")
                    }
                ))

    if points:
        qdrant.upsert(collection_name=COLLECTION_NAME, points=points)

async def enhanced_search(query: str, limit: int = 5, source: str = "") -> List[Dict]:
    query_vector = embedder.encode([query])[0].tolist()

    results = qdrant.search(
        collection_name=COLLECTION_NAME,
        query_vector=query_vector,
        limit=limit,
    )

    retrieved_docs = []
    for hit in results:
        retrieved_docs.append({
            "filename": hit.payload.get("filename"),
            "text": hit.payload.get("text"),
            "score": hit.score,
            "metadata": hit.payload.get("metadata", ""),
            "source_type": hit.payload.get("source_type", "uploaded_document")
        })

    from pprint import pprint
    print(f" ############# Source: {source}")
    pprint(retrieved_docs)

    return retrieved_docs

@app.post("/upload/")
async def upload_file(file: UploadFile = File(...)):
    file_path = UPLOAD_DIR / file.filename
    contents = await file.read()
    file_path.write_bytes(contents)
    return {"filename": file.filename, "stored_at": str(file_path)}

@app.get("/files/")
async def list_files():
    files = [f.name for f in UPLOAD_DIR.iterdir() if f.is_file()]
    return files

@app.post("/embed/")
async def embed_files(filenames: list[str]):
    results = []

    for filename in filenames:
        file_path = UPLOAD_DIR / filename
        if not file_path.exists():
            results.append({"filename": filename, "status": "File not found"})
            continue

        existing = qdrant.scroll(
            collection_name=COLLECTION_NAME,
            scroll_filter=models.Filter(
                must=[models.FieldCondition(key="filename", match=models.MatchValue(value=filename))]
            ),
            limit=1
        )
        if existing[0]:
            results.append({"filename": filename, "status": "Already embedded"})
            continue

        doc = fitz.open(file_path)
        text_chunks = []
        for page in doc:
            text_chunks.append(page.get_text())
        doc.close()
        full_text = "\n".join(text_chunks)

        if not full_text.strip():
            results.append({"filename": filename, "status": "No extractable text"})
            continue

        chunk_size = 500
        chunks = [full_text[i:i+chunk_size] for i in range(0, len(full_text), chunk_size)]

        embeddings = embedder.encode(chunks).tolist()

        points = []
        for i, (chunk, vector) in enumerate(zip(chunks, embeddings)):
            points.append(models.PointStruct(
                id=str(uuid4()),
                vector=vector,
                payload={
                    "filename": filename,
                    "chunk_id": i,
                    "text": chunk,
                    "metadata": full_text,  # full PDF text as metadata
                    "source_type": "uploaded_document",
                    "uploaded_at": datetime.now().isoformat()
                }
            ))

        qdrant.upsert(collection_name=COLLECTION_NAME, points=points)
        results.append({"filename": filename, "chunks": len(chunks), "status": "Embedded"})

    return results

@app.post("/search/")
async def search(query: str):
    results = await enhanced_search(query, limit=1, source="search")

    if not results:
        raise HTTPException(status_code=404, detail="No results found")

    return results[0]

@app.post("/qa/enhanced/")
async def enhanced_question_answer(query: str, enable_auto_enrichment: bool = True) -> EnhancedAnswer:
    retrieved_docs = await enhanced_search(query, limit=1, source="qa enhanced")

    if not retrieved_docs:
        return EnhancedAnswer(
            answer="I don't have any relevant documents to answer this question.",
            confidence=0.0,
            missing_info=[f"Documents related to: {query}"],
            source_files=[],
            enrichment_suggestions=generate_enrichment_suggestions(query, [f"Information about {query}"], []),
            relevance_score=0.0
        )

    combined_content = "\n\n---\n\n".join([
        f"Source: {doc['filename']}\nContent: {doc['metadata']}"
        for doc in retrieved_docs
    ])
    print(combined_content)

    qa_prompt = f"""
    Based on the following documents, answer the user's question comprehensively.

    Documents:
    {combined_content}

    Question: {query}

    Provide a detailed answer using only the information from the documents. If the documents don't contain enough information, clearly state what is missing.
    """

    completion = llm_client.chat.completions.create(
        model="openai/gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are a helpful assistant that provides comprehensive answers based on provided documents. Be honest about limitations."},
            {"role": "user", "content": qa_prompt}
        ],
    )

    initial_answer = completion.choices[0].message.content

    completeness_analysis = analyze_completeness(query, retrieved_docs, initial_answer)

    enrichment_suggestions = generate_enrichment_suggestions(
        query,
        completeness_analysis.get("missing_info", []),
        [doc["filename"] for doc in retrieved_docs]
    )

    final_answer = initial_answer
    if (enable_auto_enrichment and
        completeness_analysis.get("confidence", 0) < 0.7 and
        completeness_analysis.get("missing_info")):

        try:
            enrichment_result = await auto_enrich_from_external_sources(
                query,
                completeness_analysis["missing_info"][:2]
            )

            if enrichment_result["status"] == "success":
                enriched_docs = await enhanced_search(query, limit=5, source="enrichment")

                enriched_content = "\n\n---\n\n".join([
                    f"Source: {doc['filename']}\nContent: {doc['text']}"
                    for doc in enriched_docs
                ])

                enriched_qa_prompt = f"""
                Based on the following documents (including recently enriched external sources), provide a comprehensive answer:

                Documents:
                {enriched_content}

                Question: {query}

                Note: Some sources may be from external enrichment to fill knowledge gaps.
                """

                enriched_completion = llm_client.chat.completions.create(
                    model="openai/gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": "You are a helpful assistant providing comprehensive answers. Acknowledge when external sources were used to enhance the response."},
                        {"role": "user", "content": enriched_qa_prompt}
                    ],
                )

                final_answer = enriched_completion.choices[0].message.content
                retrieved_docs = enriched_docs  # Update source files

        except Exception as e:
            print(f"Auto-enrichment failed: {e}")

    return EnhancedAnswer(
        answer=final_answer,
        confidence=completeness_analysis.get("confidence", 0.5),
        missing_info=completeness_analysis.get("missing_info", []),
        source_files=[doc["filename"] for doc in retrieved_docs],
        enrichment_suggestions=enrichment_suggestions,
        relevance_score=completeness_analysis.get("relevance_score", 0.5)
    )

@app.post("/enrich/")
async def auto_enrich(request: AutoEnrichmentRequest):
    enrichment_result = await auto_enrich_from_external_sources(
        request.query,
        request.missing_info,
        request.max_sources
    )

    return enrichment_result

@app.post("/feedback/")
async def submit_feedback(feedback: FeedbackRequest):
    feedback_text = f"Query: {feedback.query}\nAnswer: {feedback.answer}"
    feedback_vector = embedder.encode([feedback_text])[0].tolist()

    feedback_point = models.PointStruct(
        id=str(uuid4()),
        vector=feedback_vector,
        payload={
            "query": feedback.query,
            "answer": feedback.answer,
            "rating": feedback.rating,
            "feedback_text": feedback.feedback_text,
            "submitted_at": datetime.now().isoformat()
        }
    )

    qdrant.upsert(collection_name=FEEDBACK_COLLECTION, points=[feedback_point])

    return {"status": "feedback_recorded", "message": "Thank you for your feedback!"}

@app.get("/feedback/stats/")
async def get_feedback_stats():
    feedback_points = []
    next_page_offset = None

    while True:
        scroll_result = qdrant.scroll(
            collection_name=FEEDBACK_COLLECTION,
            limit=100,
            offset=next_page_offset
        )

        feedback_points.extend(scroll_result[0])
        next_page_offset = scroll_result[1]

        if next_page_offset is None:
            break

    if not feedback_points:
        return {"total_feedback": 0, "average_rating": 0, "rating_distribution": {}}

    ratings = [point.payload["rating"] for point in feedback_points]
    rating_distribution = {i: ratings.count(i) for i in range(1, 6)}

    return {
        "total_feedback": len(feedback_points),
        "average_rating": sum(ratings) / len(ratings),
        "rating_distribution": rating_distribution
    }

@app.post("/qa/")
async def question_answer(query: str):
    enhanced_result = await enhanced_question_answer(query, enable_auto_enrichment=False)

    return {
        "answer": enhanced_result.answer,
        "source_file": enhanced_result.source_files[0] if enhanced_result.source_files else None
    }
