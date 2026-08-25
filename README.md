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

---

## Setup and Run Instructions

### 1. Creating the CognoDB (Neo4j Aura) Instance
To run this application, you need a CognoDB instance (which runs standard Neo4j). You can create a free cloud database on Neo4j Aura:
1. Go to [Neo4j Aura Console](https://console.neo4j.io/) and sign up for a free account.
2. Click **Create Database** and choose the **AuraDB Free** option.
3. Save the generated credentials file (which contains the **Connection URI**, **Username** `neo4j`, and **Password**).
4. Once the status shows **Running**, your instance is ready to use.

### 2. Local Environment Variables Setup
Create a `.env` file in the `backend/` directory with the following variables:
```env
NEO4J_URI=neo4j+s://<YOUR_DATABASE_ID>.auradb.static.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=<YOUR_DATABASE_PASSWORD>
GROQ_API_KEY=<YOUR_GROQ_API_KEY>
```

### 3. Running Locally
You can run the full-stack application locally as follows:

#### Start the FastAPI Backend
```bash
cd backend
python -m venv venv
# On Windows (PowerShell):
.\venv\Scripts\Activate.ps1
# On Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

#### Start the React Frontend
```bash
cd adewaleai
npm install
npm run dev
```
Open your browser to the URL displayed in your terminal (typically `http://localhost:5173`).

---

## Main Cypher Queries Explained

### 1. Document Ingestion (Paper Graph Construction)
When a PDF is uploaded, the system parses it and executes these queries sequentially to build the graph model:
* **Create/Set Paper node:**
  ```cypher
  MERGE (p:Paper {title: $title}) 
  SET p.year = $year, p.abstract = $abstract
  ```
* **Link Author to Paper & Co-Author Collaboration:**
  ```cypher
  MERGE (a:Author {name: $name})
  WITH a MATCH (p:Paper {title: $title})
  MERGE (a)-[:WROTE]->(p)
  ```
  ```cypher
  MATCH (a1:Author {name: $a1}), (a2:Author {name: $a2})
  MERGE (a1)-[:COLLABORATES_WITH]->(a2)
  ```
* **Link Paper to Topics:**
  ```cypher
  MERGE (t:Topic {name: $topic})
  WITH t MATCH (p:Paper {title: $title})
  MERGE (p)-[:DISCUSSES]->(t)
  ```

### 2. Context Retrieval for GraphRAG
To retrieve relevant context for answering questions in the chatbot, the following multi-hop query pulls connected papers, authors, topics, and citations:
```cypher
MATCH (p:Paper)
OPTIONAL MATCH (a:Author)-[:WROTE]->(p)
OPTIONAL MATCH (p)-[:DISCUSSES]->(t:Topic)
OPTIONAL MATCH (p)-[:CITES]->(cited:Paper)
RETURN p.title AS title, p.year AS year, p.abstract AS abstract,
       collect(DISTINCT a.name) AS authors,
       collect(DISTINCT t.name) AS topics,
       collect(DISTINCT cited.title) AS citations
LIMIT 25
```

### 3. Session & Message Persistence
To persist chat sessions and user messages:
```cypher
MATCH (s:Session {id: $session_id})
MERGE (m:Message {id: $msg_id})
SET m.role = $role, m.content = $content, m.timestamp = $timestamp
MERGE (s)-[:HAS_MESSAGE]->(m)
```

---

## UI Layout Walkthrough

The interface is divided into three primary views located in the navigation menu:

1. **Academic Paper Knowledge Assistant (Info/Home):**
   * Guides you on how to upload documents, build your graph, and query it.
   * Visualizes the schema properties and connections.
2. **Session Graph Visualizer (Visualize):**
   * Renders a real-time, interactive HTML5 canvas graph visualization of your session message flow and relevant database nodes.
   * Utilizes a **custom force-directed layout** with linear spring repulsion to keep nodes cleanly separated and readable.
3. **Session Artifacts (Artifacts):**
   * A dedicated center-aligned workspace listing all files uploaded during your current chat session.
   * Features a clean layout with custom indicators, file details, and vertical alignment centering the **Clear Session** option with the heading.

---

## Screenshots

### Chat — Uploading & Reading a Document
The main chat interface. Upload PDF files using the **Attach files** button and ask the assistant to read, summarise, or query the uploaded document. Sessions are listed in the sidebar with colour-coded labels.

![Chat View](screenshots/Screenshot%20(204).png)

---

### Visualize — Session Flow Graph
The **Session Flow** view renders a real-time, interactive canvas graph of your conversation. Each message exchange between you and GraphRAG is shown as a linked node chain. Use the toolbar to switch to **Global Graph** or filter by **Papers**, **Authors**, or **Topics**.

![Graph Visualizer](screenshots/Screenshot%20(205).png)

---

### Artifacts — Uploaded Files per Session
The **Artifacts** panel lists every file uploaded in the current session. Each card shows the file name, size, and type. Use the **Clear Session** button to remove all artifacts, or the **×** on each card to remove a single file.

![Session Artifacts](screenshots/Screenshot%20(206).png)

---

### Info — About & Schema Reference
The **Info** page explains the purpose of the assistant, how the graph data model works, and why a graph database was chosen over SQL for this use case.

![Info Page](screenshots/Screenshot%20(207).png)

