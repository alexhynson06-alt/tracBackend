export const validateStudentIdNumber = (value) => (
  typeof value === 'string' && /^\d{9}$/.test(value) ? value : null
);