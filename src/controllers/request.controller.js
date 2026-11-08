import { supabase } from '../config/supabase.js';
import { removeDuplicateReceiptStatusEvents } from '../utils/requestTimeline.js';
import { studentAppUrl } from '../config/email.js';
import { isRequestCatalogItemAvailable, isRoleAllowed, normalizeCatalog } from '../utils/documentCatalog.js';
import { renderEmailHeader } from '../utils/emailLayout.js';

// =============================================
// 🆕 HELPER: GET FULL SETTINGS FROM DATABASE
// =============================================
const getSystemSettings = async () => {
  const { data: settings } = await supabase
    .from('system_settings')
    .select('daily_queue_limit, max_copies_per_request, require_purpose, document_settings, email_notifications')
    .single();

  const documentSettings = normalizeCatalog(settings?.document_settings);

  return {
    dailyLimit: settings?.daily_queue_limit || 100,
    maxCopiesPerRequest: settings?.max_copies_per_request || 5,
    requirePurpose: settings?.require_purpose !== false,
    documentSettings,
    emailNotifications: settings?.email_notifications || {
      on_new_request: true,
      on_status_change: true,
      on_completion: true
    }
  };
};

const getFeeForDocument = async (requestType) => {
  const { documentSettings } = await getSystemSettings();
  const requestRule = documentSettings.find((item) => item.name === requestType);
  return Number(requestRule?.fee || 0);
};

const formatAdminDisplayName = (admin) => {
  if (!admin) return 'Awaiting administrator processing';
  if (admin.full_name && admin.username) return `${admin.full_name} (@${admin.username})`;
  return admin.full_name || (admin.username ? `@${admin.username}` : 'Awaiting administrator processing');
};

const getPHDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());

const getNextAvailableDate = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

const sendDailyLimitNotification = async (email, name, limitCheck) => {
  const subject = 'Daily Request Limit Reached - TRAC Request';
  const nextDate = getNextAvailableDate();
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      ${renderEmailHeader()}
      <div style="background-color: #fff8e1; padding: 20px; border-radius: 8px; border-left: 4px solid #F9A825;">
        <h3 style="color: #8a5a00;">Daily Request Limit Reached</h3>
        <p>Dear ${name},</p>
        <p>You have reached the daily limit of <strong>${limitCheck.limit} requests</strong>.</p>
        <div style="background-color: #fff; padding: 15px; border-radius: 8px; margin: 15px 0;">
          <p><strong>📊 Your requests today:</strong> ${limitCheck.count} / ${limitCheck.limit}</p>
          <p><strong>📅 Next available date:</strong> ${nextDate}</p>
        </div>
        <p>Your request will be processed starting tomorrow.</p>
      </div>
    </div>
  `;
  
  try {
    const { sendEmail } = await import('../config/email.js');
    await sendEmail(email, subject, html);
  } catch (err) {
    console.error('Failed to send limit notification:', err);
  }
};

function generateTrackingCode() {
  const datePart = getPHDate().replace(/-/g, '');
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  return `REQ-${datePart}-${randomPart}`;
}

// =============================================
// 🆕 HELPER: SEND CONFIRMATION EMAIL (CHECKS NOTIFICATION SETTING)
// =============================================
const sendConfirmationEmail = async (email, name, requestData) => {
  let emailNotifications;
  try {
    ({ emailNotifications } = await getSystemSettings());
  } catch (err) {
    console.error('Failed to load email notification settings:', err);
    return;
  }
  
  // 🆕 Tumingin sa settings kung naka-enable ang on_new_request
  if (emailNotifications.on_new_request === false) {
    console.log('📧 on_new_request is OFF — skipping confirmation email');
    return;
  }

  const subject = 'Request Confirmed - TRAC Request';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      ${renderEmailHeader()}
      <div style="background-color: #dcedc8; padding: 20px; border-left: 4px solid #2E7D32; border-radius: 8px;">
        <h3 style="color: #1B5E20;">Request Confirmed</h3>
        <p>Dear ${name},</p>
        <p>Your request for <strong>${requestData.request_type}</strong> has been received.</p>
        <div style="background-color: #fff; padding: 15px; border-radius: 8px; margin: 15px 0;">
          <p><strong>📋 Tracking Code:</strong> ${requestData.tracking_code}</p>
          <p><strong>🔢 Queue Number:</strong> #${requestData.queue_number}</p>
          <p><strong>📄 Copies:</strong> ${requestData.copies}</p>
          <p><strong>💰 Total Fee:</strong> ₱${requestData.totalFee}</p>
        </div>
        <p>You will receive another email when your document is ready for pickup.</p>
        <p><a href="${studentAppUrl}" style="color: #1B5E20; font-weight: bold;">Track your request in TRAC Request</a></p>
      </div>
    </div>
  `;

  try {
    const { sendEmail } = await import('../config/email.js');
    await sendEmail(email, subject, html);
    console.log('✅ Confirmation email sent to:', email);
  } catch (err) {
    console.error('Failed to send confirmation email:', err);
  }
};

