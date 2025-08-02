const express = require('express');
const Survey = require('../models/Survey');
const Response = require('../models/Response');
const auth = require('../middleware/authMiddleware');
const User = require('../models/User');
const router = express.Router();
const sendEmail = require('../utils/sendEmail');


router.post('/create', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).send('Forbidden');

  const { title, questions, assignedTo } = req.body;

  const survey = new Survey({ title, questions, assignedTo });
  await survey.save();

  // Fetch user emails
  const users = await User.find({ _id: { $in: assignedTo } });

  for (const user of users) {
    if (user.email) {
      await sendEmail({
        to: user.email,
        subject: `New Feedback Survey Assigned: ${title}`,
        html: `
          <p>Dear ${user.name},</p>
          <p>A new feedback form titled <strong>${title}</strong> has been assigned to you.</p>
          <p>Please log in to the TNA portal to complete the survey.</p>
        `
      });
    }
  }

  res.json(survey);
});



router.get('/assigned', auth, async (req, res) => {
  const surveys = await Survey.find({ assignedTo: req.user.id });
  res.json(surveys);
});

router.get('/assigned-with-status', auth, async (req, res) => {
  const userId = req.user.id;

  const assignedSurveys = await Survey.find({ assignedTo: userId });
  const responses = await Response.find({ userId });

  const submittedSurveyIds = responses.map((r) => r.surveyId.toString());

  const surveysWithStatus = assignedSurveys.map((survey) => ({
    _id: survey._id,
    title: survey.title,
    status: submittedSurveyIds.includes(survey._id.toString()) ? 'Completed' : 'Pending'
  }));

  res.json(surveysWithStatus);
});


router.get('/:id/my-response', auth, async (req, res) => {
  const userId = req.user.id;
  const surveyId = req.params.id;

  try {
    const survey = await Survey.findById(surveyId).lean();
    if (!survey) return res.status(404).json({ msg: 'Survey not found' });

    const response = await Response.findOne({ surveyId, userId }).lean();

    res.json({
      title: survey.title,
      questions: survey.questions,
      answers: response?.answers || [],
      status: response ? 'Completed' : 'Pending',
      responseId: response?._id || null, // ✅ this was missing
      submittedAt: response?.createdAt || null
    });
  } catch (err) {
    console.error('Error fetching personal survey response:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.get('/created', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ msg: 'Forbidden - admin only' });
    }

    const surveys = await Survey.find({}, 'title _id assignedTo').populate('assignedTo', 'name email').lean();
    
    const enrichedSurveys = await Promise.all(
      surveys.map(async (s) => {
        const responseCount = await Response.countDocuments({surveyId: s._id});
        return { ...s, responseCount};
      })
    )
    res.json(enrichedSurveys);
  } catch (err) {
    console.error('Error fetching surveys:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});
router.get('/:id/responses', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
  
  const survey = await Survey.findById(req.params.id).lean();
  const responses = await Response.find({ surveyId: req.params.id })
    .populate('userId', 'name email department');

  res.json({ questions: survey.questions, responses });
});

router.get('/my-responses', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const responses = await Response.find({ userId })
      .populate('surveyId', 'title questions')
      .lean();

    const formatted = responses.map((r) => ({
      surveyId: r.surveyId._id,
      title: r.surveyId.title,
      questions: r.surveyId.questions,
      answers: r.answers,
      submittedAt: r.createdAt
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Error fetching my feedback responses:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.delete('/response/:surveyId', auth, async (req, res) => {
  const { surveyId } = req.params;
  const userId = req.user.id;

  await Response.findOneAndDelete({ surveyId, userId });
  res.json({ msg: 'Deleted' });
});

router.patch('/update/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { answers } = req.body;

  try {
    const response = await Response.findByIdAndUpdate(
      id,
      { answers },
      { new: true }
    );

    if (!response) return res.status(404).send('Response not found');
    res.json({ msg: 'Response updated' });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error updating response');
  }
});

module.exports = router;

