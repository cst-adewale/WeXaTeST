import os
from groq import Groq
from database import db

client = Groq(api_key=os.getenv("GROQ_API_KEY"))


def get_graph_context(question: str) -> tuple[list, str]:
    with db.get_session() as session:
        # Lenient match: Fetch all papers, then optionally gather related authors, topics, and citations
        result = session.run(
            """
            MATCH (p:Paper)
            OPTIONAL MATCH (a:Author)-[:WROTE]->(p)
            OPTIONAL MATCH (p)-[:DISCUSSES]->(t:Topic)
            OPTIONAL MATCH (p)-[:CITES]->(cited:Paper)
            RETURN p.title AS title, p.year AS year, p.abstract AS abstract,
                   collect(DISTINCT a.name) AS authors,
                   collect(DISTINCT t.name) AS topics,
                   collect(DISTINCT cited.title) AS citations
            LIMIT 25
            """
        )
        papers = [dict(r) for r in result]

    context = "\n\n".join(
        f"Title: {p['title']} ({p['year']})\n"
        f"Authors: {', '.join(p['authors']) or 'unknown'}\n"
        f"Topics: {', '.join(p['topics']) or 'general'}\n"
        f"Cites: {', '.join(p['citations']) or 'none'}\n"
        f"Abstract/Content: {p['abstract']}"
        for p in papers
    )
    return papers, context


def ask(question: str, history: list = None) -> dict:
    import re
    # Clean and normalize the question to detect simple greetings or status checks
    normalized = re.sub(r'[^\w\s]', '', question).strip().lower()
    greetings = {"hi", "hello", "hey", "yo", "hola", "working yet", "is it working yet", "is it working", "test"}
    
    # Casual check: Only fallback to generic greeting if it is strictly a short conversational greeting
    if normalized in greetings or (len(normalized.split()) <= 2 and not any(w in normalized for w in ["paper", "author", "topic", "citation", "cite", "who", "what", "how", "why", "write", "about", "show", "tell"])):
        response = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {
                    "role": "system",
                    "content": "You are a friendly research assistant. Respond to the greeting or status check conversationally and concisely."
                },
                {
                    "role": "user",
                    "content": question
                }
            ],
        )
        return {"answer": response.choices[0].message.content, "citations": []}

    papers, context = get_graph_context(question)

    messages = [
        {
            "role": "system",
            "content": (
                "You are a research assistant. Answer the user's question using the provided graph context and cite specific paper titles in your answer. "
                "If the provided context is empty or has no papers, state clearly that no papers are currently uploaded in the database, and do not make up, list, or suggest any papers."
            ),
        }
    ]

    # Append history if available
    if history:
        for msg in history:
            role = "user" if msg.get("role") == "user" else "assistant"
            messages.append({"role": role, "content": msg.get("content", "")})

    messages.append({
        "role": "user",
        "content": f"Context:\n{context}\n\nQuestion: {question}",
    })

    try:
        response = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=messages,
        )
    except Exception as e:
        # Log error or print to console
        print(f"Error querying openai/gpt-oss-120b: {e}. Falling back to qwen/qwen3.6-27b...")
        response = client.chat.completions.create(
            model="qwen/qwen3.6-27b",
            messages=messages,
        )

    answer = response.choices[0].message.content
    citations = [{"title": p["title"], "year": p["year"], "authors": p["authors"]} for p in papers]
    return {"answer": answer, "citations": citations}


def ask_with_file_context(question: str, file_texts: list[dict], history: list = None) -> dict:
    """
    Answer a question with direct file content as context.
    file_texts: list of {name: str, text: str}
    Also pulls in the graph context so graph knowledge is still available.
    """
    # Build document context section from file contents
    doc_context = ""
    if file_texts:
        parts = []
        for f in file_texts:
            text_snippet = f["text"][:4000]  # cap per file to avoid token overflow
            parts.append(f"=== File: {f['name']} ===\n{text_snippet}")
        doc_context = "\n\n".join(parts)

    # Also pull in graph context in case it's relevant
    try:
        _, graph_context = get_graph_context(question)
    except Exception:
        graph_context = ""

    system_prompt = (
        "You are a helpful research and document assistant. "
        "The user has attached one or more documents. Read the document content carefully and answer the user's question directly based on what is in the documents. "
        "If the documents are not relevant to the question, use your knowledge graph context or your general knowledge to help."
    )

    messages = [
        {"role": "system", "content": system_prompt}
    ]

    # Append history if available
    if history:
        for msg in history:
            role = "user" if msg.get("role") == "user" else "assistant"
            messages.append({"role": role, "content": msg.get("content", "")})

    content_parts = []
    if doc_context:
        content_parts.append(f"Attached Documents:\n{doc_context}")
    if graph_context:
        content_parts.append(f"Knowledge Graph Context:\n{graph_context}")
    content_parts.append(f"User Question: {question}")

    messages.append({
        "role": "user",
        "content": "\n\n".join(content_parts)
    })

    try:
        response = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=messages,
        )
    except Exception as e:
        print(f"Primary model error: {e}. Falling back to qwen/qwen3.6-27b...")
        response = client.chat.completions.create(
            model="qwen/qwen3.6-27b",
            messages=messages,
        )

    return {"answer": response.choices[0].message.content, "citations": []}
