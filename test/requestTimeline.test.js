import test from 'node:test';
import assert from 'node:assert/strict';
import { removeDuplicateReceiptStatusEvents } from '../src/utils/requestTimeline.js';

test('removes receipt status duplicates while preserving unmatched history', () => {
  const statusHistory = [
    { status: 'or_submitted', timestamp: '2026-10-01T10:00:00.000Z' },
    { status: 'or_confirmed', timestamp: '2026-10-01T10:05:00Z' },
    { status: 'processing', timestamp: '2026-10-01T10:06:00Z' },
    { status: 'or_submitted', timestamp: '2026-09-01T10:00:00Z' }
  ];
  const submissions = [{
    submitted_at: '2026-10-01T12:00:00+02:00',
    reviewed_at: '2026-10-01T10:05:00.000Z',
    decision: 'confirmed'
  }];

  assert.deepEqual(removeDuplicateReceiptStatusEvents(statusHistory, submissions), [
    statusHistory[2],
    statusHistory[3]
  ]);
});

test('matches rejected receipt review events to their canonical history entry', () => {
  const statusHistory = [
    { status: 'or_rejected', timestamp: '2026-10-02T09:30:00Z' },
    { status: 'or_confirmed', timestamp: '2026-10-02T09:30:00Z' }
  ];

  assert.deepEqual(removeDuplicateReceiptStatusEvents(statusHistory, [{
    submitted_at: '2026-10-02T09:00:00Z',
    reviewed_at: '2026-10-02T09:30:00.000Z',
    decision: 'rejected'
  }]), [statusHistory[1]]);
});