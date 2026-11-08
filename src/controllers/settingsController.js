// backend/src/controllers/settingsController.js

import { supabase } from '../config/supabase.js';
import { DEFAULT_REQUESTS, normalizeCatalog } from '../utils/documentCatalog.js';
import { DEFAULT_INSTITUTES, normalizeInstitutes } from '../utils/academicCatalog.js';
import { DEFAULT_ACTIVITY_CALENDAR, normalizeActivityCalendar, validateActivityCalendar } from '../utils/activityCalendar.js';

const validateInstitutes = (institutes) => {
  if (!Array.isArray(institutes) || institutes.length === 0) return 'At least one institute is required.';
  const instituteCodes = new Set();
  const courseCodes = new Set();
  const courseNames = new Set();
  for (const institute of institutes) {
    const code = String(institute?.code || '').trim().toUpperCase();
    const name = String(institute?.name || '').trim();
    const shortName = String(institute?.shortName || '').trim();
    if (!/^[A-Z0-9-]{2,12}$/.test(code)) return 'Institute codes must be 2 to 12 letters, numbers, or hyphens.';
    if (!name || name.length > 120 || (shortName && shortName.length > 24)) return `${code} needs a valid name.`;
    if (instituteCodes.has(code)) return `Duplicate institute code: ${code}.`;
    if (!Array.isArray(institute.programs)) return `${code} courses must be a list.`;
    if (institute.programs.length === 0) return `${code} needs at least one course before it can be saved.`;
    instituteCodes.add(code);
    for (const program of institute.programs) {
      const courseCode = String(program?.code || '').trim().toUpperCase();
      const courseName = String(program?.name || '').trim();
      if (!/^[A-Z0-9.-]{2,20}$/i.test(courseCode)) return `${code} contains an invalid course code.`;
      if (!courseName || courseName.length > 160) return `${code} courses need a name of 1 to 160 characters.`;
      if (courseCodes.has(courseCode)) return `Duplicate course code: ${courseCode}.`;
      if (courseNames.has(courseName.toLowerCase())) return `Duplicate course name: ${courseName}.`;
      courseCodes.add(courseCode);
      courseNames.add(courseName.toLowerCase());
    }
  }
  return null;
};

const validateDocumentSettings = (items) => {
  if (!Array.isArray(items)) return 'Document settings must be an array.';
  const names = new Set();
  const ids = new Set();
  for (const item of items) {
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    const id = String(item?.id ?? '').trim();
    const fee = Number(item?.fee);
    const roundedFee = Number.isFinite(fee) ? Number(fee.toFixed(2)) : NaN;
    const roles = item?.allowedRoles;
    const feeUnit = item?.feeUnit || item?.fee_unit || 'per_copy';
    if (!name || name.length > 200) return 'Each request type needs a name of 1 to 200 characters.';
    if (!id || ids.has(id)) return 'Request type IDs must be present and unique.';
    if (names.has(name.toLowerCase())) return `Duplicate request type: ${name}.`;
    if (!['Document', 'Form'].includes(item.category)) return `${name} needs a Document or Form category.`;
    if (!Number.isFinite(fee) || fee < 0 || Math.abs(fee - roundedFee) > 0.00000001) return `${name} needs a non-negative fee with no more than two decimal places.`;
    if (!['per_copy', 'per_page', 'per_subject'].includes(feeUnit)) return `${name} has an invalid fee unit.`;
    if (!Array.isArray(roles) || roles.some((role) => !['student', 'alumni'].includes(role))) return `${name} has invalid audience settings.`;
    if (item.active !== false && item.archived !== true && roles.length === 0) return `${name} must be available to students, alumni, or both.`;
    names.add(name.toLowerCase());
    ids.add(id);
  }
  return null;
};

