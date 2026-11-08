import { sendEmail } from '../config/email.js';
import { 
  getApprovedTemplate, 
  getReadyTemplate, 
  getRejectedTemplate 
} from '../utils/emailTemplates.js';
import { supabase } from '../config/supabase.js';
import { renderEmailHeader } from '../utils/emailLayout.js';

// =============================================
// 🆕 HELPER: GET EMAIL NOTIFICATION SETTINGS
// =============================================
const getEmailNotificationSettings = async () => {
  const { data: settings } = await supabase
    .from('system_settings')
    .select('email_notifications')
    .single();

  return settings?.email_notifications || {
    on_new_request: true,
    on_status_change: true,
    on_completion: true
  };
};

// =============================================
// SAVE EMAIL LOG TO DATABASE
// =============================================
const saveEmailLog = async (logData) => {
  try {
    const { error } = await supabase
      .from('email_logs')
      .insert([logData]);

    if (error) {
      console.error('❌ Failed to save email log:', error);
    }
  } catch (err) {
    console.error('❌ Error saving email log:', err);
  }
};

// =============================================
// 🆕 SEND STATUS UPDATE EMAIL (WITH NOTIFICATION CHECK)
// =============================================
export const sendStatusEmail = async (request, newStatus, reason = null) => {
  let logData = {
    request_id: request.id,
    email_type: newStatus,
    status: 'failed',
    sent_at: new Date().toISOString()
  };

  try {
    // 🆕 CHECK EMAIL NOTIFICATION SETTINGS
    const emailSettings = await getEmailNotificationSettings();

    // 🆕 Kung ang newStatus ay 'approved' o 'processing' → tingnan ang on_status_change
    if ((newStatus === 'approved' || newStatus === 'processing') && !emailSettings.on_status_change) {
      console.log(`📧 on_status_change is OFF — skipping email for ${newStatus}`);
      logData.recipient_email = 'none';
      logData.subject = `Skipped - on_status_change disabled`;
      logData.status = 'sent';
      logData.error_message = 'Notification disabled in settings';
      await saveEmailLog(logData);
      return { success: true, message: 'Notification disabled in settings' };
    }

    // 🆕 Kung ang newStatus ay 'ready' → tingnan ang on_completion
    if (newStatus === 'ready' && !emailSettings.on_completion) {
      console.log('📧 on_completion is OFF — skipping Ready for Pickup email');
      logData.recipient_email = 'none';
      logData.subject = 'Skipped - on_completion disabled';
      logData.status = 'sent';
      logData.error_message = 'Notification disabled in settings';
      await saveEmailLog(logData);
      return { success: true, message: 'Notification disabled in settings' };
    }

    // 🆕 Kung ang newStatus ay 'rejected' → tingnan ang on_status_change (kasama ang rejection)
    if (newStatus === 'rejected' && !emailSettings.on_status_change) {
      console.log('📧 on_status_change is OFF — skipping Rejection email');
      logData.recipient_email = 'none';
      logData.subject = 'Skipped - on_status_change disabled';
      logData.status = 'sent';
      logData.error_message = 'Notification disabled in settings';
      await saveEmailLog(logData);
      return { success: true, message: 'Notification disabled in settings' };
    }

    // Get user's email from database
    const { data: user, error } = await supabase
      .from('users')
      .select('email, first_name')
      .eq('id', request.sender_id)
      .single();

    if (error || !user) {
      console.error('❌ Could not find user email:', error);
      logData.error_message = 'User not found';
      await saveEmailLog(logData);
      return { success: false, error: 'User not found' };
    }

    if (!user.email) {
      console.log('⚠️ User has no email address:', request.sender_id);
      logData.error_message = 'No email address';
      logData.recipient_email = 'none';
      await saveEmailLog(logData);
      return { success: false, error: 'No email address' };
    }

    const emailData = {
      studentName: request.sender_name || user.first_name,
      trackingCode: request.tracking_code,
      documentType: request.request_type,
      dateSubmitted: request.date_sent,
      amount: await calculateAmount(request),
      rejectionReason: reason,
      rejectedDate: new Date()
    };

    let emailContent;

    switch(newStatus) {
      case 'approved':
      case 'processing':
        emailContent = getApprovedTemplate(emailData);
        break;
      case 'ready':
        emailContent = getReadyTemplate(emailData);
        break;
      case 'rejected':
        emailContent = getRejectedTemplate(emailData);
        break;
      default:
        return { success: false, error: 'Unknown status' };
    }

    // Update log data with email info
    logData.recipient_email = user.email;
    logData.subject = emailContent.subject;

    const result = await sendEmail(
      user.email,
      emailContent.subject,
      emailContent.html
    );

    if (result.success) {
      console.log(`✅ Status email sent to ${user.email} for ${request.tracking_code}`);
      logData.status = 'sent';
      logData.error_message = null;
    } else {
      console.error(`❌ Failed to send email for ${request.tracking_code}:`, result.error);
      logData.status = 'failed';
      logData.error_message = result.error;
    }

    // Save log to database
    await saveEmailLog(logData);

    return result;

  } catch (error) {
    console.error('❌ Error in sendStatusEmail:', error);
    logData.error_message = error.message;
    await saveEmailLog(logData);
    return { success: false, error: error.message };
  }
};

