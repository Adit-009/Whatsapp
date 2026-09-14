import { Router } from 'express';
import {
  renderIndex,
  addContact,
  sendMessage,
  renderEdit,
  updateContact,
  deleteContact,
  getQRStatus,
  logoutWhatsApp,
  getTemplates,
  addTemplate,
  updateTemplate,
  deleteTemplate,
  setDefaultTemplate
} from '../controllers/whatsapp.controller.js';

const router = Router();

// Render WhatsApp Contact Dashboard
router.get('/', renderIndex);

// Add new contact
router.post('/add', addContact);

// Send predefined WhatsApp message
router.get('/send/:id', sendMessage);

// Render Edit view / load contact state
router.get('/edit/:id', renderEdit);

// Update existing contact
router.post('/update/:id', updateContact);

// Delete contact
router.get('/delete/:id', deleteContact);

// QR code status endpoint (AJAX polling from dashboard)
router.get('/whatsapp/qr-status', getQRStatus);

// Logout WhatsApp session
router.post('/whatsapp/logout', logoutWhatsApp);

// ===== MESSAGE TEMPLATE ROUTES =====
router.get('/templates', getTemplates);
router.post('/templates/add', addTemplate);
router.post('/templates/update/:id', updateTemplate);
router.get('/templates/delete/:id', deleteTemplate);
router.post('/templates/default/:id', setDefaultTemplate);

export default router;
