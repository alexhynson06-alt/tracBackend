import test from 'node:test';
import assert from 'node:assert/strict';
import { removeDuplicateReceiptStatusEvents } from '../src/utils/requestTimeline.js';
import { buildOrSubmissionTimeline } from '../src/utils/orSubmissionTimeline.js';

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

test('OR timeline resolves Alumni submitters from users and reviewers from admins', () => {
  const timeline = buildOrSubmissionTimeline([{
    attempt_number: 1,
    or_number: 'OR-123',
    submitted_at: '2026-11-08T10:00:00Z',
    submitted_by: 'alumni-user-id',
    reviewed_at: '2026-11-08T11:00:00Z',
    reviewed_by: 'admin-user-id',
    decision: 'confirmed',
    rejection_reason: null
  }], [
    { id: 'alumni-user-id', first_name: 'Alex', last_name: 'Hynson', id_number: '123456789' }
  ], [
    { id: 'admin-user-id', full_name: 'Registrar Admin', username: 'registrar' }
  ]);

  assert.equal(timeline[0].actor, 'Alex Hynson');
  assert.equal(timeline[0].administrator, null);
  assert.equal(timeline[1].actor, 'Registrar Admin');
  assert.equal(timeline[1].administrator, 'Registrar Admin');
});

test('OR timeline uses safe identity fallbacks when a linked profile is unavailable', () => {
  const timeline = buildOrSubmissionTimeline([{
    attempt_number: 1,
    submitted_at: '2026-11-08T10:00:00Z',
    submitted_by: 'missing-user-id'
  }], [], []);

  assert.equal(timeline[0].actor, 'Requester');
  assert.equal(timeline[0].administrator, null);
});