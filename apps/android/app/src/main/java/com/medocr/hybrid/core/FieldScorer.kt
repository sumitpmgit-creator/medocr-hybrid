// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core

/**
 * Kotlin mirror of packages/core/src/field-scorer.ts.
 * Benchmark B: field-level precision / recall / F1, exact match, missing fields, safety screen.
 * Entity-match minSim default is 0.7 (field-scorer.ts).
 */

enum class EntityType { MEDICATION, LAB }

enum class FieldOutcome { CORRECT, WRONG, MISSING, UNSUPPORTED }

data class FieldComparison(
    val entityType: EntityType,
    val entityKey: String,
    val field: String,
    val expected: String?,
    val actual: String?,
    val outcome: FieldOutcome,
    val formattingOnly: Boolean = false,
    val critical: Boolean,
)

data class FieldScore(
    val comparisons: List<FieldComparison>,
    val truePositives: Int,
    val predicted: Int,
    val expected: Int,
    val precision: Double,
    val recall: Double,
    val f1: Double,
    val exactMatchRate: Double,
    val missingRequired: Int,
    val unsupported: Int,
    val passesSafetyScreen: Boolean,
)

private data class FieldSpec(val field: String, val norm: (String?) -> String, val critical: Boolean, val required: Boolean)

private val MED_FIELDS = listOf(
    FieldSpec("name", ::normalizeName, critical = true, required = true),
    FieldSpec("strength", ::normalizeStrength, critical = true, required = false),
    FieldSpec("dose", ::normalizeGeneric, critical = true, required = false),
    FieldSpec("frequency", ::normalizeFrequency, critical = true, required = false),
    FieldSpec("route", ::normalizeGeneric, critical = true, required = false),
    FieldSpec("dosageForm", ::normalizeGeneric, critical = false, required = false),
    FieldSpec("timing", ::normalizeGeneric, critical = false, required = false),
    FieldSpec("duration", ::normalizeGeneric, critical = false, required = false),
    FieldSpec("quantity", ::normalizeNumber, critical = false, required = false),
    FieldSpec("instructions", ::normalizeGeneric, critical = false, required = false),
)

private val LAB_FIELDS = listOf(
    FieldSpec("test", ::normalizeName, critical = true, required = true),
    FieldSpec("value", ::normalizeNumber, critical = true, required = true),
    FieldSpec("unit", ::normalizeUnit, critical = true, required = false),
    FieldSpec("referenceRange", { v -> (v ?: "").replace(Regex("\\s+"), "").replace("–", "-").lowercase() }, critical = false, required = false),
    FieldSpec("flag", ::normalizeGeneric, critical = false, required = false),
)

data class EntityMatch(
    val pairs: List<Pair<Int, Int>>,
    val unmatchedRef: List<Int>,
    val unmatchedPred: List<Int>,
)

fun <T> matchEntities(ref: List<T>, pred: List<T>, key: (T) -> String, minSim: Double = 0.7): EntityMatch {
    val cands = mutableListOf<Triple<Double, Int, Int>>()
    ref.forEachIndexed { i, r ->
        pred.forEachIndexed { j, p ->
            val s = similarity(key(r), key(p))
            if (s >= minSim) cands += Triple(s, i, j)
        }
    }
    cands.sortByDescending { it.first }
    val ur = ref.indices.toMutableSet()
    val up = pred.indices.toMutableSet()
    val pairs = mutableListOf<Pair<Int, Int>>()
    for ((_, i, j) in cands) {
        if (i in ur && j in up) {
            pairs += i to j
            ur.remove(i)
            up.remove(j)
        }
    }
    return EntityMatch(pairs, ur.toList(), up.toList())
}

private fun medField(m: Medication, field: String): String? = when (field) {
    "name" -> m.name
    "genericName" -> m.genericName
    "strength" -> m.strength
    "dosageForm" -> m.dosageForm
    "dose" -> m.dose
    "route" -> m.route
    "frequency" -> m.frequency
    "timing" -> m.timing
    "duration" -> m.duration
    "quantity" -> m.quantity
    "instructions" -> m.instructions
    else -> null
}

private fun labField(l: LabResult, field: String): String? = when (field) {
    "test" -> l.test
    "value" -> l.value
    "unit" -> l.unit
    "referenceRange" -> l.referenceRange
    "flag" -> l.flag?.wire
    else -> null
}

private fun str(v: String?): String? = if (v.isNullOrEmpty()) null else v

