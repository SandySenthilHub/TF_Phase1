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


def save_cleaned_text_to_db(conn, session_id, document_id, form_type, text_data):
    """
    Save raw OCR text directly to database.
    """
    query = """
    INSERT INTO TF_ingestion_CleanedOCR (session_id, document_id, form_type, ocr_text, created_at)
    VALUES (?, ?, ?, ?, GETDATE())
    """
    cursor = conn.cursor()
    try:
        cursor.execute(query, (session_id, document_id, form_type, text_data))
        conn.commit()
        print(" OCR text saved to DB successfully.")
    except Exception as e:
        print(f" Failed to save OCR text to DB: {e}")
    finally:
        cursor.close()

def save_cleaned_pdf_to_db(conn, session_id, document_id, form_type, pdf_path):
    with open(pdf_path, 'rb') as f_pdf:
        pdf_data = f_pdf.read()

    query = """
    INSERT INTO TF_ingestion_CleanedPDF (session_id, document_id, form_type, file_data, created_at)
    VALUES (?, ?, ?, ?, GETDATE())
    """
    cursor = conn.cursor()
    cursor.execute(query, (session_id, document_id, form_type, pdf_data))
    conn.commit()

def save_extracted_fields_to_db(conn, session_id, document_id, form_type, fields_dict):
    cursor = conn.cursor()

    now = "GETDATE()"  # Use server time

    delta_query = """
    INSERT INTO TF_fields_delta (session_id, document_id, form_type, field_key, extracted_at)
    VALUES (?, ?, ?, ?, GETDATE())
    """

    kv_query = """
    INSERT INTO TF_fields_KeyValuePair (session_id, document_id, form_type, field_key, field_value, extracted_at)
    VALUES (?, ?, ?, ?, ?, GETDATE())
    """

    for key, value in fields_dict.items():
        # Save key only to TF_fields_delta
        cursor.execute(delta_query, (session_id, document_id, form_type, key))

        # Save key-value to TF_fields_KeyValuePair
        cursor.execute(kv_query, (session_id, document_id, form_type, key, str(value)))

    conn.commit()
    
    
    
    


# Function for grouping 

def get_cleaned_split_data(conn, session_id, document_id):
    query = """
        SELECT 
            pdf.form_type,
            pdf.file_data AS pdf_data,
            ocr.ocr_text,
            fields.fields_json
        FROM TF_ingestion_CleanedPDF AS pdf
        INNER JOIN TF_ingestion_CleanedOCR AS ocr
            ON pdf.session_id = ocr.session_id AND pdf.document_id = ocr.document_id AND pdf.form_type = ocr.form_type
        INNER JOIN ingestion_fields_new AS fields
            ON pdf.session_id = fields.session_id AND pdf.document_id = fields.document_id AND pdf.form_type = fields.form_type
        WHERE pdf.session_id = ? AND pdf.document_id = ?
        ORDER BY pdf.form_type;
    """
    cursor = conn.cursor()
    cursor.execute(query, (session_id, document_id))
    rows = cursor.fetchall()

    result = []
    for row in rows:
        result.append({
            "form_type": row.form_type,
            "pdf_data": row.pdf_data,
            "ocr_text": row.ocr_text,
            "fields_json": json.loads(row.fields_json)
        })

    return result


# Grouped Docs

def save_grouped_pdf_to_db(conn, session_id, document_id, form_type, pdf_path):
    with open(pdf_path, "rb") as f:
        data = f.read()
    query = "INSERT INTO TF_ingestion_mGroupsPDF (session_id, document_id, form_type, file_data, created_at) VALUES (?, ?, ?, ?, GETDATE())"
    cursor = conn.cursor()
    cursor.execute(query, (session_id, document_id, form_type, data))
    conn.commit()

def save_grouped_text_to_db(conn, session_id, document_id, form_type, text_path):
    with open(text_path, "r", encoding="utf-8") as f:
        text = f.read()
    query = "INSERT INTO TF_ingestion_mGroupsOCR (session_id, document_id, form_type, ocr_text, created_at) VALUES (?, ?, ?, ?, GETDATE())"
    cursor = conn.cursor()
    cursor.execute(query, (session_id, document_id, form_type, text))
    conn.commit()

def save_grouped_fields_to_db(conn, session_id, document_id, form_type, fields):
    json_data = json.dumps(fields, ensure_ascii=False)
    query = "INSERT INTO TF_ingestion_mGroupsFields (session_id, document_id, form_type, fields_json, created_at) VALUES (?, ?, ?, ?, GETDATE())"
    cursor = conn.cursor()
    cursor.execute(query, (session_id, document_id, form_type, json_data))
    conn.commit()




