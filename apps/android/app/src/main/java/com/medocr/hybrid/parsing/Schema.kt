// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.parsing

/**
 * Kotlin mirror of packages/parsing/src/extraction/schema.ts.
 *
 * Field names follow ClinicalDoc in @med-ocr/core, but this is a Nano-sized subset:
 * no inferred fields (genericName, flag, route, brand/generic mapping), one enum,
 * and per-field confidence instead of a single item-level score.
 *
 * documentType omits core's "discharge_summary"; Nano should emit "other" for those.
 */

val NANO_DOCUMENT_TYPES = listOf("prescription", "lab_report", "other")

data class NanoMedication(
    val name: String?,
    val nameConfidence: Double,
    val dose: String?,
    val doseConfidence: Double,
    val frequency: String?,
    val frequencyConfidence: Double,
    val duration: String?,
    val durationConfidence: Double,
)

data class NanoLabResult(
    val test: String?,
    val testConfidence: Double,
    val value: String?,
    val valueConfidence: Double,
    val unit: String?,
    val unitConfidence: Double,
    val referenceRange: String?,
    val referenceRangeConfidence: Double,
)

data class NanoExtraction(
    val documentType: String,
    val documentTypeConfidence: Double,
    val rawText: String?,
    val medications: List<NanoMedication>,
    val labResults: List<NanoLabResult>,
)

data class ClinicalFields(
    val documentType: String,
    val medications: List<ClinicalMedication>,
    val labResults: List<ClinicalLab>,
    val rawText: String?,
)

data class ClinicalMedication(
    val name: String,
    val dose: String?,
    val frequency: String?,
    val duration: String?,
    val confidence: Double,
)

data class ClinicalLab(
    val test: String,
    val value: String,
    val unit: String?,
    val referenceRange: String?,
    val confidence: Double,
)

val MEDICATION_VALUE_FIELDS = listOf("name", "dose", "frequency", "duration")
val LAB_VALUE_FIELDS = listOf("test", "value", "unit", "referenceRange")

/**
 * JSON Schema string for responseConstraint / responseJsonSchema.
 * Same shape as NANO_RESPONSE_SCHEMA in packages/parsing/src/extraction/schema.ts.
 * Android on-device structured output officially uses @Generable rather than
 * this object (see README); the schema is still embedded in the prompt and
 * can be passed to cloud generationConfig.responseMimeType = application/json.
 */
val NANO_RESPONSE_SCHEMA_JSON: String = """
{
  "type": "object",
  "additionalProperties": false,
  "required": ["documentType", "documentTypeConfidence", "rawText", "medications", "labResults"],
  "properties": {
    "documentType": { "type": "string", "enum": ["prescription", "lab_report", "other"] },
    "documentTypeConfidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "rawText": { "type": ["string", "null"] },
    "medications": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["name", "nameConfidence", "dose", "doseConfidence", "frequency", "frequencyConfidence", "duration", "durationConfidence"],
        "properties": {
          "name": { "type": ["string", "null"] },
          "nameConfidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "dose": { "type": ["string", "null"] },
          "doseConfidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "frequency": { "type": ["string", "null"] },
          "frequencyConfidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "duration": { "type": ["string", "null"] },
          "durationConfidence": { "type": "number", "minimum": 0, "maximum": 1 }
        }
      }
    },
    "labResults": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["test", "testConfidence", "value", "valueConfidence", "unit", "unitConfidence", "referenceRange", "referenceRangeConfidence"],
        "properties": {
          "test": { "type": ["string", "null"] },
          "testConfidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "value": { "type": ["string", "null"] },
          "valueConfidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "unit": { "type": ["string", "null"] },
          "unitConfidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "referenceRange": { "type": ["string", "null"] },
          "referenceRangeConfidence": { "type": "number", "minimum": 0, "maximum": 1 }
        }
      }
    }
  }
}
""".trim()
