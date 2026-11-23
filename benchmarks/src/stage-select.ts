// Picks stage outputs by stage name/kind so scoring follows the pipeline's own trace.
// Contract (CONTRACT.md §2): output.steps[] = { stageId, stageKind, site, text? }.

export interface StepView { stageId: string; stageKind: string; site?: string; text?: string }

/** Raw OCR stages, scored for CER/WER. Matched by id first, then by kind. */
export const OCR_STAGE_IDS = ['nano-read', 'cloud-read', 'ocr', 'read'];
export const OCR_STAGE_KINDS = ['ocr', 'ocr+structure'];
/** De-identification stages, checked for leaks. */
export const DEID_STAGE_IDS = ['deid', 'nano-deid', 'local-deid', 'deid-local', 'regex-deid', 'cloud-deid'];
export const DEID_STAGE_KINDS = ['deid'];

const isDeid = (s: StepView) => DEID_STAGE_KINDS.includes(s.stageKind) || DEID_STAGE_IDS.includes(s.stageId) || /(^|-)deid($|-)/i.test(s.stageId);

export function pickOcr(steps: StepView[] | undefined, fallbackText: string | undefined): { text: string | undefined; source: string } {
  const st = (steps ?? []).filter((s) => !isDeid(s) && typeof s.text === 'string');
  const hit = st.find((s) => OCR_STAGE_IDS.includes(s.stageId)) ?? st.find((s) => OCR_STAGE_KINDS.includes(s.stageKind));
  if (hit) return { text: hit.text, source: `stage:${hit.stageId}` };
  if (fallbackText !== undefined) return { text: fallbackText, source: 'output.text (no OCR stage in trace)' };
  return { text: undefined, source: 'none' };
}

/** All de-id stage outputs (a pipeline may de-identify more than once). Empty = no de-id stage yet. */
export function pickDeid(steps: StepView[] | undefined): { texts: string[]; stageIds: string[] } {
  const st = (steps ?? []).filter((s) => isDeid(s) && typeof s.text === 'string');
  return { texts: st.map((s) => s.text!), stageIds: st.map((s) => s.stageId) };
}
