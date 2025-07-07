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
from dotenv import load_dotenv
from pathlib import Path
from extract_fields import extract_fields
from db_utils import (
    save_raw_document_to_db,
    save_cleaned_documents_to_db,
    save_extracted_fields_to_db
)

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.core.credentials import AzureKeyCredential
from openai import AzureOpenAI
import requests



def classify_form_type(text: str, fallback_name: str) -> str:
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    for line in lines[:5]:
        if len(line) >= 5 and not re.match(r"^\d+$", line):
            cleaned = sanitize_form_name(line)
            if cleaned:
                return cleaned
    return sanitize_form_name(fallback_name)


def sanitize_form_name(name: str) -> str:
    name = name.upper().strip()
    name = re.sub(r"[^A-Z0-9 ]", "", name)
    name = re.sub(r"\s+", "_", name)
    return name[:50]


def extract_text_from_image_page(pdf_path, page_number):
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


def split_pdf_by_form_type(pdf_path: str, session_id: str, document_id: str, conn, output_base: str = "./outputs"):
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

    full_text = ""
    form_groups = []
    current_group = []
    last_type = None

    print(" Extracting and classifying pages...")
    for i, page in enumerate(reader.pages):
        text = extract_text_from_image_page(pdf_path, i)
        full_text += f"\n--- Page {i+1} ---\n{text.strip()}\n"
        form_type = classify_form_type(text, base_name)

        if form_type == last_type:
            current_group.append((i, text))
        else:
            if current_group:
                form_groups.append((last_type, current_group))
            current_group = [(i, text)]
            last_type = form_type

    if current_group:
        form_groups.append((last_type, current_group))

    with open(os.path.join(output_dir, "original_text.txt"), "w", encoding="utf-8") as f_txt:
        f_txt.write(full_text.strip())

    # Save form groups
    for idx, (form_type, pages) in enumerate(form_groups):
        writer = PdfWriter()
        text_out = ""

        for page_num, text in pages:
            writer.add_page(reader.pages[page_num])
            text_out += f"\n--- Page {page_num+1} ---\n{text.strip()}\n"

        short_form = sanitize_form_name(form_type)[:30]
        suffix = f"{session_id[:8]}_part{idx+1}"
        split_pdf_path = os.path.join(output_dir, f"{short_form}_{suffix}.pdf")
        split_text_path = os.path.join(output_dir, f"{short_form}_{suffix}.txt")
        split_json_path = split_text_path.replace('.txt', '.fields.json')

        with open(split_pdf_path, "wb") as f_split:
            writer.write(f_split)

        with open(split_text_path, "w", encoding="utf-8") as f_text:
            f_text.write(text_out.strip())

        fields = extract_fields(text_out.strip())
        with open(split_json_path, "w", encoding="utf-8") as f_json:
            json.dump(fields, f_json, indent=2, ensure_ascii=False)

        # Save to database
        save_cleaned_documents_to_db(conn, session_id, document_id, form_type, split_pdf_path, split_text_path)
        save_extracted_fields_to_db(conn, session_id, document_id, form_type, fields)

        print(f"   Saved {form_type} - Part {idx+1}")
        print(f"   PDF: {split_pdf_path}")
        print(f"   Text: {split_text_path}")
        print(f"   Fields JSON: {split_json_path}")

    print(f"\n Done splitting and saving all files for session: {session_id}")
    return output_dir


# Entry Point
if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python split_by_form.py <pdf_path> <session_id> <document_id>")
        sys.exit(1)

    pdf_path = sys.argv[1]
    session_id = sys.argv[2]
    document_id = sys.argv[3]

    from db_utils import get_sql_server_connection

    try:
        conn = get_sql_server_connection()
        split_pdf_by_form_type(pdf_path, session_id, document_id, conn)
    except Exception as e:
        print(" Split operation failed:", e)
        sys.exit(1)






# import sys
# import os
# import re
# import json
# import pyodbc
# from PyPDF2 import PdfReader, PdfWriter
# from pdf2image import convert_from_path
# from pytesseract import image_to_string
# from PIL import Image
# from typing import List, Dict
# from datetime import datetime
# from typing import Dict
# from extract_fields import extract_fields
# from db_utils import (
#     save_raw_document_to_db,
#     save_cleaned_documents_to_db,
#     save_extracted_fields_to_db
# )


