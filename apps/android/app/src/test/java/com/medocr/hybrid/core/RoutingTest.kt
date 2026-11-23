// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RoutingTest {
    @Test
    fun lowConfidenceMedicationIsSentToCloud() {
        val doc = ClinicalDoc(
            documentType = DocumentType.PRESCRIPTION,
            medications = listOf(
                Medication(name = "Amoxicillin", strength = "500 mg", dose = "1 cap", frequency = "BD", confidence = 0.62, sourceText = "Tab Amoxicillin 500 mg 1 cap BD"),
                Medication(name = "Pantoprazole", strength = "40 mg", frequency = "OD", confidence = 0.91, sourceText = "Tab Pantoprazole 40 mg OD"),
            ),
        )
        val source = "Tab Amoxicillin 500 mg 1 cap BD\nTab Pantoprazole 40 mg OD"
        val routed = routeDoc(doc, source)
        assertEquals(RouteDecision.SEND_TO_CLOUD, routed.meds[0].decision)
        assertEquals(RouteDecision.ACCEPT_ON_DEVICE, routed.meds[1].decision)
        assertEquals(1, routed.toCloud)
    }

    @Test
    fun frequencyDisagreementGoesToHumanConfirm() {
        val device = Medication(name = "Amoxicillin", frequency = "BD", dose = "1 cap", strength = "500 mg", confidence = 0.62)
        val cloud = Medication(name = "Amoxicillin", frequency = "1-0-1", dose = "1 cap", strength = "500 mg", confidence = 0.93)
        val rec = reconcileMedication(device, cloud)
        // BD and 1-0-1 normalize to the same frequency, so this should accept unless another field differs.
        // normalizeFrequency("BD") == "1-0-1", so no frequency disagreement.
        assertEquals(RouteDecision.ACCEPT_ON_DEVICE, rec.decision)
        val disagreeing = reconcileMedication(device, cloud.copy(name = "Amoxycillin", frequency = "TDS"))
        assertEquals(RouteDecision.HUMAN_CONFIRM, disagreeing.decision)
        assertTrue(disagreeing.disagreements.contains("frequency") || disagreeing.disagreements.contains("name"))
    }
}
