import sys
import os
import re
import json
import pyodbc
from PyPDF2 import PdfReader, PdfWriter
from pdf2image import convert_from_path
from pytesseract import image_to_string
from PIL import Image
from typing import List, Dict
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
from extract_fields import extract_fields
from db_utils import (
    save_raw_document_to_db,
    save_cleaned_documents_to_db,
    save_extracted_fields_to_db,
    get_sql_server_connection
)

# Azure OCR & OpenAI
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.core.credentials import AzureKeyCredential
from openai import AzureOpenAI

# Load credentials from .env
load_dotenv()
key_doc = os.getenv("AZURE_DOC_KEY")
endpoint_doc = os.getenv("AZURE_DOC_ENDPOINT")
credential_doc = AzureKeyCredential(key_doc)
client_doc = DocumentIntelligenceClient(endpoint_doc, credential_doc)

client_openai = AzureOpenAI(
    api_key=os.getenv("AZURE_OPENAI_KEY"),
    api_version="2025-01-01-preview",
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
)

# Cache for Azure OCR page texts
azure_page_text_cache = []


def sanitize_form_name(name: str) -> str:
    name = name.upper().strip()
    name = re.sub(r"[^A-Z0-9 ]", "", name)
    name = re.sub(r"\s+", "_", name)
    return name[:50]


def classify_form_type(text: str, fallback_name: str) -> str:
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    for line in lines[:5]:
        if len(line) >= 5 and not re.match(r"^\d+$", line):
            cleaned = sanitize_form_name(line)
            if cleaned:
                return cleaned
    return sanitize_form_name(fallback_name)


def extract_text_tesseract(pdf_path, page_number):
    images = convert_from_path(pdf_path, first_page=page_number + 1, last_page=page_number + 1)
    if images:
        raw_text = image_to_string(images[0])
        cleaned = re.sub(r'[ \t]+', ' ', raw_text)
        cleaned = re.sub(r'\n{3,}', '\n\n', cleaned).strip()
        lines = cleaned.split('\n')
        merged = []
        for i, line in enumerate(lines):
            if i < len(lines) - 1 and not line.endswith(('.', ':')) and len(line) < 80:
                merged.append(line + ' ' + lines[i + 1].strip())
                lines[i + 1] = ''
            elif line:
                merged.append(line)
        return '\n'.join([l for l in merged if l.strip()])
    return ""


def extract_text_azure_document(pdf_path):
    global azure_page_text_cache
    if azure_page_text_cache:  # If already processed
        return azure_page_text_cache

    client = DocumentIntelligenceClient(
        endpoint=os.getenv("AZURE_DOC_ENDPOINT"),
        credential=AzureKeyCredential(os.getenv("AZURE_DOC_KEY"))
    )

    with open(pdf_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-layout", f)

    result = poller.result()

    for page in result.pages:
        lines = [line.content for line in page.lines]
        page_text = "\n".join(lines)
        azure_page_text_cache.append(page_text)

    return azure_page_text_cache


def refine_text_with_azure_openai(raw_text: str) -> str:
    deployment = os.getenv("AZURE_DEPLOYMENT_NAME", "gpt-4")
    response = client_openai.chat.completions.create(
        model=deployment,
        messages=[
            {"role": "system", "content": "You are an OCR text cleaner."},
            {"role": "user", "content": f"Clean this OCR text:\n\n{raw_text}"}
        ],
        temperature=0.2
    )
    return response.choices[0].message.content.strip()


def extract_text_from_image_page(pdf_path, page_number, method="tesseract"):
    if method == "azure":
        texts = extract_text_azure_document(pdf_path)
        return texts[page_number] if page_number < len(texts) else ""
    else:
        return extract_text_tesseract(pdf_path, page_number)


def split_pdf_by_form_type(pdf_path: str, session_id: str, document_id: str, conn, output_base: str = "./outputs", ocr_method: str = "tesseract"):
    reader = PdfReader(pdf_path)
    original_filename = os.path.basename(pdf_path)
    base_name = os.path.splitext(original_filename)[0]

    output_dir = os.path.join(output_base, session_id, f"{base_name}-{document_id}")
    os.makedirs(output_dir, exist_ok=True)

    # Save original PDF
    original_copy_path = os.path.join(output_dir, "original.pdf")
    with open(original_copy_path, "wb") as f_out:
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        writer.write(f_out)

    # Save original PDF to DB
    save_raw_document_to_db(conn, session_id, document_id, original_filename, original_copy_path)

    print(f" Extracting and splitting each page using [{ocr_method}]...")

    for i, page in enumerate(reader.pages):
        writer = PdfWriter()
        writer.add_page(page)

        page_number = i + 1
        padded_page = f"{page_number:02}"

        pdf_path_out = os.path.join(output_dir, f"Page_{padded_page}.pdf")
        txt_path_out = os.path.join(output_dir, f"Page_{padded_page}.txt")
        json_path_out = os.path.join(output_dir, f"Page_{padded_page}.fields.json")

        # Save individual page PDF
        with open(pdf_path_out, "wb") as f_out:
            writer.write(f_out)

        # Extract text
        text = extract_text_from_image_page(pdf_path, i, method=ocr_method)

        with open(txt_path_out, "w", encoding="utf-8") as f_txt:
            f_txt.write(text.strip())

        # Extract fields
        fields = extract_fields(text.strip())
        with open(json_path_out, "w", encoding="utf-8") as f_json:
            json.dump(fields, f_json, indent=2, ensure_ascii=False)

        # Save to DB
        save_cleaned_documents_to_db(conn, session_id, document_id, f"Page_{padded_page}", pdf_path_out, txt_path_out)
        save_extracted_fields_to_db(conn, session_id, document_id, f"Page_{padded_page}", fields)

        print(f"    Saved Page {page_number}")
        print(f"    PDF: {pdf_path_out}")
        print(f"    Text: {txt_path_out}")
        print(f"    Fields JSON: {json_path_out}")

    print(f"\n  Done splitting and saving all {len(reader.pages)} pages for session: {session_id} using OCR: {ocr_method}.")

    return output_dir


# Entry Point
if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python split_by_form.py <pdf_path> <session_id> <document_id> [ocr_method]")
        sys.exit(1)

    pdf_path = sys.argv[1]
    session_id = sys.argv[2]
    document_id = sys.argv[3]
    ocr_method = sys.argv[4] if len(sys.argv) > 4 else "tesseract"

    try:
        conn = get_sql_server_connection()
        split_pdf_by_form_type(pdf_path, session_id, document_id, conn, ocr_method=ocr_method)
    except Exception as e:
        print(" Split operation failed:", e)
        sys.exit(1)
