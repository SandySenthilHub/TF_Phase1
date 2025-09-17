import os
import re
import json
from PyPDF2 import PdfReader
from pdf2image import convert_from_path
from pytesseract import image_to_string
from PIL import Image
from extract_fields import extract_fields
from db_utils import (
    save_cleaned_text_to_db,
    save_extracted_fields_to_db,
    save_cleaned_pdf_to_db,  # <-- save to DB
    get_sql_server_connection
)
from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.core.credentials import AzureKeyCredential
from openai import AzureOpenAI
from dotenv import load_dotenv
import argparse
from pathlib import Path

# -------------------------------
# Load environment variables
# -------------------------------
load_dotenv()
key_doc = os.getenv("AZURE_DOC_KEY")
endpoint_doc = os.getenv("AZURE_DOC_ENDPOINT")
credential_doc = AzureKeyCredential(key_doc)
client_doc = DocumentIntelligenceClient(endpoint_doc, credential_doc)

client_openai = AzureOpenAI(
    api_key=os.getenv("AZURE_OPENAI_KEY"),
    api_version="2024-12-01-preview",
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
)

# -------------------------------
# Text extraction helpers
# -------------------------------
def extract_text_from_pdf(pdf_path: str) -> str:
    reader = PdfReader(pdf_path)
    full_text = ""
    for page in reader.pages:
        text = page.extract_text() or ""
        full_text += text + "\n"
    return full_text.strip()

def extract_text_from_image(image: Image.Image) -> str:
    return image_to_string(image).strip()

def extract_text_azure_document(pdf_path: str) -> str:
    with open(pdf_path, "rb") as f:
        poller = client_doc.begin_analyze_document("prebuilt-layout", f)
    result = poller.result()
    pages_text = []
    for page in result.pages:
        lines = [line.content for line in page.lines]
        pages_text.append("\n".join(lines))
    return "\n".join(pages_text)

def extract_text_fallback(pdf_path: str, method: str = "tesseract") -> str:
    print(" PDF text is empty, running fallback OCR...")
    images = convert_from_path(pdf_path)
    full_text = ""

    if method.lower() == "azure":
        try:
            full_text = extract_text_azure_document(pdf_path)
            if full_text.strip():
                return full_text
        except Exception as e:
            print(f"Azure OCR failed: {e}")

    for image in images:
        page_text = extract_text_from_image(image)
        if page_text.strip():
            full_text += page_text + "\n\n"
    return full_text.strip()

# -------------------------------
# Main processing function
# -------------------------------
def process_pdf(pdf_path: str, session_id: str, document_id: str, ocr_method: str = "tesseract"):
    conn = get_sql_server_connection()
    print(f" Processing PDF: {pdf_path}")

    # -------------------------------
    # Save PDF to database
    # -------------------------------
    save_cleaned_pdf_to_db(conn, session_id, document_id, "full_document", pdf_path)
    print(" PDF saved to database.")

    # -------------------------------
    # Save PDF locally in ./outputs folder
    # -------------------------------
    output_dir = Path("outputs") / session_id
    output_dir.mkdir(parents=True, exist_ok=True)
    local_pdf_path = output_dir / f"{document_id}.pdf"
    with open(pdf_path, "rb") as src_file, open(local_pdf_path, "wb") as dst_file:
        dst_file.write(src_file.read())
    print(f" PDF saved locally at: {local_pdf_path}")

    # -------------------------------
    # Extract text
    # -------------------------------
    full_text = extract_text_from_pdf(pdf_path)
    if not full_text.strip():
        full_text = extract_text_fallback(pdf_path, method=ocr_method)
    if not full_text.strip():
        full_text = "[NO TEXT FOUND]"

    # -------------------------------
    # Extract structured fields
    # -------------------------------
    fields = extract_fields(full_text)

    # -------------------------------
    # Save text and extracted fields to database
    # -------------------------------
    save_cleaned_text_to_db(conn, session_id, document_id, "full_document", full_text)
    save_extracted_fields_to_db(conn, session_id, document_id, "full_document", fields)
    print(" OCR and field extraction completed successfully.")

# -------------------------------
# Command-line interface
# -------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OCR and extract fields from PDF")
    parser.add_argument("pdf_path")
    parser.add_argument("session_id")
    parser.add_argument("document_id")
    parser.add_argument("ocr_method", nargs="?", default="azure")
    args = parser.parse_args()

    process_pdf(args.pdf_path, args.session_id, args.document_id, args.ocr_method)
