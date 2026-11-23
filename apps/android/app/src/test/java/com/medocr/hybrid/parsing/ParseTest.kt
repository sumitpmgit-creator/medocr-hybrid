// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.parsing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ParseTest {
    @Test
    fun parseFencedJson() {
        val raw = """
        Here you go
        ```json
        {"documentType":"prescription","documentTypeConfidence":0.9,"rawText":"Tab Dolo 650","medications":[{"name":"Dolo","nameConfidence":0.9,"dose":"650 mg","doseConfidence":0.8,"frequency":"BD","frequencyConfidence":0.7,"duration":"5 days","durationConfidence":0.6}],"labResults":[]}
        ```
        """.trimIndent()
        val parsed = parseNanoOutput(raw)
        assertTrue(parsed is ParseResult.Ok)
        val ok = parsed as ParseResult.Ok
        assertEquals("prescription", ok.value.documentType)
        assertEquals("Dolo", ok.value.medications[0].name)
    }

    @Test
    fun emptyInputIsAnError() {
        val parsed = parseNanoOutput("   ")
        assertTrue(parsed is ParseResult.Err)
    }
}
