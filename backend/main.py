import os, tempfile
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from typing import List, Optional

load_dotenv()

from pdf_processor import process_pdf, extract_text
from graph_loader import load_paper
from graph_rag import ask, ask_with_file_context

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class Question(BaseModel):
    question: str
    history: Optional[List[dict]] = []

class SessionData(BaseModel):
    id: str
    title: str = "New session"
    color: str = "#d9bbfc"
    createdAt: int = 0
    time: str = "Just now"

class MessageData(BaseModel):
    id: str
    role: str
    content: str
    timestamp: int = 0

class ArtifactData(BaseModel):
    name: str
    size: str
    type: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    suffix = ".pdf" if (file.filename or "").endswith(".pdf") else ".txt"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    if suffix == ".pdf":
        metadata = process_pdf(tmp_path)
        os.unlink(tmp_path)
        load_paper(metadata)
        return {"message": "Paper loaded", "title": metadata.get("title")}
    else:
        os.unlink(tmp_path)
        return {"message": "File received (non-PDF, graph ingestion skipped)"}


@app.post("/ask")
def ask_question(body: Question):
    return ask(body.question, body.history)


@app.post("/chat")
async def chat_with_files(
    question: str = Form(...),
    history: Optional[str] = Form(default="[]"),
    files: List[UploadFile] = File(default=[])
):
    """
    Accepts a question + zero or more attached files + chat history.
    """
    import json
    try:
        history_list = json.loads(history)
    except Exception:
        history_list = []

    file_texts: list[dict] = []

    for f in files:
        filename = f.filename or "file"
        content = await f.read()
        suffix = ".pdf" if filename.endswith(".pdf") else ".txt"

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        try:
            raw_text = extract_text(tmp_path)
            file_texts.append({"name": filename, "text": raw_text})

            if suffix == ".pdf":
                try:
                    metadata = process_pdf(tmp_path)
                    load_paper(metadata)
                except Exception as ingest_err:
                    print(f"Graph ingestion failed for {filename}: {ingest_err}")
        finally:
            os.unlink(tmp_path)

    return ask_with_file_context(question, file_texts, history_list)

import session_store

@app.post("/sessions")
def create_session(session: SessionData):
    return session_store.create_session(session.dict())

@app.get("/sessions")
def get_sessions():
    return session_store.get_sessions()

@app.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    session_store.delete_session(session_id)
    return {"status": "deleted"}

@app.post("/sessions/{session_id}/messages")
def add_message(session_id: str, message: MessageData):
    return session_store.add_message(session_id, message.dict())

@app.get("/sessions/{session_id}/messages")
def get_messages(session_id: str):
    return session_store.get_messages(session_id)


@app.post("/sessions/{session_id}/artifacts")
def add_artifact(session_id: str, artifact: ArtifactData):
    return session_store.add_artifact(session_id, artifact.dict())

@app.get("/sessions/{session_id}/artifacts")
def get_artifacts(session_id: str):
    return session_store.get_artifacts(session_id)

@app.delete("/sessions/{session_id}/artifacts")
def clear_artifacts(session_id: str):
    session_store.clear_artifacts(session_id)
    return {"status": "cleared"}

@app.delete("/sessions/{session_id}/artifacts/{name}")
def delete_artifact(session_id: str, name: str):
    session_store.delete_artifact(session_id, name)
    return {"status": "deleted"}



@app.get("/graph")
def get_graph():
    from database import db
    with db.get_session() as session:
        result = session.run("""
            MATCH (a:Author)-[:WROTE]->(p:Paper)
            OPTIONAL MATCH (p)-[:DISCUSSES]->(t:Topic)
            OPTIONAL MATCH (p)-[:CITES]->(c:Paper)
            OPTIONAL MATCH (a)-[:COLLABORATES_WITH]->(a2:Author)
            RETURN
              collect(DISTINCT {id: p.title, label: p.title, type: 'Paper', year: p.year}) AS papers,
              collect(DISTINCT {id: a.name,  label: a.name,  type: 'Author'}) AS authors,
              collect(DISTINCT {id: t.name,  label: t.name,  type: 'Topic'}) AS topics,
              collect(DISTINCT {source: a.name, target: p.title, rel: 'WROTE'}) AS wrote_edges,
              collect(DISTINCT {source: p.title, target: t.name, rel: 'DISCUSSES'}) AS discusses_edges,
              collect(DISTINCT {source: p.title, target: c.title, rel: 'CITES'}) AS cites_edges,
              collect(DISTINCT {source: a.name, target: a2.name, rel: 'COLLABORATES_WITH'}) AS collab_edges
        """)
        row = result.single()
        if not row:
            return {"nodes": [], "links": []}

        nodes_map = {}
        for n in (row["papers"] + row["authors"] + row["topics"]):
            if n and n.get("id"):
                nodes_map[n["id"]] = n

        links = []
        for edge_list in [row["wrote_edges"], row["discusses_edges"], row["cites_edges"], row["collab_edges"]]:
            for e in edge_list:
                if e and e.get("source") and e.get("target") and e["source"] != e["target"]:
                    links.append(e)

        return {"nodes": list(nodes_map.values()), "links": links}


# Serve frontend static files
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")

    @app.get("/{catchall:path}")
    async def serve_frontend(catchall: str):
        # Exclude API routes
        api_routes = {"health", "upload", "ask", "chat", "sessions", "graph"}
        if catchall.split("/")[0] in api_routes:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Not Found")
            
        file_path = os.path.join(static_dir, catchall)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
            
        index_path = os.path.join(static_dir, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
            
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not Found")


