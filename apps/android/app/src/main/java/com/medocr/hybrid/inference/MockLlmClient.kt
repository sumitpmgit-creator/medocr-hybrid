// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.inference

import com.medocr.hybrid.core.ExecutionSite

/**
 * Deterministic mock inference so the app is usable on any emulator or
 * device, including those without AICore, Gemini Nano, or Firebase config.
 *
 * The on-device pass leaves Amoxicillin frequency at low confidence ("BD")
 * so hybrid verify sends a de-identified transcript to the "cloud" mock,
 * which returns a disagreeing frequency and triggers human confirm.
 */
class MockLlmClient : LlmClient {
    override val label: String = "mock"

    override suspend fun generate(
        prompt: String,
        imageJpeg: ByteArray?,
        mimeType: String?,
        target: InferenceTarget,
        kind: GenerateKind,
    ): LlmResponse {
        // Simulate a short on-device / cloud delay without blocking tests long.
        val site = when (target) {
            InferenceTarget.ON_DEVICE -> ExecutionSite.LOCAL_CODE
            InferenceTarget.CLOUD -> ExecutionSite.IN_CLOUD
        }
        val text = if (kind == GenerateKind.TEXT) MOCK_TRANSCRIPT else {
            if (target == InferenceTarget.CLOUD && prompt.contains("Only return entries")) MOCK_CLOUD_VERIFY
            else if (target == InferenceTarget.CLOUD) MOCK_CLOUD_DOC
            else MOCK_DEVICE_DOC
        }
        val inputTokens = (prompt.length / 4) + if (imageJpeg != null) 258 else 0
        val outputTokens = text.length / 4
        return LlmResponse(text = text, site = site, inputTokens = inputTokens, outputTokens = outputTokens)
    }

    companion object {
        const val MOCK_TRANSCRIPT = """
Patient Name: Ravi Kumar
Ph: +91 98765 43210
Dr. Anil Mehta
Clinic Rx

Tab Amoxicillin 500 mg
1 cap BD x 5 days
after food

Tab Pantoprazole 40 mg
OD x 5 days before breakfast

Advice: complete the course
"""

        const val MOCK_DEVICE_DOC = """
{
  "documentType": "prescription",
  "medications": [
    {
      "name": "Amoxicillin",
      "strength": "500 mg",
      "dose": "1 cap",
      "frequency": "BD",
      "duration": "5 days",
      "instructions": "after food",
      "confidence": 0.62,
      "sourceText": "Tab Amoxicillin 500 mg 1 cap BD x 5 days"
    },
    {
      "name": "Pantoprazole",
      "strength": "40 mg",
      "dose": null,
      "frequency": "OD",
      "duration": "5 days",
      "instructions": "before breakfast",
      "confidence": 0.91,
      "sourceText": "Tab Pantoprazole 40 mg OD x 5 days"
    }
  ],
  "labResults": [],
  "abstentions": []
}
"""

        const val MOCK_CLOUD_DOC = """
{
  "documentType": "prescription",
  "medications": [
    {
      "name": "Amoxicillin",
      "strength": "500 mg",
      "dose": "1 cap",
      "frequency": "1-0-1",
      "duration": "5 days",
      "instructions": "after food",
      "confidence": 0.93,
      "sourceText": "Tab Amoxicillin 500 mg 1 cap BD x 5 days"
    },
    {
      "name": "Pantoprazole",
      "strength": "40 mg",
      "dose": null,
      "frequency": "OD",
      "duration": "5 days",
      "instructions": "before breakfast",
      "confidence": 0.96,
      "sourceText": "Tab Pantoprazole 40 mg OD x 5 days"
    }
  ],
  "labResults": [],
  "abstentions": []
}
"""

        const val MOCK_CLOUD_VERIFY = """
{
  "documentType": "prescription",
  "medications": [
    {
      "name": "Amoxicillin",
      "strength": "500 mg",
      "dose": "1 cap",
      "frequency": "1-0-1",
      "duration": "5 days",
      "instructions": "after food",
      "confidence": 0.93
    }
  ],
  "labResults": [],
  "abstentions": []
}
"""
    }
}
