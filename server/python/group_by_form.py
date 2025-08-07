import os
import json
import re
from PyPDF2 import PdfMerger
from db_utils import (
    save_grouped_pdf_to_db,
    save_grouped_text_to_db,
    save_grouped_fields_to_db,
    get_sql_server_connection
)
from openai import AzureOpenAI
from dotenv import load_dotenv

# Load credentials
load_dotenv()
AZURE_API_KEY = os.getenv("AZURE_OPENAI_KEY")
AZURE_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT")
DEPLOYMENT_NAME = os.getenv("AZURE_DEPLOYMENT_NAME")

# Rule-based keyword matches
COMMON_FORM_PATTERNS = {
    "commercial_invoice": ["invoice", "commercial invoice"],
    "certificate_of_origin": ["certificate of origin"],
    "bill_of_lading": ["bill of lading"],
    "packing_list": ["packing list"],
    "insurance_certificate": ["insurance certificate"],
    "lc_terms": ["letter of credit", "lc terms", "credit terms"],
    "proforma_invoice": ["proforma invoice"],
    "remittance_advice": ["remittance advice"],
    "shipping_guarantee": ["shipping guarantee"],
    "warehouse_receipt": ["warehouse receipt"],
    "swift_message": ["swift", "mt700", "sender"]
}

def keyword_based_classification(text: str) -> str:
    text_lower = text.lower()
    for form_type, keywords in COMMON_FORM_PATTERNS.items():
        if any(k in text_lower for k in keywords):
            return form_type
    return None

def sanitize_form_name(name: str) -> str:
    name = name.lower().strip()
    name = re.sub(r"[^a-z0-9_\- ]", "", name)
    name = re.sub(r"\s+", "_", name)
    return name[:40] or "unknown"

def classify_form_type(text: str) -> str:
    if not text.strip():
        return "empty_text"

    # 1st attempt: keyword rules
    keyword_form = keyword_based_classification(text)
    if keyword_form:
        print(f"[Classifier] Keyword match: {keyword_form}")
        return keyword_form

    # 2nd attempt: fallback to OpenAI
    try:
        prompt = f"""
You are a trade finance document classifier.

Below is extracted text. Identify its document type.

Your output must be:
- A clear document type like: "Commercial Invoice", "Packing List", etc.
- Do not say "Unknown" — guess based on the content.

---
{text}
---
Return ONLY the document type name.
"""

        client = AzureOpenAI(
            api_key=AZURE_API_KEY,
            azure_endpoint=AZURE_ENDPOINT,
            api_version="2024-10-21"
        )

        response = client.chat.completions.create(
            model=DEPLOYMENT_NAME,
            messages=[
                {"role": "system", "content": "You are a trade document classification expert."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=100,
            temperature=0.0
        )

        form_name = response.choices[0].message.content.strip()
        return sanitize_form_name(form_name)

    except Exception as e:
        print(f"[OpenAI ERROR] {e}")
        return "openai_failure"

def group_documents(session_id, document_id, conn):
    base_path = os.path.join("outputs", session_id)
    subfolders = [f for f in os.listdir(base_path) if document_id in f]
    if not subfolders:
        print(f"[ERROR] No folder found for document_id: {document_id}")
        return

    input_folder = os.path.join(base_path, subfolders[0])
    grouped_data = {}
    assigned_pages = set()

    for file in sorted(os.listdir(input_folder)):
        if not file.endswith(".txt"):
            continue

        if file in assigned_pages:
            continue

        txt_path = os.path.join(input_folder, file)
        pdf_path = txt_path.replace(".txt", ".pdf")
        json_path = txt_path.replace(".txt", ".fields.json")

        with open(txt_path, "r", encoding="utf-8") as f:
            text = f.read()

        form_type = classify_form_type(text)
        form_type_clean = sanitize_form_name(form_type)

        # Skip OpenAI failures
        if form_type_clean in ["", "unknown", "openai_failure", "empty_text"]:
            form_type_clean = "unclassified"

        if form_type_clean not in grouped_data:
            grouped_data[form_type_clean] = {
                "texts": [],
                "pdfs": [],
                "jsons": []
            }

        grouped_data[form_type_clean]["texts"].append(text)
        if os.path.exists(pdf_path):
            grouped_data[form_type_clean]["pdfs"].append(pdf_path)
        if os.path.exists(json_path):
            grouped_data[form_type_clean]["jsons"].append(json_path)

        assigned_pages.add(file)
        print(f"[Grouped] {file} -> '{form_type_clean}'")

    # Save grouped outputs
    for form_type, data in grouped_data.items():
        out_dir = os.path.join("grouped", session_id, document_id, form_type)
        os.makedirs(out_dir, exist_ok=True)

        # Save combined text
        txt_path = os.path.join(out_dir, "text.txt")
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write("\n\n".join(data["texts"]))
        save_grouped_text_to_db(conn, session_id, document_id, form_type, txt_path)

        # Merge and save PDF
        if data["pdfs"]:
            pdf_path = os.path.join(out_dir, "document.pdf")
            merger = PdfMerger()
            for pdf in data["pdfs"]:
                merger.append(pdf)
            merger.write(pdf_path)
            merger.close()
            save_grouped_pdf_to_db(conn, session_id, document_id, form_type, pdf_path)

        # Merge and save fields
        all_fields = []
        for json_path in data["jsons"]:
            try:
                with open(json_path, "r", encoding="utf-8") as jf:
                    fields = json.load(jf)
                    all_fields.append(fields)
            except Exception as e:
                print(f"[Error] Skipping JSON {json_path}: {e}")

        if all_fields:
            save_grouped_fields_to_db(conn, session_id, document_id, form_type, all_fields)

    print("\n Document grouping complete.")

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 3:
        print("Usage: python group_by_form.py <session_id> <document_id>")
    else:
        session_id = sys.argv[1]
        document_id = sys.argv[2]
        conn = get_sql_server_connection()
        group_documents(session_id, document_id, conn)