# def classify_form_type(text: str, fallback_name: str) -> str:
    
#     lines = [line.strip() for line in text.split('\n') if line.strip()]
#     for line in lines[:5]:
#         if len(line) >= 5 and not re.match(r"^\d+$", line):  # Ignore numbers
#             cleaned = sanitize_form_name(line)
#             if cleaned:
#                 return cleaned
#     return sanitize_form_name(fallback_name)



# def sanitize_form_name(name: str) -> str:
#     # Clean form name for filenames
#     name = name.upper().strip()
#     name = re.sub(r"[^A-Z0-9 ]", "", name)  # remove special characters
#     name = re.sub(r"\s+", "_", name)        # spaces to underscore
#     return name[:50]  # limit length


# def extract_text_from_image_page(pdf_path, page_number):
#     images = convert_from_path(pdf_path, first_page=page_number + 1, last_page=page_number + 1)
#     if images:
#         raw_text = image_to_string(images[0])

#         # Basic cleanup
#         cleaned = re.sub(r'[ \t]+', ' ', raw_text)               # normalize spaces
#         cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)             # limit blank lines
#         cleaned = cleaned.strip()

#         # Fix broken lines inside paragraphs (optional, if OCR is good enough)
#         lines = cleaned.split('\n')
#         merged = []
#         for i, line in enumerate(lines):
#             if i < len(lines) - 1 and not line.endswith(('.', ':')) and len(line) < 80:
#                 # join with next line if not end of sentence
#                 merged.append(line + ' ' + lines[i + 1].strip())
#                 lines[i + 1] = ''
#             elif line:
#                 merged.append(line)

#         cleaned_text = '\n'.join([l for l in merged if l.strip()])

#         return cleaned_text

#     return ""

# # def split_pdf_by_form_type(pdf_path: str, session_id: str, document_id: str, output_base: str = "./outputs"):
# #     reader = PdfReader(pdf_path)
# #     original_filename = os.path.basename(pdf_path)
# #     base_name = os.path.splitext(original_filename)[0]

# #     output_dir = os.path.join(output_base, session_id, f"{base_name}-{document_id}")
# #     os.makedirs(output_dir, exist_ok=True)

# #     # Save original PDF
# #     original_copy_path = os.path.join(output_dir, "original.pdf")
# #     with open(original_copy_path, "wb") as f_out:
# #         writer = PdfWriter()
# #         for page in reader.pages:
# #             writer.add_page(page)
# #         writer.write(f_out)

# #     form_buckets: Dict[str, List[int]] = {}
# #     full_text = ""

# #     print(" Extracting and classifying pages...")
# #     for i, page in enumerate(reader.pages):
# #         text = extract_text_from_image_page(pdf_path, i)
# #         full_text += f"\n--- Page {i+1} ---\n{text.strip()}\n"
# #         form_type = classify_form_type(text, base_name)
# #         form_buckets.setdefault(form_type, []).append(i)

# #     # Save full original OCR text
# #     with open(os.path.join(output_dir, "original_text.txt"), "w", encoding="utf-8") as f_txt:
# #         f_txt.write(full_text.strip())

# #     # Save each form group PDF + text + fields.json
# #     for form_type, pages in form_buckets.items():
# #         writer = PdfWriter()
# #         text_out = ""

# #         for page_num in pages:
# #             writer.add_page(reader.pages[page_num])
# #             text = extract_text_from_image_page(pdf_path, page_num)
# #             text_out += f"\n--- Page {page_num+1} ---\n{text.strip()}\n"

# #         short_form = form_type[:30]
# #         split_pdf_path = os.path.join(output_dir, f"{short_form}_{session_id[:8]}.pdf")
# #         split_text_path = os.path.join(output_dir, f"{short_form}_{session_id[:8]}.txt")
# #         split_json_path = split_text_path.replace('.txt', '.fields.json')

# #         # Save split PDF
# #         with open(split_pdf_path, "wb") as f_split:
# #             writer.write(f_split)

# #         # Save OCR text
# #         with open(split_text_path, "w", encoding="utf-8") as f_text:
# #             f_text.write(text_out.strip())

