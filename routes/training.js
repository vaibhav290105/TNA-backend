const express = require('express');
const router = express.Router();
const TrainingNeed = require('../models/TrainingNeed');
const auth = require('../middleware/authMiddleware');
const User = require('../models/User');
const mongoose = require('mongoose');
const sendEmail = require('../sendEmail');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
// Submit training request (Employee)
router.post('/submit', auth, async (req, res) => {
  try {
    let status = 'Pending_Manager';
    let assignedManager = null;
    let notifyToEmail = null;
    let notifyToName = null;

    if (req.user.role === 'manager') {
      status = 'Pending_HOD';
      const hod = await User.findOne({ role: 'hod', department: req.user.department });
      if (hod) {
        notifyToEmail = hod.email;
        notifyToName = hod.name;
      }

    } else if (req.user.role === 'hod') {
      status = 'Pending_HR';
      const hr = await User.findOne({ role: 'hr' });
      if (hr) {
        notifyToEmail = hr.email;
        notifyToName = hr.name;
      }

    } else if (req.user.role === 'hr') {
      status = 'Pending_Admin';
      const admin = await User.findOne({ role: 'admin' });
      if (admin) {
        notifyToEmail = admin.email;
        notifyToName = admin.name;
      }

    } else if (req.user.role === 'employee') {
      const userDoc = await User.findById(req.user._id).select('manager');
      if (!userDoc || !userDoc.manager) {
        return res.status(400).json({ msg: 'No manager assigned to this employee' });
      }
      assignedManager = userDoc.manager;

      const manager = await User.findById(assignedManager);
      if (manager) {
        notifyToEmail = manager.email;
        notifyToName = manager.name;
      }
    }

    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(100 + Math.random() * 900);
    const requestNumber = `TRN-${timestamp}-${random}`;

    const trainingNeed = new TrainingNeed({
      user: req.user._id,
      department: req.user.department,
      ...req.body,
      requestNumber,
      status,
      manager: assignedManager
    });

    await trainingNeed.save();

    // Send email to the reviewer
    if (notifyToEmail) {
      await sendEmail({
        to: notifyToEmail,
        subject: 'New Training Request Awaiting Your Review',
        html: `
          <p>Dear ${notifyToName},</p>
          <p>A new training request <strong>${requestNumber}</strong> has been submitted by <b>${req.user.name}</b> from <b>${req.user.department}</b> department.</p>
          <p>Please login to the TNA portal to review it.</p>
        `
      });
    }

    res.json({ msg: 'Training request submitted successfully', requestNumber });

  } catch (err) {
    console.error('Training Request Submission Error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});





// Get all training requests
router.get('/all', auth, async (req, res) => {
  try {
    let requests;

    if (req.user.role === 'admin') {
     
      requests = await TrainingNeed.find({
        status: { $in: ['Approved_By_HR', 'Pending_Admin'] }
      })
        .populate('user', 'name email department role location')
        .sort({ createdAt: -1 });

    } else if (req.user.role === 'hr') {
      requests = await TrainingNeed.find({
        status: { $in: ['Approved_By_HOD', 'Pending_Admin'] }
      })
        .populate('user', 'name email department role location')
        .sort({ createdAt: -1 });

    } else if (req.user.role === 'manager') {
  
      requests = await TrainingNeed.find({ manager: req.user._id })
        .populate('user', 'name email department role location')
        .sort({ createdAt: -1 });

    } else if (req.user.role === 'hod') {
      
      requests = await TrainingNeed.find({ status: 'Pending_HOD' })
        .populate('user', 'name email department role location')
        .sort({ createdAt: -1 });

    } else {
      return res.status(403).json({ msg: 'Forbidden' });
    }

    res.json(requests);
  } catch (err) {
    console.error('Fetching Training Requests Error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});


// My Requests
router.get('/my-requests', auth, async (req, res) => {
  try {
    const requests = await TrainingNeed.find({ user: req.user.id })
      .populate('user', 'name department location')
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    console.error('Fetching My Training Requests Error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Manager review requests
router.get('/manager-review', auth, async (req, res) => {
  if (req.user.role !== 'manager') return res.status(403).send('Forbidden');

  const requests = await TrainingNeed.find({
    status: 'Pending_Manager',
    manager: req.user._id  
  })
    .populate('user', 'name department')
    .sort({ createdAt: -1 });

  res.json(requests);
});


// Approve or Reject (Manager)
router.patch('/manager-review/:id', auth, async (req, res) => {
  const { decision } = req.body;

  if (req.user.role !== 'manager') return res.status(403).send('Forbidden');

  const request = await TrainingNeed.findById(req.params.id).populate('user');

  if (!request) return res.status(404).send('Training request not found');

  if (!request.manager || request.manager.toString() !== req.user._id.toString()) {
    return res.status(403).send('You are not assigned to this request');
  }

  if (request.status !== 'Pending_Manager') {
    return res.status(400).send('Request already reviewed or not in Pending_Manager state');
  }

  // Update request status
  if (decision === 'approve') {
    request.status = 'Pending_HOD';
  } else {
    request.status = 'Rejected_By_Manager';
  }
  request.reviewedByManager = req.user._id;

  await request.save();

  // Notify the original requester
  if (request.user?.email) {
    await sendEmail({
      to: request.user.email,
      subject: `Training Request ${decision === 'approve' ? 'Approved' : 'Rejected'} by Manager`,
      html: `
        <p>Dear ${request.user.name},</p>
        <p>Your training request <b>${request.requestNumber}</b> has been <strong>${decision.toUpperCase()}</strong> by your manager.</p>
        <p>Current Status: <b>${request.status}</b></p>
        <p>Please login to the TNA portal for more details.</p>
      `
    });
  }

  res.json({ msg: `Training request ${request.status}` });
});





// HOD Review
router.get('/hod-review', auth, async (req, res) => {
  if (req.user.role !== 'hod') return res.status(403).send('Forbidden');

  const requests = await TrainingNeed.find({ status: 'Pending_HOD' })
    .populate('user', 'name email department role')
    .sort({ createdAt: -1 });

  res.json(requests);
});


router.patch('/hod-review/:id', auth, async (req, res) => {
  if (req.user.role !== 'hod') return res.status(403).send('Forbidden');

  const { decision } = req.body;
  const status = decision === 'approve' ? 'Approved_By_HOD' : 'Rejected_By_HOD';

  const request = await TrainingNeed.findByIdAndUpdate(
    req.params.id,
    {
      status,
      reviewedByHOD: req.user._id,
    },
    { new: true }
  ).populate('user');

  if (!request) return res.status(404).send('Request not found');

  // Notify the requester
  if (request.user?.email) {
    await sendEmail({
      to: request.user.email,
      subject: `Training Request ${decision === 'approve' ? 'Approved' : 'Rejected'} by HOD`,
      html: `
        <p>Dear ${request.user.name},</p>
        <p>Your training request <strong>${request.requestNumber}</strong> has been <strong>${decision.toUpperCase()}</strong> by the HOD.</p>
        <p>Current Status: <b>${request.status}</b></p>
        <p>Please login to the TNA portal for more details.</p>
      `
    });
  }

  res.json({ msg: `Training request ${status}` });
});




// Admin Review (Only if HOD approved)
router.get('/admin-review', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).send('Forbidden');

  const requests = await TrainingNeed.find({
    $or: [
      { status: 'Approved_By_HR' },
      { status: 'Pending_Admin' }
    ]
  })
  .populate('user', 'name department role');

  res.json(requests);
});


router.patch('/admin-review/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).send('Forbidden');

  const { decision } = req.body;
  const status = decision === 'approve' ? 'Approved_By_Admin' : 'Rejected_By_Admin';

  const request = await TrainingNeed.findByIdAndUpdate(
    req.params.id,
    {
      status,
      reviewedByAdmin: req.user._id,
    },
    { new: true }
  ).populate('user');

  if (!request) return res.status(404).json({ msg: 'Request not found' });

  // Notify the requester via email
  if (request.user?.email) {
    await sendEmail({
      to: request.user.email,
      subject: `Training Request ${decision === 'approve' ? 'Approved' : 'Rejected'} by Admin`,
      html: `
        <p>Dear ${request.user.name},</p>
        <p>Your training request <strong>${request.requestNumber}</strong> has been <strong>${decision.toUpperCase()}</strong> by the Admin.</p>
        <p>Final Status: <b>${request.status}</b></p>
        <p>Please login to the TNA portal to review the details.</p>
      `
    });
  }

  res.json({ msg: `Training request ${status}` });
});

router.get('/admin/:id', async (req, res) => {
  try {
    const request = await TrainingNeed.findOne({
      $or: [
        { _id: isValidObjectId(req.params.id) ? req.params.id : null },
        { requestNumber: req.params.id }
      ]
    }).populate('user');

    if (!request) return res.status(404).json({ msg: 'Request not found' });
    res.json(request);
  } catch (err) {
    console.error('Error fetching request by ID:', err.message);
    res.status(500).json({ msg: 'Internal Server Error' });
  }
});


// HR Review
router.get('/hr-review', auth, async (req, res) => {
  if (req.user.role !== 'hr') return res.status(403).send('Forbidden');

  const requests = await TrainingNeed.find({ $or: [
      { status: 'Pending_HR' },
      { status: 'Approved_By_HOD' }
    ] })
    .populate('user', 'name email department role')
    .sort({ createdAt: -1 });

  res.json(requests);
});

router.patch('/hr-review/:id', auth, async (req, res) => {
  if (req.user.role !== 'hr') return res.status(403).send('Forbidden');

  const { decision } = req.body;
  const finalStatus = decision === 'approve' ? 'Pending_Admin' : 'Rejected_By_HR';

  const request = await TrainingNeed.findByIdAndUpdate(
    req.params.id,
    {
      status: finalStatus,
      reviewedByHR: req.user._id,
    },
    { new: true }
  ).populate('user');

  if (!request) return res.status(404).json({ msg: 'Request not found' });

  // Notify the user who created the request
  if (request.user?.email) {
    await sendEmail({
      to: request.user.email,
      subject: `Training Request ${decision === 'approve' ? 'Approved' : 'Rejected'} by HR`,
      html: `
        <p>Dear ${request.user.name},</p>
        <p>Your training request <strong>${request.requestNumber}</strong> has been <strong>${decision.toUpperCase()}</strong> by HR.</p>
        <p>Current Status: <b>${finalStatus}</b></p>
        <p>Please log in to the TNA portal to track progress.</p>
      `
    });
  }

  res.json({ msg: `Training request ${finalStatus}` });
});

router.delete('/:id', async (req, res) => {
  try {
    const request = await TrainingNeed.findByIdAndDelete(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });
    res.status(200).json({ message: 'Request deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error while deleting request' });
  }
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'Invalid request ID' });
  }

  try {
    const request = await TrainingNeed.findById(id).populate('user');
    if (!request) return res.status(404).json({ message: 'Request not found' });
    res.json(request);
  } catch (error) {
    console.error("Error loading training request:", error);
    res.status(500).json({ message: 'Internal Server Error', error });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const request = await TrainingNeed.findByIdAndUpdate(
      req.params.id,
      { ...req.body },
      { new: true }
    );
    if (!request) return res.status(404).json({ message: 'Request not found' });
    res.json({ message: 'Request updated successfully', request });
  } catch (err) {
    res.status(500).json({ message: 'Server error while updating request' });
  }
});



module.exports = router;
