// =============================================
// EMAIL TEMPLATES FOR STATUS UPDATES
// =============================================
import { renderEmailHeader } from './emailLayout.js';

// Format date nicely
const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

// Approved & Processing Template
export const getApprovedTemplate = (data) => {
  const {
    studentName,
    trackingCode,
    documentType,
    dateSubmitted,
    amount
  } = data;

  const subject = `✅ Request Approved - Upload OR - ${trackingCode}`;
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f1f8e9; border: 1px solid #c8e6c9; border-radius: 12px;">
      ${renderEmailHeader()}
      
      <div style="background-color: #dcedc8; padding: 15px; border-left: 4px solid #2E7D32; border-radius: 8px; margin-bottom: 20px;">
        <h3 style="color: #1B5E20; margin: 0;">Request Approved - Official Receipt Required</h3>
      </div>
      
      <p>Dear <strong>${studentName}</strong>,</p>
      
      <p>Your request has been <strong style="color: #1B5E20;">APPROVED</strong>. Please upload a clear image of your Official Receipt so the Registrar can confirm your payment and begin processing.</p>
      
      <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <h4 style="margin-top: 0; color: #333;">📋 Request Details:</h4>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #666;">Request ID:</td>
            <td style="padding: 8px 0; font-weight: bold;">${trackingCode}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Document:</td>
            <td style="padding: 8px 0; font-weight: bold;">${documentType}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Date Submitted:</td>
            <td style="padding: 8px 0;">${formatDate(dateSubmitted)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Amount to Pay:</td>
            <td style="padding: 8px 0; font-weight: bold; color: #1B5E20;">${amount === 'Not recorded' ? amount : `₱${amount}`}</td>
          </tr>
        </table>
      </div>
      
      <div style="margin: 20px 0;">
        <h4 style="color: #333;">📌 Next Steps:</h4>
        <ol style="color: #666; padding-left: 20px;">
          <li>Pay at the Cashier's Office and get your Official Receipt</li>
          <li>Sign in to TRAC Request and upload the OR number and image</li>
          <li>Wait for OR confirmation and the "Ready for Pickup" notification</li>
        </ol>
      </div>
      
      <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 20px;">
        <p style="color: #4b6350; font-size: 14px;">Thank you for using TRAC Request.</p>
        <p style="color: #999; font-size: 12px;">This is an automated message, please do not reply.</p>
      </div>
    </div>
  `;

  return { subject, html };
};

// Ready for Pickup Template
export const getReadyTemplate = (data) => {
  const {
    studentName,
    trackingCode,
    documentType,
    amount
  } = data;

  const subject = `📦 Document Ready for Pickup - ${trackingCode}`;
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f1f8e9; border: 1px solid #c8e6c9; border-radius: 12px;">
      ${renderEmailHeader()}
      
      <div style="background-color: #fff8e1; padding: 15px; border-left: 4px solid #F9A825; border-radius: 8px; margin-bottom: 20px;">
        <h3 style="color: #8a5a00; margin: 0;">Document Ready for Pickup</h3>
      </div>
      
      <p>Dear <strong>${studentName}</strong>,</p>
      
      <p>Your document is now <strong style="color: #1B5E20;">READY FOR PICKUP</strong> at the Registrar's Office.</p>
      
      <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <h4 style="margin-top: 0; color: #333;">📋 Request Details:</h4>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #666;">Request ID:</td>
            <td style="padding: 8px 0; font-weight: bold;">${trackingCode}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Document:</td>
            <td style="padding: 8px 0; font-weight: bold;">${documentType}</td>
          </tr>
         
        </table>
      </div>
      
      <div style="margin: 20px 0;">
        <h4 style="color: #333;">📍 CLAIMING PROCESS:</h4>
        <ol style="color: #666; padding-left: 20px;">
     
          <li><strong>Go to Registrar Office</strong> - Present Official Receipt and Valid ID</li>
          <li><strong>Sign release form</strong> and claim your document</li>
        </ol>
        <p style="color: #e65100; font-size: 14px; margin-top: 15px;">
          ⚠️ Claim within 30 days, otherwise document will be forfeited.
        </p>
      </div>
      
      <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 20px;">
        <p style="color: #4b6350; font-size: 14px;">Thank you for using TRAC Request.</p>
        <p style="color: #999; font-size: 12px;">This is an automated message, please do not reply.</p>
      </div>
    </div>
  `;

  return { subject, html };
};

// Rejected Template
export const getRejectedTemplate = (data) => {
  const {
    studentName,
    trackingCode,
    documentType,
    rejectionReason,
    rejectedDate
  } = data;

  const subject = `❌ Request Rejected - ${trackingCode}`;
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f1f8e9; border: 1px solid #c8e6c9; border-radius: 12px;">
      ${renderEmailHeader()}
      
      <div style="background-color: #ffebee; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
        <h3 style="color: #c62828; margin: 0;">❌ Request Rejected</h3>
      </div>
      
      <p>Dear <strong>${studentName}</strong>,</p>
      
      <p>Your request has been <strong style="color: #c62828;">REJECTED</strong>.</p>
      
      <div style="background-color: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <h4 style="margin-top: 0; color: #333;">📋 Request Details:</h4>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #666;">Request ID:</td>
            <td style="padding: 8px 0; font-weight: bold;">${trackingCode}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Document:</td>
            <td style="padding: 8px 0; font-weight: bold;">${documentType}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;">Rejection Date:</td>
            <td style="padding: 8px 0;">${formatDate(rejectedDate)}</td>
          </tr>
        </table>
      </div>
      
      <div style="background-color: #fff3e0; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <h4 style="margin-top: 0; color: #e65100;">❌ Rejection Reason:</h4>
        <p style="color: #666; font-size: 16px;">${rejectionReason || 'No reason provided'}</p>
      </div>
      
      <div style="margin: 20px 0;">
        <p style="color: #666;">
          If you have questions or need to appeal, please contact the Registrar's Office:
        </p>
        <p style="color: #333;">
          📞 (068) 123-4567<br>
          📍 Registrar's Office, Sanga-Sanga, Bongao, Tawi-Tawi
        </p>
      </div>
      
      <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 20px;">
        <p style="color: #4b6350; font-size: 14px;">Thank you for using TRAC Request.</p>
        <p style="color: #999; font-size: 12px;">This is an automated message, please do not reply.</p>
      </div>
    </div>
  `;

  return { subject, html };
};