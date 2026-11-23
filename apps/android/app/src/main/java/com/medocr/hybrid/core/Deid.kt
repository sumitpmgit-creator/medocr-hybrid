// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core

/**
 * Public Kotlin mirror of packages/core/src/deid.ts, which is the source of
 * truth after the core-hardening merge (99f7fd8). Implementation lives in
 * [com.medocr.hybrid.core.deid]. This also covers every BUG-001 format from
 * qa/BUG_LOG.md (DOBs, dates, spaced PINs, full-width/glued phones, Hindi
 * names, hospital numbers, dotted Aadhaar, PAN, and labelled addresses
 * including place names such as "Green Park").
 *
 * The document image is not inspected. The privacy receipt must say so
 * when an image leaves the device.
 */

typealias PhiType = com.medocr.hybrid.core.deid.PhiType
typealias PhiSpan = com.medocr.hybrid.core.deid.PhiSpan
typealias DeidResult = com.medocr.hybrid.core.deid.DeidResult
typealias UnsafeForCloudError = com.medocr.hybrid.core.deid.UnsafeForCloudError

fun deidentify(input: String): DeidResult = com.medocr.hybrid.core.deid.deidentify(input)

fun assertSafeForCloud(text: String?) = com.medocr.hybrid.core.deid.assertSafeForCloud(text)

fun residualIdentifiers(text: String?) = com.medocr.hybrid.core.deid.residualIdentifiers(text)

fun utf8Bytes(s: String): Int = com.medocr.hybrid.core.deid.utf8Bytes(s)
