import os
from groq import Groq
from database import db

client = Groq(api_key=os.getenv("GROQ_API_KEY"))


def get_graph_context(question: str) -> tuple[list, str]:
    with db.get_session() as session:
        # Fetch papers, their authors, topics, and what they cite
        result = session.run(
            """
            MATCH (a:Author)-[:WROTE]->(p:Paper)-[:DISCUSSES]->(t:Topic)
            OPTIONAL MATCH (p)-[:CITES]->(cited:Paper)
            RETURN p.title AS title, p.year AS year, p.abstract AS abstract,
                   collect(DISTINCT a.name) AS authors,
                   collect(DISTINCT t.name) AS topics,
                   collect(DISTINCT cited.title) AS citations
            LIMIT 20
            """
        )
        papers = [dict(r) for r in result]

    context = "\n\n".join(
        f"Title: {p['title']} ({p['year']})\n"
        f"Authors: {', '.join(p['authors'])}\n"
        f"Topics: {', '.join(p['topics'])}\n"
        f"Cites: {', '.join(p['citations']) or 'none'}\n"
        f"Abstract: {p['abstract']}"
        for p in papers
    )
    return papers, context


def ask(question: str) -> dict:
    import re
    # Clean and normalize the question to detect simple greetings or status checks
    normalized = re.sub(r'[^\w\s]', '', question).strip().lower()
    greetings = {"hi", "hello", "hey", "yo", "hola", "working yet", "is it working yet", "is it working", "test"}
    
    if normalized in greetings or (len(normalized.split()) <= 2 and not any(w in normalized for w in ["paper", "author", "topic", "citation", "cite"])):
        response = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=[
                {
                    "role": "system",
                    "content": "You are a friendly research assistant. Respond to the greeting or status check conversationally and concisely. Do not use markdown bold asterisks (**)."
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
                "You are a research assistant. If the user's message is a greeting, status check, "
                "or a casual conversational remark (e.g., 'hello', 'is it working yet?', 'how are you'), "
                "respond normally, friendly, and conversationally. Otherwise, if the query is a research question, "
                "answer the user's question using the provided graph context and cite specific paper titles in your answer. "
                "If the provided context is empty or has no papers, state clearly that no papers are currently uploaded in the database, and do not make up, list, or suggest any papers. "
                "Do not use any markdown bold asterisks (**) in your output response."
            ),
        },
        {
            "role": "user",
            "content": f"Context:\n{context}\n\nQuestion: {question}",
        },
    ]

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
