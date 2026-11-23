// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TextMetricsTest {
    @Test
    fun cerOfIdenticalTextIsZero() {
        assertEquals(0.0, cer("Tab Dolo 650 BD", "Tab Dolo 650 BD").rate, 1e-9)
    }

    @Test
    fun cerCountsSubstitutionsAgainstReferenceLength() {
        // "kitten" vs "sitten" is one substitution over 6 reference chars
        val r = cer("kitten", "sitten")
        assertEquals(1, r.substitutions)
        assertEquals(0, r.deletions)
        assertEquals(0, r.insertions)
        assertEquals(1.0 / 6.0, r.rate, 1e-9)
    }

    @Test
    fun normalizeFrequencyMapsBd() {
        assertEquals("1-0-1", normalizeFrequency("BD"))
        assertEquals("1-0-0", normalizeFrequency("once daily"))
    }
}
