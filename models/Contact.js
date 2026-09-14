import mongoose from 'mongoose';

const contactSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Contact name is required.'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required.'],
    unique: true,
    trim: true
  },
  lastSent: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: ['idle', 'sent', 'failed'],
    default: 'idle'
  }
}, {
  timestamps: true  // adds createdAt and updatedAt
});

// Virtual to expose _id as 'id' string for backward compatibility with templates
contactSchema.set('toJSON', { virtuals: true });
contactSchema.set('toObject', { virtuals: true });

const Contact = mongoose.model('Contact', contactSchema);

export default Contact;
