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
    papers, context = get_graph_context(question)

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a research assistant. Answer the user's question using ONLY "
                    "the provided graph context. Cite specific paper titles in your answer."
                ),
            },
            {
                "role": "user",
                "content": f"Context:\n{context}\n\nQuestion: {question}",
            },
        ],
    )

    answer = response.choices[0].message.content
    citations = [{"title": p["title"], "year": p["year"], "authors": p["authors"]} for p in papers]
    return {"answer": answer, "citations": citations}
