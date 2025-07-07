import sys
import os
import re
import json
from typing import Dict
import os
from dotenv import load_dotenv
from pathlib import Path
import pyodbc

def get_sql_server_connection():
    env_path = Path("C:/Users/SANDHIYA/Downloads/0207/project-bolt-github-sdfj7e6k - 0207/project/.env")
    load_dotenv(dotenv_path=env_path)

    server = os.getenv('DB_SERVER')
    database = os.getenv('DB_DATABASE')
    username = os.getenv('DB_USER')
    password = os.getenv('DB_PASSWORD')

    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={server};DATABASE={database};UID={username};PWD={password}"
    )

    try:
        conn = pyodbc.connect(conn_str)
        return conn
    except Exception as e:
        print(" Failed to connect to SQL Server:", e)
        raise


def save_raw_document_to_db(conn, session_id, document_id, filename, pdf_path):
    with open(pdf_path, 'rb') as f:
        binary_data = f.read()
    
    query = """
    INSERT INTO ingestion_document_raw_new (session_id, document_id, filename, file_data, uploaded_at)
    VALUES (?, ?, ?, ?, GETDATE())
    """
    cursor = conn.cursor()
    cursor.execute(query, (session_id, document_id, filename, binary_data))
    conn.commit()


def save_cleaned_documents_to_db(conn, session_id, document_id, form_type, pdf_path, text_path):
    with open(pdf_path, 'rb') as f_pdf:
        pdf_data = f_pdf.read()
    
    with open(text_path, 'r', encoding='utf-8') as f_text:
        text_data = f_text.read()

    query = """
    INSERT INTO ingestion_document_cleaned_new (session_id, document_id, form_type, file_data, ocr_text, created_at)
    VALUES (?, ?, ?, ?, ?, GETDATE())
    """
    cursor = conn.cursor()
    cursor.execute(query, (session_id, document_id, form_type, pdf_data, text_data))
    conn.commit()


def save_extracted_fields_to_db(conn, session_id, document_id, form_type, fields_dict):
    fields_json = json.dumps(fields_dict, ensure_ascii=False)
    
    query = """
    INSERT INTO ingestion_fields_new (session_id, document_id, form_type, fields_json, extracted_at)
    VALUES (?, ?, ?, ?, GETDATE())
    """
    cursor = conn.cursor()
    cursor.execute(query, (session_id, document_id, form_type, fields_json))
    conn.commit()