// =============================================
// GET SETTINGS (Admin)
// =============================================
export const getSettings = async (req, res) => {
  try {
    let { data: settings, error } = await supabase
      .from('system_settings')
      .select('*')
      .single();

    if (error && error.code === 'PGRST116') {
      const defaultSettings = {
        contact_email: 'registrar@trac.edu.ph',
        office_hours: 'Monday to Friday, 8:00 AM - 4:45 PM',
        daily_queue_limit: 100,
        max_copies_per_request: 5,
        require_purpose: true,
        email_notifications: {
          on_new_request: true,
          on_status_change: true,
          on_completion: true
        },
        document_settings: DEFAULT_REQUESTS,
        academic_settings: DEFAULT_INSTITUTES,
        activity_calendar: DEFAULT_ACTIVITY_CALENDAR
      };

      const { data: newSettings, error: insertError } = await supabase
        .from('system_settings')
        .insert([defaultSettings])
        .select()
        .single();

      if (insertError) throw insertError;
      
      return res.status(200).json({
        success: true,
        settings: {
          contact_email: newSettings.contact_email,
          office_hours: newSettings.office_hours,
          daily_queue_limit: newSettings.daily_queue_limit,
          max_copies_per_request: newSettings.max_copies_per_request,
          require_purpose: newSettings.require_purpose,
          email_notifications: newSettings.email_notifications,
          document_settings: normalizeCatalog(newSettings.document_settings),
          academic_settings: normalizeInstitutes(newSettings.academic_settings),
          activity_calendar: normalizeActivityCalendar(newSettings.activity_calendar)
        }
      });
    }

    if (error) throw error;

    res.status(200).json({
      success: true,
      settings: {
        contact_email: settings.contact_email,
        office_hours: settings.office_hours,
        daily_queue_limit: settings.daily_queue_limit,
        max_copies_per_request: settings.max_copies_per_request,
        require_purpose: settings.require_purpose,
        email_notifications: settings.email_notifications,
        document_settings: normalizeCatalog(settings.document_settings),
        academic_settings: normalizeInstitutes(settings.academic_settings),
        activity_calendar: normalizeActivityCalendar(settings.activity_calendar)
      }
    });
    
  } catch (err) {
    console.error('Error fetching settings:', err);
    res.status(500).json({ error: err.message });
  }
};

// =============================================
// UPDATE SETTINGS (Admin)
// =============================================
export const updateSettings = async (req, res) => {
  try {
    const {
      contactEmail,
      officeHours,
      dailyQueueLimit,
      maxCopiesPerRequest,
      requirePurpose,
      emailNotifications,
      documentSettings,
      academicSettings,
      activityCalendar
    } = req.body;

    if (!Number.isInteger(Number(dailyQueueLimit)) || Number(dailyQueueLimit) < 1) {
      return res.status(400).json({ error: 'Daily Request limit must be a positive whole number.' });
    }
    if (!Number.isInteger(Number(maxCopiesPerRequest)) || Number(maxCopiesPerRequest) < 1) {
      return res.status(400).json({ error: 'Maximum copies per request must be a positive whole number.' });
    }

    const catalogError = validateDocumentSettings(documentSettings);
    if (catalogError) return res.status(400).json({ error: catalogError });
    const instituteError = validateInstitutes(academicSettings);
    if (instituteError) return res.status(400).json({ error: instituteError });
    let { data: currentSettings, error: fetchError } = await supabase
      .from('system_settings')
      .select('*')
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    const nextActivityCalendar = activityCalendar === undefined
      ? currentSettings?.activity_calendar || DEFAULT_ACTIVITY_CALENDAR
      : activityCalendar;
    const activityCalendarError = validateActivityCalendar(nextActivityCalendar);
    if (activityCalendarError) return res.status(400).json({ error: activityCalendarError });

    const nextCodes = new Set(normalizeInstitutes(academicSettings).map((institute) => institute.code));
    const removedCodes = currentSettings?.academic_settings
      ? normalizeInstitutes(currentSettings.academic_settings)
        .map((institute) => institute.code)
        .filter((code) => !nextCodes.has(code))
      : [];

    for (const code of removedCodes) {
      const { count, error: usersError } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('department', code);
      if (usersError) throw usersError;
      if (count > 0) {
        return res.status(409).json({
          error: `Cannot remove ${code}: ${count} user${count === 1 ? ' is' : 's are'} still assigned to this institute.`
        });
      }
    }

    const updateData = {
      contact_email: contactEmail,
      office_hours: officeHours,
      daily_queue_limit: dailyQueueLimit,
      max_copies_per_request: maxCopiesPerRequest,
      require_purpose: requirePurpose,
      email_notifications: emailNotifications,
      document_settings: normalizeCatalog(documentSettings),
      academic_settings: normalizeInstitutes(academicSettings),
      activity_calendar: normalizeActivityCalendar(nextActivityCalendar),
      updated_at: new Date().toISOString()
    };

    let result;

    if (currentSettings) {
      const { data, error: updateError } = await supabase
        .from('system_settings')
        .update(updateData)
        .eq('id', currentSettings.id)
        .select()
        .single();

      if (updateError) throw updateError;
      result = data;
    } else {
      updateData.created_at = new Date().toISOString();
      const { data, error: insertError } = await supabase
        .from('system_settings')
        .insert([updateData])
        .select()
        .single();

      if (insertError) throw insertError;
      result = data;
    }

    res.status(200).json({
      success: true,
      message: 'Settings updated successfully',
      settings: {
        contact_email: result.contact_email,
        office_hours: result.office_hours,
        daily_queue_limit: result.daily_queue_limit,
        max_copies_per_request: result.max_copies_per_request,
        require_purpose: result.require_purpose,
        email_notifications: result.email_notifications,
        document_settings: normalizeCatalog(result.document_settings),
        academic_settings: normalizeInstitutes(result.academic_settings),
        activity_calendar: normalizeActivityCalendar(result.activity_calendar)
      }
    });
    
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ error: err.message });
  }
};