export const getTodayRequests = async (req, res) => {
  try {
    const { userId } = req.user;
    const today = getPHDate();

    const { data, error } = await supabase
      .from('requests')
      .select('request_type')
      .eq('sender_id', userId)
      .eq('queue_date', today);

    if (error) throw error;

    res.status(200).json({ requests: data });
  } catch (err) {
    console.error('Get today requests error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const getPendingCount = async (req, res) => {
  try {
    const { count, error } = await supabase
      .from('requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (error) throw error;

    res.status(200).json({ success: true, count: count || 0 });
  } catch (err) {
    console.error('Get pending count error:', err);
    res.status(500).json({ message: 'Failed to get pending count' });
  }
};

// =============================================
// 🆕 CREATE REQUEST — WITH NOTIFICATION CHECK
// =============================================
export const createRequest = async (req, res) => {
  try {
    const {
      category,
      request_type,
      purpose,
      additional_remarks,
      copies = 1
    } = req.body;

    const { userId } = req.user;

    if (!request_type || typeof request_type !== 'string') {
      return res.status(400).json({ message: 'Request type is required.' });
    }

    const { documentSettings, maxCopiesPerRequest, requirePurpose } = await getSystemSettings();
    const requestRule = documentSettings.find((item) => item.name === request_type && isRequestCatalogItemAvailable(item));
    if (!requestRule) {
      return res.status(400).json({
        success: false,
        message: 'This request is unavailable in the current catalog.'
      });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id_number, first_name, last_name, role, email')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!isRoleAllowed(requestRule.allowedRoles, user.role)) {
      return res.status(403).json({
        success: false,
        message: `${request_type} is not available to ${user.role === 'alumni' ? 'alumni' : 'students'}.`
      });
    }

    const requestedCategory = category?.trim();
    if (!requestedCategory || requestedCategory !== requestRule.category) {
      return res.status(400).json({
        success: false,
        message: `Request category must be ${requestRule.category}.`
      });
    }

    const copyCount = Number(copies);
    if (!Number.isInteger(copyCount) || copyCount < 1) {
      return res.status(400).json({ success: false, message: 'Copies must be a valid number greater than zero.' });
    }

    if (!requestRule.allowsMultiple && copyCount > 1) {
      return res.status(400).json({ success: false, message: 'This request only allows one copy.' });
    }

    if (copyCount > maxCopiesPerRequest) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${maxCopiesPerRequest} copies are allowed per request.`
      });
    }

    const requestPurpose = typeof purpose === 'string' ? purpose.trim() : '';
    if (requirePurpose && !requestPurpose) {
      return res.status(400).json({ success: false, message: 'Purpose is required.' });
    }

    const unitFee = Number(requestRule.fee);
    if (!Number.isFinite(unitFee) || unitFee < 0 || Math.abs(unitFee - Number(unitFee.toFixed(2))) > 0.00000001 || !['per_copy', 'per_page', 'per_subject'].includes(requestRule.feeUnit)) {
      return res.status(409).json({ success: false, message: 'This catalog entry needs a valid fee.' });
    }

    const tracking_code = generateTrackingCode();
    const today = getPHDate();
    const totalFee = Number((unitFee * copyCount).toFixed(2));
    const submittedAt = new Date().toISOString();
    const requestPayload = {
      sender_id: userId,
      sender_id_number: user.id_number,
      sender_name: `${user.first_name} ${user.last_name}`,
      category: requestRule.category,
      request_type,
      purpose: requestPurpose || 'Not specified',
      additional_remarks: additional_remarks || '',
      copies: copyCount,
      tracking_code,
      status: 'pending',
      queue_date: today,
      date_sent: submittedAt,
      fee_amount: unitFee,
      fee_unit: requestRule.feeUnit,
      fee_total: totalFee
    };

    const { data, error } = await supabase.rpc('submit_catalog_request', { p_request: requestPayload });
    if (error) {
      const message = error.message || '';
      if (message.includes('GLOBAL_DAILY_LIMIT')) {
        return res.status(429).json({
          success: false,
          message: 'The system has reached its request limit for today. Please try again tomorrow.',
          limitReached: true,
          dailyLimit: (await getSystemSettings()).dailyLimit,
          nextAvailableDate: getNextAvailableDate()
        });
      }
      if (message.includes('USER_DAILY_LIMIT')) {
        const limitCheck = { limit: 100, count: 100 };
        await sendDailyLimitNotification(user.email, user.first_name, limitCheck);
        return res.status(429).json({
          success: false,
          message: 'You have reached the daily limit of 100 requests. Please try again tomorrow.',
          limitReached: true,
          dailyLimit: 100,
          requestsToday: 100,
          nextAvailableDate: getNextAvailableDate()
        });
      }
      if (message.includes('DUPLICATE_REQUEST')) {
        return res.status(409).json({
          success: false,
          message: 'You have already requested this document today. Please try again tomorrow.',
          duplicate: true
        });
      }
      throw error;
    }

    const queueNumber = data.queue_number;

    // 🆕 SEND CONFIRMATION EMAIL (CHECKS on_new_request setting)
    const userName = `${user.first_name} ${user.last_name}`;
    sendConfirmationEmail(user.email, userName, {
      request_type,
      tracking_code,
      queue_number: queueNumber,
      copies,
      totalFee: totalFee.toFixed(2)
    });

    res.status(201).json({
      success: true,
      request_id: data.id,
      tracking_code: data.tracking_code,
      request_type: data.request_type,
      purpose: data.purpose,
      copies: data.copies,
      date_submitted: data.date_sent,
      fee: `₱${totalFee.toFixed(2)}`,
      fee_amount: unitFee,
      fee_unit: requestRule.feeUnit,
      fee_total: totalFee,
      queue_number: queueNumber,
      message: 'Request submitted successfully'
    });

  } catch (err) {
    console.error('Create request error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const trackRequestByCode = async (req, res) => {
  try {
    const { tracking_code } = req.params;

    if (!tracking_code) {
      return res.status(400).json({ message: 'Tracking code is required' });
    }

    const { data, error } = await supabase
      .from('requests')
      .select('sender_id, tracking_code, status, request_type, category, date_sent, copies, purpose, additional_remarks, queue_number')
      .eq('tracking_code', tracking_code)
      .single();

    if (error || !data) {
      return res.status(404).json({ message: 'Request not found' });
    }

    const userRole = String(req.user?.role || '').toLowerCase();
    const userType = String(req.user?.type || '').toLowerCase();
    const isAdmin = userRole.includes('admin') || userType === 'admin';
    if (!isAdmin && data.sender_id !== req.user?.userId) {
      return res.status(404).json({ message: 'Request not found' });
    }

    res.json({
      tracking_code: data.tracking_code,
      status: data.status,
      request_type: data.request_type,
      category: data.category,
      date_submitted: data.date_sent,
      copies: data.copies,
      purpose: data.purpose,
      additional_remarks: data.additional_remarks,
      queue_number: data.queue_number
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getAllRequests = async (req, res) => {
  try {
    const { status, page = 1, limit = 10, startDate, endDate, endDateExclusive } = req.query;
    const user = req.user;

    let query = supabase.from('requests').select('*', { count: 'exact' });


    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (startDate) {
      query = query.gte('date_sent', startDate);
    }

    if (endDateExclusive) {
      query = query.lt('date_sent', endDateExclusive);
    } else if (endDate) {
      query = query.lte('date_sent', endDate);
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: requests, error, count } = await query
      .order('queue_date', { ascending: false })
      .order('queue_number', { ascending: false })
      .range(from, to);

    if (error) throw error;

    const senderIds = requests.map(req => req.sender_id).filter(Boolean);
    let usersMap = {};
    if (senderIds.length > 0) {
      const { data: users, error: userError } = await supabase
        .from('users')
        .select('id, id_number, first_name, last_name, role, department, course, avatar_url')
        .in('id', senderIds);
      
      if (!userError && users) {
        usersMap = users.reduce((acc, user) => { acc[user.id] = user; return acc; }, {});
      }
    }

    const formatDateShort = (dateString) => {
      if (!dateString) return '—';
      const date = new Date(dateString);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const { documentSettings } = await getSystemSettings();
    const transformedRequests = requests.map(request => {
      const userData = usersMap[request.sender_id] || {};
      const studentType = userData.role === 'alumni' ? 'Alumni' : 'Student';
      const requestRule = documentSettings.find((item) => item.name === request.request_type);
      
      return {
        id: request.tracking_code || `REQ-${request.id}`,
        student: request.sender_name || `${userData.first_name || ''} ${userData.last_name || ''}`.trim(),
        studentPhoto: userData.avatar_url || null,
        idNumber: request.sender_id_number || userData.id_number || '—',
        studentType: studentType,
        document: request.request_type,
        allowedRoles: requestRule?.allowedRoles || [],
        requestAvailable: requestRule?.active === true,
        date: request.date_sent,
        status: request.status,
        copies: request.copies,
        institute: userData.department || request.department || '',
        course: userData.course || '',
        queue_number: request.queue_number,
        queue_date: request.queue_date
      };
    });

    let statsQuery = supabase.from('requests').select('*');
    if (user.role !== 'super_admin') {
      statsQuery = statsQuery.eq('department', user.department);
    }
    const { data: allRequestsForStats } = await statsQuery;
    
    const stats = {
      totalRequests: allRequestsForStats?.length || 0,
      pending: allRequestsForStats?.filter(r => r.status === 'pending').length || 0,
      processing: allRequestsForStats?.filter(r => r.status === 'processing' || r.status === 'approved').length || 0,
      ready: allRequestsForStats?.filter(r => r.status === 'ready').length || 0,
      claimed: allRequestsForStats?.filter(r => r.status === 'claimed').length || 0,
      rejected: allRequestsForStats?.filter(r => r.status === 'rejected').length || 0
    };

    res.status(200).json({
      requests: transformedRequests,
      stats,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: count, pages: Math.ceil(count / limit) }
    });

  } catch (err) {
    console.error('Error in getAllRequests:', err);
    res.status(500).json({ error: err.message });
  }
};

export const getRequestById = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.user;

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    
    let query = supabase.from('requests').select('*');
    
    if (isUUID) { query = query.eq('id', id); } 
    else { query = query.eq('tracking_code', id); }

    const { data: request, error: requestError } = await query.single();

    if (requestError || !request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    const isAdmin = req.user.role?.toLowerCase().includes('admin') || req.user.type?.toLowerCase() === 'admin';
    if (!isAdmin && request.sender_id !== userId) {
      return res.status(403).json({ message: 'You are not authorized to view this request' });
    }

    let userData = null;
    if (request.sender_id) {
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id_number, first_name, last_name, middle_name, email, department, course, year_level, year_graduated, role, avatar_url')
        .eq('id', request.sender_id)
        .single();
      if (!userError && user) { userData = user; }
    }

    const formatDateFull = (dateString) => {
      if (!dateString) return null;
      return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const studentType = userData?.role === 'student' ? 'Student' : userData?.role === 'alumni' ? 'Alumni' : 'Student';
    const { documentSettings } = await getSystemSettings();
    const requestRule = documentSettings.find((item) => item.name === request.request_type);
    const copyCount = Number(request.copies || 1);
    const amount = request.fee_total !== null && request.fee_total !== undefined
      ? Number(request.fee_total)
      : request.fee_amount !== null && request.fee_amount !== undefined
        ? Number(request.fee_amount) * copyCount
        : (await getFeeForDocument(request.request_type)) * copyCount;

    const response = {
      id: request.tracking_code, uuid: request.id, tracking_code: request.tracking_code,
      status: request.status, category: request.category, documentType: request.request_type,
      allowedRoles: requestRule?.allowedRoles || [],
      requestAvailable: requestRule?.active === true,
      purpose: request.purpose, copies: request.copies,
      studentName: request.sender_name || (userData ? `${userData.first_name || ''} ${userData.last_name || ''}`.trim() : ''),
      ...(isAdmin ? { studentPhoto: userData?.avatar_url || null } : {}),
      studentId: userData?.id_number || request.sender_id_number || '',
      studentType: studentType, course: userData?.course || '',
      yearLevel: userData?.year_level || '', yearGraduated: userData?.year_graduated || '',
      department: userData?.department || '', email: userData?.email || '—',
      requestDate: formatDateFull(request.date_sent), amount: amount.toFixed(2),
      additional_remarks: request.additional_remarks || '',
      estimated_completion_date: formatDateFull(request.estimated_completion_date),
      queue_number: request.queue_number, queue_date: request.queue_date,
      or_number: request.or_number || null,
      or_image_url: request.or_image_url || null,
      or_uploaded_at: request.or_uploaded_at || null,
      or_reviewed_at: request.or_reviewed_at || null,
      or_confirmed_at: request.or_confirmed_at || null,
      or_rejection_reason: request.or_rejection_reason || null
    };

    res.status(200).json(response);

  } catch (err) {
    console.error('Get request by ID error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const searchRequests = async (req, res) => {
  try {
    const { q } = req.query;
    const { page = 1, limit = 10 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ message: 'Search query must be at least 2 characters' });
    }

    const searchTerm = q.trim();
    let query = supabase.from('requests').select('*');
    const conditions = [];
    
    if (searchTerm.match(/^REQ-\d{8}-\d{4}$/)) { conditions.push(`tracking_code.eq.${searchTerm}`); }
    conditions.push(`tracking_code.ilike.%${searchTerm}%`);
    conditions.push(`request_type.ilike.%${searchTerm}%`);
    conditions.push(`purpose.ilike.%${searchTerm}%`);
    conditions.push(`sender_name.ilike.%${searchTerm}%`);
    conditions.push(`sender_id_number.ilike.%${searchTerm}%`);

    query = query.or(conditions.join(','));
    const { data: requests, error } = await query.order('date_sent', { ascending: false });
    if (error) throw error;

    const { data: userMatches } = await supabase
      .from('users')
      .select('id, first_name, last_name, id_number, role')
      .or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,id_number.ilike.%${searchTerm}%`);

    let userBasedRequests = [];
    if (userMatches && userMatches.length > 0) {
      const userIds = userMatches.map(u => u.id);
      const { data: extraRequests } = await supabase
        .from('requests').select('*').in('sender_id', userIds).order('date_sent', { ascending: false });
      if (extraRequests) userBasedRequests = extraRequests;
    }

    const allRequests = [...requests, ...userBasedRequests];
    const uniqueRequests = Array.from(new Map(allRequests.map(item => [item.id, item])).values());
    const senderIds = [...new Set(uniqueRequests.map(request => request.sender_id).filter(Boolean))];
    const userMap = {};
    if (userMatches) { userMatches.forEach(user => { userMap[user.id] = user; }); }
    if (senderIds.length > 0) {
      const { data: requestUsers, error: userError } = await supabase
        .from('users')
        .select('id, first_name, last_name, id_number, role, department, course, avatar_url')
        .in('id', senderIds);
      if (userError) throw userError;
      requestUsers?.forEach(user => { userMap[user.id] = user; });
    }

    const formatDateShort = (dateString) => {
      if (!dateString) return '—';
      const date = new Date(dateString);
      return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    };

    const { documentSettings } = await getSystemSettings();
    const transformedRequests = uniqueRequests.map(request => {
      const user = userMap[request.sender_id] || {};
      const requestRule = documentSettings.find((item) => item.name === request.request_type);
      return {
        id: request.tracking_code || `REQ-${request.id}`,
        student: request.sender_name || (user.first_name || user.last_name ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Unknown'),
        studentPhoto: user.avatar_url || null,
        idNumber: request.sender_id_number || user.id_number || '—',
        studentType: user.role === 'alumni' ? 'Alumni' : 'Student',
        document: request.request_type, allowedRoles: requestRule?.allowedRoles || [],
        requestAvailable: requestRule?.active === true, date: formatDateShort(request.date_sent),
        status: request.status, purpose: request.purpose, copies: request.copies || 1,
        institute: user.department || request.department || '', course: user.course || '',
        queue_number: request.queue_number, queue_date: request.queue_date
      };
    });

    const startIndex = (page - 1) * limit;
    const paginatedResults = transformedRequests.slice(startIndex, startIndex + limit);

    res.status(200).json({
      query: searchTerm, total: transformedRequests.length,
      page: parseInt(page), limit: parseInt(limit),
      results: paginatedResults,
      stats: { totalMatches: transformedRequests.length, showing: paginatedResults.length }
    });

  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const getUserRequests = async (req, res) => {
  try {
    const { userId } = req.user;
    const { status, page = 1, limit = 10 } = req.query;

    let query = supabase
      .from('requests')
      .select('tracking_code, request_type, status, date_sent, queue_number, queue_date', { count: 'exact' })
      .eq('sender_id', userId);

    if (status && status !== 'all') { query = query.eq('status', status); }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: requests, error, count } = await query
      .order('queue_date', { ascending: true })
      .order('queue_number', { ascending: true })
      .range(from, to);

    if (error) throw error;

    const formatDateShort = (dateString) => {
      if (!dateString) return '—';
      return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    const transformedRequests = requests.map(request => ({
      tracking_code: request.tracking_code, document: request.request_type,
      status: request.status, date_submitted: formatDateShort(request.date_sent),
      queue_number: request.queue_number, queue_date: request.queue_date
    }));

    const { data: stats } = await supabase.from('requests').select('status').eq('sender_id', userId);

    const statusCounts = {
      pending: stats?.filter(r => r.status === 'pending').length || 0,
      processing: stats?.filter(r => r.status === 'processing' || r.status === 'approved').length || 0,
      ready: stats?.filter(r => r.status === 'ready').length || 0,
      claimed: stats?.filter(r => r.status === 'claimed').length || 0,
      rejected: stats?.filter(r => r.status === 'rejected').length || 0,
      total: count || 0
    };

    res.status(200).json({
      requests: transformedRequests, stats: statusCounts,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: count, pages: Math.ceil(count / limit) }
    });

  } catch (err) {
    console.error('Get user requests error:', err);
    res.status(503).json({
      code: 'DATABASE_UNAVAILABLE',
      message: 'The request service is temporarily unavailable. Please try again later.'
    });
  }
};

export const getUserRequestDetails = async (req, res) => {
  try {
    const { trackingCode } = req.params;
    const { userId } = req.user;

    const { data: request, error } = await supabase
      .from('requests')
      .select('tracking_code, request_type, status, date_sent, copies, processed_date, ready_date, claimed_date, rejected_date, rejected_reason, queue_number, queue_date, or_number, or_image_url, or_uploaded_at, or_reviewed_at, or_confirmed_at, or_rejection_reason, fee_amount, fee_unit, fee_total')
      .eq('tracking_code', trackingCode).eq('sender_id', userId).single();

    if (error || !request) { return res.status(404).json({ message: 'Request not found' }); }

    const formatDateLong = (dateString) => {
      if (!dateString) return null;
      return new Date(dateString).toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    res.status(200).json({
      tracking_code: request.tracking_code, request_type: request.request_type,
      status: request.status, date_sent: formatDateLong(request.date_sent),
      copies: request.copies,
      fee_amount: request.fee_amount, fee_unit: request.fee_unit, fee_total: request.fee_total,
      processed_date: formatDateLong(request.processed_date), ready_date: formatDateLong(request.ready_date),
      claimed_date: formatDateLong(request.claimed_date), rejected_date: formatDateLong(request.rejected_date),
      rejected_reason: request.rejected_reason || null, queue_number: request.queue_number, queue_date: request.queue_date
      ,or_number: request.or_number || null, or_image_url: request.or_image_url || null,
      or_uploaded_at: request.or_uploaded_at || null, or_reviewed_at: request.or_reviewed_at || null,
      or_confirmed_at: request.or_confirmed_at || null, or_rejection_reason: request.or_rejection_reason || null
    });

  } catch (err) {
    console.error('Get user request details error:', err);
    res.status(500).json({ error: err.message });
  }
};

export const getUserRequestTimeline = async (req, res) => {
  try {
    const { trackingCode } = req.params;
    const { userId } = req.user;

    const { data: request, error: requestError } = await supabase
      .from('requests')
      .select('id, sender_id')
      .eq('tracking_code', trackingCode)
      .eq('sender_id', userId)
      .single();

    if (requestError || !request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    const [requestResult, orResult] = await Promise.all([
      supabase
        .from('requests')
        .select('status_history')
        .eq('id', request.id)
        .single(),
      supabase
        .from('request_or_submissions')
        .select('id, attempt_number, submitted_at, reviewed_at, decision, rejection_reason, submitted_by, reviewed_by')
        .eq('request_id', request.id)
        .order('attempt_number', { ascending: true })
    ]);

    if (requestResult.error) throw requestResult.error;
    if (orResult.error) throw orResult.error;

    const statusHistory = removeDuplicateReceiptStatusEvents(
      Array.isArray(requestResult.data?.status_history) ? requestResult.data.status_history : [],
      orResult.data || []
    );
    const adminIds = new Set();
    statusHistory.forEach((entry) => {
      if (entry?.admin_id) adminIds.add(entry.admin_id);
    });
    (orResult.data || []).forEach((entry) => {
      if (entry?.reviewed_by) adminIds.add(entry.reviewed_by);
    });

    const { data: admins } = adminIds.size
      ? await supabase.from('admins').select('id, username, full_name').in('id', Array.from(adminIds))
      : { data: [] };
    const adminMap = Object.fromEntries((admins || []).map((admin) => [admin.id, admin]));

    const timeline = [
      ...statusHistory.map((entry) => ({
        type: 'status',
        status: entry.status,
        timestamp: entry.timestamp,
        reason: entry.reason || null,
        administrator: entry.admin_id ? formatAdminDisplayName(adminMap[entry.admin_id]) : null
      })),
      ...(orResult.data || []).flatMap((entry) => ([
        {
          type: 'or_submitted',
          timestamp: entry.submitted_at,
          attempt_number: entry.attempt_number,
          administrator: null,
          decision: null,
          reason: null
        },
        entry.reviewed_at ? {
          type: entry.decision === 'confirmed' ? 'or_confirmed' : 'or_rejected',
          timestamp: entry.reviewed_at,
          attempt_number: entry.attempt_number,
          administrator: formatAdminDisplayName(adminMap[entry.reviewed_by]),
          decision: entry.decision,
          reason: entry.rejection_reason || null
        } : null
      ].filter(Boolean)))
    ].sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));

    res.status(200).json({ timeline });
  } catch (error) {
    console.error('Get user request timeline error:', error);
    res.status(500).json({ message: 'Failed to load request timeline.' });
  }
};

export const getAllandallRequests = async (req, res) => {
  try {
    const { data: requests, error: requestsError } = await supabase
      .from('requests').select('*').order('queue_date', { ascending: true }).order('queue_number', { ascending: true });

    if (requestsError) throw requestsError;
    if (!requests || requests.length === 0) { return res.status(200).json({ success: true, count: 0, requests: [] }); }

    const senderIds = [...new Set(requests.map(r => r.sender_id).filter(Boolean))];
    let usersMap = {};
    if (senderIds.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from('users').select('id, id_number, first_name, last_name, middle_name, role, year_level, year_graduated, department, course, email')
        .in('id', senderIds);
      if (!usersError && users) { usersMap = users.reduce((acc, user) => { acc[user.id] = user; return acc; }, {}); }
    }

    const transformedRequests = requests.map(request => {
      const user = usersMap[request.sender_id];
      return {
        id: request.id, tracking_code: request.tracking_code, category: request.category,
        request_type: request.request_type, purpose: request.purpose, additional_remarks: request.additional_remarks,
        copies: request.copies, status: request.status, date_sent: request.date_sent,
        estimated_completion_date: request.estimated_completion_date, payment_status: request.payment_status,
        or_number: request.or_number, approved_date: request.approved_date, processed_date: request.processed_date,
        ready_date: request.ready_date, claimed_date: request.claimed_date, rejected_date: request.rejected_date,
        rejected_reason: request.rejected_reason, status_history: request.status_history,
        sender_name: request.sender_name, sender_id_number: request.sender_id_number,
        queue_number: request.queue_number, queue_date: request.queue_date,
        user: user ? {
          id: user.id, id_number: user.id_number, name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
          first_name: user.first_name, last_name: user.last_name, middle_name: user.middle_name,
          role: user.role, year_level: user.role === 'student' ? user.year_level : null,
          year_graduated: user.role === 'alumni' ? user.year_graduated : null,
          department: user.department, course: user.course, email: user.email
        } : null
      };
    });

    res.status(200).json({ success: true, count: transformedRequests.length, requests: transformedRequests });

  } catch (err) {
    console.error('Error fetching all requests:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const exportRequestsToCSV = async (req, res) => {
  try {
    const { status, startDate, endDate } = req.query;
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    let query = supabase
      .from('requests')
      .select(`
        tracking_code,
        sender_name,
        sender_id_number,
        request_type,
        copies,
        status,
        date_sent,
        queue_number,
        purpose,
        fee_amount,
        fee_total
      `);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }
    if (startDate) {
      query = query.gte('date_sent', startDate);
    }
    if (endDate) {
      query = query.lte('date_sent', endDate);
    }

    const { data: requests, error } = await query.order('date_sent', { ascending: false });

    if (error) throw error;

    if (!requests || requests.length === 0) {
      return res.status(404).json({ message: 'No data to export' });
    }

    const headers = [
      'Tracking Code',
      'Student Name',
      'Student ID',
      'Document Type',
      'Copies',
      'Status',
      'Date Submitted',
      'Queue Number',
      'Total Fee',
      'Purpose'
    ];

    const { documentSettings } = await getSystemSettings();
    const rows = requests.map((req) => {
      const copyCount = Number(req.copies || 1);
      const requestRule = documentSettings.find((item) => item.name === req.request_type);
      const totalFee = (req.fee_total !== null && req.fee_total !== undefined
        ? Number(req.fee_total)
        : req.fee_amount !== null && req.fee_amount !== undefined
          ? Number(req.fee_amount) * copyCount
          : Number(requestRule?.fee || 0) * copyCount).toFixed(2);
      
      return [
        req.tracking_code || '',
        req.sender_name || '',
        req.sender_id_number || '',
        req.request_type || '',
        req.copies || 1,
        req.status || '',
        new Date(req.date_sent).toLocaleDateString('en-PH'),
        req.queue_number || 'N/A',
        `₱${totalFee}`,
        req.purpose || 'Not specified'
      ];
    });

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const bom = '\uFEFF';
    const csvWithBom = bom + csvContent;
    const fileName = `requests_export_${new Date().toISOString().split('T')[0]}.csv`;
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.status(200).send(csvWithBom);

  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ message: 'Failed to export data' });
  }
};