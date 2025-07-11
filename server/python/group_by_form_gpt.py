import os
import json
import re
import openai
from PyPDF2 import PdfMerger
from db_utils import (
    save_grouped_pdf_to_db,
    save_grouped_text_to_db,
    save_grouped_fields_to_db,
    get_sql_server_connection
)

#  Set your OpenAI API key using environment variable
openai.api_key = os.getenv("OPENAI_API_KEY")


def detect_form_type(text):
    """
    Detects document form type using GPT-4 by classifying the given OCR-extracted text.
    """
    try:
        prompt = f"""
You are an expert in trade finance documentation. Given the following extracted text from a scanned document, identify the type of document.

Possible types include:
- LC (Letter of Credit)
- Invoice
- BL (Bill of Lading)
- AWB (Air Waybill)
- Packing List
- Certificate of Origin
- Insurance
- Draft
- Inspection
- Shipping Advice
- UNKNOWN (if none of the above)

Respond with only the document type from the above list. No extra explanation.

Text:
{text[:3000]}
        """

        response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You classify trade finance documents."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=10,
        )

        form_type = response.choices[0].message['content'].strip()
        valid_types = [
            "LC", "Invoice", "BL", "AWB", "Packing List", "Certificate of Origin",
            "Insurance", "Draft", "Inspection", "Shipping Advice"
        ]
        return form_type if form_type in valid_types else "UNKNOWN"

    except Exception as e:
        print(f" GPT-4 form detection failed: {e}")
        return "UNKNOWN"


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

            raw_form_type = detect_form_type(text)
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

            print(f" Grouped '{file}' -> {form_type}")

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
                print(f" Failed reading {json_path}: {e}")

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