// =============================================
// 🆕 GET PUBLIC SETTINGS (No Auth Required)
// Used by Student Frontend for fees, limits, etc.
// =============================================
export const getPublicSettings = async (req, res) => {
  try {
    let { data: settings, error } = await supabase
      .from('system_settings')
      .select('contact_email, office_hours, daily_queue_limit, max_copies_per_request, require_purpose, document_settings, academic_settings')
      .single();

    if (error && error.code === 'PGRST116') {
      return res.status(200).json({
        contact_email: 'registrar@trac.edu.ph',
        office_hours: 'Monday to Friday, 8:00 AM - 4:45 PM',
        daily_queue_limit: 100,
        max_copies_per_request: 5,
        require_purpose: true,
        document_settings: DEFAULT_REQUESTS,
        academic_settings: DEFAULT_INSTITUTES
      });
    }

    if (error) {
      return res.status(200).json({
        contact_email: 'registrar@trac.edu.ph',
        office_hours: 'Monday to Friday, 8:00 AM - 4:45 PM',
        daily_queue_limit: 100,
        max_copies_per_request: 5,
        require_purpose: true,
        document_settings: DEFAULT_REQUESTS,
        academic_settings: DEFAULT_INSTITUTES
      });
    }

    res.status(200).json({
      contact_email: settings.contact_email,
      office_hours: settings.office_hours,
      daily_queue_limit: settings.daily_queue_limit,
      max_copies_per_request: settings.max_copies_per_request,
      require_purpose: settings.require_purpose,
      document_settings: normalizeCatalog(settings.document_settings).filter((item) => !item.archived),
      academic_settings: normalizeInstitutes(settings.academic_settings)
    });
    
  } catch (err) {
    console.error('Error fetching public settings:', err);
    res.status(200).json({
      contact_email: 'registrar@trac.edu.ph',
      office_hours: 'Monday to Friday, 8:00 AM - 4:45 PM',
      daily_queue_limit: 100,
      max_copies_per_request: 5,
      require_purpose: true,
      document_settings: DEFAULT_REQUESTS,
      academic_settings: DEFAULT_INSTITUTES
    });
  }
};