import { supabase } from '../config/supabase.js';
import { DEFAULT_ACTIVITY_CALENDAR, getActivityDateBounds, loadActivityCalendar } from '../utils/activityCalendar.js';
import { findActivityLogMatches } from '../utils/activityLogSearch.js';

export const getActivityLogs = async (req, res) => {
  try {
    const { 
      page: rawPage = 1, 
      limit: rawLimit = 20,
      admin_id,
      action,
      start_date,
      end_date,
      startDate,
      endDate,
      period_type = 'calendar',
      semester,
      year,
      month,
      date,
      search
    } = req.query;

    const page = Number(rawPage);
    const limit = Number(rawLimit);
    if (!Number.isInteger(page) || page < 1 || page > 1000000) {
      return res.status(400).json({ message: 'Invalid page filter.' });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
      return res.status(400).json({ message: 'Invalid page size.' });
    }
    const activityCalendar = await loadActivityCalendar(supabase);
    const bounds = getActivityDateBounds({
      periodType: period_type,
      year,
      semester,
      month,
      date,
      startDate: startDate || start_date,
      endDate: endDate || end_date,
      calendar: activityCalendar
    });
    if (bounds.error) return res.status(400).json({ message: bounds.error });

    const { data: admins, error: adminsError } = await supabase
      .from('admins')
      .select('id, username, full_name')
      .eq('is_active', true);
    if (adminsError) throw adminsError;

    const emptyResponse = {
      logs: [],
      summary: { total: 0, byAction: { approved: 0, processing: 0, ready: 0, claimed: 0, rejected: 0 } },
      admins: admins || [],
      activity_calendar: activityCalendar,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, pages: 0 }
    };
    if (bounds.empty) return res.status(200).json(emptyResponse);

    const applyDateRange = (q) => {
      if (bounds.lo) q = q.gte('created_at', bounds.lo);
      if (bounds.hi) q = q.lt('created_at', bounds.hi);
      return q;
    };

    let query = supabase
      .from('admin_activity_logs')
      .select(`
        *,
        admins:admin_id (id, username, full_name),
        requests:request_id (tracking_code, request_type, purpose, sender_name)
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (admin_id) {
      query = query.eq('admin_id', admin_id);
    }
    if (action) {
      query = query.eq('action', action);
    }
    query = applyDateRange(query);
    
    let matchingRequestIds = null;
    let matchingAdminIds = null;
    if (search && search.trim()) {
      const matches = await findActivityLogMatches(supabase, search);
      matchingRequestIds = matches.requestIds;
      matchingAdminIds = matches.adminIds;
      if (matchingRequestIds.length === 0 && matchingAdminIds.length === 0) {
        return res.status(200).json(emptyResponse);
      }
    }

    const applySearchFilter = (target) => {
      if (matchingRequestIds?.length && matchingAdminIds?.length) {
        return target.or(
          `request_id.in.(${matchingRequestIds.join(',')}),admin_id.in.(${matchingAdminIds.join(',')})`
        );
      }
      if (matchingRequestIds?.length) return target.in('request_id', matchingRequestIds);
      if (matchingAdminIds?.length) return target.in('admin_id', matchingAdminIds);
      return target;
    };

    query = applySearchFilter(query);

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: logs, error, count } = await query
      .range(from, to);

    if (error) throw error;

    const countAction = async (actionName) => {
      if (action && action !== actionName) return 0;
      let countQuery = supabase.from('admin_activity_logs').select('id', { count: 'exact', head: true });
      if (admin_id) countQuery = countQuery.eq('admin_id', admin_id);
      countQuery = countQuery.eq('action', actionName);
      countQuery = applyDateRange(countQuery);
      countQuery = applySearchFilter(countQuery);
      const { count: actionCount, error: countError } = await countQuery;
      if (countError) throw countError;
      return actionCount || 0;
    };
    const [approved, processing, ready, claimed, rejected] = await Promise.all([
      countAction('approved'),
      countAction('processing'),
      countAction('ready'),
      countAction('claimed'),
      countAction('rejected')
    ]);

    const summary = {
      total: count || 0,
      byAction: { approved, processing, ready, claimed, rejected }
    };

    res.status(200).json({
      logs: logs || [],
      summary,
      admins: admins || [],
      activity_calendar: activityCalendar,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (err) {
    console.error('Get activity logs error:', err);
    res.status(500).json({ message: 'Failed to fetch activity logs.', error: err.message });
  }
};

export const getActivityLogById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: log, error } = await supabase
      .from('admin_activity_logs')
      .select(`
        *,
        admins:admin_id (id, username, full_name),
        requests:request_id (tracking_code, request_type, purpose, status, copies, sender_name, sender_id_number)
      `)
      .eq('id', id)
      .single();

    if (error || !log) {
      return res.status(404).json({ message: 'Activity log not found' });
    }

    res.status(200).json(log);

  } catch (err) {
    console.error('Get activity log by ID error:', err);
    res.status(500).json({ error: err.message });
  }
};