private fun compareMeds(ref: List<Medication>, pred: List<Medication>): List<FieldComparison> {
    val out = mutableListOf<FieldComparison>()
    val match = matchEntities(ref, pred) { normalizeName(it.name) }
    for ((i, j) in match.pairs) {
        val r = ref[i]; val p = pred[j]
        for (f in MED_FIELDS) {
            val e = str(medField(r, f.field)); val a = str(medField(p, f.field))
            if (e == null && a == null) continue
            val outcome = when {
                e == null -> FieldOutcome.UNSUPPORTED
                a == null -> FieldOutcome.MISSING
                f.norm(e) == f.norm(a) -> FieldOutcome.CORRECT
                else -> FieldOutcome.WRONG
            }
            out += FieldComparison(EntityType.MEDICATION, r.name, f.field, e, a, outcome, formattingOnly = outcome == FieldOutcome.CORRECT && e != a, critical = f.critical)
        }
    }
    for (i in match.unmatchedRef) {
        val r = ref[i]
        for (f in MED_FIELDS) {
            val e = str(medField(r, f.field))
            if (e != null) out += FieldComparison(EntityType.MEDICATION, r.name, f.field, e, null, FieldOutcome.MISSING, critical = f.critical)
        }
    }
    for (j in match.unmatchedPred) {
        val p = pred[j]
        for (f in MED_FIELDS) {
            val a = str(medField(p, f.field))
            if (a != null) out += FieldComparison(EntityType.MEDICATION, p.name, f.field, null, a, FieldOutcome.UNSUPPORTED, critical = f.critical)
        }
    }
    return out
}

private fun compareLabs(ref: List<LabResult>, pred: List<LabResult>): List<FieldComparison> {
    val out = mutableListOf<FieldComparison>()
    val match = matchEntities(ref, pred) { normalizeName(it.test) }
    for ((i, j) in match.pairs) {
        val r = ref[i]; val p = pred[j]
        for (f in LAB_FIELDS) {
            val e = str(labField(r, f.field)); val a = str(labField(p, f.field))
            if (e == null && a == null) continue
            val outcome = when {
                e == null -> FieldOutcome.UNSUPPORTED
                a == null -> FieldOutcome.MISSING
                f.norm(e) == f.norm(a) -> FieldOutcome.CORRECT
                else -> FieldOutcome.WRONG
            }
            out += FieldComparison(EntityType.LAB, r.test, f.field, e, a, outcome, formattingOnly = outcome == FieldOutcome.CORRECT && e != a, critical = f.critical)
        }
    }
    for (i in match.unmatchedRef) {
        val r = ref[i]
        for (f in LAB_FIELDS) {
            val e = str(labField(r, f.field))
            if (e != null) out += FieldComparison(EntityType.LAB, r.test, f.field, e, null, FieldOutcome.MISSING, critical = f.critical)
        }
    }
    for (j in match.unmatchedPred) {
        val p = pred[j]
        for (f in LAB_FIELDS) {
            val a = str(labField(p, f.field))
            if (a != null) out += FieldComparison(EntityType.LAB, p.test, f.field, null, a, FieldOutcome.UNSUPPORTED, critical = f.critical)
        }
    }
    return out
}

fun scoreFields(reference: ClinicalDoc, predicted: ClinicalDoc): FieldScore {
    val comparisons = compareMeds(reference.medications, predicted.medications) +
        compareLabs(reference.labResults, predicted.labResults)
    val tp = comparisons.count { it.outcome == FieldOutcome.CORRECT }
    val predictedN = comparisons.count { it.actual != null }
    val expectedN = comparisons.count { it.expected != null }
    val precision = if (predictedN != 0) tp.toDouble() / predictedN else if (expectedN != 0) 0.0 else 1.0
    val recall = if (expectedN != 0) tp.toDouble() / expectedN else 1.0
    val f1 = if (precision + recall != 0.0) (2 * precision * recall) / (precision + recall) else 0.0
    val requiredSet = setOf("name", "test", "value")
    return FieldScore(
        comparisons = comparisons,
        truePositives = tp,
        predicted = predictedN,
        expected = expectedN,
        precision = precision,
        recall = recall,
        f1 = f1,
        exactMatchRate = if (expectedN != 0) tp.toDouble() / expectedN else 1.0,
        missingRequired = comparisons.count { it.outcome == FieldOutcome.MISSING && it.field in requiredSet },
        unsupported = comparisons.count { it.outcome == FieldOutcome.UNSUPPORTED },
        passesSafetyScreen = comparisons.none { it.critical && it.outcome in setOf(FieldOutcome.WRONG, FieldOutcome.MISSING, FieldOutcome.UNSUPPORTED) },
    )
}
