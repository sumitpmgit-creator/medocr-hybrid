# Generates SYNTHETIC self-test fixtures (fake documents, no real patient data).
import json
from PIL import Image, ImageDraw
docs = [
  ("st-01", "lab_report", "CITY LAB Hemoglobin 13.5 g/dL Platelets 250000 /uL", {"patient_age": "42", "tests": [{"name": "Hemoglobin", "value": "13.5", "unit": "g/dL"}, {"name": "Platelets", "value": "250000", "unit": "/uL"}]}),
  ("st-02", "prescription", "Rx Paracetamol 500 mg twice daily for 5 days", {"patient_age": "31", "medications": [{"name": "Paracetamol", "dose": "500 mg", "frequency": "twice daily"}]}),
  ("st-03", "lab_report", "Fasting glucose 96 mg/dL HbA1c 5.4 %", {"patient_age": "55", "tests": [{"name": "Fasting glucose", "value": "96", "unit": "mg/dL"}, {"name": "HbA1c", "value": "5.4", "unit": "%"}]}),
  ("st-12", "prescription", "Rx Amoxicillin 250 mg thrice daily for 7 days", {"patient_age": "8", "medications": [{"name": "Amoxicillin", "dose": "250 mg", "frequency": "thrice daily"}]}),
]
with open("fixtures/manifest.jsonl", "w") as f:
    for id_, dt, text, fields in docs:
        img = Image.new("RGB", (640, 160), "white")
        ImageDraw.Draw(img).text((10, 60), text, fill="black")
        img.save(f"fixtures/images/{id_}.png")
        f.write(json.dumps({"id": id_, "image": f"images/{id_}.png", "document_type": dt, "reference_text": text, "fields": fields, "synthetic": True}) + "\n")
print("ok")
