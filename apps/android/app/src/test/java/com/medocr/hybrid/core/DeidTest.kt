// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class DeidTest {
    private val fixture =
        "Patient Name: Ravi Kumar Sharma\nPh: +91 98765 43210\nABHA: 12-3456-7890-1234\nAadhaar 1234 5678 9012\nravi@abdm\nDr. Anil Mehta Reg. No: MCI/12345\nTab Dolo 650 BD"

    @Test
    fun redactsIndianIdentifiersAndKeepsClinicalText() {
        val r = deidentify(fixture)
        assertFalse(r.text.contains("Ravi"))
        assertFalse(r.text.contains("98765"))
        assertTrue(r.text.contains("Tab Dolo 650 BD"))
        assertTrue(r.text.contains("[NAME]"))
        assertTrue(r.text.contains("[PHONE]"))
        assertTrue(r.text.contains("[ABHA_NUMBER]") || r.text.contains("[ABHA_ADDRESS]"))
        assertTrue((r.redactions[PhiType.PHONE] ?: 0) >= 1)
        assertTrue(r.total >= 6)
        assertEquals(r.total, r.spans.size)
    }

    @Test
    fun redactsGreenParkAddressAndLabelledPinWithoutEatingLabCounts() {
        // Core deid redacts place names like "Green Park" on purpose when they
        // sit inside a labelled address.
        val input = "Address: Flat 3B, Green Park, New Delhi - 110016\n\nPIN: 411001\nPlatelet Count 250000"
        val r = deidentify(input)
        assertTrue(r.text.contains("[ADDRESS]"))
        assertTrue(r.text.contains("[PIN]"))
        assertTrue(r.text.contains("250000"))
        assertFalse(r.text.contains("110016"))
        assertFalse(r.text.contains("411001"))
        assertFalse(r.text.contains("Green Park"))
    }

    @Test
    fun replacesDobAndDatesButLeavesAges() {
        val dob = deidentify("DOB: 14/03/1987 and Born on 14th March 1987")
        assertFalse(dob.text.contains("14/03/1987"))
        assertFalse(dob.text.contains("14th March 1987"))
        assertTrue(dob.text.contains("[DOB]"))
        val dates = deidentify("Date: 12-11-2026  Collected: 20/11/2026")
        assertFalse(dates.text.contains("12-11-2026"))
        assertFalse(dates.text.contains("20/11/2026"))
        assertTrue(dates.text.contains("[DATE]"))
        assertEquals("Age/Sex: 38Y/M", deidentify("Age/Sex: 38Y/M").text)
    }

    @Test
    fun doesNotLetANameSwallowTheNextClinicalLine() {
        val r = deidentify("Patient Name: Rajesh Kumar\nHemoglobin 13.5 g/dL")
        assertTrue(r.text.contains("[NAME]"))
        assertTrue(r.text.contains("Hemoglobin 13.5 g/dL"))
    }

    @Test
    fun assertSafeForCloudBlocksResidualDatesAndPhones() {
        assertSafeForCloud(deidentify(fixture).text)
        assertSafeForCloud("Tab Metformin 500 mg 1-0-1")
        try {
            assertSafeForCloud("Call 9876543210")
            fail("phone must be blocked")
        } catch (e: UnsafeForCloudError) {
            assertTrue(e.findings.isNotEmpty())
        }
        try {
            assertSafeForCloud("DOB: 14/03/1987")
            fail("DOB must be blocked")
        } catch (_: UnsafeForCloudError) {
        }
        try {
            assertSafeForCloud("Visit 12-11-2026")
            fail("calendar date must be blocked")
        } catch (_: UnsafeForCloudError) {
        }
    }
}
