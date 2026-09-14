import Contact from '../models/Contact.js';
import MessageTemplate from '../models/MessageTemplate.js';
import whatsappService from '../services/whatsapp.service.js';

/**
 * Validate and normalize phone numbers to 91XXXXXXXXXX format.
 * @param {string} phone 
 * @returns {{ valid: boolean, phone?: string, error?: string }}
 */
function normalizePhone(phone) {
  if (!phone) {
    return { valid: false, error: 'WhatsApp number is required.' };
  }

  // Remove any spaces, hyphens, or non-digit characters
  const cleanPhone = String(phone).replace(/\D/g, '');

  if (cleanPhone.length === 10) {
    return { valid: true, phone: `91${cleanPhone}` };
  }

  if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
    return { valid: true, phone: cleanPhone };
  }

  return {
    valid: false,
    error: 'Phone number must be 10 digits (e.g. 9876543210) or 12 digits starting with 91 (e.g. 919876543210).'
  };
}

/**
 * Replace template placeholders with actual values.
 */
function renderTemplate(templateBody, contact) {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 7);
  const formattedDueDate = dueDate.toLocaleDateString("en-IN");

  return templateBody
    .replace(/\{\{name\}\}/gi, contact.name)
    .replace(/\{\{phone\}\}/gi, contact.phone)
    .replace(/\{\{dueDate\}\}/gi, formattedDueDate);
}

// ==============================
//  CONTACT CONTROLLERS
// ==============================

/**
 * Render the main dashboard with contacts list.
 */
export const renderIndex = async (req, res) => {
  try {
    // Query parameters for search & sort
    const searchQuery = (req.query.search || '').trim().toLowerCase();
    const sortBy = req.query.sort || 'name_asc';
    const editId = req.query.edit || null;

    // Build query filter
    let filter = {};
    if (searchQuery) {
      filter = {
        $or: [
          { name: { $regex: searchQuery, $options: 'i' } },
          { phone: { $regex: searchQuery } }
        ]
      };
    }

    // Build sort option
    let sortOption = {};
    if (sortBy === 'name_asc') {
      sortOption = { name: 1 };
    } else if (sortBy === 'name_desc') {
      sortOption = { name: -1 };
    } else if (sortBy === 'newest') {
      sortOption = { createdAt: -1 };
    }

    const contacts = await Contact.find(filter).sort(sortOption).lean();
    const totalCount = await Contact.countDocuments();

    // Find target contact if editing
    let editContact = null;
    if (editId) {
      editContact = await Contact.findById(editId).lean();
    }

    const isConnected = await whatsappService.isConnected();

    // Get default template for preview
    const defaultTemplate = await MessageTemplate.findOne({ isDefault: true }).lean();

    // Alert notifications from query
    const alert = {
      success: req.query.success || null,
      error: req.query.error || null
    };

    res.render('whatsapp/index', {
      contacts,
      totalCount,
      editContact,
      isConnected,
      searchQuery: req.query.search || '',
      sortBy,
      alert,
      defaultTemplate
    });
  } catch (error) {
    console.error('[WhatsAppController] Error rendering index:', error);
    res.status(500).send('Server Error loading WhatsApp module.');
  }
};

/**
 * Add a new WhatsApp contact.
 */
export const addContact = async (req, res) => {
  try {
    const { name, phone } = req.body;

    // 1. Name validation
    if (!name || !name.trim()) {
      return res.redirect('/?error=' + encodeURIComponent('Name is required.'));
    }

    // 2. Phone validation & normalization
    const phoneValidation = normalizePhone(phone);
    if (!phoneValidation.valid) {
      return res.redirect('/?error=' + encodeURIComponent(phoneValidation.error));
    }

    const normalizedPhone = phoneValidation.phone;

    // 3. Prevent duplicate phone numbers
    const existing = await Contact.findOne({ phone: normalizedPhone });
    if (existing) {
      return res.redirect('/?error=' + encodeURIComponent(`Contact with phone ${normalizedPhone} already exists.`));
    }

    // 4. Create new contact
    const newContact = await Contact.create({
      name: name.trim(),
      phone: normalizedPhone
    });

    res.redirect('/?success=' + encodeURIComponent(`Contact "${newContact.name}" added successfully!`));
  } catch (error) {
    console.error('[WhatsAppController] Error adding contact:', error);
    res.redirect('/?error=' + encodeURIComponent('Failed to add contact.'));
  }
};

