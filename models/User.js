const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, enum: ['employee', 'manager', 'hod', 'hr', 'admin'], default: 'employee' },

  department: {
  type: String,
  enum: [
    'Finance',
    'IT',
    'Operations',
    'Marketing',
    'Customer Service',
    'Projects',
    'Engineering',
    'Safety and Compliance',
    'Legal',
    'Procurement',
    'Logistics',
    'Sales',
    'Technical Services',
    'Network Maintenance',
    'Strategy & Planning'
  ]
},
  location: { type: String },

  
  manager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  hod: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  resetToken: String,
  resetTokenExpiry: Date,
  image: { type: String, default: null }
});

module.exports = mongoose.model('User', UserSchema);
