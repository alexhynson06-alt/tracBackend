import { supabase } from '../config/supabase.js';
import storageService from '../services/cloudinaryService.js';
import { buildOrSubmissionTimeline } from '../utils/orSubmissionTimeline.js';

const getRequestByIdentifier = async (identifier) => {
  const byTrackingCode = await supabase
    .from('requests')
    .select('*')
    .eq('tracking_code', identifier)
    .maybeSingle();

  if (byTrackingCode.data) return byTrackingCode.data;

  const byId = await supabase
    .from('requests')
    .select('*')
    .eq('id', identifier)
    .maybeSingle();

  return byId.data || null;
};

const sendOrEmail = async (request, event, reason = null) => {
  try {
    const { sendOrEmailNotification } = await import('../services/emailService.js');
    await sendOrEmailNotification(request, event, reason);
  } catch (error) {
    console.error(`OR ${event} email error:`, error);
  }
};

export const uploadOfficialReceipt = async (req, res) => {
  try {
    const request = await getRequestByIdentifier(req.params.id);
    const { userId } = req.user;
    const { or_number: orNumber } = req.body;

    if (!request || request.sender_id !== userId) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (!['approved', 'or_rejected'].includes(request.status)) {
      return res.status(400).json({ message: 'This request is not waiting for an official receipt upload.' });
    }

    if (!orNumber?.trim()) {
      return res.status(400).json({ message: 'OR number is required.' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'OR image is required.' });
    }

    const upload = await storageService.uploadImage(req.file, {
      folder: `trac/official-receipts/${request.tracking_code || request.id}`
    });
    const now = new Date().toISOString();

    const { data: updatedRequest, error } = await supabase.rpc('submit_request_or', {
      p_request_id: request.id,
      p_user_id: userId,
      p_or_number: orNumber.trim(),
      p_image_url: upload.url,
      p_image_public_id: upload.publicId,
      p_submitted_at: now
    });

    if (error) {
      await storageService.deleteImage(upload.publicId).catch((cleanupError) => {
        console.error('Failed to clean up OR image after request update failure:', cleanupError.message);
      });
      if (error.code === 'P0001') {
        return res.status(409).json({ message: error.message });
      }
      throw error;
    }

    await sendOrEmail(updatedRequest, 'submitted');
    return res.status(200).json({
      success: true,
      message: 'Official receipt submitted for review.',
      request: {
        tracking_code: updatedRequest.tracking_code,
        status: updatedRequest.status,
        or_number: updatedRequest.or_number,
        or_image_url: updatedRequest.or_image_url,
        or_uploaded_at: updatedRequest.or_uploaded_at
      }
    });
  } catch (error) {
    console.error('Upload official receipt error:', error);
    return res.status(500).json({ message: error.message || 'Failed to upload official receipt.' });
  }
};

