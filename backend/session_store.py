from database import db

def create_session(session_data: dict):
    with db.get_session() as tx:
        tx.run(
            """
            MERGE (s:Session {id: $id})
            SET s.title = $title,
                s.color = $color,
                s.createdAt = $createdAt,
                s.time = $time
            """,
            id=session_data["id"],
            title=session_data.get("title", "New session"),
            color=session_data.get("color", "#d9bbfc"),
            createdAt=session_data.get("createdAt", 0),
            time=session_data.get("time", "Just now")
        )
        return session_data

def get_sessions():
    with db.get_session() as tx:
        result = tx.run(
            """
            MATCH (s:Session)
            RETURN s.id AS id, s.title AS title, s.color AS color, 
                   s.createdAt AS createdAt, s.time AS time
            ORDER BY s.createdAt DESC
            """
        )
        return [dict(record) for record in result]

def delete_session(session_id: str):
    with db.get_session() as tx:
        tx.run(
            """
            MATCH (s:Session {id: $id})
            OPTIONAL MATCH (s)-[:HAS_MESSAGE]->(m:Message)
            DETACH DELETE s, m
            """,
            id=session_id
        )

def add_message(session_id: str, message_data: dict):
    with db.get_session() as tx:
        tx.run(
            """
            MATCH (s:Session {id: $session_id})
            MERGE (m:Message {id: $msg_id})
            SET m.role = $role,
                m.content = $content,
                m.timestamp = $timestamp
            MERGE (s)-[:HAS_MESSAGE]->(m)
            """,
            session_id=session_id,
            msg_id=message_data["id"],
            role=message_data["role"],
            content=message_data["content"],
            timestamp=message_data.get("timestamp", 0)
        )
        # Note: We aren't fully storing the 'files' array in this simple schema yet, 
        # but could add it as a JSON string property if needed.
        return message_data

def get_messages(session_id: str):
    with db.get_session() as tx:
        result = tx.run(
            """
            MATCH (s:Session {id: $session_id})-[:HAS_MESSAGE]->(m:Message)
            RETURN m.id AS id, m.role AS role, m.content AS content, m.timestamp AS timestamp
            ORDER BY m.timestamp ASC
            """,
            session_id=session_id
        )
        return [dict(record) for record in result]