/**
 * Send WhatsApp message to a contact using the default template.
 */
export const sendMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const contact = await Contact.findById(id);

    if (!contact) {
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ success: false, error: 'Contact not found.' });
      }
      return res.redirect('/?error=' + encodeURIComponent('Contact not found.'));
    }

    // Get default message template
    const template = await MessageTemplate.findOne({ isDefault: true });
    if (!template) {
      const errMsg = 'No default message template found. Please create one in the Templates section.';
      if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(400).json({ success: false, error: errMsg });
      }
      return res.redirect('/?error=' + encodeURIComponent(errMsg));
    }

    // Render the template with contact data
    const messageText = renderTemplate(template.body, contact);

    // Send via WhatsApp service
    const result = await whatsappService.sendMessage(contact.phone, messageText);

    // Update contact metrics
    contact.lastSent = new Date();
    contact.status = result.success ? 'sent' : 'failed';
    await contact.save();

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json({
        success: true,
        messageId: result.messageId,
        whatsappWebUrl: result.whatsappWebUrl || null,
        message: `Message sent to ${contact.name}!`,
        lastSent: contact.lastSent.toISOString(),
        status: contact.status
      });
    }

    res.redirect('/?success=' + encodeURIComponent(`WhatsApp message sent successfully to ${contact.name} (${contact.phone})!`));
  } catch (error) {
    console.error('[WhatsAppController] Error sending message:', error);

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ success: false, error: error.message || 'Failed to send WhatsApp message.' });
    }

    res.redirect('/?error=' + encodeURIComponent(error.message || 'Failed to send WhatsApp message.'));
  }
};

/**
 * Render view with contact data loaded for editing.
 */
export const renderEdit = async (req, res) => {
  const { id } = req.params;
  res.redirect(`/?edit=${id}`);
};

/**
 * Update contact details.
 */
export const updateContact = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone } = req.body;

    if (!name || !name.trim()) {
      return res.redirect(`/?edit=${id}&error=` + encodeURIComponent('Name is required.'));
    }

    const phoneValidation = normalizePhone(phone);
    if (!phoneValidation.valid) {
      return res.redirect(`/?edit=${id}&error=` + encodeURIComponent(phoneValidation.error));
    }

    const normalizedPhone = phoneValidation.phone;
    const contact = await Contact.findById(id);

    if (!contact) {
      return res.redirect('/?error=' + encodeURIComponent('Contact not found.'));
    }

    // Check duplicate phone number excluding current contact
    const duplicate = await Contact.findOne({ phone: normalizedPhone, _id: { $ne: id } });
    if (duplicate) {
      return res.redirect(`/?edit=${id}&error=` + encodeURIComponent(`Another contact with phone ${normalizedPhone} already exists.`));
    }

    // Update details
    contact.name = name.trim();
    contact.phone = normalizedPhone;
    await contact.save();

    res.redirect('/?success=' + encodeURIComponent(`Contact "${contact.name}" updated successfully!`));
  } catch (error) {
    console.error('[WhatsAppController] Error updating contact:', error);
    res.redirect('/?error=' + encodeURIComponent('Failed to update contact.'));
  }
};

/**
 * Delete a contact by ID.
 */
export const deleteContact = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await Contact.findByIdAndDelete(id);

    if (!result) {
      return res.redirect('/?error=' + encodeURIComponent('Contact not found.'));
    }

    res.redirect('/?success=' + encodeURIComponent('Contact deleted successfully.'));
  } catch (error) {
    console.error('[WhatsAppController] Error deleting contact:', error);
    res.redirect('/?error=' + encodeURIComponent('Failed to delete contact.'));
  }
};

/**
 * Get WhatsApp QR code and connection status (JSON endpoint for AJAX polling).
 */
export const getQRStatus = async (req, res) => {
  try {
    const qrData = await whatsappService.getQRCode();
    res.json({
      connected: !!qrData.connected,
      qr: qrData.qr || '',
      serviceOnline: !!qrData.serviceOnline
    });
  } catch (error) {
    console.error('[WhatsAppController] Error fetching QR status:', error);
    res.json({
      connected: false,
      qr: '',
      serviceOnline: false
    });
  }
};

