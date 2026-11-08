const getEventKey = (status, timestamp) => {
  const parsedTimestamp = Date.parse(timestamp);
  return Number.isFinite(parsedTimestamp) ? `${status}:${parsedTimestamp}` : null;
};

export const removeDuplicateReceiptStatusEvents = (statusHistory, submissions) => {
  const receiptEventKeys = new Set();

  submissions.forEach((submission) => {
    const submittedKey = getEventKey('or_submitted', submission.submitted_at);
    if (submittedKey) receiptEventKeys.add(submittedKey);

    if (submission.reviewed_at) {
      const reviewStatus = submission.decision === 'confirmed' ? 'or_confirmed' : 'or_rejected';
      const reviewedKey = getEventKey(reviewStatus, submission.reviewed_at);
      if (reviewedKey) receiptEventKeys.add(reviewedKey);
    }
  });

  return statusHistory.filter((entry) => {
    const eventKey = getEventKey(entry?.status, entry?.timestamp);
    return !eventKey || !receiptEventKeys.has(eventKey);
  });
};