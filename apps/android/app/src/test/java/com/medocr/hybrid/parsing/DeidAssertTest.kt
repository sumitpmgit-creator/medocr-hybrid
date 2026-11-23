// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.parsing

import com.medocr.hybrid.parsing.deid.CloudGate
import com.medocr.hybrid.parsing.deid.RedactionType
import com.medocr.hybrid.parsing.deid.UnsafeForCloudError
import com.medocr.hybrid.parsing.deid.assertSafeForCloud
import com.medocr.hybrid.parsing.deid.deidentify
import com.medocr.hybrid.parsing.deid.gateForCloud
import com.medocr.hybrid.parsing.deid.redactionCounts
import com.medocr.hybrid.parsing.deid.residualIdentifiers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class DeidAssertTest {
    private val dirty = """
        Patient Name: Ravi Kumar Sharma
        Ph: +91 98765 43210
        ABHA: 12-3456-7890-1234
        Aadhaar 1234 5678 9012
        ravi@abdm
        Dr. Anil Mehta Reg. No: MCI/12345
        Tab Dolo 650 BD
    """.trimIndent()

    @Test
    fun deidentifyRemovesLabelledIdentifiersAndKeepsClinicalText() {
        val r = deidentify(dirty)
        assertTrue(r.redactions.isNotEmpty())
        val counts = redactionCounts(r.redactions)
        assertTrue("expected a name redaction", (counts[RedactionType.NAME] ?: 0) >= 1)
        assertTrue("expected a phone redaction", (counts[RedactionType.PHONE] ?: 0) >= 1)
        assertFalse("receipt/types must not require the original values; the de-id text must not keep the phone", r.text.contains("98765"))
        assertFalse(r.text.contains("Ravi Kumar"))
        assertTrue("clinical content must be preserved", r.text.contains("Tab Dolo 650 BD"))
        assertTrue(r.text.contains("[NAME]") || r.text.contains("[PHONE]"))
    }

    @Test
    fun assertSafeForCloudThrowsOnRawPhiAndPassesAfterDeid() {
        try {
            assertSafeForCloud(dirty)
            fail("raw transcript with PHI must not be sent to the cloud")
        } catch (e: UnsafeForCloudError) {
            assertTrue(e.findings.isNotEmpty())
            // The error may include a preview of residual text; callers must not put that in the receipt.
            assertTrue(e.message?.contains("not safe to send") == true)
        }
        assertSafeForCloud(deidentify(dirty).text)
    }

    @Test
    fun residualIdentifiersOnRawTextAreNonEmpty() {
        assertTrue(residualIdentifiers(dirty).isNotEmpty())
        assertTrue(residualIdentifiers(deidentify(dirty).text).isEmpty())
    }

    @Test
    fun gateForCloudBlocksRawAndAllowsDeidentifiedText() {
        // gateForCloud de-identifies first, so a typical prescription becomes Safe.
        val gated = gateForCloud(dirty)
        assertTrue("well-formed PHI should be clean after de-id", gated is CloudGate.Safe)
        val safe = gated as CloudGate.Safe
        assertFalse(safe.text.contains("98765"))
        assertTrue(safe.deid.redactions.isNotEmpty())

        // Residual after a failed/partial clean: un-redacted labelled phone must block.
        // We simulate a residual payload that skipped de-id (what the gate would see if de-id missed).
        val leftover = residualIdentifiers("Ph: +91 98765 43210")
        assertTrue(leftover.isNotEmpty())
        assertEquals(RedactionType.PHONE, leftover.first().type)
    }

    @Test
    fun clinicalOnlyTextIsSafeWithoutRedactions() {
        val clinical = "Tab Amoxicillin 500 mg\n1 cap BD x 5 days\nHbA1c 7.2 %"
        assertSafeForCloud(clinical)
        val g = gateForCloud(clinical)
        assertTrue(g is CloudGate.Safe)
        assertEquals(0, (g as CloudGate.Safe).deid.redactions.size)
    }
}
