import os
import difflib
from db_utils import get_sql_server_connection 

def get_master_documents(conn):
    query = "SELECT DocumentID, DocumentName FROM TF_master_documentset WHERE IsActive = 1"
    cursor = conn.cursor()
    cursor.execute(query)
    rows = cursor.fetchall()
    return [{"DocumentID": str(row[0]), "DocumentName": row[1]} for row in rows]

def catalog_grouped_form(conn, session_id, document_id, grouped_form_type):
    master_docs = get_master_documents(conn)
    form_type_lower = grouped_form_type.lower()

    document_names = [doc["DocumentName"] for doc in master_docs]
    best_match = difflib.get_close_matches(form_type_lower, [name.lower() for name in document_names], n=1, cutoff=0.6)

    if best_match:
        matched_name = best_match[0]
        matched_doc = next(doc for doc in master_docs if doc["DocumentName"].lower() == matched_name)
        matched_id = matched_doc["DocumentID"]
        score = difflib.SequenceMatcher(None, matched_name, form_type_lower).ratio()
    else:
        matched_name = None
        matched_id = None
        score = 0.0

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
        session_id,
        document_id,
        grouped_form_type,
        matched_name,
        matched_id,
        score
    ))
    conn.commit()

    print(f"[ Cataloged] '{grouped_form_type}' -> '{matched_name}' (score: {round(score, 2)})")

def catalog_all_grouped_documents(session_id, document_id):
    # Use project root to ensure correct path
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    grouped_path = os.path.join(base_dir, "grouped", session_id, document_id)

    if not os.path.exists(grouped_path):
        print(f" Grouped folder not found: {grouped_path}")
        return

    form_folders = [f for f in os.listdir(grouped_path) if os.path.isdir(os.path.join(grouped_path, f))]
    if not form_folders:
        print(f" No grouped folders found inside {grouped_path}")
        return

    conn = get_sql_server_connection()
    for form_type in form_folders:
        catalog_grouped_form(conn, session_id, document_id, form_type)
    conn.close()

if __name__ == "__main__":
    import sys
    if len(sys.argv) != 3:
        print("Usage: python catalog_with_master.py <session_id> <document_id>")
    else:
        session_id = sys.argv[1]
        document_id = sys.argv[2]
        catalog_all_grouped_documents(session_id, document_id)