export const getOfficialReceiptTimeline = async (req, res) => {
  try {
    const request = await getRequestByIdentifier(req.params.id);
    const isAdmin = req.user.type === 'admin' || req.user.role?.toLowerCase().includes('admin');

    if (!request || (!isAdmin && request.sender_id !== req.user.userId)) {
      return res.status(404).json({ message: 'Request not found' });
    }

    const { data: submissions, error } = await supabase
      .from('request_or_submissions')
      .select('id, attempt_number, or_number, submitted_at, submitted_by, reviewed_at, reviewed_by, decision, rejection_reason')
      .eq('request_id', request.id)
      .order('attempt_number', { ascending: true });

    if (error) throw error;

    const submitterIds = [...new Set((submissions || []).map((entry) => entry.submitted_by).filter(Boolean))];
    const reviewerIds = [...new Set((submissions || []).map((entry) => entry.reviewed_by).filter(Boolean))];

    const [{ data: users, error: usersError }, { data: admins, error: adminsError }] = await Promise.all([
      submitterIds.length
        ? supabase.from('users').select('id, first_name, last_name, id_number').in('id', submitterIds)
        : Promise.resolve({ data: [], error: null }),
      reviewerIds.length
        ? supabase.from('admins').select('id, username, full_name').in('id', reviewerIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (usersError) throw usersError;
    if (adminsError) throw adminsError;

    const timeline = buildOrSubmissionTimeline(submissions || [], users || [], admins || []);

    return res.status(200).json({ submissions: timeline });
  } catch (error) {
    console.error('Get official receipt timeline error:', error);
    return res.status(500).json({ message: 'Failed to load official receipt history.' });
  }
};

export const getOfficialReceipt = async (req, res) => {
  try {
    const request = await getRequestByIdentifier(req.params.id);
    const isAdmin = req.user.type === 'admin' || req.user.role?.toLowerCase().includes('admin');

    if (!request || (!isAdmin && request.sender_id !== req.user.userId)) {
      return res.status(404).json({ message: 'Request not found' });
    }

    return res.status(200).json({
      tracking_code: request.tracking_code,
      status: request.status,
      or_number: request.or_number || null,
      or_image_url: request.or_image_url || null,
      or_uploaded_at: request.or_uploaded_at || null,
      or_reviewed_at: request.or_reviewed_at || null,
      or_confirmed_at: request.or_confirmed_at || null,
      or_rejection_reason: request.or_rejection_reason || null
    });
  } catch (error) {
    console.error('Get official receipt error:', error);
    return res.status(500).json({ message: 'Failed to load official receipt.' });
  }
};

export const getOfficialReceiptHistory = async (req, res) => {
  try {
    const request = await getRequestByIdentifier(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found.' });

    const { data: submissions, error } = await supabase
      .from('request_or_submissions')
      .select('id, attempt_number, or_number, image_url, submitted_at, submitted_by, reviewed_at, reviewed_by, decision, rejection_reason')
      .eq('request_id', request.id)
      .order('attempt_number', { ascending: true });

    if (error) throw error;
    return res.status(200).json({ submissions: submissions || [] });
  } catch (error) {
    console.error('Get official receipt history error:', error);
    return res.status(500).json({ message: 'Failed to load official receipt history.' });
  }
};

const reviewOfficialReceipt = async (req, res, action) => {
  const request = await getRequestByIdentifier(req.params.id);
  const adminId = req.user.userId;

  if (!request) return { error: { status: 404, message: 'Request not found' } };
  if (request.status !== 'or_submitted') {
    return { error: { status: 400, message: 'This request has no official receipt waiting for review.' } };
  }

  const reason = req.body.reason?.trim() || null;
  if (action === 'reject' && !reason) {
    return { error: { status: 400, message: 'A rejection reason is required.' } };
  }

  const now = new Date().toISOString();
  const { data: updatedRequest, error } = await supabase.rpc('review_request_or', {
    p_request_id: request.id,
    p_expected_image_public_id: request.or_image_public_id,
    p_expected_image_url: request.or_image_url,
    p_admin_id: adminId,
    p_decision: action === 'confirm' ? 'confirmed' : 'rejected',
    p_rejection_reason: reason,
    p_reviewed_at: now
  });

  if (error?.code === 'P0001') return { error: { status: 409, message: error.message } };
  if (error) throw error;
  if (!updatedRequest) return { error: { status: 409, message: 'The request changed before it could be reviewed.' } };

  await sendOrEmail(updatedRequest, action === 'confirm' ? 'confirmed' : 'rejected', reason);
  return { updatedRequest };
};

export const confirmOfficialReceipt = async (req, res) => {
  try {
    const result = await reviewOfficialReceipt(req, res, 'confirm');
    if (result.error) return res.status(result.error.status).json({ message: result.error.message });
    return res.status(200).json({ success: true, message: 'Official receipt confirmed.', request: result.updatedRequest });
  } catch (error) {
    console.error('Confirm official receipt error:', error);
    return res.status(500).json({ message: 'Failed to confirm official receipt.' });
  }
};

export const rejectOfficialReceipt = async (req, res) => {
  try {
    const result = await reviewOfficialReceipt(req, res, 'reject');
    if (result.error) return res.status(result.error.status).json({ message: result.error.message });
    return res.status(200).json({ success: true, message: 'Official receipt rejected.', request: result.updatedRequest });
  } catch (error) {
    console.error('Reject official receipt error:', error);
    return res.status(500).json({ message: 'Failed to reject official receipt.' });
  }
};
