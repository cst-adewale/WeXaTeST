import os, json
import pdfplumber
from groq import Groq

client = Groq(api_key=os.getenv("GROQ_API_KEY"))


def extract_text(pdf_path: str) -> str:
    with pdfplumber.open(pdf_path) as pdf:
        return "\n".join(page.extract_text() or "" for page in pdf.pages[:6])


def structure_metadata(text: str) -> dict:
    prompt = f"""Extract metadata from this academic paper excerpt and return ONLY valid JSON with keys:
title (str), year (int), abstract (str), authors (list of last names), topics (list of keywords), references (list of paper titles mentioned).

Paper text:
{text[:3000]}"""

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)


def process_pdf(pdf_path: str) -> dict:
    text = extract_text(pdf_path)
    return structure_metadata(text)
