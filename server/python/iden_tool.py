"""
Document Classification Tool using Azure OpenAI.

This tool takes markdown-style extracted document text and classifies the type of document.
It returns document types like 'swift', 'lc', 'invoice', etc.
"""

from pydantic import BaseModel, Field
from typing import Any
from openai import AzureOpenAI
import json
import argparse
import re
import pandas as pd

# Load document types
df = pd.read_excel("Format.xlsx")
doc_format_types = df["Document name"].dropna().unique().tolist()

class UserParameters(BaseModel):
    """
    Azure OpenAI credentials.
    """
    azure_api_key: str = '3etbcid9Lmrf1MZ0hLxDyu4ZClFJw5rWVHq6WXWYHWAEzE6MPwLMJQQJ99BFACYeBjFXJ3w3AAABACOGKNeb'
    azure_endpoint: str = 'https://shahul.openai.azure.com/'
    deployment_name: str = 'gpt-4o'

class ToolParameters(BaseModel):
    """
    The extracted text to be classified.
    """
    extracted_text: str = Field(description="The text extracted from a document to classify.")

def run_tool(config: UserParameters, args: ToolParameters) -> Any:
    """
    Classifies a document's type using Azure OpenAI based on the extracted text.
    Returns one of: 'swift', 'lc', 'invoice', etc.
    """
    if not args.extracted_text.strip():
        return {"error": "No content provided to classify."}

    prompt = f"""
You are an expert in classifying international trade documents.

Based on the following extracted text, classify the type of document.
Possible document types include: {', '.join(doc_format_types)}

If the document is a SWIFT message, try to identify whether it is '700MT', '799MT', or another type.
Return ONLY the document type in lowercase, for example: 'swift 700mt', 'lc', 'invoice', etc.

---
{args.extracted_text[:2000]}
---
"""

    try:
        client = AzureOpenAI(
            api_key=config.azure_api_key,
            azure_endpoint=config.azure_endpoint,
            api_version="2024-10-21",
        )

        response = client.chat.completions.create(
            model=config.deployment_name,
            messages=[
                {"role": "system", "content": "You are an expert in classifying international trade documents."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=100,
            temperature=0,
            top_p=1.0,
        )

        document_type = response.choices[0].message.content.strip().lower()

        valid_types = [
            "swift", "letter of credit", "lc", "packing list", "certificate of origin", "bill of lading",
            "certificate from shipping company", "bill of exchange", "invoice",
            "insurance certificate", "mill certificate", "certificate of weight"
        ]

        # Handle SWIFT-specific classification
        if "swift" in document_type:
            match = re.search(r"mt\s*(\d{3})", args.extracted_text, re.IGNORECASE)
            if match:
                mt_code = match.group(1)
                document_type = f"swift {mt_code}mt"
            elif not re.search(r"\d{3}", document_type):
                document_type = "swift unknown"

        if document_type not in valid_types and not document_type.startswith("swift"):
            return {"error": f"Unrecognized document type: {document_type}"}

        return {"result": document_type}

    except Exception as e:
        return {"error": f"Error during classification: {str(e)}"}

# Constants for output key
OUTPUT_KEY = "tool_output"

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-params", required=True, help="Tool configuration (JSON)")
    parser.add_argument("--tool-params", required=False, help="Tool input parameters (JSON)")
    parser.add_argument("--file", help="Path to input file instead of tool-params")

    args = parser.parse_args()

    # Parse user params
    user_dict = json.loads(args.user_params)
    config = UserParameters(**user_dict)

    # Load text from file or from tool-params
    if args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            text = f.read()
        tool_dict = {"extracted_text": text}
    elif args.tool_params:
        tool_dict = json.loads(args.tool_params)
    else:
        raise ValueError("Either --tool-params or --file must be provided.")

    params = ToolParameters(**tool_dict)
    output = run_tool(config, params)
    print(OUTPUT_KEY, output)
