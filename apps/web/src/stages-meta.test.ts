// SPDX-License-Identifier: Apache-2.0
import { DEFAULT_THRESHOLDS, type Stage } from '@med-ocr/core';
import { describe, expect, it } from 'vitest';
import { mockHybridVerify, mockPipelines, mockCloudRead, mockCloudStructure, mockNanoRead, mockNanoStructure } from './mock';
import { cloudRead, cloudStructure, deidStage, hybridVerify, nanoRead, nanoStructure, pipelines } from './stages';

function declaresEgress(stage: Stage): boolean {
  const sent = stage.meta?.sendsDataOffDevice;
  const runtime = stage.meta?.runtime;
  return sent === true || sent === false || runtime === 'cloud' || runtime === 'device' || runtime === 'code';
}

function egressOf(stage: Stage): 'cloud' | 'none' {
  if (stage.meta?.sendsDataOffDevice === true || stage.meta?.runtime === 'cloud') return 'cloud';
  return 'none';
}

describe('every web stage declares egress', () => {
  const live: Stage[] = [
    nanoRead, nanoStructure, deidStage, cloudRead, cloudStructure, hybridVerify(DEFAULT_THRESHOLDS),
    ...pipelines(DEFAULT_THRESHOLDS).flatMap((p) => p.stages),
  ];
  const mocks: Stage[] = [
    mockNanoRead, mockNanoStructure, mockCloudRead, mockCloudStructure, mockHybridVerify(DEFAULT_THRESHOLDS),
    ...mockPipelines(DEFAULT_THRESHOLDS).flatMap((p) => p.stages),
  ];

  for (const stage of [...live, ...mocks]) {
    it(`${stage.id} declares meta.sendsDataOffDevice / runtime`, () => {
      expect(stage.meta, `${stage.id} is missing meta`).toBeDefined();
      expect(declaresEgress(stage), `${stage.id} does not declare egress`).toBe(true);
    });
  }

  it('marks on-device and de-id stages as no egress, and cloud stages as cloud', () => {
    expect(egressOf(nanoRead)).toBe('none');
    expect(egressOf(nanoStructure)).toBe('none');
    expect(egressOf(deidStage)).toBe('none');
    expect(egressOf(cloudRead)).toBe('cloud');
    expect(egressOf(mockCloudRead)).toBe('cloud');
    expect(egressOf(cloudStructure)).toBe('cloud');
    expect(egressOf(hybridVerify(DEFAULT_THRESHOLDS))).toBe('cloud');
  });
});