/**
 * Logout WhatsApp session and redirect.
 */
export const logoutWhatsApp = async (req, res) => {
  try {
    await whatsappService.logout();
    res.redirect('/?success=' + encodeURIComponent('WhatsApp session disconnected. You will need to scan QR again.'));
  } catch (error) {
    res.redirect('/?error=' + encodeURIComponent('Failed to logout: ' + error.message));
  }
};

// ==============================
//  MESSAGE TEMPLATE CONTROLLERS
// ==============================

/**
 * Render the templates management page.
 */
export const getTemplates = async (req, res) => {
  try {
    const templates = await MessageTemplate.find().sort({ isDefault: -1, createdAt: -1 }).lean();
    const editId = req.query.edit || null;
    let editTemplate = null;
    if (editId) {
      editTemplate = await MessageTemplate.findById(editId).lean();
    }

    const alert = {
      success: req.query.success || null,
      error: req.query.error || null
    };

    res.render('whatsapp/templates', {
      templates,
      editTemplate,
      alert
    });
  } catch (error) {
    console.error('[WhatsAppController] Error rendering templates:', error);
    res.status(500).send('Server Error loading templates.');
  }
};

/**
 * Add a new message template.
 */
export const addTemplate = async (req, res) => {
  try {
    const { name, body } = req.body;

    if (!name || !name.trim()) {
      return res.redirect('/templates?error=' + encodeURIComponent('Template name is required.'));
    }
    if (!body || !body.trim()) {
      return res.redirect('/templates?error=' + encodeURIComponent('Template body is required.'));
    }

    await MessageTemplate.create({
      name: name.trim(),
      body: body.trim()
    });

    res.redirect('/templates?success=' + encodeURIComponent(`Template "${name.trim()}" created successfully!`));
  } catch (error) {
    console.error('[WhatsAppController] Error adding template:', error);
    res.redirect('/templates?error=' + encodeURIComponent('Failed to create template.'));
  }
};

/**
 * Update an existing message template.
 */
export const updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, body } = req.body;

    if (!name || !name.trim()) {
      return res.redirect(`/templates?edit=${id}&error=` + encodeURIComponent('Template name is required.'));
    }
    if (!body || !body.trim()) {
      return res.redirect(`/templates?edit=${id}&error=` + encodeURIComponent('Template body is required.'));
    }

    const template = await MessageTemplate.findById(id);
    if (!template) {
      return res.redirect('/templates?error=' + encodeURIComponent('Template not found.'));
    }

    template.name = name.trim();
    template.body = body.trim();
    await template.save();

    res.redirect('/templates?success=' + encodeURIComponent(`Template "${template.name}" updated successfully!`));
  } catch (error) {
    console.error('[WhatsAppController] Error updating template:', error);
    res.redirect('/templates?error=' + encodeURIComponent('Failed to update template.'));
  }
};

/**
 * Delete a message template.
 */
export const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await MessageTemplate.findById(id);

    if (!template) {
      return res.redirect('/templates?error=' + encodeURIComponent('Template not found.'));
    }

    if (template.isDefault) {
      return res.redirect('/templates?error=' + encodeURIComponent('Cannot delete the default template. Set another template as default first.'));
    }

    await MessageTemplate.findByIdAndDelete(id);
    res.redirect('/templates?success=' + encodeURIComponent('Template deleted successfully.'));
  } catch (error) {
    console.error('[WhatsAppController] Error deleting template:', error);
    res.redirect('/templates?error=' + encodeURIComponent('Failed to delete template.'));
  }
};

/**
 * Set a template as the default one.
 */
export const setDefaultTemplate = async (req, res) => {
  try {
    const { id } = req.params;

    // Remove default from all templates
    await MessageTemplate.updateMany({}, { isDefault: false });

    // Set the new default
    const template = await MessageTemplate.findByIdAndUpdate(id, { isDefault: true }, { new: true });

    if (!template) {
      return res.redirect('/templates?error=' + encodeURIComponent('Template not found.'));
    }

    res.redirect('/templates?success=' + encodeURIComponent(`"${template.name}" is now the default template.`));
  } catch (error) {
    console.error('[WhatsAppController] Error setting default template:', error);
    res.redirect('/templates?error=' + encodeURIComponent('Failed to set default template.'));
  }
};
