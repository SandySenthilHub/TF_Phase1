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
from pydantic import BaseModel, Field

# Azure OpenAI credentials
AZURE_API_KEY = "3etbcid9Lmrf1MZ0hLxDyu4ZClFJw5rWVHq6WXWYHWAEzE6MPwLMJQQJ99BFACYeBjFXJ3w3AAABACOGKNeb"
AZURE_ENDPOINT = "https://shahul.openai.azure.com/"
DEPLOYMENT_NAME = "gpt-4o"

class ToolParameters(BaseModel):
    extracted_text: str = Field(description="Text from document")


def classify_form_type(extracted_text: str) -> str:
    """
    Classifies the document type using Azure OpenAI.
    Returns something like 'Commercial Invoice', 'Shipping Guarantee', etc.
    If not known, it still returns a meaningful custom name (e.g., 'Warehouse Receipt').
    """
    if not extracted_text.strip():
        return "Unknown"

    prompt = f"""
You are a trade finance document classifier.

Below is the extracted text from a document. Identify what type of trade document it is.

Your answer should be:
- A concise document type like: "Commercial Invoice", "Certificate of Origin", "Shipping Guarantee", etc.
- If the document doesn't match any known types, generate the most appropriate custom name based on the content (e.g., "Remittance Advice", "Warehouse Receipt").

DO NOT return "Unknown" — always suggest the most meaningful document type name.

---
{extracted_text}
---
Return only the name of the document type.
"""

    try:
        client = AzureOpenAI(
            api_key=AZURE_API_KEY,
            azure_endpoint=AZURE_ENDPOINT,
            api_version="2024-10-21"
        )

        response = client.chat.completions.create(
            model=DEPLOYMENT_NAME,
            messages=[
                {"role": "system", "content": "You are an expert in trade document classification."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=100,
            temperature=0,
            top_p=1.0
        )

        document_type = response.choices[0].message.content.strip()

        # Fallback
        return document_type if document_type else "Unknown"

    except Exception as e:
        print(f"[ERROR] OpenAI classification failed: {e}")
        return "Unknown"


def group_documents(session_id, document_id, conn):
    base_path = os.path.join("outputs", session_id)
    subfolders = [f for f in os.listdir(base_path) if document_id in f]
    if not subfolders:
        print(f"No matching subfolder found for document_id: {document_id}")
        return

    input_folder = os.path.join(base_path, subfolders[0])
    grouped_data = {}

    for file in sorted(os.listdir(input_folder)):
        if file.endswith(".txt"):
            txt_path = os.path.join(input_folder, file)
            pdf_path = txt_path.replace(".txt", ".pdf")
            json_path = txt_path.replace(".txt", "_fields.json")

            with open(txt_path, "r", encoding="utf-8") as f:
                text = f.read()

            # Call GPT to classify document type
            raw_form_type = classify_form_type(text)
            form_type = re.sub(r"[^\w\-]+", "_", raw_form_type).strip("_")[:40]

            if form_type not in grouped_data:
                grouped_data[form_type] = {
                    "texts": [],
                    "pdfs": [],
                    "jsons": []
                }

            grouped_data[form_type]["texts"].append(text)
            if os.path.exists(pdf_path):
                grouped_data[form_type]["pdfs"].append(pdf_path)
            if os.path.exists(json_path):
                grouped_data[form_type]["jsons"].append(json_path)

            print(f"[Grouped] '{file}' -> {form_type}")

    # Save each grouped result
    for form_type, data in grouped_data.items():
        temp_dir = os.path.join("grouped", session_id, document_id, form_type)
        os.makedirs(temp_dir, exist_ok=True)

        # Save merged text
        txt_file_path = os.path.join(temp_dir, "text.txt")
        with open(txt_file_path, "w", encoding="utf-8") as f:
            f.write("\n\n".join(data["texts"]))
        save_grouped_text_to_db(conn, session_id, document_id, form_type, txt_file_path)

        # Save merged PDF
        if data["pdfs"]:
            pdf_output_path = os.path.join(temp_dir, "document.pdf")
            merger = PdfMerger()
            for pdf in data["pdfs"]:
                merger.append(pdf)
            merger.write(pdf_output_path)
            merger.close()
            save_grouped_pdf_to_db(conn, session_id, document_id, form_type, pdf_output_path)

        # Save merged fields
        all_fields = []
        for json_path in data["jsons"]:
            try:
                with open(json_path, "r", encoding="utf-8") as jf:
                    fields = json.load(jf)
                    all_fields.append(fields)
            except Exception as e:
                print(f"[Error] Failed to read JSON: {json_path} -> {e}")

        if all_fields:
            save_grouped_fields_to_db(conn, session_id, document_id, form_type, all_fields)

    print(" Grouping and saving completed.")


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 3:
        print("Usage: python group_by_form.py <session_id> <document_id>")
    else:
        session_id = sys.argv[1]
        document_id = sys.argv[2]
        conn = get_sql_server_connection()
        group_documents(session_id, document_id, conn)
