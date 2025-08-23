import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')
import os
import io
import re
import json
import pyodbc
import argparse
from PyPDF2 import PdfReader, PdfWriter
from collections import defaultdict
from pdf2image import convert_from_path
from pytesseract import image_to_string
from PIL import Image
from typing import List, Dict
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
from extract_fields import extract_fields
from db_utils import (
    save_cleaned_text_to_db,
    save_cleaned_pdf_to_db,
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
    api_version="2024-12-01-preview",
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

def extract_text_from_image_with_rotation(image: Image.Image) -> str:
    max_text = ""
    max_len = 0
    for angle in [0, 90, 180, 270]:
        rotated = image.rotate(angle, expand=True)
        gray = rotated.convert("L")  # Grayscale improves OCR accuracy
        text = image_to_string(gray).strip()
        if len(text) > max_len:
            max_text = text
            max_len = len(text)
    return max_text

def extract_text_azure_document(pdf_path):
    global azure_page_text_cache
    if azure_page_text_cache:
        return azure_page_text_cache
    with open(pdf_path, "rb") as f:
        poller = client_doc.begin_analyze_document("prebuilt-layout", f)
    result = poller.result()
    for page in result.pages:
        lines = [line.content for line in page.lines]
        page_text = "\n".join(lines)
        azure_page_text_cache.append(page_text)
    return azure_page_text_cache

import base64
from io import BytesIO

def encode_image_to_base64(image: Image.Image) -> str:
    buffer = BytesIO()
    image.save(buffer, format="JPEG")
    return base64.b64encode(buffer.getvalue()).decode("utf-8")

def refine_text_with_azure_openai_image(image: Image.Image) -> str:
    try:
        base64_image = encode_image_to_base64(image)
        image_data = f"data:image/jpeg;base64,{base64_image}"
        deployment = os.getenv("AZURE_DEPLOYMENT_NAME", "gpt-4o")

        response = client_openai.chat.completions.create(
            model=deployment,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "You are an OCR/ICR agent who will extract the text "
                                "in any language from the image, including lines, tables, "
                                "stamps, seals, and numbers in currencies. Keep them as they are "
                                "and identify them clearly. DO NOT TRANSLATE ON YOUR OWN. "
                                "Return the result as it is in the same format."
                            ),
                        },
                        {"type": "image_url", "image_url": {"url": image_data}},
                    ],
                }
            ],
            max_tokens=4096,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Azure OpenAI image OCR failed: {e}")
        return None

def extract_text_multi_ocr(image: Image.Image, pdf_path: str, page_index: int) -> Dict[str, str]:
    tesseract_text = extract_text_from_image_with_rotation(image)
    azure_doc_text = ""

    # Azure OCR
    try:
        azure_texts = extract_text_azure_document(pdf_path)
        azure_doc_text = azure_texts[page_index] if page_index < len(azure_texts) else ""
    except Exception as e:
        print(f"Azure OCR error: {e}")

    # OpenAI Clean-up (may fail)
    try:
        openai_cleaned = refine_text_with_azure_openai_image(image)
    except Exception as e:
        print(f" OpenAI cleaning failed: {e}")
        openai_cleaned = azure_doc_text or tesseract_text  # fallback

    return {
        "tesseract": tesseract_text,
        "azure_doc_intelligence": azure_doc_text,
        "azure_openai": openai_cleaned
    }

def split_pdf_by_form_type(pdf_path: str, session_id: str, document_id: str, conn, output_base: str = "./outputs", ocr_method: str = "tesseract"):
    original_filename = os.path.basename(pdf_path)
    base_name = os.path.splitext(original_filename)[0]
    output_dir = os.path.join(output_base, session_id, f"{base_name}-{document_id}")
    os.makedirs(output_dir, exist_ok=True)

    original_copy_path = os.path.join(output_dir, "original.pdf")
    with open(original_copy_path, "wb") as f_out:
        reader = PdfReader(pdf_path)
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        writer.write(f_out)

    print(f" Converting all PDF pages to images...")
    images = convert_from_path(pdf_path)

    for i, image in enumerate(images):
        page_number = i + 1
        padded_page = f"{page_number:02}"
        print(f"\n Processing Page {page_number}...")

        pdf_path_out = os.path.join(output_dir, f"Page_{padded_page}.pdf")
        txt_path_out = os.path.join(output_dir, f"Page_{padded_page}.txt")
        json_path_out = os.path.join(output_dir, f"Page_{padded_page}.fields.json")

        os.makedirs(os.path.dirname(pdf_path_out), exist_ok=True)

        reader = PdfReader(pdf_path)
        writer = PdfWriter()
        writer.add_page(reader.pages[i])
        with open(pdf_path_out, "wb") as f_pdf:
            writer.write(f_pdf)

        texts = extract_text_multi_ocr(image, pdf_path, i)

# Always prefer OpenAI, but fallback safely
        final_text = texts.get("azure_openai")
        if not final_text or "[filtered" in final_text.lower() or len(final_text.strip()) < 10:
            print(f"OpenAI blocked or failed — using fallback OCR for Page {i+1}")
            final_text = texts.get("azure_doc_intelligence") or texts.get("tesseract")

        if not final_text.strip():
            final_text = "[NO TEXT FOUND]"
            
            

        with open(txt_path_out, "w", encoding="utf-8") as f_txt:
            f_txt.write(final_text)

        if final_text.strip() == "[NO TEXT FOUND]" or len(final_text.strip()) < 10:
            fields = {}
            print(" Skipping field extraction due to empty/invalid text.")
        else:
            fields = extract_fields(final_text.strip())

        with open(json_path_out, "w", encoding="utf-8") as f_json:
            json.dump(fields, f_json, indent=2, ensure_ascii=False)

        save_cleaned_pdf_to_db(conn, session_id, document_id, f"Page_{padded_page}", pdf_path_out)
        save_cleaned_text_to_db(conn, session_id, document_id, f"Page_{padded_page}", txt_path_out)
        save_extracted_fields_to_db(conn, session_id, document_id, f"Page_{padded_page}", fields)

        print(f" Page {page_number} processed and saved.")

    print(f"\n Done splitting and saving all {len(images)} pages for session: {session_id}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Split documents by pages with OCR")
    parser.add_argument("pdf_path")
    parser.add_argument("session_id")
    parser.add_argument("document_id")
    parser.add_argument("ocr_method")
    args = parser.parse_args()
    conn = get_sql_server_connection()
    split_pdf_by_form_type(args.pdf_path, args.session_id, args.document_id, conn, ocr_method=args.ocr_method)