# #         # Save extracted fields as JSON
# #         fields = extract_fields(text_out.strip())
# #         with open(split_json_path, "w", encoding="utf-8") as f_json:
# #             json.dump(fields, f_json, indent=2, ensure_ascii=False)

# #         print(f" Saved {form_type}:")
# #         print(f" {split_pdf_path}")
# #         print(f" {split_text_path}")
# #         print(f" {split_json_path}")

# #     print(f"\n Done splitting and saving all files for session: {session_id}")
# #     return output_dir



# def split_pdf_by_form_type(pdf_path: str, session_id: str, document_id: str, conn, output_base: str = "./outputs"):
#     reader = PdfReader(pdf_path)
#     original_filename = os.path.basename(pdf_path)
#     base_name = os.path.splitext(original_filename)[0]

#     output_dir = os.path.join(output_base, session_id, f"{base_name}-{document_id}")
#     os.makedirs(output_dir, exist_ok=True)

#     # Save original PDF
#     original_copy_path = os.path.join(output_dir, "original.pdf")
#     with open(original_copy_path, "wb") as f_out:
#         writer = PdfWriter()
#         for page in reader.pages:
#             writer.add_page(page)
#         writer.write(f_out)

#     # Save original PDF to DB
#     save_raw_document_to_db(conn, session_id, document_id, original_filename, original_copy_path)

#     full_text = ""
#     form_groups = []
#     current_group = []
#     last_type = None

#     print("🔍 Extracting and classifying pages...")
#     for i, page in enumerate(reader.pages):
#         text = extract_text_from_image_page(pdf_path, i)
#         full_text += f"\n--- Page {i+1} ---\n{text.strip()}\n"
#         form_type = classify_form_type(text, base_name)

#         if form_type == last_type:
#             current_group.append((i, text))
#         else:
#             if current_group:
#                 form_groups.append((last_type, current_group))
#             current_group = [(i, text)]
#             last_type = form_type

#     if current_group:
#         form_groups.append((last_type, current_group))

#     with open(os.path.join(output_dir, "original_text.txt"), "w", encoding="utf-8") as f_txt:
#         f_txt.write(full_text.strip())

#     # Save form groups
#     for idx, (form_type, pages) in enumerate(form_groups):
#         writer = PdfWriter()
#         text_out = ""

#         for page_num, text in pages:
#             writer.add_page(reader.pages[page_num])
#             text_out += f"\n--- Page {page_num+1} ---\n{text.strip()}\n"

#         short_form = sanitize_form_name(form_type)[:30]
#         suffix = f"{session_id[:8]}_part{idx+1}"
#         split_pdf_path = os.path.join(output_dir, f"{short_form}_{suffix}.pdf")
#         split_text_path = os.path.join(output_dir, f"{short_form}_{suffix}.txt")
#         split_json_path = split_text_path.replace('.txt', '.fields.json')

#         with open(split_pdf_path, "wb") as f_split:
#             writer.write(f_split)

#         with open(split_text_path, "w", encoding="utf-8") as f_text:
#             f_text.write(text_out.strip())

#         fields = extract_fields(text_out.strip())
#         with open(split_json_path, "w", encoding="utf-8") as f_json:
#             json.dump(fields, f_json, indent=2, ensure_ascii=False)

#         # Save to database
#         save_cleaned_documents_to_db(conn, session_id, document_id, form_type, split_pdf_path, split_text_path)
#         save_extracted_fields_to_db(conn, session_id, document_id, form_type, fields)

#         print(f"✅ Saved {form_type} - Part {idx+1}")
#         print(f"   PDF: {split_pdf_path}")
#         print(f"   Text: {split_text_path}")
#         print(f"   Fields JSON: {split_json_path}")

#     print(f"\n🎉 Done splitting and saving all files for session: {session_id}")
#     return output_dir



# # Entry point
# if __name__ == "__main__":
#     if len(sys.argv) < 4:
#         print("Usage: python split_by_form.py <pdf_path> <session_id> <document_id>")
#         sys.exit(1)

#     pdf_path = sys.argv[1]
#     session_id = sys.argv[2]
#     document_id = sys.argv[3]

#     split_pdf_by_form_type(pdf_path, session_id, document_id)
