export const createActivityLogSearchPattern = (value) => {
  const escaped = String(value || '').trim().replace(/[\\%_*]/g, '\\$&');
  return `%${escaped}%`;
};

export const findActivityLogMatches = async (supabase, searchValue) => {
  const pattern = createActivityLogSearchPattern(searchValue);
  const requestFields = ['tracking_code', 'sender_name', 'sender_id_number'];
  const adminFields = ['username', 'full_name'];

  const requestResults = await Promise.all(requestFields.map((field) => (
    supabase.from('requests').select('id').ilike(field, pattern).limit(1000)
  )));
  const adminResults = await Promise.all(adminFields.map((field) => (
    supabase.from('admins').select('id').ilike(field, pattern).limit(1000)
  )));

  const errors = [...requestResults, ...adminResults].filter((result) => result.error);
  if (errors.length) throw errors[0].error;

  return {
    requestIds: [...new Set(requestResults.flatMap((result) => (result.data || []).map((row) => row.id)))],
    adminIds: [...new Set(adminResults.flatMap((result) => (result.data || []).map((row) => row.id)))]
  };
};