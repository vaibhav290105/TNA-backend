const mongoose = require('mongoose');

const SurveySchema = new mongoose.Schema({
  title: String,
  questions: [String],
  assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

module.exports = mongoose.model('Survey', SurveySchema);
