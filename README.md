# GraphRAG - Academic Paper Knowledge Assistant

This project is a smart assistant designed to help you search, connect, and understand academic papers. 

## What It Does
1. **Upload Papers**: You can upload academic papers (PDF format).
2. **Build a Knowledge Graph**: The system automatically extracts key details from the papers (authors, topics, citations) and links them together in a database.
3. **Ask Questions**: You can chat with the assistant to query the papers. The assistant runs smart searches across the connections in the database to give you accurate answers.

---

## Graph Data Model

The knowledge graph is structured around three types of nodes and four relationship types:

```
  (:Author)                    (:Topic)
      |                            ^
 [:WROTE]                   [:DISCUSSES]
      |                            |
      v                            |
  (:Paper) ──────[:CITES]──► (:Paper)
      |
 [:COLLABORATES_WITH] between co-authors of the same paper
```

| Node       | Properties                          |
|------------|-------------------------------------|
| `Paper`    | `title`, `year`, `abstract`         |
| `Author`   | `name`                              |
| `Topic`    | `name`                              |

| Relationship        | From     | To       | Meaning                              |
|---------------------|----------|----------|--------------------------------------|
| `WROTE`             | Author   | Paper    | An author wrote this paper           |
| `DISCUSSES`         | Paper    | Topic    | A paper covers a topic               |
| `CITES`             | Paper    | Paper    | A paper references another paper     |
| `COLLABORATES_WITH` | Author   | Author   | Two authors co-wrote a paper         |

---

## Why a Graph Database?
Instead of a traditional relational database (SQL), this project uses a graph database (Neo4j/CognoDB) to store and query research data. Here is why a graph database is the perfect fit:

* **Relationship-Driven Context**: In academic research, papers are not isolated rows in a table. They form a rich web of connections: authors collaborate, papers cite other papers, and documents share overlapping topics. Storing this directly as nodes and edges allows us to preserve the natural structure of the data.
* **Efficient Multi-Hop Traversals**: Common queries in research discovery—such as *"Find the citation chain from Devlin to Vaswani and discover what shared topics connect them"*—require traversing multiple hops. In a relational database (SQL), this requires writing slow, nested `JOIN` queries. In a graph database, traversing these paths is built-in and takes milliseconds.
* **Contextual Retrieval for RAG**: Standard RAG (Retrieval-Augmented Generation) systems use simple vector search, which retrieves chunks of text but loses the broader context of how concepts connect. By using a graph database, our RAG pipeline can retrieve entire sub-graphs (e.g., *"this paper cites X, which was authored by Y, who also wrote Z"*), providing the LLM with richer, structured, and factual context.
* **Evolutionary Schema**: Research fields evolve rapidly. As new entities (e.g., funding agencies, universities, journal issues) are introduced, we can add them as new nodes and relationships dynamically without altering an rigid database schema or running costly table migrations.
