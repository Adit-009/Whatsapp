import mongoose from 'mongoose';

const messageTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Template name is required.'],
    trim: true
  },
  body: {
    type: String,
    required: [true, 'Template body is required.'],
    trim: true
  },
  isDefault: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Virtual for template ID compatibility
messageTemplateSchema.set('toJSON', { virtuals: true });
messageTemplateSchema.set('toObject', { virtuals: true });

const MessageTemplate = mongoose.model('MessageTemplate', messageTemplateSchema);

/**
 * Ensure at least one default template exists.
 * Called on server startup to seed the original hardcoded message.
 */
export async function seedDefaultTemplate() {
  const count = await MessageTemplate.countDocuments();
  if (count === 0) {
    await MessageTemplate.create({
      name: 'Fee Reminder',
      body: `Hello {{name}},

This is a reminder that your Installment of course fee is pending.

Due Date: {{dueDate}}

Please complete the payment on or before the due date.

If you have already made the payment, kindly ignore this message.

Thank you.

Regards,
Third Eye Computer Institute`,
      isDefault: true
    });
    console.log('[MongoDB] Default message template seeded.');
  }
}

export default MessageTemplate;
