const express = require('express');
const Response = require('../models/Response');
const router = express.Router();
const auth = require('../middleware/authMiddleware');


router.post('/submit', auth, async (req, res) => {
  const { surveyId, answers } = req.body;

  const existing = await Response.findOne({ surveyId, userId: req.user.id });
  if (existing) {
    return res.status(400).json({ msg: 'You have already submitted this survey.' });
  }

  const response = new Response({ surveyId, userId: req.user.id, answers });
  await response.save();
  res.json({ msg: 'Response submitted' });
});

module.exports = router;
