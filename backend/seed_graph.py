"""
Seed script: loads sample academic papers into CognoDB and runs example queries.
Run from project root: python backend/seed_graph.py
"""

import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from database import db

PAPERS = [
    {
        "title": "Attention Is All You Need",
        "year": 2017,
        "abstract": "We propose the Transformer, a model architecture based solely on attention mechanisms.",
        "authors": ["Vaswani", "Shazeer", "Parmar"],
        "topics": ["Transformers", "Attention Mechanism", "NLP"],
    },
    {
        "title": "BERT: Pre-training of Deep Bidirectional Transformers",
        "year": 2018,
        "abstract": "A new language representation model called BERT for pre-training deep bidirectional Transformers.",
        "authors": ["Devlin", "Chang", "Lee"],
        "topics": ["BERT", "NLP", "Pre-training"],
    },
    {
        "title": "GPT-3: Language Models are Few-Shot Learners",
        "year": 2020,
        "abstract": "We train GPT-3, an autoregressive language model with 175 billion parameters.",
        "authors": ["Brown", "Mann", "Ryder"],
        "topics": ["GPT", "Few-Shot Learning", "Language Models"],
    },
]

CITATIONS = [
    ("BERT: Pre-training of Deep Bidirectional Transformers", "Attention Is All You Need"),
    ("GPT-3: Language Models are Few-Shot Learners", "Attention Is All You Need"),
    ("GPT-3: Language Models are Few-Shot Learners", "BERT: Pre-training of Deep Bidirectional Transformers"),
]


def seed(session):
    for paper in PAPERS:
        session.run(
            "MERGE (p:Paper {title: $title}) SET p.year = $year, p.abstract = $abstract",
            title=paper["title"], year=paper["year"], abstract=paper["abstract"],
        )
        for author in paper["authors"]:
            session.run(
                """
                MERGE (a:Author {name: $name})
                WITH a
                MATCH (p:Paper {title: $title})
                MERGE (a)-[:WROTE]->(p)
                """,
                name=author, title=paper["title"],
            )
            for other in paper["authors"]:
                if other != author:
                    session.run(
                        """
                        MATCH (a1:Author {name: $a1}), (a2:Author {name: $a2})
                        MERGE (a1)-[:COLLABORATES_WITH]->(a2)
                        """,
                        a1=author, a2=other,
                    )
        for topic in paper["topics"]:
            session.run(
                """
                MERGE (t:Topic {name: $topic})
                WITH t
                MATCH (p:Paper {title: $title})
                MERGE (p)-[:DISCUSSES]->(t)
                """,
                topic=topic, title=paper["title"],
            )

    for citing, cited in CITATIONS:
        session.run(
            """
            MATCH (p1:Paper {title: $citing}), (p2:Paper {title: $cited})
            MERGE (p1)-[:CITES]->(p2)
            """,
            citing=citing, cited=cited,
        )
    print("Seed data loaded.")


def query_multi_hop(session, title_fragment: str):
    """2-hop: Paper -> CITES -> Paper -> DISCUSSES -> Topic"""
    result = session.run(
        """
        MATCH (p1:Paper)-[:CITES]->(p2:Paper)-[:DISCUSSES]->(t:Topic)
        WHERE p1.title CONTAINS $title
        RETURN p2.title AS cited_paper, t.name AS topic
        """,
        title=title_fragment,
    )
    print(f"\nMulti-hop query — papers cited by '{title_fragment}':")
    for r in result:
        print(f"  {r['cited_paper']}  ->  {r['topic']}")


def query_collaboration_strength(session, author_name: str):
    """Graph-specific: collaboration strength via shared citations (awkward in SQL)."""
    result = session.run(
        """
        MATCH (a1:Author)-[:WROTE]->(p1:Paper)-[:CITES]->(p2:Paper)<-[:WROTE]-(a2:Author)
        WHERE a1.name = $author_name
        RETURN DISTINCT a2.name AS collaborator, count(*) AS strength
        ORDER BY strength DESC
        """,
        author_name=author_name,
    )
    print(f"\nCollaboration strength for '{author_name}':")
    for r in result:
        print(f"  {r['collaborator']}  strength: {r['strength']}")


if __name__ == "__main__":
    with db.get_session() as session:
        seed(session)
        query_multi_hop(session, "BERT")
        query_collaboration_strength(session, "Brown")
