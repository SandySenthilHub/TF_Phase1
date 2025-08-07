import sys
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
    # save_raw_document_to_db,
    save_cleaned_text_to_db,
    save_cleaned_pdf_to_db,
    save_extracted_fields_to_db,
    get_sql_server_connection,
    save_grouped_pdf_to_db, save_grouped_text_to_db, save_grouped_fields_to_db, get_cleaned_split_data
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

import cv2
import numpy as np

def ocr_image_with_best_rotation(pil_image: Image.Image) -> str:
    """
    Try OCR at 0, 90, 180, and 270 degrees and return the one with most text content.
    """
    max_text = ""
    max_len = 0

    for angle in [0, 90, 180, 270]:
        rotated = pil_image.rotate(angle, expand=True)
        cv_img = cv2.cvtColor(np.array(rotated), cv2.COLOR_RGB2BGR)
        gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
        text = image_to_string(gray)
        text = text.strip()
        if len(text) > max_len:
            max_text = text
            max_len = len(text)

    return max_text


def extract_text_tesseract(image: Image.Image) -> str:
    raw_text = ocr_image_with_best_rotation(image)
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


from pdf2image import convert_from_path
from pytesseract import image_to_string
from PIL import Image

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


def split_pdf_by_form_type(pdf_path: str, session_id: str, document_id: str, conn, output_base: str = "./outputs", ocr_method: str = "tesseract"):
    from PyPDF2 import PdfReader, PdfWriter

    original_filename = os.path.basename(pdf_path)
    base_name = os.path.splitext(original_filename)[0]
    output_dir = os.path.join(output_base, session_id, f"{base_name}-{document_id}")
    os.makedirs(output_dir, exist_ok=True)

    # Save original PDF
    original_copy_path = os.path.join(output_dir, "original.pdf")
    with open(original_copy_path, "wb") as f_out:
        reader = PdfReader(pdf_path)
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        writer.write(f_out)

    # Save original to DB
    # save_raw_document_to_db(conn, session_id, document_id, original_filename, original_copy_path)

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

        #  Export single-page PDF FIRST
        reader = PdfReader(pdf_path)
        writer = PdfWriter()
        writer.add_page(reader.pages[i])
        with open(pdf_path_out, "wb") as f_pdf:
            writer.write(f_pdf)

        #  Now it’s safe to extract + save
        text = extract_text_from_image_with_rotation(image)

        if not text or len(text.strip()) < 20:
            print(f" Tesseract OCR failed or returned low confidence on page {page_number}")
            try:
                print(" Trying Azure OCR fallback...")
                texts = extract_text_azure_document(pdf_path)
                text = texts[i] if i < len(texts) else ""
            except Exception as azure_error:
                print(f" Azure fallback also failed: {azure_error}")
                text = "[NO TEXT FOUND]"

        with open(txt_path_out, "w", encoding="utf-8") as f_txt:
            f_txt.write(text)

        if text.strip() == "[NO TEXT FOUND]" or len(text.strip()) < 10:
            fields = {}
            print(" Skipping field extraction due to empty/invalid text.")
        else:
            fields = extract_fields(text.strip())

        with open(json_path_out, "w", encoding="utf-8") as f_json:
            json.dump(fields, f_json, indent=2, ensure_ascii=False)

            save_cleaned_pdf_to_db(conn, session_id, document_id, f"Page_{padded_page}", pdf_path_out)
            save_cleaned_text_to_db(conn, session_id, document_id, f"Page_{padded_page}", txt_path_out)
            save_extracted_fields_to_db(conn, session_id, document_id, f"Page_{padded_page}", fields)

        print(f" Page {page_number} processed and saved.")

    print(f"\n Done splitting and saving all {len(images)} pages for session: {session_id}")





if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Split documents by pages with OCR")
    parser.add_argument("pdf_path")
    parser.add_argument("session_id")
    parser.add_argument("document_id")
    parser.add_argument("ocr_method")
    args = parser.parse_args()
    conn = get_sql_server_connection()
    split_pdf_by_form_type(args.pdf_path, args.session_id, args.document_id, conn, ocr_method=args.ocr_method)

