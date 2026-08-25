from database import db


def load_paper(metadata: dict):
    with db.get_session() as session:
        session.run(
            "MERGE (p:Paper {title: $title}) SET p.year = $year, p.abstract = $abstract",
            title=metadata["title"], year=metadata.get("year", 0), abstract=metadata.get("abstract", ""),
        )
        for author in metadata.get("authors", []):
            session.run(
                """
                MERGE (a:Author {name: $name})
                WITH a MATCH (p:Paper {title: $title})
                MERGE (a)-[:WROTE]->(p)
                """,
                name=author, title=metadata["title"],
            )
            for other in metadata.get("authors", []):
                if other != author:
                    session.run(
                        """
                        MATCH (a1:Author {name: $a1}), (a2:Author {name: $a2})
                        MERGE (a1)-[:COLLABORATES_WITH]->(a2)
                        """,
                        a1=author, a2=other,
                    )
        for topic in metadata.get("topics", []):
            session.run(
                """
                MERGE (t:Topic {name: $topic})
                WITH t MATCH (p:Paper {title: $title})
                MERGE (p)-[:DISCUSSES]->(t)
                """,
                topic=topic, title=metadata["title"],
            )
        for ref in metadata.get("references", []):
            session.run(
                """
                MERGE (ref:Paper {title: $ref})
                WITH ref MATCH (p:Paper {title: $title})
                MERGE (p)-[:CITES]->(ref)
                """,
                ref=ref, title=metadata["title"],
            )