export const sendOrEmailNotification = async (request, event, reason = null) => {
  const subjects = {
    submitted: `Official Receipt Received - ${request.tracking_code}`,
    confirmed: `Official Receipt Confirmed - ${request.tracking_code}`,
    rejected: `Official Receipt Needs Correction - ${request.tracking_code}`
  };
  const subject = subjects[event];
  if (!subject) return { success: false, error: 'Unknown OR email event' };

  try {
    const emailSettings = await getEmailNotificationSettings();
    if (!emailSettings.on_status_change) {
      await saveEmailLog({
        request_id: request.id,
        email_type: `or_${event}`,
        status: 'sent',
        sent_at: new Date().toISOString(),
        recipient_email: 'none',
        subject,
        error_message: 'Notification disabled in settings'
      });
      return { success: true, message: 'Notification disabled in settings' };
    }

    const { data: user } = await supabase
      .from('users')
      .select('email, first_name')
      .eq('id', request.sender_id)
      .single();

    if (!user?.email) return { success: false, error: 'User email not found' };

    const safeReason = String(reason || '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
    const body = event === 'submitted'
      ? 'Your official receipt has been received and is waiting for Registrar review.'
      : event === 'confirmed'
        ? 'Your official receipt has been confirmed. Your request may now proceed according to the processing queue.'
        : `Your official receipt needs correction before processing can continue. Reason: ${safeReason}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f1f8e9; border: 1px solid #c8e6c9; border-radius: 12px;">
        ${renderEmailHeader()}
        <p>Dear <strong>${request.sender_name || user.first_name || 'Requester'}</strong>,</p>
        <p>${body}</p>
        <p><strong>Request:</strong> ${request.tracking_code}</p>
        <p><strong>Document:</strong> ${request.request_type}</p>
        ${event === 'rejected' ? '<p>You may sign in to TRAC Request and upload a corrected official receipt.</p>' : ''}
        <p style="color: #666; font-size: 12px;">This is an automated message. Please do not reply.</p>
      </div>`;
    const result = await sendEmail(user.email, subject, html);

    await saveEmailLog({
      request_id: request.id,
      email_type: `or_${event}`,
      status: result.success ? 'sent' : 'failed',
      sent_at: new Date().toISOString(),
      recipient_email: user.email,
      subject,
      error_message: result.success ? null : result.error
    });
    return result;
  } catch (error) {
    console.error(`OR ${event} notification error:`, error);
    return { success: false, error: error.message };
  }
};

export const calculateAmount = async (request) => {
  if (request.fee_total === null || request.fee_total === undefined) return 'Not recorded';
  const total = Number(request.fee_total);
  return Number.isFinite(total) ? total.toFixed(2) : 'Not recorded';
};