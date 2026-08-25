# GraphRAG - Academic Paper Knowledge Assistant

This project is a smart assistant designed to help you search, connect, and understand academic papers. 

## What It Does
1. **Upload Papers**: You can upload academic papers (PDF format).
2. **Build a Knowledge Graph**: The system automatically extracts key details from the papers (authors, topics, citations) and links them together in a database.
3. **Ask Questions**: You can chat with the assistant to query the papers. The assistant runs smart searches across the connections in the database to give you accurate answers.

---

## Why a Graph Database?
Instead of a traditional relational database (SQL), this project uses a graph database (Neo4j). Here is why:

* **Connected Data**: In research, papers are naturally linked together through authors, shared topics, and citations. A graph database stores these connections directly as first-class relationships rather than forcing them into separate tables.
* **Fast Multi-Hop Searches**: Finding connections like *"Which papers cite papers written by Author X on Topic Y?"* requires multiple complex joins in SQL, which can be very slow. In a graph database, tracing these multi-step connections is simple and extremely fast.
* **Flexible Schema**: As new types of connections or metadata are discovered, we can add them to a graph database immediately without restructuring tables or writing complex database migrations.
