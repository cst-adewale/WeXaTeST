import os, tempfile
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

from pdf_processor import process_pdf
from graph_loader import load_paper
from graph_rag import ask

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class Question(BaseModel):
    question: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    metadata = process_pdf(tmp_path)
    os.unlink(tmp_path)
    load_paper(metadata)
    return {"message": "Paper loaded", "title": metadata.get("title")}


@app.post("/ask")
def ask_question(body: Question):
    return ask(body.question)
