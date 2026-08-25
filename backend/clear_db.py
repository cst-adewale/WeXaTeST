from database import db
with db.get_session() as session:
    session.run("MATCH (n) DETACH DELETE n")
print("Database cleared successfully!")
