// SPDX-License-Identifier: Apache-2.0
package com.medocr.hybrid.core

import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger

/** Kotlin mirror of packages/core/src/pipeline.ts. */

fun emptyMetrics(): StageMetrics =
    StageMetrics(latencyMs = 0.0, costUsd = 0.0, bytesSent = 0, inputTokens = 0, outputTokens = 0)

fun addMetrics(a: StageMetrics, b: StageMetrics): StageMetrics = StageMetrics(
    latencyMs = a.latencyMs + b.latencyMs,
    costUsd = a.costUsd + b.costUsd,
    bytesSent = a.bytesSent + b.bytesSent,
    inputTokens = (a.inputTokens ?: 0) + (b.inputTokens ?: 0),
    outputTokens = (a.outputTokens ?: 0) + (b.outputTokens ?: 0),
)

private val runCounter = AtomicInteger(0)

fun newRunId(prefix: String = "run"): String {
    val n = runCounter.incrementAndGet()
    return "${prefix}_${java.lang.Long.toString(System.currentTimeMillis(), 36)}_${Integer.toString(n, 36)}"
}

/**
 * Runs stages in order. A failing stage stops the run but the partial trace is returned.
 */
suspend fun runPipeline(
    pipeline: Pipeline,
    input: StageData,
    docId: String,
    runId: String? = null,
    config: Map<String, Any?>? = null,
    now: () -> Long = { System.currentTimeMillis() },
): PipelineRun {
    val id = runId ?: newRunId(pipeline.id)
    val steps = mutableListOf<StageResult>()
    var current = input
    var totals = emptyMetrics()
    val startedAt = Instant.now().toString()
    for (stage in pipeline.stages) {
        if (current.kind !in stage.accepts) {
            val error = "Stage ${stage.id} does not accept input kind \"${current.kind}\""
            return PipelineRun(id, pipeline.id, docId, startedAt, steps, current, totals, true, error)
        }
        val t0 = now()
        try {
            val res = stage.run(current, StageContext(id, docId, config))
            val metrics = if (res.metrics.latencyMs == 0.0) {
                res.metrics.copy(latencyMs = (now() - t0).toDouble())
            } else {
                res.metrics
            }
            val withMetrics = res.copy(metrics = metrics)
            steps += withMetrics
            totals = addMetrics(totals, withMetrics.metrics)
            if (withMetrics.error != null) {
                return PipelineRun(id, pipeline.id, docId, startedAt, steps, current, totals, true, withMetrics.error)
            }
            current = withMetrics.output
        } catch (e: Throwable) {
            val error = e.message ?: e.toString()
            steps += StageResult(
                stageId = stage.id,
                stageKind = stage.kind,
                site = ExecutionSite.LOCAL_CODE,
                output = current,
                metrics = emptyMetrics().copy(latencyMs = (now() - t0).toDouble()),
                error = error,
            )
            return PipelineRun(id, pipeline.id, docId, startedAt, steps, current, totals, true, error)
        }
    }
    return PipelineRun(id, pipeline.id, docId, startedAt, steps, current, totals, false)
}

/**
 * Text produced by the reading stage (first stage of kind ocr / ocr+structure) for Benchmark A.
 * De-identification stages are deliberately skipped so redaction is not counted as an OCR error.
 */
fun readingText(run: PipelineRun): String? {
    for (step in run.steps) {
        if (step.stageKind != StageKind.OCR && step.stageKind != StageKind.OCR_STRUCTURE) continue
        return when (val o = step.output) {
            is StageData.Text -> o.text
            is StageData.Fields -> o.text
            else -> null
        } ?: continue
    }
    return null
}
