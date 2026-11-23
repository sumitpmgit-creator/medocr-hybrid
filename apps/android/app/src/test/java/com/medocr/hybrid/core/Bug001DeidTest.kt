// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core

import org.junit.Assert.assertFalse
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/**
 * Every BUG-001 format in qa/BUG_LOG.md, plus the extra cases in
 * packages/core/test/deid.test.ts and packages/parsing/test/deid/bug-001.test.ts.
 * Raw text must be blocked by assertSafeForCloud; de-identify must remove the leak.
 */
@RunWith(Parameterized::class)
class Bug001DeidTest(private val title: String, private val input: String, private val leak: String) {

    @Test
    fun redactsAndBlocksTheRawForm() {
        val r = deidentify(input)
        assertFalse("$title: de-id still contains '$leak' in ${r.text}", r.text.contains(leak, ignoreCase = true))
        assertSafeForCloud(r.text)
        try {
            assertSafeForCloud(input)
            fail("$title: raw text must not be safe for the cloud")
        } catch (_: UnsafeForCloudError) {
        }
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}")
        fun data(): List<Array<String>> = listOf(
            // The 10 formats named in qa/BUG_LOG.md BUG-001:
            arrayOf("DOB slash", "DOB: 14/03/1987", "14/03/1987"),
            arrayOf("Born on words", "Born on 14th March 1987", "14th March 1987"),
            arrayOf("spaced PIN", "Hyderabad 500 080", "500 080"),
            arrayOf("full-width mobile", "Mobile：９８７６５４３２１０", "９８７６５４３２１０"),
            arrayOf("glued phone", "Callon9876543210forreports", "9876543210"),
            arrayOf("Devanagari labelled name", "रोगी: अनीता शर्मा", "अनीता शर्मा"),
            arrayOf("lowercase unlabelled name", "sunita devi", "sunita devi"),
            arrayOf("hospital number", "Hospital number: 2023/BF/057", "2023/BF/057"),
            arrayOf("dotted Aadhaar", "UID:2345.6789.0123", "2345.6789.0123"),
            arrayOf("PAN any case", "PAN abcpk1234f", "abcpk1234f"),
            // Extra cases covered by core / parsing tests:
            arrayOf("D.O.B ISO", "D.O.B 1987-03-14", "1987-03-14"),
            arrayOf("dob dotted short", "dob 14.03.87", "14.03.87"),
            arrayOf("unlabelled lowercase relation", "sunita devi w/o ramesh yadav", "sunita devi"),
            arrayOf("obfuscated email", "mail: rajesh.kumar87 [at] gmail [dot] com", "rajesh.kumar87"),
        )
    }
}
