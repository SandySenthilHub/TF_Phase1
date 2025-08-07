import os
import difflib
import uuid
from db_utils import get_sql_server_connection

def get_master_documents(conn):
    query = "SELECT * FROM Attributes_TF_Document"
    cursor = conn.cursor()
    cursor.execute(query)
    columns = [column[0] for column in cursor.description]
    rows = cursor.fetchall()
    return [dict(zip(columns, row)) for row in rows]

def read_grouped_text(folder_path):
    # Look for the first .txt file inside the folder (usually Page_01.txt)
    for file in os.listdir(folder_path):
        if file.endswith(".txt"):
            with open(os.path.join(folder_path, file), "r", encoding="utf-8") as f:
                return f.read().strip()
    return ""

def catalog_grouped_text(conn, session_id, document_id, folder_name, text_content):
    master_docs = get_master_documents(conn)
    text_lower = text_content.lower()

    best_match_name = None
    best_match_id = None
    best_score = 0.0

    for doc in master_docs:
        master_name = doc.get("DocumentName", "").lower()
        score = difflib.SequenceMatcher(None, text_lower, master_name).ratio()

        if score > best_score:
            best_score = score
            best_match_name = doc.get("DocumentName")
            best_match_id = doc.get("DocumentID")

    if best_score < 0.3:
        best_match_name = None
        best_match_id = None

    # Convert to UUIDs
    session_uuid = uuid.UUID(str(session_id))
    document_uuid = uuid.UUID(str(document_id))
    matched_uuid = uuid.UUID(str(best_match_id)) if best_match_id else None

    # Insert into DB
    query = """
        INSERT INTO TF_mdocs_mgroups (
            session_id, document_id, grouped_form_type,
            matched_document_name, matched_document_id,
            confidence_score, cataloged_at
        )
        VALUES (?, ?, ?, ?, ?, ?, GETDATE())
    """
    cursor = conn.cursor()
    cursor.execute(query, (
        session_uuid,
        document_uuid,
        folder_name,
        best_match_name,
        matched_uuid,
        best_score
    ))
    conn.commit()

    print(f"[ Cataloged] '{folder_name}' -> '{best_match_name}' (score: {round(best_score, 2)})")

def catalog_all_grouped_documents(session_id, document_id):
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    grouped_path = os.path.join(base_dir, "grouped", str(session_id), str(document_id))

    if not os.path.exists(grouped_path):
        print(f" Grouped folder not found: {grouped_path}")
        return

    folders = [
        f for f in os.listdir(grouped_path)
        if os.path.isdir(os.path.join(grouped_path, f))
    ]

    print(f" Found {len(folders)} grouped folders")

    conn = get_sql_server_connection()
    for folder in folders:
        folder_path = os.path.join(grouped_path, folder)
        content = read_grouped_text(folder_path)

        if content:
            catalog_grouped_text(conn, session_id, document_id, folder, content)
        else:
            print(f" No text found in {folder_path}")
    conn.close()

if __name__ == "__main__":
    import sys
    if len(sys.argv) != 3:
        print("Usage: python catalog_with_master.py <session_id> <document_id>")
    else:
        try:
            session_id = uuid.UUID(sys.argv[1])
            document_id = uuid.UUID(sys.argv[2])
        except ValueError:
            print(" Invalid UUIDs")
            sys.exit(1)

        catalog_all_grouped_documents(session_id, document_id)
